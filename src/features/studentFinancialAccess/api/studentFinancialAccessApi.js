import { supabase } from "../../../shared/api/supabaseClient";

const firstOrNull = (data) => (Array.isArray(data) ? data[0] ?? null : data ?? null);

const refreshFinancialAccessFxRates = async () => {
  const { error } = await supabase.functions.invoke("refresh-finance-fx-rates", {
    body: {},
  });

  if (error) {
    console.warn("Financial access FX refresh warning:", error);
  }
};

export const getTeacherStudentFinancialAccess = async (studentId) => {
  await refreshFinancialAccessFxRates();

  const { data, error } = await supabase.rpc(
    "get_teacher_student_financial_access",
    { p_student_id: studentId },
  );

  return { data: error ? null : firstOrNull(data), error };
};

export const getMyStudentFinancialAccess = async () => {
  await refreshFinancialAccessFxRates();

  const { data, error } = await supabase.rpc("get_my_student_financial_access");

  return { data: error ? null : firstOrNull(data), error };
};

export const temporaryUnlockStudentFinancialAccess = async (studentId) => {
  const { data, error } = await supabase.rpc(
    "temporary_unlock_student_financial_access",
    { p_student_id: studentId },
  );

  return { data: error ? null : firstOrNull(data), error };
};
