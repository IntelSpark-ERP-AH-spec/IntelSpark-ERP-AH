import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { useCurrency } from '../CurrencyContext';
import { useLanguage } from '../LanguageContext';
import { useT } from '../appI18n';

const ROLE_LABELS = {
  admin: 'Administration', commercial: 'Ventes', magasinier: 'Magasin',
  comptable: 'Comptabilité', financier: 'Finance', rh: 'Ressources humaines',
  technicien: 'Atelier', employe: 'Équipe',
};

const METRIC_CONFIG = {
  admin: [['Produits', 'produits_count'], ['Stock faible', 'stock_faible'], ['Documents validés', 'docs_valides'], ['Collaborateurs', 'users_count']],
  commercial: [['Produits', 'produits_count'], ['Devis', 'docs_brouillon'], ['Documents validés', 'docs_valides'], ['Facturation', 'total_facture']],
  magasinier: [['Références', 'produits_count'], ['Alertes stock', 'stock_faible'], ['Mouvements récents', 'recent_mouvements'], ['Documents validés', 'docs_valides']],
  comptable: [['Facturation', 'total_facture'], ['Devis', 'total_devis'], ['Documents validés', 'docs_valides'], ['Collaborateurs', 'users_count']],
  financier: [['Facturation', 'total_facture'], ['Devis', 'total_devis'], ['Documents validés', 'docs_valides'], ['Alertes stock', 'stock_faible']],
  rh: [['Collaborateurs', 'users_count'], ['Documents validés', 'docs_valides'], ['Brouillons', 'docs_brouillon'], ['Mouvements récents', 'recent_mouvements']],
  technicien: [['Produits', 'produits_count'], ['Alertes stock', 'stock_faible'], ['Mouvements récents', 'recent_mouvements'], ['Documents validés', 'docs_valides']],
};

function normalizeRole(role) {
  const value = String(role || '').trim().toLowerCase();
  const aliases = { hr: 'rh', finance: 'financier', magasin: 'magasinier', accounting: 'comptable', technician: 'technicien', sales: 'commercial' };
  return aliases[value] || value || 'employe';
}

function formatMetric(key, value, formatMoney, locale) {
  if (key === 'recent_mouvements') return Array.isArray(value) ? value.length : 0;
  if (key === 'total_facture' || key === 'total_devis') {
    return formatMoney(value, { decimals: 0 });
  }
  return Number(value || 0).toLocaleString(locale);
}

export default function RoleHome({ user, navigation, onNavigate }) {
  const t = useT();
  const { formatMoney } = useCurrency();
  const { language } = useLanguage();
  const locale = ({ fr: 'fr-FR', en: 'en-US', es: 'es-ES', de: 'de-DE', zh: 'zh-CN' })[language] || 'fr-FR';
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');
  const role = normalizeRole(user?.role);

  useEffect(() => {
    let active = true;
    api.getDashboard()
      .then((result) => { if (active) { setData(result || {}); setState('ready'); } })
      .catch(() => { if (active) setState('error'); });
    return () => { active = false; };
  }, []);

  const metrics = useMemo(() => METRIC_CONFIG[role] || METRIC_CONFIG.admin, [role]);
  const actions = navigation
    .filter((item) => item.id !== 'home' && item.id !== '----------------' && !item.section && item.label)
    .slice(0, 6);
  const movements = Array.isArray(data?.recent_mouvements) ? data.recent_mouvements.slice(0, 5) : [];

  return (
    <section className="role-home">
      <div className="role-home-hero">
        <div>
          <span className="role-home-eyebrow">{t(ROLE_LABELS[role] || 'Espace professionnel')}</span>
          <h1>{t('Bonjour')} {user?.full_name || user?.username || t('Utilisateur')}</h1>
          <p>{t('Activité')}, {t('raccourcis')}, {t('priorités')}. {t('Accès centralisé')}.</p>
        </div>
      </div>

      <div className="role-home-metrics" aria-label="Indicateurs principaux">
        {metrics.map(([label, key]) => (
          <article key={key}>
            <span>{t(label)}</span>
            {state === 'loading' ? <div className="role-home-skeleton" /> : <strong>{formatMetric(key, data?.[key], formatMoney, locale)}</strong>}
            <small>{t('Données actualisées')}</small>
          </article>
        ))}
      </div>

      <div className="role-home-layout">
        <article className="role-home-panel">
          <header><div><span>ACCÈS RAPIDE</span><h2>Outils métier</h2></div></header>
          <div className="role-home-actions">
            {actions.map((item, index) => (
              <button key={`${item.id}-${item.type || index}`} onClick={() => onNavigate(item)}>
                <span className="role-home-action-mark">{String(item.label || '?').slice(0, 2).toUpperCase()}</span>
                <span><strong>{item.label}</strong><small>Ouvrir</small></span>
              </button>
            ))}
          </div>
        </article>

        <article className="role-home-panel">
          <header><div><span>ACTIVITÉ</span><h2>Mouvements récents</h2></div></header>
          {state === 'error' && <div className="role-home-empty">Données indisponibles. Réessayez après actualisation.</div>}
          {state === 'ready' && movements.length === 0 && <div className="role-home-empty">Aucun mouvement récent.</div>}
          {movements.length > 0 && (
            <div className="role-home-table-wrap"><table><thead><tr><th>Article</th><th>Type</th><th>Quantité</th></tr></thead>
              <tbody>{movements.map((item, index) => <tr key={item.id || index}><td>{item.designation || item.produit || 'Article'}</td><td>{item.type || 'Mouvement'}</td><td>{item.quantite || 0}</td></tr>)}</tbody>
            </table></div>
          )}
        </article>
      </div>
    </section>
  );
}
