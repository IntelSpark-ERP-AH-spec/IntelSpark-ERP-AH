import { useEffect, useRef, useState } from 'react';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useLanguage } from '../LanguageContext';
import { useCurrency } from '../CurrencyContext';
import { useUserDoc } from '../useUserDoc';
import { useT } from '../appI18n';
import EmailAccountSettings from '../components/EmailAccountSettings';

const LS_KEYS = { visual: 'hz_settings_visual', fiscal: 'hz_settings_fiscal', comptable: 'hz_settings_comptable' };
const DEFAULT_VISUAL = { fontSize: 14, fontFamily: 'Inter', textColor: '#111827' };
const DEFAULT_FISCAL = { regime: 'encaissements', tvaRate: 20 };
const DEFAULT_COMPTABLE = { clients: '411000', fournisseurs: '401000', tvaCollectee: '445710', tvaDeductible: '445660', banque: '512000', salaires: '641000', chargesPatronales: '645000' };
const FONT_FAMILIES = ['Inter', 'Arial', 'Roboto', 'system-ui', 'Segoe UI', 'Calibri', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Courier New', 'Consolas'];
const TVA_RATES = [20, 14, 10, 7, 0];
const ACCOUNT_FIELDS = [
  ['clients', 'Compte clients', '411000'], ['fournisseurs', 'Compte fournisseurs', '401000'],
  ['tvaCollectee', 'TVA collectée', '445710'], ['tvaDeductible', 'TVA déductible', '445660'],
  ['banque', 'Banque', '512000'], ['salaires', 'Salaires', '641000'],
  ['chargesPatronales', 'Charges patronales', '645000'],
];
const SECTIONS = [
  ['general', 'GL', 'Général', 'Langue, devise, session'],
  ['appearance', 'AP', 'Apparence', 'Confort visuel'],
  ['fiscal', 'FI', 'Fiscalité', 'TVA marocaine', ['admin', 'comptable']],
  ['accounts', 'PC', 'Plan comptable', 'Comptes automatiques', ['admin', 'comptable']],
  ['email', 'EM', 'Messagerie', 'Configuration SMTP'],
];

function load(key, fallback) {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key)) }; }
  catch { return { ...fallback }; }
}

export default function Settings() {
  const t = useT();
  const { user, logout } = useAuth();
  const { language, setLanguage } = useLanguage();
  const { code: currencyCode, setCode: setCurrencyCode, CURRENCIES } = useCurrency();
  const preferences = useUserDoc('user_preferences', null);
  const organizationAccounting = useUserDoc('organization_accounting_settings', null);
  const hydratedRef = useRef(false);
  const [activeSection, setActiveSection] = useState('general');
  const [theme, setTheme] = useState('light');
  const [visual, setVisual] = useState(() => load(LS_KEYS.visual, DEFAULT_VISUAL));
  const [fiscal, setFiscal] = useState(() => load(LS_KEYS.fiscal, DEFAULT_FISCAL));
  const [accounts, setAccounts] = useState(() => load(LS_KEYS.comptable, DEFAULT_COMPTABLE));
  const [notice, setNotice] = useState(null);
  const canManageAccounting = ['admin', 'comptable'].includes(user?.role);
  const sections = SECTIONS.filter(([, , , , roles]) => !roles || roles.includes(user?.role));

  useEffect(() => {
    if (!preferences.loaded || hydratedRef.current || !preferences.data) return;
    hydratedRef.current = true;
    if (preferences.data.visual) setVisual(current => ({ ...current, ...preferences.data.visual }));
    if (preferences.data.theme) setTheme('light');
    if (preferences.data.language) setLanguage(preferences.data.language);
    if (preferences.data.currency) setCurrencyCode(preferences.data.currency);
  }, [preferences.loaded, preferences.data, setLanguage, setCurrencyCode]);

  useEffect(() => {
    if (!organizationAccounting.loaded || !organizationAccounting.data) return;
    if (organizationAccounting.data.fiscal) setFiscal(current => ({ ...current, ...organizationAccounting.data.fiscal }));
    if (organizationAccounting.data.accounts) setAccounts(current => ({ ...current, ...organizationAccounting.data.accounts }));
  }, [organizationAccounting.loaded, organizationAccounting.data]);

  useEffect(() => {
    document.documentElement.style.fontSize = `${visual.fontSize}px`;
    document.documentElement.style.setProperty('--user-text-color', visual.textColor);
    document.documentElement.style.setProperty('--user-font-family', visual.fontFamily);
    document.documentElement.style.setProperty('--user-font-size', `${visual.fontSize}px`);
    document.body.style.fontFamily = visual.fontFamily;
    document.body.style.color = visual.textColor;
    localStorage.setItem(LS_KEYS.visual, JSON.stringify(visual));
    localStorage.setItem('is_font_size', String(visual.fontSize));
    localStorage.setItem('is_font_family', visual.fontFamily);
    localStorage.setItem('is_font_color', visual.textColor);
    window.dispatchEvent(new CustomEvent('settings:changed', { detail: { visual } }));
  }, [visual]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('settings:changed', { detail: { fiscal } }));
  }, [fiscal]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('settings:changed', { detail: { accounts } }));
  }, [accounts]);

  useEffect(() => {
    localStorage.setItem('is_theme', theme);
    window.dispatchEvent(new CustomEvent('settings:changed', { detail: { theme } }));
  }, [theme]);

  useEffect(() => {
    if (!preferences.loaded || !hydratedRef.current) return;
    preferences.setData(current => ({ ...(current || {}), language, currency: currencyCode, visual, theme }));
  }, [language, currencyCode, visual, theme, preferences.loaded]);

  useEffect(() => {
    if (!organizationAccounting.loaded) return;
    organizationAccounting.setData({ fiscal, accounts });
  }, [fiscal, accounts, organizationAccounting.loaded]);

  async function handleLogout() {
    if (!(await systemConfirm('Fermer votre session maintenant ?', { danger: false, confirmLabel: 'Se déconnecter' }))) return;
    localStorage.removeItem('is_server_loaded');
    await logout();
  }

  return (
    <section className="settings-page">
      {(notice || preferences.error || organizationAccounting.error) && <div className={`settings-notice settings-notice-${notice?.type || 'error'}`} role="status">{notice?.message || preferences.error || organizationAccounting.error}</div>}

      <header className="settings-hero">
        <div><span>{t('Configuration')} · {t('Espace personnel')}</span><h1>{t('Paramètres')}</h1><p>{t('Personnalisez affichage, fiscalité, comptabilité et messagerie.')}</p></div>
        <div className="settings-security"><i /><span><strong>Configuration locale sécurisée</strong><small>Synchronisation automatique</small></span></div>
      </header>

      <div className="settings-workspace">
        <nav className="settings-nav" aria-label="Sections paramètres">
          <header><span>Préférences</span><small>{sections.length} catégories</small></header>
          {sections.map(([id, code, label, description]) => (
            <button key={id} className={activeSection === id ? 'is-active' : ''} onClick={() => setActiveSection(id)}>
              <b>{code}</b><span><strong>{t(label)}</strong><small>{t(description)}</small></span><i>›</i>
            </button>
          ))}
          <footer><span>IntelSpark ERP-AH</span><small>Centre de configuration</small></footer>
        </nav>

        <main className="settings-content">
          {activeSection === 'general' && (
            <div className="settings-section">
              <header><div><span>{t('Session utilisateur')}</span><h2>{t('Langue, devise et accès')}</h2><p>{t('Préférences appliquées dans tous vos modules.')}</p></div><b>GL</b></header>
              <div className="settings-form-grid settings-form-grid-email">
                <label><span>{t('Langue interface')}</span><select value={language} onChange={event => setLanguage(event.target.value)}><option value="fr">Français</option><option value="en">English</option><option value="es">Español</option><option value="de">Deutsch</option><option value="zh">中文</option></select><small>{t('Appliquée immédiatement partout.')}</small></label>
                <label><span>{t('Devise principale')}</span><select value={currencyCode} onChange={event => setCurrencyCode(event.target.value)}>{CURRENCIES.map(currency => <option key={currency.code} value={currency.code}>{currency.label}</option>)}</select><small>{t('Utilisée dans documents et rapports.')}</small></label>
              </div>
              <div className="settings-account-note"><strong>SESSION</strong><span>Connecté comme {user?.full_name || user?.username}.</span></div>
              <div className="settings-session-actions"><span>{preferences.saving ? 'Synchronisation en cours…' : 'Synchronisation automatique active.'}</span><button type="button" className="is-danger" onClick={handleLogout}>Déconnexion</button></div>
            </div>
          )}

          {activeSection === 'appearance' && (
            <div className="settings-section">
              <header><div><span>{t('Interface')}</span><h2>{t('Apparence et lisibilité')}</h2><p>{t('Adaptez interface à votre environnement de travail.')}</p></div><b>AP</b></header>
              <div className="settings-form-grid">
                <label><span>{t('Taille typographique')}</span><div className="settings-range"><input type="range" min="10" max="32" value={visual.fontSize} onChange={event => setVisual({ ...visual, fontSize: Number(event.target.value) })} /><strong>{visual.fontSize}px</strong></div><small>{t('Appliquée instantanément partout.')}</small></label>
                <label><span>{t('Famille typographique')}</span><select value={visual.fontFamily} onChange={event => setVisual({ ...visual, fontFamily: event.target.value })}>{FONT_FAMILIES.map(font => <option key={font}>{font}</option>)}</select><small>{t('Police utilisée dans chaque module.')}</small></label>
                <label><span>{t('Couleur principale')}</span><div className="settings-color"><input type="color" value={visual.textColor} onChange={event => setVisual({ ...visual, textColor: event.target.value })} /><strong>{visual.textColor}</strong></div><small>{t('Contraste recommandé : noir.')}</small></label>
              </div>
              <div className="settings-preview" style={{ fontFamily: visual.fontFamily, fontSize: visual.fontSize, color: visual.textColor }}><span>Aperçu en temps réel</span><strong>Gestion claire, décisions rapides.</strong><small>Exemple interface IntelSpark ERP-AH</small></div>
              <footer><span>{preferences.saving ? 'Synchronisation en cours…' : 'Modifications automatiques.'}</span></footer>
            </div>
          )}

          {activeSection === 'fiscal' && canManageAccounting && (
            <div className="settings-section">
              <header><div><span>Conformité Maroc</span><h2>Fiscalité et TVA</h2><p>Configurez règles utilisées automatiquement.</p></div><b>FI</b></header>
              <fieldset className="settings-choice"><legend>Régime TVA</legend>{[['encaissements', 'Encaissements', 'TVA due après encaissement effectif.'], ['debits', 'Débits', 'TVA due dès émission facture.']].map(([value, label, hint]) => <label key={value} className={fiscal.regime === value ? 'is-selected' : ''}><input type="radio" name="regime" value={value} checked={fiscal.regime === value} onChange={event => setFiscal({ ...fiscal, regime: event.target.value })} /><span><strong>{label}</strong><small>{hint}</small></span><i /></label>)}</fieldset>
              <div className="settings-field"><label htmlFor="default-vat">Taux TVA par défaut</label><select id="default-vat" value={fiscal.tvaRate} onChange={event => setFiscal({ ...fiscal, tvaRate: Number(event.target.value) })}>{TVA_RATES.map(rate => <option key={rate} value={rate}>{rate === 0 ? '0 % · Exonéré' : `${rate} %`}</option>)}</select><small>Appliqué aux nouvelles opérations.</small></div>
              <footer><span>{preferences.saving ? 'Synchronisation en cours…' : 'Fiscalité synchronisée automatiquement.'}</span></footer>
            </div>
          )}

          {activeSection === 'accounts' && canManageAccounting && (
            <div className="settings-section">
              <header><div><span>Automatisation</span><h2>Plan comptable marocain</h2><p>Comptes utilisés pour écritures générées.</p></div><b>PC</b></header>
              <div className="settings-account-note"><strong>Structure PCGE</strong><span>Vérifiez chaque compte avant automatisation définitive.</span></div>
              <div className="settings-account-grid">{ACCOUNT_FIELDS.map(([key, label, fallback]) => <label key={key}><span>{label}</span><input value={accounts[key]} onChange={event => setAccounts({ ...accounts, [key]: event.target.value })} placeholder={fallback} /><small>Compte recommandé : {fallback}</small></label>)}</div>
              <footer><span>{preferences.saving ? 'Synchronisation en cours…' : `${ACCOUNT_FIELDS.length} comptes synchronisés automatiquement.`}</span></footer>
            </div>
          )}

          {activeSection === 'email' && (
            <div className="settings-section">
              <header><div><span>Communication</span><h2>Comptes Gmail</h2><p>Gmail personnel, comptes entreprise, permissions.</p></div><b>EM</b></header>
              <EmailAccountSettings
                user={user}
                onNotice={(nextNotice) => {
                  setNotice(nextNotice);
                  window.setTimeout(() => setNotice(null), 3200);
                }}
              />
            </div>
          )}
        </main>
      </div>
    </section>
  );
}
