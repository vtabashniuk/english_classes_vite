import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const jsonResponse = (body: Record<string, unknown>, status: number) =>
  Response.json(body, {
    status,
    headers: corsHeaders,
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authorization = req.headers.get("Authorization");

    if (!authorization) {
      return jsonResponse({ error: "Необхідна авторизація." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
      throw new Error("Supabase environment variables are missing");
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
      return jsonResponse({ error: "Недійсна сесія." }, 401);
    }

    const { data: profile, error: profileError } = await supabaseUser
      .from("profiles")
      .select("role, is_active")
      .eq("id", user.id)
      .single();

    if (profileError || !profile) {
      return jsonResponse({ error: "Не вдалося перевірити профіль." }, 403);
    }

    if (profile.role !== "teacher" || !profile.is_active) {
      return jsonResponse(
        { error: "Запрошувати учнів може лише активний викладач." },
        403,
      );
    }

    const body = await req.json().catch(() => null);
    const email = body?.email;
    const fullName = body?.fullName;

    const normalizedEmail =
      typeof email === "string" ? email.trim().toLowerCase() : "";
    const normalizedFullName =
      typeof fullName === "string" ? fullName.trim() : "";

    if (!normalizedEmail) {
      return jsonResponse({ error: "Email є обов'язковим." }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    const appUrl = (
      Deno.env.get("APP_URL") ??
      "https://english-classes-sigma.vercel.app"
    ).replace(/\/+$/, "");

    const redirectTo = `${appUrl}/set-password`;

    // Compatibility/recovery path for users invited before teacher_students
    // existed. Such a profile may exist in auth/profiles but be invisible to the
    // teacher after scoped RLS because no relationship row exists yet.
    const { data: existingProfile, error: existingProfileError } =
      await supabaseAdmin
        .from("profiles")
        .select("id, role, is_active")
        .eq("email", normalizedEmail)
        .maybeSingle();

    if (existingProfileError) {
      console.error("Existing profile lookup error:", existingProfileError);
      throw new Error("Не вдалося перевірити існуючий профіль.");
    }

    if (existingProfile) {
      if (existingProfile.role !== "student") {
        return jsonResponse(
          { error: "Користувач з таким email вже існує і не є учнем." },
          409,
        );
      }

      if (!existingProfile.is_active) {
        return jsonResponse(
          { error: "Профіль учня з таким email деактивований." },
          409,
        );
      }

      const { data: relationships, error: relationshipsError } =
        await supabaseAdmin
          .from("teacher_students")
          .select("teacher_id, is_active")
          .eq("student_id", existingProfile.id);

      if (relationshipsError) {
        console.error("Relationship lookup error:", relationshipsError);
        throw new Error("Не вдалося перевірити зв'язок учня з викладачем.");
      }

      const activeRelationship = relationships?.find((item) => item.is_active);

      if (activeRelationship && activeRelationship.teacher_id !== user.id) {
        return jsonResponse(
          { error: "Учень уже прив'язаний до іншого активного викладача." },
          409,
        );
      }

      if (activeRelationship?.teacher_id === user.id) {
        // Idempotent invite: from the product point of view the relationship is
        // already correct, so do not surface this as an application error.
        return jsonResponse(
          {
            success: true,
            userId: existingProfile.id,
            email: normalizedEmail,
            existingUser: true,
            alreadyLinked: true,
          },
          200,
        );
      }

      const historicalOtherTeacher = relationships?.find(
        (item) => item.teacher_id !== user.id,
      );

      if (historicalOtherTeacher) {
        return jsonResponse(
          {
            error:
              "Учень раніше був прив'язаний до іншого викладача. Потрібне окреме перенесення учня.",
          },
          409,
        );
      }

      const ownHistoricalRelationship = relationships?.find(
        (item) => item.teacher_id === user.id,
      );

      const { error: relationshipError } = ownHistoricalRelationship
        ? await supabaseAdmin
            .from("teacher_students")
            .update({ is_active: true })
            .eq("teacher_id", user.id)
            .eq("student_id", existingProfile.id)
        : await supabaseAdmin.from("teacher_students").insert({
            teacher_id: user.id,
            student_id: existingProfile.id,
            is_active: true,
          });

      if (relationshipError) {
        console.error("Existing student relationship error:", relationshipError);
        return jsonResponse(
          { error: "Не вдалося відновити зв'язок викладача з учнем." },
          409,
        );
      }

      return jsonResponse(
        {
          success: true,
          userId: existingProfile.id,
          email: normalizedEmail,
          existingUser: true,
          relationshipRestored: true,
        },
        200,
      );
    }

    const { data, error: inviteError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: {
          full_name: normalizedFullName,
          role: "student",
        },
        redirectTo,
      });

    if (inviteError) {
      console.error("Invite error:", inviteError);
      return jsonResponse({ error: inviteError.message }, 400);
    }

    const studentId = data.user?.id;

    if (!studentId) {
      throw new Error("Invite succeeded without a user id.");
    }

    const { error: relationshipError } = await supabaseAdmin
      .from("teacher_students")
      .insert({
        teacher_id: user.id,
        student_id: studentId,
        is_active: true,
      });

    if (relationshipError) {
      console.error("Teacher/student relationship error:", relationshipError);

      const { error: cleanupError } =
        await supabaseAdmin.auth.admin.deleteUser(studentId);

      if (cleanupError) {
        console.error("Invite rollback error:", cleanupError);
      }

      return jsonResponse(
        {
          error:
            relationshipError.code === "23505"
              ? "Учень уже прив'язаний до іншого активного викладача."
              : "Не вдалося створити зв'язок викладача з учнем.",
        },
        409,
      );
    }

    return jsonResponse(
      {
        success: true,
        userId: studentId,
        email: normalizedEmail,
      },
      200,
    );
  } catch (error) {
    console.error("invite-student error:", error);

    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Невідома помилка.",
      },
      500,
    );
  }
});
