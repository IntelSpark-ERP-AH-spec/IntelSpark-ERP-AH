import { createContext, useContext, useEffect, useState } from 'react';
import { useLanguage } from './LanguageContext';

export const CURRENCIES = [
  { code: 'EUR', symbol: '€', label: 'Euro (€)' },
  { code: 'USD', symbol: '$', label: 'Dollar US ($)' },
  { code: 'MAD', symbol: 'MAD', label: 'Dirham marocain (MAD)' },
  { code: 'GBP', symbol: '£', label: 'Livre sterling (£)' },
  { code: 'CHF', symbol: 'CHF', label: 'Franc suisse (CHF)' },
  { code: 'TND', symbol: 'TND', label: 'Dinar tunisien (TND)' },
  { code: 'DZD', symbol: 'DZD', label: 'Dinar algérien (DZD)' },
  { code: 'XAF', symbol: 'FCFA', label: 'Franc CFA (FCFA)' },
  { code: 'CAD', symbol: 'CAD', label: 'Dollar canadien (CAD)' },
  { code: 'AED', symbol: 'AED', label: 'Dirham émirati (AED)' },
  { code: 'SAR', symbol: 'SAR', label: 'Riyal saoudien (SAR)' },
];

const LS_KEY = 'is_currency';
const CurrencyContext = createContext(null);

function findCurrency(code) {
  return CURRENCIES.find(c => c.code === code) || CURRENCIES[0];
}

export function CurrencyProvider({ children }) {
  const { language } = useLanguage();
  const [code, setCode] = useState(() => {
    try { return localStorage.getItem(LS_KEY) || 'MAD'; } catch { return 'MAD'; }
  });

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, code); } catch {}
    document.documentElement.dataset.currency = code;
  }, [code]);

  useEffect(() => {
    const syncCurrency = (event) => {
      if (event.key === LS_KEY && event.newValue) setCode(event.newValue);
    };
    window.addEventListener('storage', syncCurrency);
    return () => window.removeEventListener('storage', syncCurrency);
  }, []);

  const currency = findCurrency(code);
  const locale = ({ fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', zh: 'zh-CN' })[language] || 'fr-FR';

  function formatMoney(value, opts = {}) {
    const n = Number(value || 0);
    if (!Number.isFinite(n)) return `0 ${currency.symbol}`;
    const formatted = n.toLocaleString(locale, {
      minimumFractionDigits: opts.decimals ?? 2,
      maximumFractionDigits: opts.decimals ?? 2,
    });
    // Espace entre le nombre et la devise pour lisibilité
    return `${formatted} ${currency.symbol}`;
  }

  function moneySymbol() {
    return currency.symbol;
  }

  return (
    <CurrencyContext.Provider value={{ currency, code, setCode, formatMoney, moneySymbol, CURRENCIES }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx) {
    // Fallback si utilisé hors provider
    const c = findCurrency('MAD');
    return {
      currency: c, code: 'MAD', setCode: () => {},
      formatMoney: (v, o = {}) => `${Number(v || 0).toFixed(o.decimals ?? 2)} ${c.symbol}`,
      moneySymbol: () => c.symbol,
      CURRENCIES,
    };
  }
  return ctx;
}
