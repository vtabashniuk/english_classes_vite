import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (body: Record<string, unknown>, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      ...corsHeaders,
      "Cache-Control": "no-store",
    },
  });

const toNbuDate = (isoDate: string) => isoDate.replaceAll("-", "");

const fromNbuDate = (value: string) => {
  const match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);

  if (!match) return null;

  return `${match[3]}-${match[2]}-${match[1]}`;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  try {
    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse({ error: "AUTH_REQUIRED" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      throw new Error("Supabase environment variables are missing");
    }

    const body = await req.json().catch(() => null);
    const paymentId = typeof body?.paymentId === "string" ? body.paymentId : "";

    if (!paymentId) {
      return jsonResponse({ error: "PAYMENT_ID_REQUIRED" }, 400);
    }

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: {
          Authorization: authorization,
        },
      },
    });

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "INVALID_SESSION" }, 401);
    }

    const { data: profile, error: profileError } = await supabaseUser
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || !profile || profile.role !== "teacher" || !profile.is_active) {
      return jsonResponse({ error: "TEACHER_REQUIRED" }, 403);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Ensure the management-reporting snapshot exists even for personal/cash
    // foreign-currency receipts that do not create a PE tax accrual.
    const { data: reportingCreate, error: reportingCreateError } = await supabaseAdmin.rpc(
      "create_payment_reporting_value_if_needed",
      { p_payment_id: paymentId },
    );

    if (reportingCreateError) {
      console.error("Reporting value create error:", reportingCreateError);
      return jsonResponse({ error: "PAYMENT_REPORTING_VALUE_FAILED" }, 500);
    }

    const reporting = Array.isArray(reportingCreate)
      ? reportingCreate[0]
      : reportingCreate;

    if (!reporting || reporting.teacher_id !== user.id) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    const { data: accrual, error: accrualError } = await supabaseUser
      .from("payment_tax_accruals")
      .select(
        "payment_id, teacher_id, income_date, source_currency, status, fx_rate, fx_rate_date, tax_base_uah_minor, single_tax_minor, military_levy_minor, total_income_taxes_minor",
      )
      .eq("payment_id", paymentId)
      .maybeSingle();

    if (accrualError) {
      console.error("Tax accrual lookup error:", accrualError);
      return jsonResponse({ error: "TAX_ACCRUAL_LOOKUP_FAILED" }, 500);
    }

    if (accrual && accrual.teacher_id !== user.id) {
      return jsonResponse({ error: "FORBIDDEN" }, 403);
    }

    if (reporting.status === "ready" && (!accrual || accrual.status === "ready")) {
      return jsonResponse({ success: true, reporting, accrual });
    }

    const sourceCurrency = String(reporting.source_currency ?? "").toUpperCase();
    const rateDateSource = String(reporting.payment_date ?? accrual?.income_date ?? "");

    if (sourceCurrency === "UAH") {
      // Reporting should already be ready for UAH. A PE UAH tax accrual is also
      // calculated synchronously by the database.
      return jsonResponse({ success: true, reporting, accrual });
    }

    if (!["USD", "EUR"].includes(sourceCurrency)) {
      return jsonResponse({ error: "UNSUPPORTED_CURRENCY" }, 400);
    }

    if (!rateDateSource) {
      return jsonResponse({ error: "PAYMENT_DATE_REQUIRED" }, 409);
    }

    const nbuUrl = new URL(
      "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangenew",
    );
    nbuUrl.searchParams.set("json", "");
    nbuUrl.searchParams.set("valcode", sourceCurrency);
    nbuUrl.searchParams.set("date", toNbuDate(rateDateSource));

    const nbuResponse = await fetch(nbuUrl, {
      headers: {
        Accept: "application/json",
      },
    });

    if (!nbuResponse.ok) {
      console.error("NBU API response:", nbuResponse.status);
      return jsonResponse({ error: "NBU_RATE_UNAVAILABLE" }, 503);
    }

    const nbuData = await nbuResponse.json().catch(() => null);
    const rateRow = Array.isArray(nbuData) ? nbuData[0] : null;
    const rate = Number(rateRow?.rate);
    const rateDate = fromNbuDate(String(rateRow?.exchangedate ?? ""));
    const currency = String(rateRow?.cc ?? "").toUpperCase();

    if (
      !rateRow ||
      !Number.isFinite(rate) ||
      rate <= 0 ||
      !rateDate ||
      currency !== sourceCurrency
    ) {
      console.error("Unexpected NBU payload:", nbuData);
      return jsonResponse({ error: "NBU_RATE_INVALID" }, 502);
    }

    const { data: finalizedReporting, error: reportingFinalizeError } =
      await supabaseAdmin.rpc("finalize_payment_reporting_value", {
        p_payment_id: paymentId,
        p_fx_rate: rate,
        p_fx_rate_date: rateDate,
      });

    if (reportingFinalizeError) {
      console.error("Reporting value finalize error:", reportingFinalizeError);
      return jsonResponse({ error: "PAYMENT_REPORTING_FINALIZE_FAILED" }, 500);
    }

    let finalizedAccrual = accrual;

    if (accrual && accrual.status === "fx_pending") {
      const { data, error: finalizeError } = await supabaseAdmin.rpc(
        "finalize_payment_tax_accrual",
        {
          p_payment_id: paymentId,
          p_fx_rate: rate,
          p_fx_rate_date: rateDate,
        },
      );

      if (finalizeError) {
        console.error("Tax accrual finalize error:", finalizeError);
        return jsonResponse({ error: "TAX_ACCRUAL_FINALIZE_FAILED" }, 500);
      }

      finalizedAccrual = data;
    }

    return jsonResponse({
      success: true,
      reporting: finalizedReporting,
      accrual: finalizedAccrual,
      nbu: {
        currency,
        rate,
        rateDate,
      },
    });
  } catch (error) {
    console.error("resolve-payment-tax error:", error);
    return jsonResponse({ error: "INTERNAL_ERROR" }, 500);
  }
});
