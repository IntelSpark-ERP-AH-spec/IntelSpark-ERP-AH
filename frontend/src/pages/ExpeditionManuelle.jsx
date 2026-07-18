import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';

const field = { width: '100%', boxSizing: 'border-box', padding: '9px 10px', border: '1px solid #cbd5e1', borderRadius: 7, font: 'inherit', fontSize: 13 };
const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 11, marginBottom: 14, overflow: 'hidden' };
const th = { padding: '9px 10px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569', fontSize: 10, textTransform: 'uppercase', textAlign: 'left', whiteSpace: 'nowrap' };
const td = { padding: '8px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };

export default function ExpeditionManuelle({ canEdit, showMsg }) {
  const [numeroBL, setNumeroBL] = useState('');
  const [bonsLivraison, setBonsLivraison] = useState([]);
  const [bonLivraison, setBonLivraison] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  const totalWeight = useMemo(() => rows.reduce((sum, row) => sum + Number(row.quantite_attendue || 0) * Number(row.poids_unitaire || 0), 0), [rows]);

  const refreshBLs = async () => {
    try { setBonsLivraison(await api.request('/warehouse/bons-livraison')); }
    catch { setBonsLivraison([]); }
  };

  useEffect(() => { refreshBLs(); }, []);

  const openBL = async () => {
    if (!numeroBL.trim()) return showMsg('Sélectionnez ou saisissez un numéro de Bon de Livraison.', 'warning');
    setBusy(true);
    try {
      const data = await api.request(`/warehouse/bons-livraison/${encodeURIComponent(numeroBL.trim())}`);
      setBonLivraison(data);
      setRows(data.items.map((item) => ({ ...item, quantite_chargee: '', verifie: false })));
      showMsg(`BL ${data.numero} ouvert.`, 'success');
    } catch (error) {
      setBonLivraison(null);
      setRows([]);
      showMsg(error.message, 'error');
    } finally { setBusy(false); }
  };

  const updateRow = (index, patch) => setRows((current) => current.map((row, i) => i === index ? { ...row, ...patch } : row));

  const validate = async () => {
    if (!bonLivraison || !rows.length) return showMsg('Ouvrez un Bon de Livraison avant de valider.', 'warning');
    const missing = rows.reduce((sum, row) => sum + Math.max(0, Number(row.quantite_attendue || 0) - Number(row.quantite_chargee || 0)), 0);
    let confirmerPartiel = false;
    if (missing > 0) {
      confirmerPartiel = await systemConfirm(`Attention : écart détecté avec le BL. Il manque ${missing} pièce(s). Confirmer l’expédition partielle ?`, { danger: false, confirmLabel: 'Confirmer expédition' });
      if (!confirmerPartiel) return;
    }
    setBusy(true);
    try {
      const result = await api.request(`/warehouse/bons-livraison/${bonLivraison.id}/valider`, {
        method: 'POST',
        body: JSON.stringify({
          items: rows.map((row) => ({ item_id: row.id, quantite_expediee: Number(row.quantite_chargee || 0), verifie: row.verifie })),
          confirmer_partiel: confirmerPartiel,
        }),
      });
      showMsg(result.partial ? 'Chargement partiel validé : stock et comptabilité mis à jour.' : 'Chargement validé : stock et comptabilité mis à jour.', 'success');
      setBonLivraison(null);
      setRows([]);
      setNumeroBL('');
      refreshBLs();
    } catch (error) { showMsg(error.message, 'error'); }
    finally { setBusy(false); }
  };

  return <div>
    <section style={card}>
      <div style={{ padding: 14, display: 'flex', gap: 10, alignItems: 'end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 300px' }}>
          <label htmlFor="expedition-bl" style={{ display: 'block', marginBottom: 5, fontSize: 11, color: '#475569', fontWeight: 800 }}>BON DE LIVRAISON ENVOYÉ PAR LE COMMERCIAL</label>
          <input id="expedition-bl" value={numeroBL} list="bons-livraison-disponibles" onChange={(event) => setNumeroBL(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && openBL()} placeholder="Sélectionner ou saisir le N° du BL" style={field} />
          <datalist id="bons-livraison-disponibles">{bonsLivraison.map((bl) => <option key={bl.id} value={bl.numero}>{bl.client_nom} - {bl.chauffeur_livreur}</option>)}</datalist>
        </div>
        <button onClick={openBL} disabled={busy} style={{ padding: '10px 16px', background: '#2563eb', color: '#fff', border: 0, borderRadius: 7, cursor: 'pointer', fontWeight: 800, opacity: busy ? 0.65 : 1 }}>{busy ? 'Ouverture...' : 'Ouvrir le BL'}</button>
      </div>
    </section>

    {bonLivraison && <>
      <section style={card}>
        <div style={{ padding: '11px 14px', fontWeight: 900, color: '#1e293b' }}>Informations fixes du Bon de Livraison</div>
        <div style={{ padding: '0 14px 14px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
          <div><span style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#64748b', marginBottom: 4 }}>CLIENT</span><div style={{ ...field, background: '#f8fafc', color: '#334155' }}>{bonLivraison.client_nom}</div></div>
          <div><span style={{ display: 'block', fontSize: 10, fontWeight: 800, color: '#64748b', marginBottom: 4 }}>CHAUFFEUR / LIVREUR</span><div style={{ ...field, background: '#f8fafc', color: '#334155' }}>{bonLivraison.chauffeur_livreur}</div></div>
        </div>
      </section>

      {totalWeight > 500 && <div role="alert" style={{ marginBottom: 14, border: '1px solid #fdba74', borderRadius: 9, padding: '11px 14px', background: '#fff7ed', color: '#9a3412', fontWeight: 800 }}>Alerte logistique : poids total de {Number(totalWeight).toLocaleString('fr-MA')} kg. Utiliser le chariot élévateur pour le quai de chargement.</div>}

      <section style={card}>
        <div style={{ padding: '11px 14px', fontWeight: 900, color: '#1e293b' }}>Pointage physique - BL {bonLivraison.numero}</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', minWidth: 900, width: '100%', fontSize: 12 }}>
            <thead><tr><th style={th}>Réf / SKU</th><th style={th}>Désignation</th><th style={th}>Emplacement</th><th style={{ ...th, textAlign: 'right' }}>Qté attendue</th><th style={{ ...th, textAlign: 'right' }}>Qté chargée</th><th style={{ ...th, textAlign: 'center' }}>Contrôle visuel</th></tr></thead>
            <tbody>{rows.map((row, index) => <tr key={row.id}>
              <td style={{ ...td, fontFamily: 'monospace', fontWeight: 800 }}>{row.reference || 'Non liée'}</td>
              <td style={td}>{row.designation}</td>
              <td style={{ ...td, color: '#475569' }}>{row.emplacement || 'À définir'}</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{row.quantite_attendue}</td>
              <td style={{ ...td, textAlign: 'right' }}><input aria-label={`Quantité chargée ${row.designation}`} type="number" min="0" max={row.quantite_attendue} value={row.quantite_chargee} onChange={(event) => updateRow(index, { quantite_chargee: event.target.value })} style={{ ...field, width: 90, textAlign: 'right' }} /></td>
              <td style={{ ...td, textAlign: 'center' }}><input type="checkbox" checked={row.verifie} onChange={(event) => updateRow(index, { verifie: event.target.checked })} aria-label={`Contrôle visuel ${row.designation}`} style={{ width: 17, height: 17, cursor: 'pointer' }} /></td>
            </tr>)}</tbody>
          </table>
        </div>
        <div style={{ padding: 13, textAlign: 'right', borderTop: '1px solid #e2e8f0', background: '#f8fafc' }}><button onClick={validate} disabled={!canEdit || busy} style={{ padding: '11px 18px', background: '#15803d', color: '#fff', border: 0, borderRadius: 7, cursor: 'pointer', fontWeight: 900, opacity: busy || !canEdit ? 0.6 : 1 }}>{busy ? 'Validation...' : 'Valider le chargement & Expédier la pièce'}</button></div>
      </section>
    </>}
  </div>;
}
