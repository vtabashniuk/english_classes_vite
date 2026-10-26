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

      // Gate 4.5-B: the decision to restore a relationship is performed by a
      // single guarded DB transaction. A Google-only student must explicitly
      // accept their Google invitation; email mode must not bypass consent.
      const { data: linkStatus, error: linkError } = await supabaseAdmin.rpc(
        "link_existing_student_email_invitation",
        {
          p_teacher_id: user.id,
          p_student_id: existingProfile.id,
          p_email: normalizedEmail,
        },
      );

      if (linkError) {
        const code = linkError.message ?? "";
        if (code.includes("EMAIL_LINK_PENDING_GOOGLE_INVITATION")) {
          return jsonResponse(
            { error: "Для цього email уже є Google-запрошення. Завершіть його через Google або скасуйте перед переходом на Email + пароль." },
            409,
          );
        }
        if (code.includes("EMAIL_LINK_GOOGLE_ACCEPTANCE_REQUIRED")) {
          return jsonResponse(
            { error: "Цей Google-акаунт можна прив'язати до викладача лише через підтвердження Google-запрошення." },
            409,
          );
        }
        if (code.includes("EMAIL_LINK_OTHER_ACTIVE_TEACHER")) {
          return jsonResponse(
            { error: "Учень уже прив'язаний до іншого активного викладача." },
            409,
          );
        }
        if (code.includes("EMAIL_LINK_OTHER_HISTORICAL_TEACHER")) {
          return jsonResponse(
            { error: "Учень раніше був прив'язаний до іншого викладача. Потрібне окреме перенесення учня." },
            409,
          );
        }
        if (code.includes("EMAIL_LINK_STUDENT_NOT_AVAILABLE")) {
          return jsonResponse({ error: "Профіль учня недоступний або змінився." }, 409);
        }
        if (code.includes("EMAIL_LINK_TEACHER_NOT_ACTIVE")) {
          return jsonResponse({ error: "Запрошувати учнів може лише активний викладач." }, 403);
        }
        console.error("Existing student email relationship RPC error:", linkError.code);
        return jsonResponse({ error: "Не вдалося перевірити зв'язок викладача з учнем." }, 500);
      }

      if (linkStatus !== "already_linked" && linkStatus !== "relationship_restored") {
        console.error("Existing student email relationship RPC returned unexpected state.");
        return jsonResponse({ error: "Не вдалося перевірити зв'язок викладача з учнем." }, 500);
      }

      return jsonResponse(
        {
          success: true,
          userId: existingProfile.id,
          email: normalizedEmail,
          existingUser: true,
          ...(linkStatus === "already_linked"
            ? { alreadyLinked: true }
            : { relationshipRestored: true }),
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
      if (code.includes("ADMISSION_GOOGLE_INVITATION_PENDING")) {
        return jsonResponse(
          { error: "Для цього email уже є Google-запрошення. Спочатку скасуйте його, якщо потрібно запросити через Email + пароль." },
          409,
        );
      }
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
    const revokeUnusedAdmission = async (): Promise<boolean> => {
      try {
        const { data: revoked, error } = await supabaseAdmin.rpc(
          "revoke_email_invitation_admission",
          { p_ticket: admissionTicket },
        );
        if (error) console.error("Email admission revoke failed:", error.code);
        // false means this ticket was already consumed or revoked; when a
        // successful fresh invite created an Auth user, this establishes that
        // the enabled Hook consumed it. true means the Hook was OFF and the
        // ticket has just been revoked (Gate 3a.2-A compatibility).
        return !error && revoked === false;
      } catch (error) {
        console.error(
          "Email admission revoke request failed:",
          error instanceof Error ? error.name : "unknown",
        );
        return false;
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

    const hookConsumedAdmission = await revokeUnusedAdmission();

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

    // Gate 3a.2-B: once the Hook consumes a ticket it must not remain as a usable
    // string in Auth user_metadata after the invitation is completed.
    // GoTrue can merge user_metadata updates, so explicitly overwrite the
    // sensitive key with null; preserve the existing full_name/role fields.
    // This is defense-in-depth: the Hook already consumed the ticket, and
    // the server attempted to revoke any unused ticket immediately above.
    // Gate 3a.2-A (Hook OFF) keeps its original revoked-ticket observation.
    // Never roll back a successfully linked student if metadata scrubbing
    // fails: report it internally without logging the ticket itself.
    if (hookConsumedAdmission) {
      try {
        const { error: scrubError, data: scrubResult } =
          await supabaseAdmin.auth.admin.updateUserById(studentId, {
            user_metadata: {
              ...(data?.user?.user_metadata ?? {}),
              crm_email_invite_ticket: null,
            },
          });

        if (scrubError ||
            typeof scrubResult?.user?.user_metadata?.crm_email_invite_ticket === "string") {
          console.error("Invitation metadata scrub failed:",
            scrubError?.code ?? "ticket still present");
        }
      } catch (error) {
        console.error("Invitation metadata scrub transport failure:",
          error instanceof Error ? error.name : "unknown");
      }
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
