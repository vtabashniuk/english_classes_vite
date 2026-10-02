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
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
};

const shiftIsoDate = (isoDate: string, days: number) => {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const getDateInTimeZone = (timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const fetchNbuRate = async (currency: "USD" | "EUR", requestedDate: string) => {
  // NBU normally has a rate for every calendar date. The short fallback window
  // also covers any exceptional publication gap without blocking the dashboard.
  for (let offset = 0; offset <= 7; offset += 1) {
    const lookupDate = shiftIsoDate(requestedDate, -offset);
    const nbuUrl = new URL(
      "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangenew",
    );
    nbuUrl.searchParams.set("json", "");
    nbuUrl.searchParams.set("valcode", currency);
    nbuUrl.searchParams.set("date", toNbuDate(lookupDate));

    const response = await fetch(nbuUrl, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) continue;

    const payload = await response.json().catch(() => null);
    const row = Array.isArray(payload) ? payload[0] : null;
    const rate = Number(row?.rate);
    const rateDate = fromNbuDate(String(row?.exchangedate ?? ""));
    const returnedCurrency = String(row?.cc ?? "").toUpperCase();

    if (
      row &&
      Number.isFinite(rate) &&
      rate > 0 &&
      rateDate &&
      returnedCurrency === currency
    ) {
      return {
        currency,
        rate_date: rateDate,
        rate_uah_per_unit: rate,
        source: "NBU",
        fetched_at: new Date().toISOString(),
      };
    }
  }

  throw new Error(`NBU_RATE_UNAVAILABLE_${currency}`);
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

    const supabaseUser = createClient(supabaseUrl, supabaseAnonKey, {
      global: {
        headers: { Authorization: authorization },
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

    const body = await req.json().catch(() => null);
    const requestedBodyDate =
      typeof body?.rateDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.rateDate)
        ? body.rateDate
        : null;

    const { data: settings } = await supabaseUser
      .from("teacher_settings")
      .select("schedule_timezone")
      .eq("teacher_id", user.id)
      .maybeSingle();

    const rateDate =
      requestedBodyDate ||
      getDateInTimeZone(settings?.schedule_timezone || "Europe/Kyiv");

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const { data: cached, error: cacheError } = await supabaseAdmin
      .from("finance_nbu_exchange_rates")
      .select("currency, rate_date, rate_uah_per_unit, source, fetched_at")
      .eq("rate_date", rateDate)
      .in("currency", ["USD", "EUR"]);

    if (!cacheError && (cached?.length ?? 0) === 2) {
      return jsonResponse({ success: true, requestedDate: rateDate, rates: cached });
    }

    const rates = await Promise.all([
      fetchNbuRate("USD", rateDate),
      fetchNbuRate("EUR", rateDate),
    ]);

    const { data: stored, error: upsertError } = await supabaseAdmin
      .from("finance_nbu_exchange_rates")
      .upsert(rates, { onConflict: "currency,rate_date" })
      .select("currency, rate_date, rate_uah_per_unit, source, fetched_at");

    if (upsertError) {
      console.error("FX rate upsert error:", upsertError);
      return jsonResponse({ error: "FX_RATE_STORE_FAILED" }, 500);
    }

    return jsonResponse({ success: true, requestedDate: rateDate, rates: stored });
  } catch (error) {
    console.error("refresh-finance-fx-rates error:", error);
    return jsonResponse({ error: "NBU_RATE_UNAVAILABLE" }, 503);
  }
});
