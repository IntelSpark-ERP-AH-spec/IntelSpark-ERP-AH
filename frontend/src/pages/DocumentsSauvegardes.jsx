import { useMemo, useState } from 'react';
import { useAuth } from '../AuthContext';
import { useCurrency } from '../CurrencyContext';

const TYPES_DOC = [
  'Facture', 'Devis', 'Bon de commande', 'Bon de livraison',
  'Avoir', 'Proforma', 'Note de frais', 'Bulletin de paie',
];

function documentAmount(document, kind) {
  const legacyKey = kind === 'ht' ? 'totalHT' : kind === 'tva' ? 'totalTVA' : 'totalTTC';
  return Number(document?.totals?.[kind] ?? document?.[legacyKey] ?? 0) || 0;
}

export default function DocumentsSauvegardes({ savedDocs = [], 
onDelete, onView, language = 'fr' }) {
  const { hasRole } = useAuth();
  const canDelete = hasRole('admin');
  const { currency } = useCurrency();
  const [search, setSearch]   = useState('');
  const [type, setType]       = useState('tous');
  const [periode, setPeriode] = useState('tous'); // tous, mois, semaine
  const [tri, setTri]         = useState('date_desc');

  const tr = {
    fr: { title: 'Documents sauvegardés', search: 'Rechercher (n°, client, type…)', delete: '🗑️ Supprimer', view: '👁️ Voir', empty: 'Aucun document sauvegardé', noResult: 'Aucun résultat', total: 'Total', ttc: 'TTC', client: 'Client', type: 'Type', date: 'Date', num: 'N°', count: 'documents', mois: 'Ce mois', semaine: 'Cette semaine', tous: 'Toutes périodes' },
    en: { title: 'Saved Documents',        search: 'Search…',                         delete: '🗑️ Delete',     view: '👁️ View',  empty: 'No saved documents',       noResult: 'No result',          total: 'Total', ttc: 'Total', client: 'Client', type: 'Type', date: 'Date', num: 'N°', count: 'documents', mois: 'This month', semaine: 'This week', tous: 'All periods' },
  };
  const langKey = String(language || 'fr').toLowerCase().slice(0, 2);
  const t = tr[langKey] || tr.fr;

  const filtered = useMemo(() => {
    let list = savedDocs.slice();
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(d =>
        (d.number || '').toLowerCase().includes(q) ||
        (d.client || '').toLowerCase().includes(q) ||
        (d.type || '').toLowerCase().includes(q)
      );
    }
    if (type !== 'tous')   list = list.filter(d => (d.type || '') === type);

    const now = new Date();
    if (periode === 'mois') {
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      list = list.filter(d => (d.date || '').startsWith(ym));
    } else if (periode === 'semaine') {
      const start = new Date(now); start.setDate(now.getDate() - now.getDay() + 1);
      list = list.filter(d => new Date(d.date) >= start);
    }

    list.sort((a, b) => {
      if (tri === 'date_desc')   return (b.date || '').localeCompare(a.date || '');
      if (tri === 'date_asc')    return (a.date || '').localeCompare(b.date || '');
      if (tri === 'ttc_desc')    return documentAmount(b, 'ttc') - documentAmount(a, 'ttc');
      if (tri === 'ttc_asc')     return documentAmount(a, 'ttc') - documentAmount(b, 'ttc');
      return 0;
    });

    return list;
  }, [savedDocs, search, type, periode, tri]);

  const totalTTC = useMemo(() => filtered.reduce((s, d) => s + documentAmount(d, 'ttc'), 0), [filtered]);
  const totalHT  = useMemo(() => filtered.reduce((s, d) => s + documentAmount(d, 'ht'), 0), [filtered]);
  const totalTVA = useMemo(() => filtered.reduce((s, d) => s + documentAmount(d, 'tva'), 0), [filtered]);

  // Devise d'affichage : devise du contexte (= devise app) prioritaire
  const symbol = currency.symbol;

  return (
    <div className="saved-documents-page" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 0 }}>

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ fontWeight: 900, fontSize: 22, color: '#1e293b' }}>📁 {t.title}</div>
        <span style={{
          background: '#f1f5f9', color: '#475569', padding: '4px 10px',
          borderRadius: 999, fontSize: 12, fontWeight: 700,
        }}>{filtered.length} {t.count}</span>
      </div>

      {/* KPIs */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {[
          ['📄 Documents',      filtered.length,                            '#3b82f6'],
          ['💰 Total HT',       totalHT.toFixed(2) + ' ' + currency.symbol,          '#0f766e'],
          ['🧾 Total TVA',      totalTVA.toFixed(2) + ' ' + currency.symbol,         '#f59e0b'],
          ['💵 Total TTC',      totalTTC.toFixed(2) + ' ' + currency.symbol,         '#16a34a'],
        ].map(([label, value, color]) => (
          <div key={label} style={{
            flex: '1 1 160px', background: '#fff', border: `1px solid ${color}40`,
            borderLeft: `4px solid ${color}`, borderRadius: 10, padding: '10px 14px',
          }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 700 }}>{label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Filtres */}
      <div className="no-print" style={{
        background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 10,
        display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
      }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder={t.search}
          style={{ flex: '2 1 240px', padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none' }} />
        <select value={type} onChange={e => setType(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none', background: '#fff' }}>
          <option value="tous">{t.type} — tous</option>
          {TYPES_DOC.map(ty => <option key={ty} value={ty}>{ty}</option>)}
        </select>
        <select value={periode} onChange={e => setPeriode(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none', background: '#fff' }}>
          <option value="tous">{t.tous}</option>
          <option value="mois">{t.mois}</option>
          <option value="semaine">{t.semaine}</option>
        </select>
        <select value={tri} onChange={e => setTri(e.target.value)}
          style={{ padding: '7px 10px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, outline: 'none', background: '#fff' }}>
          <option value="date_desc">↓ Date</option>
          <option value="date_asc">↑ Date</option>
          <option value="ttc_desc">↓ TTC</option>
          <option value="ttc_asc">↑ TTC</option>
        </select>
      </div>

      {/* Tableau */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <colgroup>
            <col style={{ width: '15%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '25%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '14%' }} />
            <col className="no-print" style={{ width: '6%' }} />
          </colgroup>
          <thead>
            <tr style={{ background: '#f8fafc', position: 'sticky', top: 0 }}>
              {[t.num, t.type, t.date, t.client, 'HT', 'TTC', ''].map((h, i) => (
                <th key={i} className={i === 6 ? 'no-print' : ''} style={{
                  textAlign: 'center', padding: '9px 10px', borderBottom: '2px solid #e2e8f0',
                  color: '#475569', fontWeight: 800, fontSize: 11, verticalAlign: 'middle',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                {savedDocs.length === 0 ? t.empty : t.noResult}
              </td></tr>
            )}
            {filtered.map((d, i) => {
              return (
                <tr key={d.id || i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontFamily: 'monospace', fontWeight: 700, color: '#0f766e', verticalAlign: 'middle' }}>
                    {d.number || '—'}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{d.type || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{d.date || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>{d.client || '—'}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', verticalAlign: 'middle' }}>
                    {documentAmount(d, 'ht').toFixed(2)} {symbol}
                  </td>
                  <td style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 800, color: '#0f766e', verticalAlign: 'middle' }}>
                    {documentAmount(d, 'ttc').toFixed(2)} {symbol}
                  </td>
                  <td className="no-print" style={{ padding: '8px 10px', textAlign: 'center', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      {onView && (
                        <button onClick={() => onView(d)} style={{
                          background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0',
                          borderRadius: 5, padding: '4px 8px', fontWeight: 700, cursor: 'pointer', fontSize: 11,
                        }}>{t.view}</button>
                      )}
                      {canDelete && onDelete && (
                        <button className="admin-delete-action" title={t.delete.replace('🗑️ ', '')} onClick={() => onDelete(d)} style={{
                          background: '#fff', color: '#dc2626', border: '1px solid #fecaca',
                          borderRadius: 5, width: 25, height: 25, padding: 0, fontWeight: 900, cursor: 'pointer', fontSize: 14,
                        }}>×</button>
                      )}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {filtered.length > 0 && (
            <tfoot>
              <tr style={{ background: '#f0fdf4', fontWeight: 800 }}>
                <td colSpan={4} style={{ padding: '8px 10px', textAlign: 'right', color: '#0f766e' }}>TOTAUX</td>
                <td style={{ padding: '8px 10px', textAlign: 'center', color: '#0f766e' }}>{totalHT.toFixed(2)} {currency.symbol}</td>
                <td style={{ padding: '8px 10px', textAlign: 'center', color: '#0f766e' }}>{totalTTC.toFixed(2)} {currency.symbol}</td>
                <td className="no-print"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
