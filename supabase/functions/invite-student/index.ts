import { createClient } from "npm:@supabase/supabase-js@2";
import { resolveInvitationMethod } from "./invitation-mode.mjs";

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

    let invitationMethod: string;
    try {
      invitationMethod = resolveInvitationMethod(body?.invitationMethod);
    } catch {
      return jsonResponse({ error: "Невідомий спосіб запрошення." }, 400);
    }

    if (!normalizedEmail) {
      return jsonResponse({ error: "Email є обов'язковим." }, 400);
    }

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    if (invitationMethod === "google_no_email") {
      // The identity in this RPC is always taken from the validated JWT.
      // No Auth user, profile, teacher/student link, or email is created here.
      const { data: invitationId, error: invitationError } =
        await supabaseAdmin.rpc("create_pending_google_invitation", {
          p_teacher_id: user.id,
          p_email: normalizedEmail,
          p_full_name: normalizedFullName,
        });

      if (invitationError) {
        console.error("Pending Google invitation RPC error:", invitationError);
        const message = invitationError.message ?? "";
        if (message.includes("INVITATION_ACCOUNT_ALREADY_EXISTS")) {
          return jsonResponse(
            { error: "Користувач із таким email уже існує. Потрібен окремий сценарій прив'язування." },
            409,
          );
        }
        if (message.includes("INVITATION_INVALID_DETAILS")) {
          return jsonResponse({ error: "Перевірте email та ім'я учня." }, 400);
        }
        if (message.includes("INVITATION_TEACHER_NOT_ACTIVE")) {
          return jsonResponse({ error: "Запрошувати учнів може лише активний викладач." }, 403);
        }
        return jsonResponse(
          { error: "Не вдалося зберегти Google-запрошення." },
          500,
        );
      }

      if (!invitationId) {
        return jsonResponse({ error: "Не вдалося отримати ID запрошення." }, 500);
      }

      return jsonResponse({
        success: true,
        email: normalizedEmail,
        invitationId,
        invitationMethod: "google_no_email",
        pendingActivation: true,
        emailSent: false,
      }, 200);
    }

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

    // Gate 3a.2-A: only the trusted server can issue admission tickets. The
    // caller's JWT has been verified and the active teacher profile checked.
    // The ticket is never returned to the browser or written to logs.
    const { data: admissionTicket, error: admissionError } =
      await supabaseAdmin.rpc("issue_email_invitation_admission", {
        p_teacher_id: user.id,
        p_email: normalizedEmail,
      });

    if (admissionError) {
      const code = admissionError.message ?? "";
      if (code.includes("ADMISSION_ACCOUNT_ALREADY_EXISTS")) {
        return jsonResponse(
          { error: "Користувач із таким email уже існує. Перевірте його профіль." },
          409,
        );
      }
      if (code.includes("ADMISSION_INVALID_EMAIL")) {
        return jsonResponse({ error: "Перевірте правильність email." }, 400);
      }
      if (code.includes("ADMISSION_TEACHER_NOT_ACTIVE")) {
        return jsonResponse(
          { error: "Запрошувати учнів може лише активний викладач." },
          403,
        );
      }
      console.error("Email admission issue failed:", admissionError.code);
      return jsonResponse({ error: "Не вдалося підготувати email-запрошення." }, 500);
    }

    // The SQL function is the only issuer. An unexpected RPC response must
    // fail closed, never bypass admission by inviting without a ticket.
    if (typeof admissionTicket !== "string" ||
        !/^[0-9a-f-]{36}\.[0-9a-f-]{36}$/.test(admissionTicket)) {
      console.error("Email admission issue returned an invalid result.");
      return jsonResponse({ error: "Не вдалося підготувати email-запрошення." }, 500);
    }

    // If the Hook is enabled it consumes the ticket *inside Auth*; revocation
    // then returns false. While the Hook is disabled (Gate 3a.2-A), always
    // revoke the otherwise unused ticket immediately after the Auth call.
    // This prevents a live admission capability remaining in user_metadata.
    const revokeUnusedAdmission = async () => {
      try {
        const { error } = await supabaseAdmin.rpc(
          "revoke_email_invitation_admission",
          { p_ticket: admissionTicket },
        );
        if (error) console.error("Email admission revoke failed:", error.code);
      } catch (error) {
        console.error(
          "Email admission revoke request failed:",
          error instanceof Error ? error.name : "unknown",
        );
      }
    };

    let inviteResult;
    try {
      inviteResult = await supabaseAdmin.auth.admin.inviteUserByEmail(
        normalizedEmail,
        {
          data: {
            full_name: normalizedFullName,
            role: "student",
            crm_email_invite_ticket: admissionTicket,
          },
          redirectTo,
        },
      );
    } catch (error) {
      // A transport failure is ambiguous: Auth might have created the user.
      // Never delete or blindly retry it without checking the actual state.
      await revokeUnusedAdmission();
      console.error("Email invitation transport failure:",
        error instanceof Error ? error.name : "unknown");
      return jsonResponse(
        { error: "Стан запрошення невідомий. Перевірте учня перед повторною спробою." },
        502,
      );
    }

    await revokeUnusedAdmission();

    const { data, error: inviteError } = inviteResult;
    if (inviteError) {
      console.error("Invite error:", inviteError.code ?? inviteError.name);
      if (inviteError.status === 0 || inviteError.name === "AuthRetryableFetchError") {
        return jsonResponse(
          { error: "Стан запрошення невідомий. Перевірте учня перед повторною спробою." },
          502,
        );
      }
      return jsonResponse({ error: inviteError.message }, 400);
    }

    const studentId = data?.user?.id;

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
