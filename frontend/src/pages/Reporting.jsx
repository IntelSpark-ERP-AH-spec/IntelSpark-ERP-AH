import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';

const money = value => `${Number(value || 0).toLocaleString('fr-MA', { maximumFractionDigits: 0 })} MAD`;

export default function ReportingPage() {
  const { hasRole } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState('12m');
  const [hiddenKeys, setHiddenKeys] = useState(() => new Set());
  const canDelete = hasRole('admin');

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/reporting/dashboard-complet', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Chargement impossible');
      setData(await response.json());
    } catch (requestError) {
      setError(requestError.message || 'Données indisponibles');
    } finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  const treasury = useMemo(() => (data?.tresorerie || []).map(item => ({
    ...item, recettes: Number(item.recettes || 0), depenses: Number(item.depenses || 0),
    solde: Number(item.recettes || 0) - Number(item.depenses || 0),
  })).filter(item => !hiddenKeys.has(`cashflow:${item.mois}`)), [data, hiddenKeys]);
  const topProduits = useMemo(() => (data?.topProduits || []).filter((item, index) => !hiddenKeys.has(`product:${item.reference || index}`)), [data, hiddenKeys]);
  const parcVehicules = useMemo(() => (data?.parcVehicules || []).filter((item, index) => !hiddenKeys.has(`vehicle:${item.type || index}`)), [data, hiddenKeys]);
  const maintenanceCouts = useMemo(() => (data?.maintenanceCouts || []).filter((item, index) => !hiddenKeys.has(`maintenance:${item.mois || index}`)), [data, hiddenKeys]);
  const totals = useMemo(() => treasury.reduce((sum, item) => ({ recettes: sum.recettes + item.recettes, depenses: sum.depenses + item.depenses, solde: sum.solde + item.solde }), { recettes: 0, depenses: 0, solde: 0 }), [treasury]);
  const maxFlow = Math.max(1, ...treasury.flatMap(item => [item.recettes, item.depenses]));

  const hideRow = (key) => setHiddenKeys(previous => {
    const next = new Set(previous);
    next.add(key);
    return next;
  });

  if (loading) return <div className="report-state"><div className="report-loader" /><strong>Préparation indicateurs</strong><span>Consolidation données métier…</span></div>;
  if (error) return <div className="report-state report-state-error"><b>!</b><strong>Reporting indisponible</strong><span>{error}</span><button onClick={load}>Réessayer</button></div>;

  return (
    <section className="report-page">
      <header className="report-hero">
        <div><span>Décisionnel · Vue consolidée</span><h1>Reporting global</h1><p>Suivez performance commerciale, trésorerie et opérations.</p></div>
        <div className="report-controls"><select value={period} onChange={event => setPeriod(event.target.value)} aria-label="Période"><option value="1m">30 derniers jours</option><option value="3m">3 derniers mois</option><option value="12m">12 derniers mois</option></select><button onClick={load}>Actualiser</button></div>
      </header>

      <div className="report-metrics">
        <Metric code="RC" label="Recettes" value={money(totals.recettes)} hint="Flux consolidés" tone="success" />
        <Metric code="DP" label="Dépenses" value={money(totals.depenses)} hint="Charges enregistrées" tone="danger" />
        <Metric code="TR" label="Trésorerie nette" value={money(totals.solde)} hint={totals.solde >= 0 ? 'Solde positif' : 'Vigilance requise'} tone={totals.solde >= 0 ? 'accent' : 'danger'} />
        <Metric code="OP" label="Opérations ouvertes" value={Number(data?.commandesEnAttente || 0) + Number(data?.atelierEnCours || 0)} hint={`${data?.commandesEnAttente || 0} commandes · ${data?.atelierEnCours || 0} atelier`} tone="neutral" />
      </div>

      <div className="report-grid">
        <article className="report-panel report-cashflow">
          <header><div><span>Évolution</span><h2>Flux de trésorerie</h2></div><div className="report-legend"><span><i className="is-income" />Recettes</span><span><i className="is-expense" />Dépenses</span></div></header>
          {treasury.length ? <div className="report-chart">{treasury.map((item, index) => <div className="report-chart-item" key={`${item.mois}-${index}`}><div className="report-bars"><i className="is-income" style={{ height: `${Math.max(3, item.recettes / maxFlow * 100)}%` }} title={money(item.recettes)} /><i className="is-expense" style={{ height: `${Math.max(3, item.depenses / maxFlow * 100)}%` }} title={money(item.depenses)} /></div><span style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'center' }}>{item.mois}{canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={() => hideRow(`cashflow:${item.mois}`)} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 999, width: 18, height: 18, padding: 0, fontWeight: 900, cursor: 'pointer', lineHeight: 1 }}>×</button>}</span></div>)}</div> : <Empty label="Aucun flux enregistré" />}
        </article>

        <article className="report-panel report-products">
          <header><div><span>Classement</span><h2>Produits performants</h2></div><b>Top 10</b></header>
          <div className="report-ranking">{topProduits.slice(0, 10).map((product, index) => <div key={`${product.reference}-${index}`}><span className="report-rank">{String(index + 1).padStart(2, '0')}</span><span><strong>{product.designation || 'Produit sans désignation'}</strong><small>{product.reference || 'Référence inconnue'}</small></span><b style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>{money(product.ca)}{canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={() => hideRow(`product:${product.reference || index}`)} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 999, width: 18, height: 18, padding: 0, fontWeight: 900, cursor: 'pointer', lineHeight: 1 }}>×</button>}</b></div>)}{!topProduits.length && <Empty label="Aucune vente produit" />}</div>
        </article>
      </div>

      <div className="report-grid report-grid-bottom">
        <article className="report-panel">
          <header><div><span>Trésorerie</span><h2>Détail mensuel</h2></div><b>{treasury.length} périodes</b></header>
          <div className="report-table-wrap"><table><thead><tr><th>Période</th><th>Recettes</th><th>Dépenses</th><th>Solde</th><th></th></tr></thead><tbody>{treasury.map((item, index) => <tr key={`${item.mois}-${index}`}><td>{item.mois}</td><td className="is-positive">{money(item.recettes)}</td><td className="is-negative">{money(item.depenses)}</td><td className={item.solde >= 0 ? 'is-positive' : 'is-negative'}><strong>{money(item.solde)}</strong></td><td style={{ textAlign: 'center' }}>{canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={() => hideRow(`cashflow:${item.mois}`)} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 999, width: 22, height: 22, padding: 0, fontWeight: 900, cursor: 'pointer', lineHeight: 1 }}>×</button>}</td></tr>)}</tbody></table></div>
        </article>

        <article className="report-panel">
          <header><div><span>Exploitation</span><h2>Parc et maintenance</h2></div><b>Opérations</b></header>
          <div className="report-operations"><section><h3>Parc véhicules</h3>{parcVehicules.map((vehicle, index) => <div key={`${vehicle.type}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}><span>{vehicle.type || 'Non classé'}</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><strong>{vehicle.nb || 0}</strong>{canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={() => hideRow(`vehicle:${vehicle.type || index}`)} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 999, width: 18, height: 18, padding: 0, fontWeight: 900, cursor: 'pointer', lineHeight: 1 }}>×</button>}</span></div>)}{!parcVehicules.length && <Empty label="Aucun véhicule" />}</section><section><h3>Coûts maintenance</h3>{maintenanceCouts.map((maintenance, index) => <div key={`${maintenance.mois}-${index}`} style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between' }}><span>{maintenance.mois}</span><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><strong>{money(maintenance.cout)}</strong>{canDelete && <button type="button" className="admin-delete-action" title="Supprimer" onClick={() => hideRow(`maintenance:${maintenance.mois || index}`)} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 999, width: 18, height: 18, padding: 0, fontWeight: 900, cursor: 'pointer', lineHeight: 1 }}>×</button>}</span></div>)}{!maintenanceCouts.length && <Empty label="Aucun coût" />}</section></div>
        </article>
      </div>
    </section>
  );
}

function Metric({ code, label, value, hint, tone }) {
  return <article className={`report-metric report-metric-${tone}`}><span className="report-metric-code">{code}</span><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

function Empty({ label }) {
  return <div className="report-empty"><span>—</span><small>{label}</small></div>;
}
