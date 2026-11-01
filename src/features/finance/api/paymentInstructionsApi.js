import { supabase } from "../../../shared/api/supabaseClient";

const COLUMNS = "teacher_id, currency, recipient_name, iban, bank_name, payment_purpose, notes, payment_url, qr_image_url, is_published";

// Visibility is enforced in Postgres: only the teacher or an actively linked
// student (and only published rows) can read these instructions.
export const getPublishedTeacherPaymentInstructions = (teacherId) =>
  supabase.from("teacher_payment_instructions")
    .select(COLUMNS)
    .eq("teacher_id", teacherId)
    .eq("is_published", true)
    .order("currency", { ascending: true });

export const getMyTeacherPaymentInstructions = (teacherId) =>
  supabase.from("teacher_payment_instructions")
    .select(COLUMNS)
    .eq("teacher_id", teacherId)
    .order("currency", { ascending: true });

export const saveTeacherPaymentInstructions = (teacherId, data) =>
  supabase.from("teacher_payment_instructions")
    .upsert({
      teacher_id: teacherId,
      currency: data.currency,
      recipient_name: data.recipientName.trim(),
      iban: data.iban.trim(),
      bank_name: data.bankName.trim(),
      payment_purpose: data.paymentPurpose.trim(),
      notes: data.notes.trim(),
      payment_url: data.paymentUrl.trim() || null,
      qr_image_url: data.qrImageUrl.trim() || null,
      is_published: Boolean(data.isPublished),
      updated_at: new Date().toISOString(),
    }, { onConflict: "teacher_id,currency" });
