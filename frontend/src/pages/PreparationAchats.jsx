import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';

const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', marginBottom: 14 };
const input = { width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid #cbd5e1', borderRadius: 7, font: 'inherit', fontSize: 12, outline: 'none' };
const label = { display: 'block', marginBottom: 4, fontSize: 10, fontWeight: 800, letterSpacing: '.04em', color: '#64748b', textTransform: 'uppercase' };
const th = { padding: '9px 10px', background: '#f8fafc', borderBottom: '2px solid #e2e8f0', textAlign: 'left', color: '#475569', fontSize: 10, textTransform: 'uppercase', whiteSpace: 'nowrap' };
const td = { padding: '7px 10px', borderBottom: '1px solid #f1f5f9', verticalAlign: 'middle' };

function money(value) { return `${Number(value || 0).toLocaleString('fr-MA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} DH`; }

function EditableItemTable({ items, setItems, mode, products, canDelete = false }) {
  const update = (index, field, value) => setItems((current) => current.map((item, i) => i === index ? { ...item, [field]: value } : item));
  const updateReference = (index, reference) => {
    const product = products.find((entry) => entry.reference?.toLowerCase() === reference.trim().toLowerCase());
    setItems((current) => current.map((item, i) => i === index ? {
      ...item,
      reference,
      ...(product ? {
        produit_id: product.id,
        designation: product.designation,
        prix_unitaire: Number(product.prix_ht || product.prix_vente || 0),
        poids_unitaire: Number(product.poids_unitaire || 0),
        volume_unitaire: Number(product.volume_unitaire || 0),
        emplacement: product.emplacement || item.emplacement,
      } : {}),
    } : item));
  };
  const selectProduct = (index, productId) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    setItems((current) => current.map((item, i) => i === index ? {
      ...item, produit_id: product.id, reference: product.reference, designation: product.designation,
      prix_unitaire: Number(product.prix_ht || product.prix_vente || 0), poids_unitaire: Number(product.poids_unitaire || 0),
      volume_unitaire: Number(product.volume_unitaire || 0), emplacement: product.emplacement || item.emplacement,
      statut_espace: product.emplacement ? 'Espace à confirmer' : item.statut_espace,
    } : item));
  };
  const add = () => setItems((current) => [...current, { produit_id: '', reference: '', designation: '', quantite: 1, prix_unitaire: 0, poids_unitaire: 0, volume_unitaire: 0, emplacement: mode === 'import' ? 'Allée A / Sol' : '', statut_espace: 'Espace à confirmer' }]);

  return <div style={{ overflowX: 'auto' }}>
    <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: mode === 'import' ? 1100 : 900, fontSize: 12 }}>
      <thead><tr>
        <th style={th}>Référence / SKU</th><th style={th}>Désignation</th><th style={{ ...th, textAlign: 'right' }}>{mode === 'import' ? 'Qté attendue' : 'Qté à acheter'}</th>
        {mode === 'local' ? <><th style={{ ...th, textAlign: 'right' }}>Poids unitaire (kg)</th><th style={{ ...th, textAlign: 'right' }}>Poids total</th><th style={th}>Emplacement suggéré</th></> : <><th style={{ ...th, textAlign: 'right' }}>Poids unitaire (kg)</th><th style={{ ...th, textAlign: 'right' }}>Poids total</th><th style={th}>Volume / encombrement</th><th style={th}>Emplacement suggéré</th><th style={th}>Statut de l’espace</th></>}
        <th style={th}>Action</th>
      </tr></thead>
      <tbody>{items.map((item, index) => {
        const total = Number(item.quantite || 0) * Number(item.poids_unitaire || 0);
        const saturated = item.statut_espace === 'Alerte dépôt saturé';
        return <tr key={index} style={{ background: saturated ? '#fff1f2' : '#fff' }}>
          <td style={td}><input list="purchase-sku-options" value={item.reference} onChange={(e) => updateReference(index, e.target.value)} placeholder="REF-001" style={{ ...input, minWidth: 105, fontFamily: 'monospace' }} /></td>
          <td style={{ ...td, minWidth: 210 }}><select value={item.produit_id} onChange={(e) => selectProduct(index, e.target.value)} style={{ ...input, marginBottom: 4 }}><option value="">— Catalogue / saisie libre —</option>{products.map((p) => <option key={p.id} value={p.id}>{p.reference} — {p.designation}</option>)}</select><input value={item.designation} onChange={(e) => update(index, 'designation', e.target.value)} placeholder="Désignation de la pièce" style={input} /></td>
          <td style={td}><input type="number" min="0.01" value={item.quantite} onChange={(e) => update(index, 'quantite', e.target.value)} style={{ ...input, width: 84, textAlign: 'right' }} /></td>
          {mode === 'local' ? <><td style={td}><input type="number" min="0" value={item.poids_unitaire} onChange={(e) => update(index, 'poids_unitaire', e.target.value)} style={{ ...input, width: 100, textAlign: 'right' }} /></td><td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{Number(total).toLocaleString('fr-MA')} kg</td><td style={td}><input value={item.emplacement} onChange={(e) => update(index, 'emplacement', e.target.value)} placeholder="Allée A / Étagère 2" style={{ ...input, width: 150 }} /></td></> : <><td style={td}><input type="number" min="0" value={item.poids_unitaire} onChange={(e) => update(index, 'poids_unitaire', e.target.value)} style={{ ...input, width: 100, textAlign: 'right' }} /></td><td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{Number(total).toLocaleString('fr-MA')} kg</td><td style={td}><input value={item.volume_unitaire || ''} onChange={(e) => update(index, 'volume_unitaire', e.target.value)} placeholder="m³ / palette" style={{ ...input, width: 105 }} /></td><td style={td}><input value={item.emplacement} onChange={(e) => update(index, 'emplacement', e.target.value)} style={{ ...input, width: 140 }} /></td><td style={{ ...td, color: saturated ? '#be123c' : '#0f766e', fontWeight: 800 }}>{item.statut_espace || 'Espace à confirmer'}</td></>}
          <td style={td}>{canDelete && <button className="admin-delete-action" onClick={() => setItems((current) => current.filter((_, i) => i !== index))} style={{ border: 0, background: 'transparent', color: '#dc2626', cursor: 'pointer', fontSize: 18 }} aria-label="Supprimer la ligne">×</button>}</td>
        </tr>;
      })}
      {!items.length && <tr><td colSpan={mode === 'local' ? 7 : 10} style={{ ...td, padding: 25, textAlign: 'center', color: '#94a3b8' }}>Ajoutez des lignes manuellement pour constituer la commande.</td></tr>}
      </tbody>
    </table>
    <datalist id="purchase-sku-options">{products.map((product) => <option key={product.id} value={product.reference}>{product.designation}</option>)}</datalist>
    <button onClick={add} style={{ margin: 10, border: '1px solid #bfdbfe', background: '#eff6ff', color: '#1d4ed8', borderRadius: 7, padding: '7px 11px', cursor: 'pointer', fontWeight: 700 }}>+ Ajouter une pièce</button>
  </div>;
}

export function PreparationLocale({ canEdit, canDelete = false, showMsg }) {
  const [products, setProducts] = useState([]); const [supplier, setSupplier] = useState(''); const [date, setDate] = useState(new Date().toISOString().slice(0, 10)); const [status, setStatus] = useState('en_projet'); const [items, setItems] = useState([]); const [history, setHistory] = useState([]);
  const totalWeight = useMemo(() => items.reduce((sum, item) => sum + Number(item.quantite || 0) * Number(item.poids_unitaire || 0), 0), [items]);
  const total = useMemo(() => items.reduce((sum, item) => sum + Number(item.quantite || 0) * Number(item.prix_unitaire || 0), 0), [items]);
  const load = () => { api.getProduits().then(setProducts).catch(() => {}); api.request('/warehouse/preparations-locales').then(setHistory).catch(() => {}); };
  useEffect(load, []);
  const confirm = async () => { if (!canEdit) return; try { const result = await api.request('/warehouse/preparations-locales', { method: 'POST', body: JSON.stringify({ fournisseur_nom: supplier, date_demande: date, status, items }) }); showMsg(`Bon de commande ${result.numero} créé et comptabilité notifiée.`, 'success'); setItems([]); load(); } catch (error) { showMsg(error.message, 'error'); } };
  const markReceived = async (id) => {
    try {
      await api.request(`/warehouse/preparations-locales/${id}/reception`, { method: 'PUT' });
      showMsg('Commande marquée comme reçue.', 'success');
      load();
    } catch (error) { showMsg(error.message, 'error'); }
  };
  const removeHistory = async (id) => {
    if (!canDelete || !(await systemConfirm('Supprimer cette préparation locale ?'))) return;
    try {
      await api.request(`/warehouse/preparations-locales/${id}`, { method: 'DELETE' });
      setHistory((current) => current.filter((entry) => entry.id !== id));
      showMsg('Préparation locale supprimée.', 'success');
    } catch (error) { showMsg(error.message, 'error'); }
  };
  return <><div className="magasinier-preparation">
    <div style={card}><div style={{ padding: '12px 15px', fontWeight: 900, color: '#1e293b' }}>Informations du fournisseur local</div><div style={{ padding: '0 15px 15px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}><div><label style={label}>Fournisseur marocain</label><input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Maghreb Pièces SARL" style={input} /></div><div><label style={label}>Date de la demande</label><input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={input} /></div><div><label style={label}>Statut de la préparation</label><select value={status} onChange={(e) => setStatus(e.target.value)} style={input}><option value="en_projet">En projet</option><option value="envoye_fournisseur">Envoyé au fournisseur</option></select></div><div style={{ alignSelf: 'end', color: '#0f766e', fontSize: 16, fontWeight: 900 }}>Total estimé : {money(total)}</div></div></div>
    <div style={card}><div style={{ padding: '12px 15px', fontWeight: 900, color: '#1e293b' }}>Pièces à acheter</div><EditableItemTable items={items} setItems={setItems} products={products} mode="local" canDelete={canDelete} /><div style={{ padding: 12, borderTop: '1px solid #e2e8f0', background: '#f8fafc', textAlign: 'right' }}><button disabled={!canEdit || !items.length} onClick={confirm} style={{ background: '#0f766e', color: '#fff', border: 0, borderRadius: 7, padding: '10px 15px', cursor: 'pointer', fontWeight: 900, opacity: !items.length ? .5 : 1 }}>Confirmer la commande d’achat</button></div></div>
    {history.length > 0 && <div style={{ fontSize: 12, color: '#64748b' }}>Dernière commande : <strong>{history[0].commande_numero}</strong> — {history[0].fournisseur_nom} — {money(history[0].total_ht)}</div>}
  </div>
  {history.length > 0 && <div style={{ ...card, marginTop: 14 }}>
    <div style={{ padding: '12px 15px', fontWeight: 900, color: '#1e293b' }}>Historique des commandes locales</div>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 720, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr><th style={th}>Bon de commande</th><th style={th}>Date</th><th style={th}>Fournisseur</th><th style={th}>Désignations et quantités</th><th style={th}>Statut commande</th><th style={th}>Réception</th><th style={th}></th></tr></thead><tbody>
      {history.map((entry) => <tr key={entry.id}><td style={{ ...td, fontFamily: 'monospace', fontWeight: 800 }}>{entry.commande_numero}</td><td style={td}>{entry.date_demande}</td><td style={td}>{entry.fournisseur_nom}</td><td style={td}>{(entry.items || []).map((item) => <div key={`${entry.id}-${item.reference}-${item.designation}`}>{item.designation} <strong>× {item.quantite}</strong></div>)}</td><td style={td}><span style={{ color: entry.status === 'envoye_fournisseur' ? '#1d4ed8' : '#a16207', fontWeight: 800 }}>{entry.status === 'envoye_fournisseur' ? 'Envoyée au fournisseur' : 'En projet'}</span></td><td style={td}><span style={{ color: entry.reception_status === 'recu' ? '#15803d' : '#b45309', fontWeight: 800 }}>{entry.reception_status === 'recu' ? 'Pièces reçues' : 'En attente'}</span></td><td style={td}><span style={{display:'inline-flex',gap:5}}>{canEdit && entry.reception_status !== 'recu' && <button onClick={() => markReceived(entry.id)} style={{ border: 0, borderRadius: 6, padding: '6px 9px', background: '#dcfce7', color: '#166534', fontWeight: 800, cursor: 'pointer' }}>Marquer reçue</button>}{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => removeHistory(entry.id)} style={{border:'1px solid #fecaca',borderRadius:6,background:'#fff',color:'#dc2626',fontWeight:900,cursor:'pointer'}}>×</button>}</span></td></tr>)}
    </tbody></table></div>
  </div>}
  </>;
}

export function PreparationImportation({ canEdit, canDelete = false, showMsg, onOpenReception }) {
  const [products, setProducts] = useState([]); const [supplier, setSupplier] = useState(''); const [eta, setEta] = useState(''); const [transport, setTransport] = useState(''); const [items, setItems] = useState([]); const [history, setHistory] = useState([]);
  const totalWeight = useMemo(() => items.reduce((sum, item) => sum + Number(item.quantite || 0) * Number(item.poids_unitaire || 0), 0), [items]);
  const load = () => { api.getProduits().then(setProducts).catch(() => {}); api.request('/warehouse/preparations-importation').then(setHistory).catch(() => {}); };
  useEffect(load, []);
  const save = async () => { try { const result = await api.request('/warehouse/preparations-importation', { method: 'POST', body: JSON.stringify({ fournisseur_nom: supplier, eta, type_transport: transport, items }) }); showMsg(`Arrivage enregistré en transit international (${Number(result.poids_total).toLocaleString('fr-MA')} kg).`, 'success'); setItems([]); load(); } catch (error) { showMsg(error.message, 'error'); } };
  const transfer = async (id) => { try { const result = await api.request(`/warehouse/preparations-importation/${id}/basculer-reception`, { method: 'POST' }); localStorage.setItem('is_import_reception_draft', JSON.stringify(result.receptionDraft)); showMsg('Brouillon transféré : pointez maintenant les pièces à la réception.', 'success'); onOpenReception?.(); } catch (error) { showMsg(error.message, 'error'); } };
  const removeHistory = async (id) => { if (!canDelete || !(await systemConfirm('Supprimer cette préparation importation ?'))) return; try { await api.request(`/warehouse/preparations-importation/${id}`, { method: 'DELETE' }); setHistory((current) => current.filter((entry) => entry.id !== id)); showMsg('Préparation importation supprimée.', 'success'); } catch (error) { showMsg(error.message, 'error'); } };
  return <><div className="magasinier-preparation">
    <div style={card}><div style={{ padding: '12px 15px', fontWeight: 900, color: '#1e293b' }}>Arrivée logistique</div><div style={{ padding: '0 15px 15px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}><div><label style={label}>Fournisseur étranger</label><input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Volvo Trucks Allemagne" style={input} /></div><div><label style={label}>ETA au Maroc</label><input type="date" value={eta} onChange={(e) => setEta(e.target.value)} style={input} /></div><div><label style={label}>Volume / transport</label><input value={transport} onChange={(e) => setTransport(e.target.value)} placeholder="Conteneur 40 pieds / Camion TIR" style={input} /></div><div style={{ alignSelf: 'end', color: totalWeight >= 2000 ? '#b45309' : '#0f766e', fontSize: 14, fontWeight: 900 }}>{totalWeight >= 2000 ? `⚠ ${Number(totalWeight).toLocaleString('fr-MA')} kg : grand chariot élévateur requis` : `Charge prévue : ${Number(totalWeight).toLocaleString('fr-MA')} kg`}</div></div></div>
    <div style={card}><div style={{ padding: '12px 15px', fontWeight: 900, color: '#1e293b' }}>Préparation du stockage</div><EditableItemTable items={items} setItems={setItems} products={products} mode="import" canDelete={canDelete} /><div style={{ padding: 12, borderTop: '1px solid #e2e8f0', background: '#f8fafc', textAlign: 'right' }}><button disabled={!canEdit || !items.length} onClick={save} style={{ background: '#b45309', color: '#fff', border: 0, borderRadius: 7, padding: '10px 15px', cursor: 'pointer', fontWeight: 900, opacity: !items.length ? .5 : 1 }}>Enregistrer en transit international</button></div></div>
  </div>
  {history.length > 0 && <div style={{ ...card, marginTop: 14 }}>
    <div style={{ padding: '12px 14px', fontWeight: 900, color: '#1e293b' }}>Historique des commandes import</div>
    <div style={{ overflowX: 'auto' }}><table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontSize: 12 }}><thead><tr><th style={th}>N° bon import</th><th style={th}>Date / ETA</th><th style={th}>Fournisseur</th><th style={th}>Désignation</th><th style={{ ...th, textAlign: 'right' }}>Quantité</th><th style={{ ...th, textAlign: 'right' }}>Prix unitaire</th><th style={th}>Statut commande</th><th style={th}></th></tr></thead><tbody>
      {history.flatMap((entry) => (entry.items || []).map((item, index) => <tr key={`${entry.id}-${index}`}><td style={{ ...td, fontFamily: 'monospace', fontWeight: 800 }}>{entry.numero || `IMPORT-${entry.id.slice(0, 8).toUpperCase()}`}</td><td style={td}>{entry.eta || entry.created_at?.slice(0, 10) || 'À confirmer'}</td><td style={td}>{entry.fournisseur_nom}</td><td style={td}>{item.designation}</td><td style={{ ...td, textAlign: 'right', fontWeight: 800 }}>{item.quantite}</td><td style={{ ...td, textAlign: 'right' }}>{money(item.prix_unitaire)}</td><td style={td}><span style={{ color: entry.status === 'pret_reception' ? '#0f766e' : '#2563eb', fontWeight: 800 }}>{entry.status === 'pret_reception' ? 'Prête pour réception' : 'En transit international'}</span></td><td style={td}>{index === 0 && <span style={{display:'inline-flex',gap:5}}>{entry.status === 'en_transit_international' && <button onClick={() => transfer(entry.id)} style={{ background: '#0f766e', color: '#fff', border: 0, borderRadius: 6, padding: '6px 9px', fontWeight: 800, cursor: 'pointer' }}>Basculer vers réception</button>}{canDelete && <button className="admin-delete-action" title="Supprimer" onClick={() => removeHistory(entry.id)} style={{border:'1px solid #fecaca',borderRadius:6,background:'#fff',color:'#dc2626',fontWeight:900,cursor:'pointer'}}>×</button>}</span>}</td></tr>))}
    </tbody></table></div>
  </div>}
  </>;
}
