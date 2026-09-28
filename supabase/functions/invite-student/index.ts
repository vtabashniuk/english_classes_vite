import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders,
    });
  }

  try {
    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return Response.json(
        {
          error: "Необхідна авторизація.",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get(
      "SUPABASE_SERVICE_ROLE_KEY"
    );

    if (
      !supabaseUrl ||
      !supabaseAnonKey ||
      !serviceRoleKey
    ) {
      throw new Error(
        "Supabase environment variables are missing"
      );
    }

    // Клієнт від імені поточного користувача
    const supabaseUser = createClient(
      supabaseUrl,
      supabaseAnonKey,
      {
        global: {
          headers: {
            Authorization: authorization,
          },
        },
      }
    );

    // Перевіряємо реального користувача через Auth API
    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return Response.json(
        {
          error: "Недійсна сесія.",
        },
        {
          status: 401,
          headers: corsHeaders,
        }
      );
    }

    // Перевіряємо роль через profiles
    const { data: profile, error: profileError } =
      await supabaseUser
        .from("profiles")
        .select("role, is_active")
        .eq("id", user.id)
        .single();

    if (profileError || !profile) {
      return Response.json(
        {
          error: "Не вдалося перевірити профіль.",
        },
        {
          status: 403,
          headers: corsHeaders,
        }
      );
    }

    if (
      profile.role !== "teacher" ||
      !profile.is_active
    ) {
      return Response.json(
        {
          error:
            "Запрошувати учнів може лише активний викладач.",
        },
        {
          status: 403,
          headers: corsHeaders,
        }
      );
    }

    const { email, fullName } = await req.json();

    const normalizedEmail =
      typeof email === "string"
        ? email.trim().toLowerCase()
        : "";

    const normalizedFullName =
      typeof fullName === "string"
        ? fullName.trim()
        : "";

    if (!normalizedEmail) {
      return Response.json(
        {
          error: "Email є обов'язковим.",
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    // Admin-клієнт: тільки всередині Edge Function
    const supabaseAdmin = createClient(
      supabaseUrl,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Redirect is controlled by server configuration, not by a caller-provided
    // Origin header. APP_URL can be set as an Edge Function secret for
    // staging/production environments.
    const appUrl = (
      Deno.env.get("APP_URL") ??
      "https://english-classes-sigma.vercel.app"
    ).replace(/\/+$/, "");

    const redirectTo = `${appUrl}/set-password`;

    const { data, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(
        normalizedEmail,
        {
          data: {
            full_name: normalizedFullName,
            role: "student",
          },
          redirectTo,
        }
      );

    if (inviteError) {
      console.error("Invite error:", inviteError);

      return Response.json(
        {
          error: inviteError.message,
        },
        {
          status: 400,
          headers: corsHeaders,
        }
      );
    }

    return Response.json(
      {
        success: true,
        userId: data.user?.id,
        email: normalizedEmail,
      },
      {
        status: 200,
        headers: corsHeaders,
      }
    );
  } catch (error) {
    console.error("invite-student error:", error);

    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Невідома помилка.",
      },
      {
        status: 500,
        headers: corsHeaders,
      }
    );
  }
});