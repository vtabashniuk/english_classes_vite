import { supabase } from "../../../shared/api/supabaseClient";

export const listTeacherMaterialsWithAssignments = async (query = "", offset = 0, limit = 40, level = null, tagIds = []) => {
  const results = await searchMaterials({ query, offset, limit, level, tagIds });
  if (results.error || !results.data?.length) return results.error ? results : { data: [], error: null };
  const details = await supabase.from("materials")
    .select("id, title, description, url, tags, level, archived_at, created_at, material_resources(id,title,external_url,sort_order), student_materials(student_id,revoked_at)")
    .in("id", results.data.map(({ id }) => id));
  if (details.error) return details;
  const byId = new Map((details.data ?? []).map((row) => [row.id, row]));
  return { data: results.data.map(({ id }) => byId.get(id)).filter(Boolean), error: null };
};

export const listMaterialsForAssignment = () =>
  supabase.from("materials").select("id, title").is("archived_at", null).order("title");

// Assignment links are not access grants. Only currently shared resources are offered.
export const listGrantedMaterialsForStudentAssignment = async (studentId) => {
  const result = await supabase.from("student_materials")
    .select("materials(id,title,archived_at)")
    .eq("student_id", studentId)
    .is("revoked_at", null);
  if (result.error) return result;
  return { data: (result.data ?? []).map(({ materials }) => materials)
    .filter((material) => material && !material.archived_at)
    .sort((a, b) => a.title.localeCompare(b.title)), error: null };
};

// All catalog writes go through RPCs so the tag directory stays consistent.
export const deleteMaterial = (materialId) =>
  supabase.rpc("archive_material_catalog", { p_material_id: materialId });

export const shareMaterialWithStudent = ({ materialId, studentId }) =>
  supabase.rpc("share_material_with_student", {
    p_material_id: materialId,
    p_student_id: studentId,
  });

export const listStudentMaterials = () =>
  supabase
    .from("student_materials")
    .select(
      "id, assigned_at, materials(id, title, description, url)",
    )
    .order("assigned_at", { ascending: false });

export const searchMaterials = ({ query = "", limit = 40, offset = 0, level = null, tagIds = [], tagMatch = "all" }) =>
  supabase.rpc("search_materials_catalog", {
    p_query: query.trim(), p_limit: limit, p_offset: offset,
    p_level: level || null, p_tag_ids: tagIds, p_tag_match: tagMatch,
  });

export const saveExternalMaterial = ({ materialId = null, payload }) =>
  supabase.rpc("save_material_catalog", {
    p_material_id: materialId,
    p_title: payload.title,
    p_description: payload.description,
    p_tags: payload.tags,
    p_level: payload.level || null,
    p_resources: payload.resources.map(({ title, url }) => ({ title, url })),
  });

export const listMaterialTags = () =>
  supabase.from("material_tags").select("id,name,material_tag_links(material_id)").order("name");
export const createMaterialTag = (name) =>
  supabase.rpc("create_material_tag", { p_name: name });
export const renameMaterialTag = (tagId, name) =>
  supabase.rpc("rename_material_tag", { p_tag_id: tagId, p_name: name });
export const deleteMaterialTag = (tagId) =>
  supabase.rpc("delete_material_tag", { p_tag_id: tagId });

// Page collection definitions on the server; RLS limits them to the current teacher.
export const listMaterialCollections = ({ page = 0, pageSize = 20 } = {}) =>
  supabase.from("material_collections")
    .select("id,name,kind,level,tag_match,material_collection_tags(tag_id),material_collection_items(material_id)", { count: "exact" })
    .order("name")
    .order("id")
    .range(page * pageSize, (page + 1) * pageSize - 1);
export const saveMaterialCollection = ({ id = null, name, kind, level, tagMatch, tagIds, materialIds }) =>
  supabase.rpc("save_material_collection", {
    p_id: id, p_name: name, p_kind: kind, p_level: level || null,
    p_tag_match: tagMatch, p_tag_ids: tagIds, p_material_ids: materialIds,
  });
export const deleteMaterialCollection = (id) =>
  supabase.rpc("delete_material_collection", { p_id: id });

export const listMaterialsByIds = (ids) => ids.length ?
  supabase.from("materials").select("id,title,description,level,tags,material_resources(id,title,external_url,sort_order)").in("id", ids).is("archived_at", null).order("title") :
  Promise.resolve({ data: [], error: null });

export const revokeMaterialFromStudent = ({ materialId, studentId }) =>
  supabase.rpc("revoke_material_from_student", {
    p_material_id: materialId, p_student_id: studentId,
  });

export const restoreMaterialAccess = ({ materialId, studentId }) =>
  supabase.rpc("restore_material_access", {
    p_material_id: materialId, p_student_id: studentId,
  });

export const revokeAllStudentMaterials = (studentId) =>
  supabase.rpc("revoke_all_student_materials", { p_student_id: studentId });

export const listStudentMaterialResources = () =>
  supabase.from("student_materials")
    .select("id, assigned_at, materials(id, title, description, tags, level, material_resources(id,title,external_url,sort_order))")
    .is("revoked_at", null)
    .order("assigned_at", { ascending: false });

export const searchStudentCatalog = async ({ query = "", limit = 40, offset = 0, level = null }) => {
  const result = await searchMaterials({ query, limit, offset, level });
  if (result.error || !result.data?.length) return result;
  const resources = await supabase.from("material_resources")
    .select("id, material_id, title, external_url, sort_order")
    .in("material_id", result.data.map((item) => item.id))
    .order("sort_order");
  if (resources.error) return resources;
  return {
    data: result.data.map((item) => ({ ...item,
      resources: (resources.data ?? []).filter((resource) => resource.material_id === item.id),
    })),
    error: null,
  };
};

export const listStudentMaterialGrantsForTeacher = (studentId, { page = 0, pageSize = 10 } = {}) =>
  supabase.from("student_materials")
    .select("id, material_id, assigned_at, revoked_at, materials(id,title,description,tags,url)", { count: "exact" })
    .eq("student_id", studentId).order("assigned_at", { ascending: false })
    .order("id", { ascending: false })
    .range(page * pageSize, page * pageSize + pageSize - 1);

export const getStudentMaterialGrantForTeacher = (studentId, materialId) =>
  supabase.from("student_materials")
    .select("id, revoked_at")
    .eq("student_id", studentId).eq("material_id", materialId).maybeSingle();

export const countActiveStudentMaterialGrantsForTeacher = (studentId) =>
  supabase.from("student_materials")
    .select("id", { count: "exact", head: true })
    .eq("student_id", studentId).is("revoked_at", null);


// Batch access changes are atomic, validated by the teacher-scoped RPC.
export const grantCollectionMaterialsToStudent = (studentId, materialIds) =>
  supabase.rpc("grant_collection_materials_to_student", {
    p_student_id: studentId, p_material_ids: materialIds,
  });
