import { createContext, useContext, useEffect, useState } from 'react';

const LS_KEY = 'is_lang';
const SUPPORTED = ['fr', 'en', 'es', 'de', 'zh'];

const LanguageContext = createContext(null);

function normalize(v) {
  const lower = String(v || '').toLowerCase();
  if (lower.startsWith('fr')) return 'fr';
  if (lower.startsWith('en')) return 'en';
  if (lower.startsWith('es')) return 'es';
  if (lower.startsWith('de')) return 'de';
  if (lower.startsWith('zh')) return 'zh';
  return 'fr';
}

export function LanguageProvider({ children }) {
  const [language, setLanguage] = useState(() => {
    try { return normalize(localStorage.getItem(LS_KEY) || 'fr'); } catch { return 'fr'; }
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, language); } catch {}
    document.documentElement.lang = language;
  }, [language]);

  useEffect(() => {
    const syncLanguage = (event) => {
      if (event.key === LS_KEY && event.newValue) setLanguage(normalize(event.newValue));
    };
    window.addEventListener('storage', syncLanguage);
    return () => window.removeEventListener('storage', syncLanguage);
  }, []);

  const updateLanguage = (value) => setLanguage(normalize(value));

  return (
    <LanguageContext.Provider value={{ language, setLanguage: updateLanguage, SUPPORTED }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    return { language: 'fr', setLanguage: () => {}, SUPPORTED };
  }
  return ctx;
}
