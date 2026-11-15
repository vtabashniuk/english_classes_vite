import styles from "./SettingsTabs.module.css";

/**
 * Controlled tab navigation. The parent owns the URL and navigation blocker.
 * Tabs contain { id, label } and panel content is rendered by the parent.
 */
export default function SettingsTabs({ tabs, activeTab, onTabChange, label = "Налаштування" }) {
  return (
    <nav className={styles.tabs} aria-label={label}>
      {tabs.map(({ id, label: title }) => (
        <button
          key={id}
          type="button"
          aria-current={id === activeTab ? "page" : undefined}
          className={`${styles.tab} ${id === activeTab ? styles.active : ""}`}
          onClick={() => { if (id !== activeTab) onTabChange(id); }}
        >
          {title}
        </button>
      ))}
    </nav>
  );
}
