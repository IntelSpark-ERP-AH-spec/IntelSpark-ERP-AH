import { useT } from '../appI18n';

export default function SessionGlobale({ savedDocs, catalog, clients, leads, items, currencyKey, documentType, documentNumber, totals, alerteStock, setActivePage }) {
  const t = useT();
  const btn = (color) => ({
    background: color || '#0d9488', border: 'none', borderRadius: 6, padding: '6px 14px',
    color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', fontFamily: 'inherit',
  });

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
      <div style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>🌐 {t('Session Globale')}</div>

      {/* Stats bar */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
        {[
          { icon: '📄', label: 'Documents', value: savedDocs.length, color: '#3b82f6' },
          { icon: '📚', label: 'Catalogue', value: catalog.length, color: '#0d9488' },
          { icon: '👤', label: 'Clients', value: clients.length, color: '#8b5cf6' },
          { icon: '👥', label: 'Leads/Pipeline', value: leads.length, color: '#f59e0b' },
          { icon: '📦', label: 'Articles en cours', value: items.length, color: '#10b981' },
        ].map((c, i) => (
          <div key={i} style={{
            background: '#fff', borderRadius: 10, padding: 14,
            borderLeft: `4px solid ${c.color}`, boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
          }}>
            <div style={{ fontSize: 22 }}>{c.icon}</div>
            <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600 }}>{c.label}</div>
            <div style={{ fontSize: 18, fontWeight: 900, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Document actif + Dashboard rapide */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{
          background: '#fff', borderRadius: 10, padding: 16,
          border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: '#475569', marginBottom: 8 }}>📄 Document actif</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div><span style={{ color: '#64748b' }}>Type :</span> <strong>{documentType}</strong></div>
            <div><span style={{ color: '#64748b' }}>N° :</span> <strong>{documentNumber}</strong></div>
            <div><span style={{ color: '#64748b' }}>Articles :</span> <strong>{items.length}</strong></div>
            <div><span style={{ color: '#64748b' }}>Total HT :</span> <strong>{totals.ht.toFixed(2)} {currencyKey}</strong></div>
            <div><span style={{ color: '#64748b' }}>Total TTC :</span> <strong>{totals.ttc.toFixed(2)} {currencyKey}</strong></div>
          </div>
          <button onClick={() => setActivePage('chiffrage')} style={{ ...btn(), marginTop: 10 }}>Ouvrir →</button>
        </div>
        <div style={{
          background: '#fff', borderRadius: 10, padding: 16,
          border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: '#475569', marginBottom: 8 }}>📊 Aperçu Dashboard</div>
          {(() => {
            const mois = new Date().getMonth();
            const annee = new Date().getFullYear();
            const docsMois = savedDocs.filter(d => {
              if (!d.date) return false;
              const [j, m, a] = d.date.split('/').map(Number);
              return m === mois + 1 && a === annee;
            });
            const caMois = docsMois.reduce((s, d) => s + (d.totals?.ttc || 0), 0);
            const valides = savedDocs.filter(d => d.status !== 'draft').length;
            return (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>CA du mois</span>
                  <strong style={{ color: '#10b981' }}>{caMois.toFixed(2)} {currencyKey}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Total documents</span>
                  <strong>{savedDocs.length}</strong>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: '#64748b' }}>Validés</span>
                  <strong>{valides}</strong>
                </div>
              </div>
            );
          })()}
          <button onClick={() => setActivePage('dashboard')} style={{ ...btn(), marginTop: 10 }}>Ouvrir →</button>
        </div>
      </div>

      {/* Catalogue aperçu */}
      {catalog.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: 10, padding: 16,
          border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: '#475569', marginBottom: 8 }}>📚 Catalogue — dernières références</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 6 }}>
            {catalog.slice(0, 6).map(c => (
              <div key={c.ref} style={{
                background: '#f8fafc', borderRadius: 6, padding: '6px 10px',
                border: '1px solid #e2e8f0',
              }}>
                <div style={{ fontWeight: 700, fontSize: 12, color: '#0d9488' }}>{c.ref}</div>
                <div style={{ fontSize: 12, color: '#475569' }}>{c.name}</div>
                <div style={{ fontSize: 12, fontWeight: 600 }}>{c.price} {currencyKey}</div>
              </div>
            ))}
          </div>
          <button onClick={() => setActivePage('catalogue')} style={{ ...btn(), marginTop: 8 }}>Voir tout →</button>
        </div>
      )}

      {/* Stock alertes */}
      {alerteStock.length > 0 && (
        <div style={{
          background: '#fff', borderRadius: 10, padding: 16,
          border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
        }}>
          <div style={{ fontWeight: 900, fontSize: 14, color: '#dc2626', marginBottom: 8 }}>
            ⚠️ Alertes Stock ({alerteStock.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 6 }}>
            {alerteStock.slice(0, 8).map(c => (
              <div key={c.ref} style={{
                background: '#fef2f2', borderRadius: 6, padding: '6px 10px',
                border: '1px solid #fecaca', fontSize: 12,
              }}>
                <strong style={{ color: '#dc2626' }}>{c.ref}</strong> — {c.name}
                <div style={{ color: '#991b1b' }}>
                  Stock: {c.stockPhysique || 0} / Min: {c.minStock != null ? c.minStock : 2}
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => setActivePage('stock')} style={{ ...btn(), marginTop: 8 }}>Gérer le stock →</button>
        </div>
      )}

      {/* Navigation rapide */}
      <div style={{
        background: '#fff', borderRadius: 10, padding: 16,
        border: '1px solid #e2e8f0', boxShadow: '0 1px 4px rgba(0,0,0,0.04)',
      }}>
        <div style={{ fontWeight: 900, fontSize: 14, color: '#475569', marginBottom: 10 }}>🔗 Accès rapide</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
          {[
            { id: 'dashboard', icon: '📊', label: 'Tableau de bord' },
            { id: 'catalogue', icon: '📚', label: 'Catalogue' },
            { id: 'stock', icon: '📦', label: 'Stock' },
            { id: 'clients', icon: '👤', label: 'Clients' },
            { id: 'pipeline', icon: '👥', label: 'Pipeline' },
            { id: 'reporting', icon: '📊', label: 'Reporting' },
            { id: 'hist', icon: '⏱️', label: 'Historique' },
            { id: 'status', icon: '📋', label: 'Statut' },
            { id: 'saved', icon: '📁', label: 'Enregistrés' },
            { id: 'magasin_reception', icon: '📥', label: 'Réception' },
            { id: 'magasin_stockage', icon: '📍', label: 'Stockage' },
            { id: 'magasin_preparation', icon: '📋', label: 'Préparation' },
            { id: 'magasin_expedition', icon: '🚚', label: 'Expédition' },
            { id: 'magasin_gestion', icon: '📦', label: 'Gestion Stock' },
            { id: 'compta_journaux_achats', icon: '📋', label: "Journal d'Achat" },
            { id: 'admin_users', icon: '🔐', label: 'Administration' },
          ].map(m => (
            <button key={m.id} onClick={() => setActivePage(m.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px',
                borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff',
                color: '#475569', fontWeight: 600, fontSize: 12, cursor: 'pointer',
                fontFamily: 'inherit', textAlign: 'left',
              }}>
              <span>{m.icon}</span><span>{m.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
