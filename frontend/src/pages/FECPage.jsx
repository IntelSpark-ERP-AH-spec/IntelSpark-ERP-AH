import { useState, useEffect } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';
import { useAuth } from '../AuthContext';
import { useUserDoc } from '../useUserDoc';

const ANOMALIE_TYPES = {
  equilibre: { label: 'Déséquilibre Débit/Crédit', bloque: true },
  chronologie: { label: 'Rupture de chronologie', bloque: true },
  sequence: { label: 'Rupture de séquence', bloque: false },
};

export default function FECPage({ showMsg }) {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'comptable');

  const now = new Date();
  const [exercice, setExercice] = useState(now.getFullYear());
  const doc = useUserDoc('fec_fermetures', {});
  const fermetures = (doc && doc.data) || {};
  const setFermetures = doc.setData;

  const [ecritures, setEcritures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [anomalies, setAnomalies] = useState([]);
  const [fecGenere, setFecGenere] = useState(false);

  const estVerrouille = fermetures[String(exercice)] === true;

  async function chargerEcritures() {
    setLoading(true);
    try {
      const data = await api.getCompta(`?exercice=${exercice}`);
      setEcritures(Array.isArray(data) ? data : []);
    } catch (e) {
      setEcritures([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    chargerEcritures();
  }, [exercice]); // eslint-disable-line

  function verifierConformite() {
    const errs = [];
    const triees = [...ecritures].sort((a, b) => new Date(a.date_operation) - new Date(b.date_operation));

    // 1. Équilibre : débit = crédit pour chaque écriture
    const grouped = {};
    triees.forEach(e => {
      const key = e.piece || e.id;
      if (!grouped[key]) grouped[key] = { ecritures: [], totalDebit: 0, totalCredit: 0 };
      grouped[key].ecritures.push(e);
      grouped[key].totalDebit += Number(e.debit || 0);
      grouped[key].totalCredit += Number(e.credit || 0);
    });
    for (const [piece, g] of Object.entries(grouped)) {
      if (Math.abs(g.totalDebit - g.totalCredit) > 0.01) {
        errs.push({
          journal: g.ecritures[0]?.categorie || '—',
          type: 'equilibre',
          ecriture: piece,
          statut: 'bloquant',
        });
      }
    }

    // 2. Chronologie : dates doivent être croissantes
    for (let i = 1; i < triees.length; i++) {
      if (new Date(triees[i].date_operation) < new Date(triees[i - 1].date_operation)) {
        errs.push({
          journal: triees[i]?.categorie || '—',
          type: 'chronologie',
          ecriture: triees[i]?.piece || triees[i]?.id || '—',
          statut: 'bloquant',
        });
        break;
      }
    }

    // 3. Rupture de séquence (vérifie les numéros de pièce)
    const pieces = [...new Set(triees.map(e => e.piece || ''))].filter(Boolean).sort();
    for (let i = 1; i < pieces.length; i++) {
      const prev = parseInt(pieces[i - 1].replace(/\D/g, ''), 10);
      const curr = parseInt(pieces[i].replace(/\D/g, ''), 10);
      if (!isNaN(prev) && !isNaN(curr) && curr > prev + 1) {
        errs.push({
          journal: '—',
          type: 'sequence',
          ecriture: `${pieces[i - 1]} → ${pieces[i]}`,
          statut: 'avertissement',
        });
      }
    }

    setAnomalies(errs);
    return errs.filter(e => e.statut === 'bloquant').length === 0;
  }

  async function genererFEC() {
    const ok = verifierConformite();
    if (!ok) {
      showMsg('❌ Des anomalies bloquantes empêchent la génération du FEC', 'error');
      return;
    }
    if (estVerrouille) {
      showMsg('🔒 Cet exercice est déjà verrouillé. Aucune modification possible.', 'error');
      return;
    }

    const rows = ecritures.map((e, idx) => [
      e.categorie === 'ventes' ? 'VT' : e.categorie === 'achats' ? 'AC' : e.categorie === 'banque' ? 'BQ' : 'OD',
      e.categorie ? `Journal des ${e.categorie}` : 'Journal OD',
      String(idx + 1).padStart(6, '0'),
      (e.date_operation || '').replace(/-/g, ''),
      e.compte || '',
      e.compte_nom || e.description || '',
      e.piece || '',
      e.description || '',
      (Number(e.debit) || 0).toFixed(2),
      (Number(e.credit) || 0).toFixed(2),
    ]);

    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF('l', 'mm', 'a4');
    const W = pdf.internal.pageSize.getWidth();
    const H = pdf.internal.pageSize.getHeight();
    const M = 8;
    const usable = W - M * 2;

    const cols = ['JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate', 'CompteNum', 'CompteLib', 'PieceRef', 'EcritureLib', 'Debit', 'Credit'];
    const colW = [16, 26, 18, 16, 18, 24, 18, 26, 14, 14];
    const rowH = 5.5;
    let y = M;

    function entetePDF() {
      pdf.setFillColor(0, 90, 80);
      pdf.rect(0, 0, W, 22, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.text('FICHIER DES ÉCRITURES COMPTABLES (FEC)', W / 2, 8, { align: 'center' });
      pdf.setFontSize(9);
      pdf.setFont('helvetica', 'normal');
      pdf.text(`Exercice : ${exercice}  |  Généré le ${now.toLocaleDateString('fr-FR')}`, W / 2, 15, { align: 'center' });
      pdf.setTextColor(40);
      y = 26;
    }

    function enteteTableau() {
      pdf.setFillColor(241, 245, 249);
      pdf.rect(M, y, usable, rowH, 'F');
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(6.5);
      pdf.setTextColor(30);
      let x = M;
      cols.forEach((c, i) => {
        pdf.text(c, x + colW[i] / 2, y + 4, { align: 'center' });
        x += colW[i];
      });
      y += rowH;
    }

    function drawRow(row) {
      if (y + rowH > H - M) {
        pdf.setFontSize(6);
        pdf.setTextColor(150);
        pdf.text(`Page ${pdf.internal.getCurrentPageInfo().pageNumber}`, W / 2, H - 4, { align: 'center' });
        pdf.addPage();
        entetePDF();
        enteteTableau();
      }
      let x = M;
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(6);
      pdf.setTextColor(50);
      row.forEach((val, i) => {
        pdf.text(String(val), x + (i >= 8 ? colW[i] - 1 : colW[i] / 2), y + 4, { align: i >= 8 ? 'right' : 'center' });
        x += colW[i];
      });
      pdf.setDrawColor(220);
      pdf.line(M, y + rowH - 0.5, W - M, y + rowH - 0.5);
      y += rowH;
    }

    entetePDF();
    enteteTableau();
    rows.forEach(drawRow);

    pdf.setFontSize(6);
    pdf.setTextColor(150);
    pdf.text(`Page ${pdf.internal.getCurrentPageInfo().pageNumber}`, W / 2, H - 4, { align: 'center' });

    pdf.save(`FEC_${exercice}_${now.toISOString().slice(0, 10)}.pdf`);
    setFecGenere(true);
    showMsg(`✅ FEC ${exercice} généré en PDF (${rows.length} lignes)`);
  }

  async function verrouiller() {
    if (!(await systemConfirm(`Verrouiller définitivement l'exercice ${exercice} ?\n\nPlus aucune modification ne sera possible sur les écritures de cette année.`, { confirmLabel: 'Verrouiller' }))) return;
    const next = { ...fermetures, [String(exercice)]: true };
    setFermetures(next);
    showMsg(`🔒 Exercice ${exercice} verrouillé définitivement`);
  }

  const anomaliesBloquantes = anomalies.filter(a => a.statut === 'bloquant').length;

  return (
    <div>
      {/* Panneau de contrôle de l'Exercice */}
      <div className="no-print" style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 14, color: '#0f766e', marginBottom: 8 }}>📅 Exercice comptable</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={exercice} onChange={e => setExercice(Number(e.target.value))}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#fff', outline: 'none', width: 120 }}>
            {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {loading ? '⏳ Chargement...' : `${ecritures.length} écriture(s) trouvée(s)`}
          </span>
          <div style={{ flex: 1 }} />
          {estVerrouille ? (
            <span style={{ background: '#fef2f2', color: '#dc2626', padding: '6px 12px', borderRadius: 6, fontWeight: 800, fontSize: 12, border: '1px solid #fecaca' }}>
              🔒 Verrouillé
            </span>
          ) : canEdit && (
            <button onClick={verrouiller}
              style={{ background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
              🔒 Verrouillage définitif
            </button>
          )}
        </div>
      </div>

      {/* Génération manuelle */}
      {!estVerrouille && (
        <div style={{ marginBottom: 14, display: 'flex', gap: 6 }}>
          <button onClick={genererFEC}
            style={{ background: '#0f766e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 16px', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}>
            📥 Télécharger le FEC {exercice}
          </button>
        </div>
      )}

      {/* Tableau des Anomalies */}
      <div style={{ fontWeight: 800, fontSize: 15, color: '#0f766e', marginBottom: 8 }}>
        📋 Anomalies de Conformité
        {anomalies.length > 0 && (
          <span style={{ marginLeft: 8, fontSize: 12, color: anomaliesBloquantes > 0 ? '#dc2626' : '#f59e0b' }}>
            ({anomaliesBloquantes > 0 ? `${anomaliesBloquantes} bloquante(s)` : `${anomalies.length} avertissement(s)`})
          </span>
        )}
      </div>
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {['Journal', "Type d'anomalie", 'Écriture concernée', 'Statut'].map((h, i) => (
                <th key={i} style={{ textAlign: 'left', padding: '9px 14px', borderBottom: '2px solid #e2e8f0', color: '#475569', fontWeight: 800, fontSize: 11 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {anomalies.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>
                {ecritures.length === 0 ? 'Aucune écriture pour cet exercice' : '✅ Aucune anomalie détectée'}
              </td></tr>
            )}
            {anomalies.map((a, i) => {
              const info = ANOMALIE_TYPES[a.type] || { label: a.type, bloque: false };
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: a.statut === 'bloquant' ? '#fef2f2' : '#fffbeb' }}>
                  <td style={{ padding: '9px 14px', fontWeight: 600 }}>{a.journal}</td>
                  <td style={{ padding: '9px 14px' }}>{info.label}</td>
                  <td style={{ padding: '9px 14px', fontFamily: 'monospace', fontSize: 11 }}>{a.ecriture}</td>
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{
                      background: a.statut === 'bloquant' ? '#fef2f2' : '#fffbeb',
                      color: a.statut === 'bloquant' ? '#dc2626' : '#d97706',
                      padding: '3px 10px', borderRadius: 999, fontSize: 11, fontWeight: 800,
                    }}>
                      {a.statut === 'bloquant' ? '🔴 Bloque l\'export' : '🟠 Avertissement'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
