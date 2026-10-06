import { supabase } from "../../../shared/api/supabaseClient";

const firstOrNull = (data) =>
  Array.isArray(data) ? data[0] ?? null : data ?? null;

export const listTeacherStudentsLifecycle = () =>
  supabase.rpc("list_teacher_students_lifecycle");

export const getTeacherStudentLifecycle = async (studentId) => {
  const { data, error } = await supabase.rpc("get_teacher_student_lifecycle", {
    p_student_id: studentId,
  });

  return { data: error ? null : firstOrNull(data), error };
};

export const setTeacherStudentLearningStatus = async ({
  studentId,
  status,
  pauseUntil = null,
}) => {
  const { data, error } = await supabase.rpc(
    "set_teacher_student_learning_status",
    {
      p_student_id: studentId,
      p_status: status,
      p_pause_until: pauseUntil,
    },
  );

  return { data: error ? null : firstOrNull(data), error };
};

export const getMyStudentLifecycle = async () => {
  const { data, error } = await supabase.rpc("get_my_student_lifecycle");

  return { data: error ? null : firstOrNull(data), error };
};
