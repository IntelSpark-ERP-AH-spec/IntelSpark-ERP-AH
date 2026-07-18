import { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../api';
import { useAuth } from '../AuthContext';
import { useUserDoc } from '../useUserDoc';

const PERIODES = [
  { value: 'exercice', label: 'Exercice complet' },
  { value: 'semestre1', label: '1er Semestre (01/01 → 30/06)' },
  { value: 'semestre2', label: '2e Semestre (01/07 → 31/12)' },
  { value: 'trimestre1', label: '1er Trimestre (01/01 → 31/03)' },
  { value: 'trimestre2', label: '2e Trimestre (01/04 → 30/06)' },
  { value: 'trimestre3', label: '3e Trimestre (01/07 → 30/09)' },
  { value: 'trimestre4', label: '4e Trimestre (01/10 → 31/12)' },
];

function getPeriodRange(annee, periode) {
  if (periode === 'exercice') return { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
  const semestres = { semestre1: ['01-01', '06-30'], semestre2: ['07-01', '12-31'] };
  const trimestres = { trimestre1: ['01-01', '03-31'], trimestre2: ['04-01', '06-30'], trimestre3: ['07-01', '09-30'], trimestre4: ['10-01', '12-31'] };
  if (semestres[periode]) return { debut: `${annee}-${semestres[periode][0]}`, fin: `${annee}-${semestres[periode][1]}` };
  if (trimestres[periode]) return { debut: `${annee}-${trimestres[periode][0]}`, fin: `${annee}-${trimestres[periode][1]}` };
  return { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
}

const LIGNES_CPC = [
  { id: 'produits_exploitation', label: "I — Produits d'Exploitation", type: 'header' },
  { id: 'ca', label: 'Chiffre d\'affaires', prefix: ['711', '712', '713'], type: 'sum' },
  { id: 'produits_accessoires', label: 'Produits accessoires', prefix: ['714'], type: 'sum' },
  { id: 'reprises_exploitation', label: 'Reprises sur provisions', prefix: ['718'], type: 'sum' },
  { id: 'total_produits_exploitation', label: 'Total Produits d\'Exploitation (A)', type: 'total', refs: ['ca', 'produits_accessoires', 'reprises_exploitation'] },
  { id: 'spacer1', type: 'spacer' },
  { id: 'charges_exploitation', label: 'II — Charges d\'Exploitation', type: 'header' },
  { id: 'achats_revendus', label: 'Achats revendus', prefix: ['611', '612', '6131', '6136'], type: 'sum' },
  { id: 'impots_taxes', label: 'Impôts et taxes', prefix: ['614'], type: 'sum' },
  { id: 'charges_personnel', label: 'Charges de personnel', prefix: ['616'], type: 'sum' },
  { id: 'dotations', label: 'Dotations amortissements et provisions', prefix: ['618', '619'], type: 'sum' },
  { id: 'total_charges_exploitation', label: 'Total Charges d\'Exploitation (B)', type: 'total', refs: ['achats_revendus', 'impots_taxes', 'charges_personnel', 'dotations'] },
  { id: 'resultat_exploitation', label: 'RÉSULTAT D\'EXPLOITATION (A — B)', type: 'resultat', posRefs: ['total_produits_exploitation'], negRefs: ['total_charges_exploitation'] },
  { id: 'spacer2', type: 'spacer' },
  { id: 'produits_financiers', label: 'III — Produits Financiers', type: 'header' },
  { id: 'produits_financiers_sum', label: 'Produits financiers', prefix: ['716', '73'], type: 'sum' },
  { id: 'total_produits_financiers', label: 'Total Produits Financiers (C)', type: 'total', refs: ['produits_financiers_sum'] },
  { id: 'charges_financieres', label: 'IV — Charges Financières', type: 'header' },
  { id: 'charges_financieres_sum', label: 'Intérêts et charges financières', prefix: ['617', '63'], type: 'sum' },
  { id: 'total_charges_financieres', label: 'Total Charges Financières (D)', type: 'total', refs: ['charges_financieres_sum'] },
  { id: 'resultat_financier', label: 'RÉSULTAT FINANCIER (C — D)', type: 'resultat', posRefs: ['total_produits_financiers'], negRefs: ['total_charges_financieres'] },
  { id: 'resultat_courant', label: 'RÉSULTAT COURANT', type: 'resultat', posRefs: ['resultat_exploitation', 'resultat_financier'], negRefs: [] },
  { id: 'spacer3', type: 'spacer' },
  { id: 'produits_non_courants', label: 'V — Produits Non Courants', type: 'header' },
  { id: 'produits_non_courants_sum', label: 'Produits non courants', prefix: ['75'], type: 'sum' },
  { id: 'total_produits_non_courants', label: 'Total Produits Non Courants (E)', type: 'total', refs: ['produits_non_courants_sum'] },
  { id: 'charges_non_courantes', label: 'VI — Charges Non Courantes', type: 'header' },
  { id: 'charges_non_courantes_sum', label: 'Charges non courantes', prefix: ['65'], type: 'sum' },
  { id: 'total_charges_non_courantes', label: 'Total Charges Non Courantes (F)', type: 'total', refs: ['charges_non_courantes_sum'] },
  { id: 'resultat_non_courant', label: 'RÉSULTAT NON COURANT (E — F)', type: 'resultat', posRefs: ['total_produits_non_courants'], negRefs: ['total_charges_non_courantes'] },
  { id: 'spacer4', type: 'spacer' },
  { id: 'is_header', label: 'VII — Impôt sur les Sociétés', type: 'header' },
  { id: 'is_sum', label: 'Impôt sur les Sociétés (IS)', prefix: ['670'], type: 'sum' },
  { id: 'total_is', label: 'Total Impôt (G)', type: 'total', refs: ['is_sum'] },
  { id: 'resultat_net', label: 'RÉSULTAT NET', type: 'resultat', posRefs: ['resultat_courant', 'resultat_non_courant'], negRefs: ['total_is'] },
];

export default function CPCPage({ showMsg }) {
  const { hasRole } = useAuth();
  const canEdit = hasRole('admin', 'comptable');

  const now = new Date();
  const [annee, setAnnee] = useState(now.getFullYear());
  const [periode, setPeriode] = useState('exercice');

  const pcgeDoc = useUserDoc('pcge_comptes', []);
  const pcgeComptes = pcgeDoc.data || [];

  const [ecritures, setEcritures] = useState([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);

  const range = getPeriodRange(annee, periode);

  async function chargerEcritures() {
    setLoading(true);
    try {
      const data = await api.getCompta(`?exercice=${annee}`);
      setEcritures(Array.isArray(data) ? data : []);
    } catch (e) {
      setEcritures([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    chargerEcritures();
  }, [annee]); // eslint-disable-line

  const ecrituresFiltrees = useMemo(() => {
    return ecritures.filter(e => {
      const d = e.date_operation || '';
      return d >= range.debut && d <= range.fin;
    });
  }, [ecritures, range]);

  const soldes = useMemo(() => {
    const map = {};
    ecrituresFiltrees.forEach(e => {
      const compte = e.compte || '';
      if (!compte) return;
      const debit = Number(e.debit) || 0;
      const credit = Number(e.credit) || 0;
      if (!map[compte]) map[compte] = 0;
      map[compte] += credit - debit;
    });
    return map;
  }, [ecrituresFiltrees]);

  const totalParPrefixe = useCallback((prefixes) => {
    let total = 0;
    prefixes.forEach(p => {
      Object.entries(soldes).forEach(([compte, solde]) => {
        if (compte.startsWith(p)) total += solde;
      });
    });
    return total;
  }, [soldes]);

  const cpcValues = useMemo(() => {
    const vals = {};
    LIGNES_CPC.forEach(l => {
      if (l.type === 'sum') vals[l.id] = totalParPrefixe(l.prefix);
      if (l.type === 'total') vals[l.id] = l.refs.reduce((s, r) => s + (vals[r] || 0), 0);
      if (l.type === 'resultat') {
        const pos = l.posRefs.reduce((s, r) => s + (vals[r] || 0), 0);
        const neg = l.negRefs.reduce((s, r) => s + (vals[r] || 0), 0);
        vals[l.id] = pos - neg;
      }
    });
    vals['_total_produits'] = (vals['total_produits_exploitation'] || 0) + (vals['total_produits_financiers'] || 0) + (vals['total_produits_non_courants'] || 0);
    vals['_total_charges'] = (vals['total_charges_exploitation'] || 0) + (vals['total_charges_financieres'] || 0) + (vals['total_charges_non_courantes'] || 0) + (vals['total_is'] || 0);
    return vals;
  }, [totalParPrefixe]);

  function fmt(montant) {
    if (montant === undefined || montant === null) return '—';
    return montant.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' DH';
  }

  async function exportPDF() {
    setExporting(true);
    try {
      const { default: jsPDF } = await import('jspdf');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const W = pdf.internal.pageSize.getWidth();
      const H = pdf.internal.pageSize.getHeight();
      const M = 12;
      const usable = W - M * 2;
      let y = M;

      function header() {
        pdf.setFillColor(0, 90, 80);
        pdf.rect(0, 0, W, 26, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(16);
        pdf.text('COMPTE DE PRODUITS ET CHARGES (CPC)', W / 2, 10, { align: 'center' });
        pdf.setFontSize(9);
        pdf.setFont('helvetica', 'normal');
        pdf.text(`Exercice ${annee}  |  ${PERIODES.find(p => p.value === periode)?.label || periode}  |  Généré le ${now.toLocaleDateString('fr-FR')}`, W / 2, 19, { align: 'center' });
        y = 32;
      }

      function drawRow(label, value, type) {
        const rh = type === 'header' ? 6 : type === 'resultat' ? 6.5 : 5.5;
        const indent = type === 'spacer' ? 0 : 6;
        if (y + rh > H - M) {
          pdf.addPage();
          header();
        }
        if (type === 'spacer') { y += 3; return; }
        if (type === 'resultat') {
          pdf.setFillColor(240, 245, 245);
          pdf.rect(M, y, usable, rh, 'F');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(9);
          pdf.setTextColor(0, 90, 80);
        } else if (type === 'header') {
          pdf.setFillColor(241, 245, 249);
          pdf.rect(M, y, usable, rh, 'F');
          pdf.setFont('helvetica', 'bold');
          pdf.setFontSize(8);
          pdf.setTextColor(50);
        } else {
          pdf.setFont('helvetica', 'normal');
          pdf.setFontSize(8);
          pdf.setTextColor(60);
        }
        pdf.text(label, M + indent, y + rh - 1.8);
        if (value !== undefined && value !== null) {
          pdf.setFont('helvetica', type === 'resultat' ? 'bold' : 'normal');
          const txt = (type === 'resultat' ? '' : '') + fmt(value);
          pdf.text(txt, W - M - 2, y + rh - 1.8, { align: 'right' });
        }
        y += rh;
      }

      header();
      LIGNES_CPC.forEach(l => {
        drawRow(l.label, l.type !== 'header' ? cpcValues[l.id] : undefined, l.type);
      });

      // Footer cartes
      if (y + 20 > H - M) pdf.addPage();
      y = Math.max(y, H - 45);
      const rectW = (usable - 12) / 3;
      const vals = [
        { label: 'Total Produits', value: cpcValues['_total_produits'], color: [0, 90, 80] },
        { label: 'Total Charges', value: cpcValues['_total_charges'], color: [180, 60, 60] },
        { label: 'Résultat Net', value: cpcValues['resultat_net'], color: (cpcValues['resultat_net'] || 0) >= 0 ? [0, 130, 80] : [200, 50, 50] },
      ];
      vals.forEach((v, i) => {
        const x = M + i * (rectW + 6);
        pdf.setFillColor(v.color[0], v.color[1], v.color[2]);
        pdf.roundedRect(x, y, rectW, 14, 2, 2, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFont('helvetica', 'bold');
        pdf.setFontSize(8);
        pdf.text(v.label, x + rectW / 2, y + 4, { align: 'center' });
        pdf.setFontSize(10);
        const signe = v.value < 0 ? '- ' : '';
        pdf.text(signe + fmt(Math.abs(v.value || 0)), x + rectW / 2, y + 11, { align: 'center' });
      });

      pdf.save(`CPC_${annee}_${now.toISOString().slice(0, 10)}.pdf`);
      showMsg('✅ CPC exporté en PDF');
    } catch (e) {
      showMsg('Erreur export PDF : ' + e.message, 'error');
    } finally {
      setExporting(false);
    }
  }

  const resultatNet = cpcValues['resultat_net'] || 0;

  return (
    <div>
      {/* Bandeau de filtrage */}
      <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <select value={annee} onChange={e => setAnnee(Number(e.target.value))}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#fff', outline: 'none', width: 90 }}>
            {[2024, 2025, 2026, 2027].map(a => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={periode} onChange={e => setPeriode(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, background: '#fff', outline: 'none', flex: 1, maxWidth: 300 }}>
            {PERIODES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
          <span style={{ fontSize: 12, color: '#64748b' }}>
            {loading ? '⏳...' : `${ecrituresFiltrees.length} écritures`}
          </span>
          <div style={{ flex: 1 }} />
          <button onClick={exportPDF} disabled={exporting}
            style={{ background: '#2563eb', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 14px', fontWeight: 700, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
            📄 PDF
          </button>
        </div>
      </div>

      {/* Cartes indicateurs */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 14 }}>
        {[
          { label: 'Total Produits', value: cpcValues['_total_produits'], bg: '#ecfdf5', color: '#065f46', icon: '📈' },
          { label: 'Total Charges', value: cpcValues['_total_charges'], bg: '#fef2f2', color: '#991b1b', icon: '📉' },
          { label: 'Résultat Net', value: resultatNet, bg: resultatNet >= 0 ? '#ecfdf5' : '#fef2f2', color: resultatNet >= 0 ? '#065f46' : '#991b1b', icon: resultatNet >= 0 ? '✅' : '❌' },
        ].map((c, i) => (
          <div key={i} style={{ flex: 1, background: c.bg, border: `1px solid ${c.color}20`, borderRadius: 10, padding: '14px 18px' }}>
            <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, marginBottom: 4 }}>{c.icon} {c.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color: c.color }}>
              {c.value !== undefined && c.value !== null ? (
                <>
                  {c.value < 0 ? '- ' : ''}
                  {Math.abs(c.value).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span style={{ fontSize: 12 }}>DH</span>
                </>
              ) : '—'}
            </div>
          </div>
        ))}
      </div>

      {/* Tableau CPC */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#0f766e' }}>
              <th style={{ textAlign: 'left', padding: '10px 16px', color: '#fff', fontWeight: 800, fontSize: 12 }}>
                Compte de Produits et des Charges — Exercice {annee}
              </th>
              <th style={{ textAlign: 'right', padding: '10px 16px', color: '#fff', fontWeight: 800, fontSize: 12, width: 140 }}>
                Montant (DH)
              </th>
            </tr>
          </thead>
          <tbody>
            {LIGNES_CPC.map((l, i) => {
              if (l.type === 'spacer') return <tr key={i}><td colSpan={2} style={{ height: 6 }} /></tr>;
              const val = l.type !== 'header' ? cpcValues[l.id] : undefined;
              const isResultat = l.type === 'resultat';
              return (
                <tr key={i} style={{
                  background: isResultat ? '#f0f5f5' : l.type === 'header' ? '#f8fafc' : '#fff',
                  borderBottom: '1px solid #e2e8f0',
                }}>
                  <td style={{
                    padding: '7px 16px',
                    fontWeight: isResultat ? 800 : l.type === 'header' ? 700 : 400,
                    color: isResultat ? '#0f766e' : '#1e293b',
                    fontSize: isResultat ? 13 : 12,
                    fontStyle: l.type === 'sum' ? 'italic' : 'normal',
                  }}>
                    {l.label}
                  </td>
                  <td style={{
                    textAlign: 'right', padding: '7px 16px',
                    fontWeight: isResultat ? 800 : l.type === 'total' ? 700 : 400,
                    color: isResultat ? '#0f766e' : '#334155',
                    fontSize: isResultat ? 13 : 12,
                    fontFamily: 'monospace',
                  }}>
                    {val !== undefined ? (
                      <span style={{ color: isResultat && val < 0 ? '#dc2626' : 'inherit' }}>
                        {val < 0 ? '(' : ''}{Math.abs(val).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{val < 0 ? ')' : ''}
                      </span>
                    ) : '—'}
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
