import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect } from 'react';
import styles from './LanguageSwitcher.module.css';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);

  const languages = [
    { code: 'ua', label: 'UA' },
    { code: 'en', label: 'EN' },
    { code: 'ru', label: 'RU' },
  ];

  const handleChange = (code) => {
    i18n.changeLanguage(code);
    setIsOpen(false); // Закриваємо при виборі
  };

  // Закриття при кліку за межами
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={styles.switcherWrapper} ref={wrapperRef}>
      <div className={`${styles.selectWrapper} ${isOpen ? styles.isOpen : ''}`} onClick={() => setIsOpen(!isOpen)}>
        <span>
          {languages.find(lang => lang.code === i18n.language)?.label}
        </span>
        <svg className={styles.arrow} viewBox="0 0 20 20" fill="none">
          <path stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="m6 8 4 4 4-4" />
        </svg>
      </div>
      {isOpen && (
        <ul className={styles.optionsList}>
          {languages.map((lang) => (
            <li
              key={lang.code}
              className={styles.option}
              onClick={() => handleChange(lang.code)}
            >
              {lang.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default LanguageSwitcher;