import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import styles from "./LanguageSwitcher.module.css";

const languages = ["ua", "en", "ru"];

const LanguageSwitcher = () => {
  const { t, i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  const currentLanguage = i18n.resolvedLanguage || i18n.language || "ua";

  const handleChange = (code) => {
    i18n.changeLanguage(code);
    setIsOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  return (
    <div className={styles.switcherWrapper} ref={wrapperRef}>
      <button
        type="button"
        className={`${styles.selectWrapper} ${isOpen ? styles.isOpen : ""}`}
        onClick={() => setIsOpen((current) => !current)}
        aria-label={t("languageSwitcher.label")}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
      >
        <span>{t(`lang.${currentLanguage}`)}</span>

        <svg
          className={styles.arrow}
          viewBox="0 0 20 20"
          fill="none"
          aria-hidden="true"
        >
          <path
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
            d="m6 8 4 4 4-4"
          />
        </svg>
      </button>

      {isOpen && (
        <ul
          className={styles.optionsList}
          role="listbox"
          aria-label={t("languageSwitcher.optionsLabel")}
        >
          {languages.map((code) => (
            <li
              key={code}
              className={styles.option}
              role="option"
              aria-selected={currentLanguage === code}
              onClick={() => handleChange(code)}
            >
              {t(`lang.${code}`)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LanguageSwitcher;
