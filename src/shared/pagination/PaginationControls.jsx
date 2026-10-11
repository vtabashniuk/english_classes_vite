import { getPageCount } from "./pagination";
import styles from "./PaginationControls.module.css";

const PaginationControls = ({ page, pageSize, total, disabled = false,
  onPageChange, previousLabel, nextLabel, summary, hasMore = false, className = "", buttonClassName = "" }) => {
  const count = typeof total === "number" ? getPageCount(total, pageSize) : null;
  return (
    <nav className={`${styles.pagination} ${className}`} aria-label={summary}>
      <button type="button" className={buttonClassName}
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={disabled || page === 0}>{previousLabel}</button>
      <span aria-live="polite">{summary}</span>
      <button type="button" className={buttonClassName}
        onClick={() => onPageChange(count === null ? page + 1 : Math.min(count - 1, page + 1))}
        disabled={disabled || (count === null ? !hasMore : page >= count - 1)}>{nextLabel}</button>
    </nav>
  );
};

export default PaginationControls;
