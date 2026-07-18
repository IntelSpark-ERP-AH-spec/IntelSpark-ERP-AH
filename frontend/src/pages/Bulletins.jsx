import { useState, useMemo } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useT } from '../appI18n';

const MOIS_LABELS = {
  '01': 'Janvier', '02': 'Février', '03': 'Mars', '04': 'Avril', '05': 'Mai', '06': 'Juin',
  '07': 'Juillet', '08': 'Août', '09': 'Septembre', '10': 'Octobre', '11': 'Novembre', '12': 'Décembre',
};

function formatPeriode(periode) {
  if (!periode) return '';
  const [y, m] = periode.split('-');
  const nomMois = MOIS_LABELS[m] || '';
  const dernierJour = new Date(Number(y), Number(m), 0).getDate();
  return `${nomMois} ${y} (du 01/${m}/${y} au ${dernierJour.toString().padStart(2, '0')}/${m}/${y})`;
}

export default function BulletinsPage() {
  const t = useT();
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'rh', 'comptable');
  const canDelete = hasRole('admin');

  const [periode, setPeriode] = useState(new Date().toISOString().slice(0, 7));
  const [employes, setEmployes] = useState([]);
  const [bulletinsExistants, setBulletinsExistants] = useState([]);
  const [lignes, setLignes] = useState([]);
  const [notify, setNotify] = useState(null);
  const [loading, setLoading] = useState(false);
  const [genere, setGenere] = useState(false);

  function showMsg(msg, type = 'info') { setNotify({ msg, type }); setTimeout(() => setNotify(null), 3500); }

  // ============= Étape 1 + 2 : bouton "Générer les bulletins du mois" =============
  async function genererBulletins() {
    setLoading(true);
    try {
      // Charger tous les employés
      const data = await api.getEmployes('');
      const actifs = data.filter(e => e.status === 'actif');

      // Charger les bulletins existants (pour ne pas faire de doublons)
      const allPaies = [];
      for (const emp of data) {
        try {
          const full = await api.getEmploye(emp.id);
          (full.paies || []).forEach(p => allPaies.push({
            ...p,
            employe: { id: emp.id, nom: emp.nom, prenom: emp.prenom, poste: emp.poste, departement: emp.departement, email: emp.email, salaire_base: emp.salaire_base }
          }));
        } catch {}
      }
      setEmployes(data);
      setBulletinsExistants(allPaies);

      // Construire les lignes : 1 par salarié actif, données issues de la fiche
      // Si bulletin existe déjà → on l'utilise ; sinon → simulation depuis salaire de base
      const nouvelles = actifs.map(emp => {
        const bulletinExistant = allPaies.find(b => b.employe?.id === emp.id && b.mois === periode);
        const brut = bulletinExistant ? Number(bulletinExistant.salaire_brut) : Number(emp.salaire_base || 0);
        const retenues = bulletinExistant ? Number(bulletinExistant.retenues || 0) : Number((brut * 0.22).toFixed(2));
        const primes = bulletinExistant ? Number(bulletinExistant.primes || 0) : 0;
        const net = bulletinExistant
          ? Number(bulletinExistant.net_a_payer ?? (brut - retenues + primes))
          : Number((brut - retenues + primes).toFixed(2));
        const statut = bulletinExistant ? (bulletinExistant.status === 'valide' ? 'valide' : 'brouillon') : 'brouillon';
        return {
          employeId: emp.id,
          bulletinId: bulletinExistant?.id || null,
          nom: emp.nom,
          prenom: emp.prenom,
          poste: emp.poste,
          departement: emp.departement,
          email: emp.email,
          salaireBase: Number(emp.salaire_base || 0),
          periode: formatPeriode(periode),
          brut,
          retenues,
          primes,
          net,
          statut,
        };
      });

      setLignes(nouvelles);
      setGenere(true);
      showMsg(`✅ ${nouvelles.length} bulletin(s) généré(s) pour ${formatPeriode(periode)}`);
    } catch (e) {
      showMsg('Erreur génération : ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  // ============= Étape 3 : totaux (masse salariale) =============
  const totaux = useMemo(() => lignes.reduce((acc, l) => ({
    brut: acc.brut + l.brut,
    net: acc.net + l.net,
  }), { brut: 0, net: 0 }), [lignes]);

  function fmt(n) { return Number(n || 0).toFixed(2); }

  // ============= PDF individuel =============
  async function telechargerPdf(l) {
    const { default: jsPDF } = await import('jspdf');
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const [y, m] = periode.split('-');
    const nomMois = MOIS_LABELS[m] || m;

    doc.setFillColor(13, 148, 136);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(20); doc.setFont(undefined, 'bold');
    doc.text('BULLETIN DE PAIE', 14, 16);
    doc.setFontSize(11); doc.setFont(undefined, 'normal');
    doc.text(`${nomMois} ${y}`, 14, 24);
    doc.text(`Émis le ${new Date().toLocaleDateString('fr-FR')}`, pageW - 14, 24, { align: 'right' });

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(14); doc.setFont(undefined, 'bold');
    doc.text(`${l.prenom} ${l.nom}`, 14, 45);
    doc.setFontSize(10); doc.setFont(undefined, 'normal'); doc.setTextColor(71, 85, 105);
    doc.text(`Poste : ${l.poste || '—'}`, 14, 52);
    doc.text(`Département : ${l.departement || '—'}`, 14, 58);
    doc.text(`Email : ${l.email || '—'}`, 14, 64);

    let yp = 80;
    doc.setFillColor(241, 245, 249);
    doc.rect(14, yp, pageW - 28, 10, 'F');
    doc.setTextColor(71, 85, 105); doc.setFont(undefined, 'bold'); doc.setFontSize(10);
    doc.text('Désignation', 18, yp + 7);
    doc.text('Montant (€)', pageW - 18, yp + 7, { align: 'right' });
    yp += 12;

    doc.setFont(undefined, 'normal'); doc.setFontSize(11);
    [['Salaire Brut', fmt(l.brut), '#0f766e'],
     ['− Retenues salariales', '-' + fmt(l.retenues), '#dc2626'],
     ['+ Primes et indemnités', fmt(l.primes), '#16a34a']].forEach(([lbl, val, c]) => {
      doc.setTextColor(15, 23, 42); doc.text(lbl, 18, yp + 5);
      doc.setTextColor(c); doc.setFont(undefined, 'bold');
      doc.text(val, pageW - 18, yp + 5, { align: 'right' });
      doc.setFont(undefined, 'normal');
      doc.setDrawColor(226, 232, 240);
      doc.line(14, yp + 8, pageW - 14, yp + 8);
      yp += 9;
    });

    yp += 4;
    doc.setFillColor(240, 253, 244);
    doc.rect(14, yp, pageW - 28, 16, 'F');
    doc.setDrawColor(13, 148, 136); doc.setLineWidth(0.6);
    doc.rect(14, yp, pageW - 28, 16);
    doc.setFont(undefined, 'bold'); doc.setFontSize(14);
    doc.setTextColor(13, 148, 136);
    doc.text('NET À PAYER', 18, yp + 10);
    doc.text(fmt(l.net) + ' €', pageW - 18, yp + 10, { align: 'right' });

    doc.setTextColor(150, 150, 150);
    doc.setFontSize(8); doc.setFont(undefined, 'italic');
    doc.text('Document généré automatiquement par IntelSpark ERP-AH', pageW / 2, 285, { align: 'center' });

    doc.save(`Bulletin_${l.prenom}_${l.nom}_${periode}.pdf`);
    showMsg(`📄 PDF téléchargé pour ${l.prenom} ${l.nom}`);
  }

  // ============= Validation finale → compta =============
  async function validerEtComptabiliser() {
    if (lignes.length === 0) return showMsg('Aucun bulletin à valider', 'error');
    const ok = await systemConfirm(
      `Valider et comptabiliser les bulletins de ${formatPeriode(periode)} ?\n\n` +
      `Effectif : ${lignes.length} salarié(s)\n` +
      `Total Brut : ${fmt(totaux.brut)} €\n` +
      `Total Net : ${fmt(totaux.net)} €\n\n` +
      `Écritures envoyées dans le Journal Salaires.`
    );
    if (!ok) return;

    setLoading(true);
    try {
      // Pour chaque salarié sans bulletin en base, on crée la paie brouillon
      for (const l of lignes) {
        if (!l.bulletinId) {
          await api.addPaie(l.employeId, {
            mois: periode,
            salaire_brut: String(l.brut),
            retenues: String(l.retenues),
            primes: String(l.primes),
            net_a_payer: String(l.net),
          });
        }
      }
      // Écritures comptables en partie double
      const chargesPatronales = Number((totaux.brut * 0.22).toFixed(2));
      await api.createEcriture({
        type: 'depense', categorie: 'salaires', compte: '641',
        montant: Number((totaux.brut + chargesPatronales).toFixed(2)),
        description: `Salaires ${formatPeriode(periode)} — ${lignes.length} bulletin(s) (charges patronales 22% : ${fmt(chargesPatronales)} €)`,
        date_operation: new Date().toISOString().slice(0, 10),
      });
      await api.createEcriture({
        type: 'depense', categorie: 'salaires', compte: '645',
        montant: Number((totaux.brut * 0.22).toFixed(2)),
        description: `Cotisations salariales ${formatPeriode(periode)}`,
        date_operation: new Date().toISOString().slice(0, 10),
      });
      await api.createEcriture({
        type: 'depense', categorie: 'salaires', compte: '421',
        montant: Number(totaux.net.toFixed(2)),
        description: `Net à payer aux salariés — ${formatPeriode(periode)}`,
        date_operation: new Date().toISOString().slice(0, 10),
      });

      // Marquer toutes les lignes comme validées localement
      setLignes(prev => prev.map(l => ({ ...l, statut: 'valide' })));
      showMsg(`✅ Bulletins validés — écriture comptable envoyée dans le Journal Salaires (Brut ${fmt(totaux.brut)} €, Net ${fmt(totaux.net)} €)`);
    } catch (e) {
      showMsg('Erreur validation : ' + e.message, 'error');
    } finally {
      setLoading(false);
    }
  }

  async function supprimerLigne(ligne) {
    if (!(await systemConfirm(`Supprimer ${ligne.prenom} ${ligne.nom} de cette liste ?`))) return;
    setLignes(prev => prev.filter(item => !(item.employeId === ligne.employeId && item.periode === ligne.periode)));
    showMsg('Bulletin retiré de l’affichage');
  }

  return (
    <div style={{ padding: 24, maxWidth: 1300, margin: '0 auto' }}>
      {notify && <div style={{ position: 'fixed', top: 16, right: 16, background: notify.type === 'error' ? '#fef2f2' : '#f0fdf4', color: notify.type === 'error' ? '#dc2626' : '#16a34a', padding: '10px 18px', borderRadius: 8, fontSize: 13, fontWeight: 700, zIndex: 9999, border: `1px solid ${notify.type === 'error' ? '#fecaca' : '#bbf7d0'}`, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>{notify.msg}</div>}

      <div style={{ fontWeight: 900, fontSize: 22, color: '#0f172a', marginBottom: 4 }}>📄 {t('Bulletins de Paie')}</div>
      <div style={{ fontSize: 13, color: '#64748b', marginBottom: 20 }}>
        Génération automatique des bulletins de salaire depuis la fiche des employés actifs.
      </div>

      {/* ========== Sélecteur + bouton principal ========== */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ fontSize: 11, color: '#475569', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4 }}>Période</label>
          <select value={periode} onChange={e => { setPeriode(e.target.value); setGenere(false); }}
            style={{ padding: '9px 14px', border: '1px solid #cbd5e1', borderRadius: 7, fontSize: 14, background: '#fff', minWidth: 200, fontWeight: 600, color: '#0f172a' }}>
            {Array.from({ length: 24 }, (_, i) => {
              const d = new Date();
              d.setMonth(d.getMonth() - i);
              const v = d.toISOString().slice(0, 7);
              return <option key={v} value={v}>{formatPeriode(v)}</option>;
            })}
          </select>
        </div>
        <button onClick={genererBulletins} disabled={loading}
          style={{ background: loading ? '#94a3b8' : '#2563eb', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 24px', fontWeight: 800, cursor: loading ? 'wait' : 'pointer', fontSize: 14, marginTop: 18, boxShadow: '0 2px 6px rgba(37,99,235,0.3)' }}>
          {loading ? '⏳ Génération...' : '🔄 Générer les bulletins du mois'}
        </button>
        {genere && lignes.length > 0 && canEdit && (
          <button onClick={validerEtComptabiliser} disabled={loading}
            style={{ background: '#16a34a', color: '#fff', border: 'none', borderRadius: 8, padding: '11px 24px', fontWeight: 800, cursor: 'pointer', fontSize: 14, marginTop: 18, boxShadow: '0 2px 6px rgba(22,163,74,0.3)' }}>
            ✅ Valider et Comptabiliser
          </button>
        )}
      </div>

      {/* ========== Tableau de résultats ========== */}
      {genere && (
        <div style={{ border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#0f766e' }}>
                <th style={{ textAlign: 'left', padding: '12px 14px', color: '#fff', fontWeight: 700, fontSize: 12 }}>Salarié</th>
                <th style={{ textAlign: 'left', padding: '12px 14px', color: '#fff', fontWeight: 700, fontSize: 12 }}>Période</th>
                <th style={{ textAlign: 'right', padding: '12px 14px', color: '#fff', fontWeight: 700, fontSize: 12 }}>Salaire Brut</th>
                <th style={{ textAlign: 'right', padding: '12px 14px', color: '#fff', fontWeight: 700, fontSize: 12 }}>Net à payer</th>
                <th style={{ textAlign: 'center', padding: '12px 14px', color: '#fff', fontWeight: 700, fontSize: 12 }}>Document PDF</th>
                <th style={{ textAlign: 'center', padding: '12px 14px', color: '#fff', fontWeight: 700, fontSize: 12 }}>Statut</th>
                <th style={{ textAlign: 'center', padding: '12px 14px', color: '#fff', fontWeight: 700, fontSize: 12 }}>{canDelete ? 'Suppr.' : ''}</th>
              </tr>
            </thead>
            <tbody>
              {lignes.map((l, i) => (
                <tr key={l.employeId} style={{ background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                  <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontWeight: 700 }}>{l.prenom} {l.nom}</div>
                    <div style={{ fontSize: 11, color: '#64748b' }}>{l.poste || '—'}</div>
                  </td>
                  <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', fontFamily: 'monospace', fontSize: 12, color: '#475569' }}>{l.periode}</td>
                  <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 700 }}>{fmt(l.brut)} €</td>
                  <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', textAlign: 'right', fontWeight: 800, color: '#0f766e' }}>{fmt(l.net)} €</td>
                  <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                    <button onClick={() => telechargerPdf(l)}
                      style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 5, padding: '6px 12px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      📄 Télécharger le PDF
                    </button>
                  </td>
                  <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                    {l.statut === 'valide' ? (
                      <span style={{ background: '#dcfce7', color: '#15803d', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>✓ Validé</span>
                    ) : (
                      <span style={{ background: '#fef3c7', color: '#a16207', padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700 }}>⏳ Brouillon</span>
                    )}
                  </td>
                  <td style={{ padding: '12px 14px', borderBottom: '1px solid #f1f5f9', textAlign: 'center' }}>
                    {canDelete && <button type="button" className="admin-delete-action" onClick={() => supprimerLigne(l)} style={{ background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 5, padding: '6px 10px', fontSize: 11, fontWeight: 700, cursor: 'pointer' }}>
                      Supprimer
                    </button>}
                  </td>
                </tr>
              ))}
              {lignes.length === 0 && (
                <tr><td colSpan={7} style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
                  Aucun salarié actif trouvé. Ajoutez des employés dans "Dossiers Salariés".
                </td></tr>
              )}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f0fdf4', fontWeight: 900, borderTop: '3px solid #0f766e' }}>
                <td colSpan={2} style={{ padding: '14px', textAlign: 'right', color: '#0f766e', fontSize: 14 }}>
                  💰 Masse salariale totale du mois : {fmt(totaux.brut + totaux.net === 0 ? 0 : (totaux.brut + totaux.net) / 2)} €
                </td>
                <td style={{ padding: '14px', textAlign: 'right', color: '#0f766e', fontSize: 14 }}>Brut : {fmt(totaux.brut)} €</td>
                <td style={{ padding: '14px', textAlign: 'right', color: '#0f766e', fontSize: 16 }}>Net : {fmt(totaux.net)} €</td>
                <td colSpan={3} style={{ padding: '14px', textAlign: 'center', color: '#0f766e', fontSize: 11 }}>
                  {lignes.length} salarié(s)
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {!genere && (
        <div style={{ background: '#f8fafc', border: '2px dashed #cbd5e1', borderRadius: 12, padding: 50, textAlign: 'center', color: '#64748b' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>Aucun bulletin affiché</div>
          <div style={{ fontSize: 13 }}>
            Sélectionnez une période et cliquez sur <strong style={{ color: '#2563eb' }}>« Générer les bulletins du mois »</strong> pour importer automatiquement les salariés actifs et créer leurs bulletins.
          </div>
        </div>
      )}
    </div>
  );
}
