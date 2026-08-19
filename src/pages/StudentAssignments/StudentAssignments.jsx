import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../components/common/ui/Button/Button";
import { supabase } from "../../lib/supabase";
import { getIntlLocale } from "../../utils/getIntlLocale";
import styles from "./StudentAssignments.module.css";

const StudentAssignments = () => {
  const { t, i18n } = useTranslation();
  const [assignments, setAssignments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const load = async () => {
    const { data, error } = await supabase.from("assignments").select("id, title, description, due_date, status, completed_at, created_at, assignment_materials(materials(id,title,url,category))").order("created_at", { ascending: false });
    if (error) throw error;
    setAssignments(data ?? []);
  };

  useEffect(() => { const init=async()=>{try{setLoading(true);await load();}catch(error){console.error("Student assignments load error:",error);setErrorMessage(t("studentAssignments.errors.load"));}finally{setLoading(false);}};init(); },[t]);

  const markCompleted = async (id) => {
    try { setProcessingId(id); setErrorMessage(""); const { error }=await supabase.rpc("complete_assignment",{p_assignment_id:id}); if(error)throw error; await load(); }
    catch(error){console.error("Complete assignment error:",error);setErrorMessage(t("studentAssignments.errors.complete"));}
    finally{setProcessingId(null);}
  };

  const formatDue=(value)=>value?new Intl.DateTimeFormat(locale,{day:"2-digit",month:"long",year:"numeric"}).format(new Date(`${value}T12:00:00`)):t("studentAssignments.noDeadline");

  if(loading)return <section className={styles.page}><div className={styles.state}>{t("studentAssignments.loading")}</div></section>;

  return <section className={styles.page}><header className={styles.header}><h1>{t("studentAssignments.title")}</h1><p>{t("studentAssignments.description")}</p></header>{errorMessage&&<p className={styles.error}>{errorMessage}</p>}{assignments.length===0?<div className={styles.empty}>{t("studentAssignments.empty")}</div>:<div className={styles.list}>{assignments.map((assignment)=><article key={assignment.id} className={styles.card}><div className={styles.cardTop}><div><span className={styles.deadline}>{t("studentAssignments.deadline")}: {formatDue(assignment.due_date)}</span><h2>{assignment.title}</h2></div><span className={`${styles.status} ${assignment.status==="completed"?styles.completed:styles.assigned}`}>{t(`studentAssignments.statuses.${assignment.status}`)}</span></div>{assignment.description&&<p>{assignment.description}</p>}{(assignment.assignment_materials??[]).length>0&&<div className={styles.materials}><strong>{t("studentAssignments.materials")}</strong>{assignment.assignment_materials.map((link)=><a key={link.materials?.id} href={link.materials?.url} target="_blank" rel="noreferrer">{link.materials?.title}</a>)}</div>}{assignment.status!=="completed"&&<div className={styles.actions}><Button variant="success" onClick={()=>markCompleted(assignment.id)} disabled={processingId===assignment.id}>{t("studentAssignments.complete")}</Button></div>}</article>)}</div>}</section>;
};
export default StudentAssignments;
