import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';
import { systemConfirm } from './SystemConfirm';
import { useAuth } from './AuthContext';
import { useWS } from './WebSocketContext';
import { useUserDoc } from './useUserDoc';
import { useAudit } from './AuditContext';
import { useCurrency } from './CurrencyContext';
import { useLanguage } from './LanguageContext';
import { useAppI18n } from './appI18n';

import LoginPage from './LoginPage';
import StockPage from './pages/Stock';
import RHPage from './pages/RH';
import ComptaPage from './pages/Compta';
import AdminUsersPage from './pages/AdminUsers';
import MagasinOperations, { ReceptionTab, StockageTab, PreparationTab, ExpeditionTab, GestionStockTab } from './pages/MagasinOperations';
import { PreparationLocale, PreparationImportation } from './pages/PreparationAchats';
import ExpeditionManuelle from './pages/ExpeditionManuelle';
import ComptaJournaux from './pages/ComptaJournaux';
import RHSections from './pages/RHSections';
import TempsAbsences from './pages/TempsAbsences';
import NotesFrais from './pages/NotesFrais';
import PCGE from './pages/PCGE';
import TVAPage from './pages/TVAPage';
import FECPage from './pages/FECPage';
import CPCPage from './pages/CPCPage';
import GrandLivrePage from './pages/GrandLivrePage';
import SuiviTemps from './pages/SuiviTemps';
import DocumentsSauvegardes from './pages/DocumentsSauvegardes';
import VehiculesPage from './pages/Vehicules';
import MaintenancePage from './pages/Maintenance';
import AtelierPage from './pages/Atelier';
import PneusPage from './pages/Pneus';
import ReportingPage from './pages/Reporting';
import SettingsPage from './pages/Settings';
import EcheancierPage from './pages/Echeancier';
import RoleHome from './components/RoleHome';
import CommunicationDrawer from './components/CommunicationDrawer';
import ReceivedDocuments from './pages/ReceivedDocuments';
import './white-theme.css';
import './login-restore.css';
import './communication-apps.css';
import './stitch-enterprise.css';
import './typography-lock.css';

// ============================================================
// LOGO
// ============================================================
const IntelSheetsLogo = ({ size = 50 }) => (
  <img src="/site-logo-transparent.png" alt="Logo INTELSPARK" style={{ width: size, height: size, objectFit: 'contain' }} />
);

// ============================================================
// CONSTANTS
// ============================================================
const TVA_RATES = [20, 14, 10, 7, 0];

const INITIAL_CATALOG = [
  { ref: 'PC-020-A-19', name: 'POMPE COUDEE FONTE MDS 080', priceHT: 4960, stockPhysique: 5, stockReserve: 0, minStock: 2, emplacement: 'A1-E3', oem: 'MDS-080-PC', compatible: 'Remorque MDS / Camion Renault T', entryDate: '15/05/2026', supplier: 'CPR Maroc', category: 'Pompes' },
  { ref: 'P-101', name: 'Moteur Électrique X1', priceHT: 450, stockPhysique: 12, stockReserve: 0, minStock: 3, emplacement: 'B2-E1', oem: 'X1-MOT', compatible: 'Universal', entryDate: '10/04/2026', supplier: 'Electro Parts', category: 'Moteurs' },
  { ref: 'P-102', name: 'Batterie Lithium 12V', priceHT: 120, stockPhysique: 24, stockReserve: 0, minStock: 5, emplacement: 'C1-E2', oem: 'LI12V-STD', compatible: 'Voiture / Camion', entryDate: '20/04/2026', supplier: 'Lithium Corp', category: 'Électricité' },
  { ref: 'P-103', name: 'Câblage Renforcé 5m', priceHT: 35, stockPhysique: 150, stockReserve: 0, minStock: 20, emplacement: 'D3-E1', oem: 'CAB-5M-R', compatible: 'Universal', entryDate: '01/03/2026', supplier: "Câbles de l'Atlas", category: 'Électricité' },
  { ref: 'P-104', name: "Fusible d'origine 15A", priceHT: 5, stockPhysique: 800, stockReserve: 0, minStock: 100, emplacement: 'D1-E4', oem: 'FUS-15A', compatible: 'Universal', entryDate: '02/02/2026', supplier: 'Melt Co', category: 'Électricité' },
];

function sharedProductToCatalog(product) {
  const salePrice = Number(product.prix_vente || 0);
  return {
    id: product.id,
    ref: product.reference || '',
    name: product.designation || '',
    priceHT: salePrice > 0 ? salePrice : Number(product.prix_ht || 0),
    stockPhysique: Number(product.stock_actuel || 0),
    stockReserve: 0,
    minStock: Number(product.stock_min || 0),
    emplacement: product.emplacement || '-',
    oem: product.code_barre || '-',
    compatible: '-',
    entryDate: product.created_at || '',
    supplier: product.fournisseur || '-',
    category: product.categorie || '-',
  };
}

const INITIAL_CLIENTS = [
  { id: 1, ice: '002456789000045', name: 'CARRIERE MENARA', address: '12 Route de Ourika, Marrakech', phone: '0524123456', email: 'contact@menara-carriere.ma', encours: 0, limiteCredit: 50000 },
  { id: 2, ice: '001234567000012', name: 'Marjane Holding', address: 'Twin Center, Casablanca', phone: '0522456789', email: 'achats@marjane.ma', encours: 0, limiteCredit: 200000 },
];

const COUNTRIES = { Morocco: 'Maroc', France: 'France', USA: 'États-Unis', UK: 'Royaume-Uni', Spain: 'Espagne', Germany: 'Allemagne' };
const CURRENCIES = { MAD: 'MAD', EUR: '€', USD: '$', CHF: 'CHF', GBP: '£' };
const EXCHANGE_RATES = { MAD: 1, EUR: 10.85, USD: 10.15, CHF: 11.50, GBP: 12.80 };

const DOC_STATUSES = {
  draft:     { labelKey: 'statusDraft',     color: '#94a3b8', bg: '#f1f5f9' },
  validated: { labelKey: 'statusValidated', color: '#f59e0b', bg: '#fffbeb' },
  sent:      { labelKey: 'statusSent',      color: '#3b82f6', bg: '#eff6ff' },
  delivered: { labelKey: 'statusDelivered', color: '#8b5cf6', bg: '#f5f3ff' },
  paid:      { labelKey: 'statusPaid',      color: '#10b981', bg: '#ecfdf5' },
  returned:  { labelKey: 'statusReturned',  color: '#dc2626', bg: '#fef2f2' },
  cancelled: { labelKey: 'statusCancelled', color: '#dc2626', bg: '#fce4e4' },
};

const THEMES = {
  light:    { bg: '#f7f9fc', btn: '#2563eb', light: '#eff6ff', surface: '#ffffff', text: '#172033' },
  dark:     { bg: '#ffffff', btn: '#111827', light: '#f8fafc', surface: '#ffffff', text: '#111827', muted: '#64748b', border: '#d9dde3' },
  graphite: { bg: '#e7e9ed', btn: '#334155', light: '#f1f5f9', surface: '#ffffff', text: '#202938' },
  sand:     { bg: '#f3eee5', btn: '#9a5b35', light: '#fbf7f0', surface: '#fffdf9', text: '#312b27' },
  teal:     { bg: 'linear-gradient(135deg, #e2f1f1 0%, #ccfbf1 100%)', btn: '#0d9488', light: '#f0fdf9', surface: '#f8fffd', text: '#153b38' },
  noir:     { bg: '#ffffff', btn: '#334155', light: '#f8fafc', surface: '#ffffff', text: '#111827', muted: '#64748b', border: '#d9dde3' },
  cobalt:   { bg: 'linear-gradient(135deg, #e0e7ff 0%, #c7d2fe 100%)', btn: '#4f46e5', light: '#eef2ff', surface: '#f8f9ff', text: '#202759' },
  rose:     { bg: 'linear-gradient(135deg, #fce7f3 0%, #fbcfe8 100%)', btn: '#db2777', light: '#fdf2f8', surface: '#fff8fc', text: '#5c2144' },
  emerald:  { bg: 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)', btn: '#059669', light: '#ecfdf5', surface: '#f7fffb', text: '#164536' },
  violet:   { bg: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)', btn: '#7c3aed', light: '#f5f3ff', surface: '#fbf9ff', text: '#3d2861' },
  sky:      { bg: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)', btn: '#0284c7', light: '#f0f9ff', surface: '#f7fcff', text: '#17445d' },
};
const STATUS_DOCUMENT_TYPES = new Set(['DEV', 'BL', 'BC', 'FACT', 'AVOIR']);

function documentAmount(document, kind) {
  const legacyKey = kind === 'ht' ? 'totalHT' : kind === 'tva' ? 'totalTVA' : 'totalTTC';
  return Number(document?.totals?.[kind] ?? document?.[legacyKey] ?? 0) || 0;
}

function normalizeScheduleDate(value) {
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const match = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!match) return '';
  return `${match[3]}-${match[2].padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

function localTodayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatScheduleDate(value) {
  if (!value) return 'À renseigner';
  const [year, month, day] = String(value).split('-');
  return year && month && day ? `${day}/${month}/${year}` : String(value);
}

function scheduleNotificationMessage(row, dueNow = false) {
  const amount = Number(row?.amount || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const overdue = row?.status !== 'paid' && row?.due_date && row.due_date <= localTodayISO();
  const status = row?.status === 'paid' ? 'Payé' : overdue ? 'En retard' : 'À payer';
  return [
    `Client / Fournisseur : ${row?.party_name || 'À renseigner'}`,
    `Facture : ${row?.document_number || 'À renseigner'}`,
    `Échéance : ${formatScheduleDate(row?.due_date)}`,
    `Montant : ${amount} ${row?.currency || 'MAD'}`,
    `Statut : ${status}`,
    dueNow ? 'Échéance sauvegardée. Paiement attendu.' : 'Échéance sauvegardée automatiquement.',
  ].join('\n');
}

const TRANSLATIONS = {
  FR: {
    docTab: "Devis", BLTab: "Bon de Livraison", BCTab: "Bon de Commande", avoirTab: "Avoir",
    factTab: "Facture", refTab: "Catalogue", stockTab: "Stock", pipelineTab: "CRM",
    statsTab: "Reporting", iaTab: "IA", histTab: "Historique", clientsTab: "Clients", statusTab: "Statut",
    activeDoc: "Document :", exportBtn: "Exporter", saveBtn: "Enregistrer",
    refLabel: "Référence", descLabel: "Désignation", priceLabel: "Prix unitaire", qtyLabel: "Qte", addBtn: "Ajouter", itemFieldsRequired: "Remplissez référence, désignation, quantité et prix avant ajout.",
    fournisseur: "Fournisseur", dateEntree: "Entrée",
    currencyLabel: "Devise", regionLabel: "Région", translationLabel: "Langue",
    destinatary: "COORDONNÉES DU CLIENT", representative: "Représentant", vRef: "V/Référence", dateDoc: "Date",
    totalTva: "TVA 20% :", netToPay: "NET À PAYER :",
    catalogTitle: "Catalogue", stockTitle: "Stock", crmTitle: "Pipeline CRM",
    addProspect: "+ Prospect", clientAccount: "Client", valEst: "Valeur", stage: "Étape", prob: "Prob.",
    historyTitle: "Historique", clearLog: "Vider", colTime: "Heure", colRef: "Élément concerné", colDesc: "Contexte", colAction: "Action effectuée",
    submit: "Analyser",
    kpiCa: "CA Réalisé", kpiGoal: "Objectif", kpiSig: "Conversion", kpiVol: "Volume",
    crmForecast: "Prévision",
    iaTitle: "Intelligence IA", emailTitle: "Email IA", emailBtn: "Rédiger",
    exportPDF: "PDF", exportWord: "Word", print: "Imprimer",
    deleteLogo: "Supprimer logo", fontSettings: "Affichage",
    fontSizeLabel: "Taille", fontFamilyLabel: "Police", fontColorLabel: "Couleur texte",
    stockPrice: "Prix HT", stockValue: "Valeur stock", addCatalogBtn: "Ajouter au catalogue",
    paymentMethod: "Mode de paiement", dueDate: "Échéance", tvaLabel: "TVA 20%",
    totalBrut: "Total HT :", baseHt: "Base HT", footerLabel: "Mentions Légales",
    aiWelcome: "En attente de commandes...", aiPlaceholder: "Posez votre question...",
    aiStock: "Analyse du Stock", aiCA: "Chiffre d'Affaires", aiPipeline: "Pipeline CRM",
    stockError: "Stock insuffisant ! Disponible : ",
    stockSuccess: "Article ajouté",
    stockWarning: "Stock faible après ajout",
    ttcLabel: "Total TTC :",
    statusLabel: "Statut",
    docNum: "N° document",
    docType: "Type",
    docDate: "Date",
    validateDoc: "Valider",
    lockMsg: "Document verrouillé — non modifiable après validation",
    newDoc: "Nouveau",
    convertToBL: "→ BL",
    convertToFact: "→ Facture",
    convertToAvoir: "→ Avoir",
    oemLabel: "Réf. OEM",
    compatLabel: "Compatible",
    emplacLabel: "Emplacement",
    minStockLabel: "Stock min.",
    categoryLabel: "Catégorie",
    availableStock: "Dispo",
    reservedStock: "Réservé",
    clientsTitle: "Clients",
    addClient: "+ Client",
    iceLabel: "ICE",
    limiteLabel: "Limite crédit",
    encoursLabel: "En-cours",
    encaissLabel: "Encaissements",
    paymentStatus: "Paiement",
    totalHT: "Total HT", discountLabel: "Remise",
    tvaAmt: "TVA (20%)",
    totalTTC: "Total TTC",
    docHistory: "Documents",
    alertRestock: "Alertes réapprovisionnement",
    exportPDFBtn: "Télécharger PDF",
    savedDocs: "Documents sauvegardés",
    validityLabel: "Date validité",
    montantHT: "Montant HT",
    loadBtn: "Charger",
    devInfo: "📄 Devis — stock non déduit",
    blInfo: "🚚 BL envoyé au magasinier - stock mis à jour à l’expédition",
    bcInfo: "📋 Bon de commande",
    factInfo: "💳 Facture — stock déduit à validation",
    chooseClient: "👤 Choisir client",
    chooseSupplier: "👤 Choisir fournisseur",
    selectClient: "👤 Sélectionner un client",
    factOrig: "Facture orig.",
    paymentCheque: "Chèque",
    paymentCash: "Espèces",
    paymentTransfer: "Virement",
    paymentEffet: "Effet",
    timbreFiscal: "Timbre fiscal",
    acompte: "Acompte",
    acompteVerse: "Acompte versé",
    restantDu: "Restant dû",
    paid: "PAYÉ",
    importCSV: "📥 Import CSV",
    stockArticles: "📦 Articles",
    stockEnStock: "✅ En stock",
    stockCritiques: "⚠️ Critiques",
    stockValeur: "💰 Valeur stock",
    valeurLabel: "Valeur",
    clientNameLabel: "Nom *",
    clientAddressLabel: "Adresse",
    clientPhoneLabel: "Téléphone",
    clientEmailLabel: "Email",
    clientDeleted: "Client supprimé",
    stageNew: "Nouveau",
    stageQualified: "Qualifié",
    stageSent: "Devis Envoyé",
    stageNegotiation: "Négociation",
    stageWon: "Gagné",
    stageLost: "Perdu",
    analyseFinanciere: "📊 Analyse Financière Catalogue",
    valeurStock: "Valeur Stock",
    totalValeurStock: "TOTAL VALEUR STOCK DISPONIBLE",
    derniersDocuments: "💳 Derniers Documents",
    noDocRecorded: "Aucun document enregistré",
    aiQuickAnalyse: "analyse stock",
    aiQuickRestock: "alertes réapprovisionnement",
    aiQuickCA: "chiffre d'affaires",
    aiQuickPipeline: "pipeline CRM",
    aiQuickClients: "clients",
    contextLabel: "Contexte :",
    docContext: "Doc :",
    clientContext: "Client :",
    montantTTC: "Montant TTC :",
    statusContext: "Statut :",
    emailPlaceholder: "Email généré automatiquement...",
    copyBtn: "📋 Copier",
    emailCopied: "Email copié !",
    historyCleared: "Historique vidé",
    noDoc: "Aucun document",
    actionsLabel: "Actions", traceabilityLabel: "Traçabilité",
    traceDraft: "Brouillon sauvegardé — validation attendue depuis le document",
    traceValidated: "Document validé depuis le formulaire",
    traceSent: "Document envoyé",
    traceDelivered: "Document livré",
    tracePaid: "Paiement enregistré",
    traceReturned: "Document retourné",
    traceCancelled: "Document annulé",
    markedSent: "marqué Envoyé",
    sendBtn: "📤 Envoyer",
    markedDelivered: "marqué Livré",
    deliverBtn: "📦 Livrer",
    markedPaid: "marqué Payé",
    payBtn: "✅ Payer",
    returnBtn: "↩️ Retour",
    markedReturned: "marqué Retour — stock réintégré",
    searchPlaceholder: "🔍 Rechercher par n° doc, client, type...",
    noResult: "Aucun résultat",
    refPlaceholder: "Ex: PC-020-A-19",
    descPlaceholder: "Désignation...",
    addLogo: "+ Logo",
    companyPlaceholder: "Nom de l'entreprise",
    addressPlaceholder: "Adresse...",
    phonePlaceholder: "Téléphone...",
    clientPlaceholder: "Nom et adresse du client...",
    compatPlaceholder: "Renault / MAN...",
    categoryPlaceholder: "Pompes, Moteurs...",
    supplierPlaceholder: "Fournisseur",
    stockInitial: "Stock initial",
    clientNamePlaceholder: "Nom du client",
    clientAddressPlaceholder: "Adresse...",
    clientPhonePlaceholder: "0522...",
    clientEmailPlaceholder: "email@...",
    alertCountSingular: "alerte stock",
    alertCountPlural: "alertes stock",
    generating: "Génération...",
    refNotFound: "Référence introuvable dans le catalogue",
    noItemDoc: "Aucun article dans le document",
    iceRequired: "ICE client obligatoire pour valider une facture",
    validateFirst: "Validez d'abord le document",
    docSaved: "Document sauvegardé",
    noDocExport: "Aucun document à exporter",
    pdfDownloaded: "PDF téléchargé avec succès",
    pdfError: "Erreur lors de la génération du PDF",
    docPrinted: "Document envoyé à l'impression",
    catItemDeleted: "Article supprimé du catalogue",
    statusDraft: "",
    statusValidated: "Validé",
    statusSent: "Envoyé",
    statusDelivered: "Livré",
    statusPaid: "Payé",
    statusReturned: "Retour",
    statusCancelled: "Annulé",
    unknownLabel: "Inconnu",
    docDevis: "DEVIS",
    docBL: "BON DE LIVRAISON",
    docBC: "BON DE COMMANDE",
    docFact: "FACTURE",
    docAvoir: "AVOIR",
    docGeneric: "DOCUMENT",
    statusDocumentsTitle: "📋 Statut des documents",
    confirmNewDoc: "Un document est en cours. Créer un nouveau document ? Les données actuelles seront perdues.",
    confirmReturn: "Confirmer le retour pour",
    confirmReturnStock: "Le stock sera réintégré.",
    ofDocuments: "des documents",
    newProspect: "Nouveau Prospect",
    stockInsufficientFormat: "Stock insuffisant. Disponible: {0}, requis: {1}",
    stockInsufficientFor: "Stock insuffisant pour {0}: {1} dispo",
    dispoInfo: "Dispo: {0} | {1} | {2}",
    newDocCreatedFormat: "Nouveau {0} créé : {1}",
    stockInsufficientItems: "Stock insuffisant pour: {0}",
    stockDeductedFormat: "Stock déduit pour {0} articles",
    stockReintegratedFormat: "Stock réintégré pour {0} articles (Avoir)",
    docValidatedFormat: "Document {0} validé et verrouillé",
    convertedToFormat: "Converti en {0}: {1}",
    docLoadedFormat: "Document {0} chargé",
    itemAddedFormat: "Article ajouté: {0} ({1} unités)",
    clientAddedFormat: "Client {0} ajouté",
    clientInfoFormat: "Client: {0}",
    itemsImportedFormat: "{0} articles importés",
    aiAnalyseTitle: "📊 Analyse du Stock",
    aiAnalyseBody: "📦 Stock total: {0} unités\n💰 Valeur: {1}\n📋 Références: {2}\n⚠️ Alertes stock: {3}\n\n{4}",
    aiRestockTitle: "⚠️ Alertes Réapprovisionnement",
    aiNoAlerts: "Aucune alerte — tous les stocks sont suffisants ✅",
    aiCriticalItem: "• {0} — {1}\n  Stock: {2} / Min: {3} | Fournisseur: {4}",
    aiCaTitle: "💰 Chiffre d'Affaires",
    aiCaBody: "📈 CA Réalisé: {0}\n🎯 Prévision pondérée: {1}\n✅ Deals gagnés: {2}/{3}\n📉 Taux conversion: {4}%",
    aiPipelineTitle: "👥 Pipeline CRM",
    aiPipelineBody: "📊 Prospects: {0}\n💰 Valeur totale: {1}\n🎯 Prévision: {2}\n\n📋 Par étape:\n{3}",
    aiClientsTitle: "👤 Clients",
    aiClientsBody: "📋 Nombre de clients: {0}\n{1}",
    aiTopClient: "🏆 Plus gros encours: {0} ({1})",
    aiDefaultTitle: "🤖 IntelSpark ERP-AH Intelligence",
    aiDefaultCmds: "Commandes disponibles:\n• \"{0}\" → {1}\n• \"{2}\" → {3}\n• \"{4}\" → {5}\n• \"{6}\" → {7}\n• \"{8}\" → {9}",
    aiCmdAnalyse: "analyse stock",
    aiCmdDescAnalyse: "inventaire et alertes",
    aiCmdRestock: "alertes réapprovisionnement",
    aiCmdDescRestock: "articles critiques",
    aiCmdCA: "chiffre d'affaires",
    aiCmdDescCA: "CA et prévisions",
    aiCmdPipeline: "pipeline CRM",
    aiCmdDescPipeline: "état des prospects",
    aiCmdClients: "clients",
    aiCmdDescClients: "portefeuille clients",
    aiDefaultFooter: "Stock actuel: {0} unités | CA: {1}",
    emailSubject: "Objet: {0} N°{1}",
    emailGreeting: "Bonjour,",
    emailAttach: "Veuillez trouver ci-joint le {0} N°{1}.",
    emailDetail: "Détail:",
    emailLine: "• {0} — {1} x{2} = {3} HT",
    emailTvaLine: "TVA {0}% : {1}",
    emailTotalHT: "Total HT : {0}",
    emailTimbre: "Timbre fiscal: {0}",
    emailTotalTTC: "Total TTC : {0}",
    emailAcompte: "Acompte versé : {0}\nRestant dû : {1}",
    emailPayment: "Mode de paiement : {0}",
    emailDue: "Échéance : {0}",
    emailClosing: "Cordialement,",
    emailCompanyFallback: "Notre société",
    emailItemHT: "HT",
    itemDeletedFormat: "Article supprimé: {0}",
    stockRestoredFormat: "Stock restauré: +{0}",
    logDelete: "Suppression x{0}",
    logDocValidated: "Document validé: {0}",
    logConversion: "Conversion → {0}: {1}",
    logSave: "Sauvegarde: {0}",
    logPdfDownload: "PDF téléchargé: {0}.pdf",
    logPrint: "Impression",
    logCatalogAdd: "Ajout Catalogue",
    logAdd: "Ajout x{0}",
    manualItem: "Article Manuel",
    phoneLabel: "Tél",
    aiCriticalTitle: "Articles critiques:",
    supplierLabel: "Fournisseur",
    // === BULLETINS DE PAIE (NOUVELLES CLÉS) ===
    bulletinTitle: "Bulletins de Paie",
    bulletinNoEmployees: "Aucun salarié trouvé",
    bulletinNoEmployeesDesc: "La page Bulletins de Paie a besoin des fiches salariés créées dans la page RH → Admin & Paie → Dossiers Salariés.",
    bulletinPeriodMonth: "Mois",
    bulletinPeriodYear: "Année",
    bulletinSearchPlaceholder: "Nom, matricule, poste...",
    bulletinGenerate: "Générer les bulletins du mois",
    bulletinDownloadAll: "Télécharger tous les PDF",
    bulletinColSalarie: "Salarié",
    bulletinColPeriode: "Période",
    bulletinColBrut: "Salaire Brut",
    bulletinColNet: "Net à Payer",
    bulletinColPdf: "Document PDF",
    bulletinColStatus: "Statut",
    bulletinStatusGenerated: "Généré",
    bulletinMasseTotale: "Masse salariale totale du mois :",
    bulletinTotalRetenues: "CNSS : -{0} · AMO : -{1} · IR : -{2}",
    bulletinNoBulletin: "Aucun bulletin généré pour le moment",
    bulletinHint: "Sélectionnez une période puis cliquez sur Générer les bulletins du mois",
    bulletinEmpty: "Aucun salarié avec salaire défini",
  },
  EN: {
    docTab: "Quote", BLTab: "Delivery Note", BCTab: "Purchase Order", avoirTab: "Credit Note",
    factTab: "Invoice", refTab: "Catalog", stockTab: "Stock", pipelineTab: "CRM",
    statsTab: "Reporting", iaTab: "AI", histTab: "History", clientsTab: "Clients", statusTab: "Status",
    activeDoc: "Doc:", exportBtn: "Export", saveBtn: "Save",
    refLabel: "Reference", descLabel: "Description", priceLabel: "Unit Price HT", qtyLabel: "Qty", addBtn: "Add", itemFieldsRequired: "Complete reference, description, quantity and price before adding.",
    fournisseur: "Supplier", dateEntree: "Entry",
    currencyLabel: "Currency", regionLabel: "Region", translationLabel: "Language",
    destinatary: "CUSTOMER DETAILS", representative: "Representative", vRef: "Your Ref", dateDoc: "Date",
    totalTva: "VAT 20%:", netToPay: "NET TO PAY:",
    catalogTitle: "Catalog", stockTitle: "Stock", crmTitle: "CRM Pipeline",
    addProspect: "+ Prospect", clientAccount: "Client", valEst: "Value", stage: "Stage", prob: "Prob.",
    historyTitle: "History", clearLog: "Clear", colTime: "Time", colRef: "Affected item", colDesc: "Context", colAction: "Completed action",
    submit: "Analyze",
    kpiCa: "Revenue", kpiGoal: "Goal", kpiSig: "Conversion", kpiVol: "Volume",
    crmForecast: "Forecast",
    iaTitle: "AI Intelligence", emailTitle: "AI Email", emailBtn: "Compose",
    exportPDF: "PDF", exportWord: "Word", print: "Print",
    deleteLogo: "Delete logo", fontSettings: "Display",
    fontSizeLabel: "Size", fontFamilyLabel: "Font", fontColorLabel: "Text Color",
    stockPrice: "Unit Price", stockValue: "Stock Value", addCatalogBtn: "Add to catalog",
    paymentMethod: "Payment Method", dueDate: "Due Date", tvaLabel: "VAT 20%",
    totalBrut: "Total HT:", baseHt: "Net Base", footerLabel: "Legal Information",
    aiWelcome: "Waiting for commands...", aiPlaceholder: "Ask your question...",
    aiStock: "Stock Analysis", aiCA: "Revenue", aiPipeline: "CRM Pipeline",
    stockError: "Insufficient stock! Available: ",
    stockSuccess: "Item added",
    stockWarning: "Low stock after order",
    ttcLabel: "Total TTC:",
    statusLabel: "Status",
    docNum: "Document No.",
    docType: "Type",
    docDate: "Date",
    validateDoc: "Validate",
    lockMsg: "Document locked — cannot be modified after validation",
    newDoc: "New",
    convertToBL: "→ DN",
    convertToFact: "→ Invoice",
    convertToAvoir: "→ Credit",
    oemLabel: "OEM Ref.",
    compatLabel: "Compatible",
    emplacLabel: "Location",
    minStockLabel: "Min stock",
    categoryLabel: "Category",
    availableStock: "Available",
    reservedStock: "Reserved",
    clientsTitle: "Clients",
    addClient: "+ Client",
    iceLabel: "Tax ID",
    limiteLabel: "Credit limit",
    encoursLabel: "Outstanding",
    encaissLabel: "Receipts",
    paymentStatus: "Payment",
    totalHT: "Total HT", discountLabel: "Discount",
    tvaAmt: "VAT (20%)",
    totalTTC: "Total TTC",
    docHistory: "Documents",
    alertRestock: "Restock Alerts",
    exportPDFBtn: "Download PDF",
    savedDocs: "Saved Documents",
    validityLabel: "Valid until",
    montantHT: "HT Amount",
    loadBtn: "Load",
    devInfo: "📄 Quote — stock not deducted",
    blInfo: "🚚 Delivery note sent to warehouse - stock updated on shipment",
    bcInfo: "📋 Purchase Order",
    factInfo: "💳 Invoice — stock deducted on validation",
    chooseClient: "👤 Choose client",
    chooseSupplier: "👤 Choose supplier",
    selectClient: "👤 Select a client",
    factOrig: "Orig. Invoice",
    paymentCheque: "Cheque",
    paymentCash: "Cash",
    paymentTransfer: "Transfer",
    paymentEffet: "Promissory",
    timbreFiscal: "Stamp duty",
    acompte: "Deposit",
    acompteVerse: "Deposit paid",
    restantDu: "Remaining due",
    paid: "PAID",
    importCSV: "📥 Import CSV",
    stockArticles: "📦 Items",
    stockEnStock: "✅ In stock",
    stockCritiques: "⚠️ Critical",
    stockValeur: "💰 Stock value",
    valeurLabel: "Value",
    clientNameLabel: "Name *",
    clientAddressLabel: "Address",
    clientPhoneLabel: "Phone",
    clientEmailLabel: "Email",
    clientDeleted: "Client deleted",
    stageNew: "New",
    stageQualified: "Qualified",
    stageSent: "Quote Sent",
    stageNegotiation: "Negotiation",
    stageWon: "Won",
    stageLost: "Lost",
    analyseFinanciere: "📊 Financial Catalog Analysis",
    valeurStock: "Stock Value",
    totalValeurStock: "TOTAL AVAILABLE STOCK VALUE",
    derniersDocuments: "💳 Latest Documents",
    noDocRecorded: "No documents recorded",
    aiQuickAnalyse: "stock analysis",
    aiQuickRestock: "restock alerts",
    aiQuickCA: "revenue",
    aiQuickPipeline: "CRM pipeline",
    aiQuickClients: "clients",
    contextLabel: "Context:",
    docContext: "Doc:",
    clientContext: "Client:",
    montantTTC: "Total TTC:",
    statusContext: "Status:",
    emailPlaceholder: "Auto-generated email...",
    copyBtn: "📋 Copy",
    emailCopied: "Email copied!",
    historyCleared: "History cleared",
    noDoc: "No document",
    actionsLabel: "Actions", traceabilityLabel: "Traceability",
    traceDraft: "Draft saved — awaiting validation from document",
    traceValidated: "Document validated from form",
    traceSent: "Document sent",
    traceDelivered: "Document delivered",
    tracePaid: "Payment recorded",
    traceReturned: "Document returned",
    traceCancelled: "Document cancelled",
    markedSent: "marked Sent",
    sendBtn: "📤 Send",
    markedDelivered: "marked Delivered",
    deliverBtn: "📦 Deliver",
    markedPaid: "marked Paid",
    payBtn: "✅ Pay",
    returnBtn: "↩️ Return",
    markedReturned: "marked Return — stock reintegrated",
    searchPlaceholder: "🔍 Search by doc #, client, type...",
    noResult: "No results",
    refPlaceholder: "Ex: PC-020-A-19",
    descPlaceholder: "Description...",
    addLogo: "+ Logo",
    companyPlaceholder: "Company name",
    addressPlaceholder: "Address...",
    phonePlaceholder: "Phone...",
    clientPlaceholder: "Client name and address...",
    compatPlaceholder: "Renault / MAN...",
    categoryPlaceholder: "Pumps, Motors...",
    supplierPlaceholder: "Supplier",
    stockInitial: "Initial stock",
    clientNamePlaceholder: "Client name",
    clientAddressPlaceholder: "Address...",
    clientPhonePlaceholder: "0522...",
    clientEmailPlaceholder: "email@...",
    alertCountSingular: "stock alert",
    alertCountPlural: "stock alerts",
    generating: "Generating...",
    refNotFound: "Reference not found in catalog",
    noItemDoc: "No items in document",
    iceRequired: "Client ICE required to validate an invoice",
    validateFirst: "Validate the document first",
    docSaved: "Document saved",
    noDocExport: "No document to export",
    pdfDownloaded: "PDF downloaded successfully",
    pdfError: "Error generating PDF",
    docPrinted: "Document sent to print",
    catItemDeleted: "Item removed from catalog",
    statusDraft: "",
    statusValidated: "Validated",
    statusSent: "Sent",
    statusDelivered: "Delivered",
    statusPaid: "Paid",
    statusReturned: "Returned",
    statusCancelled: "Cancelled",
    unknownLabel: "Unknown",
    docDevis: "QUOTE",
    docBL: "DELIVERY NOTE",
    docBC: "PURCHASE ORDER",
    docFact: "INVOICE",
    docAvoir: "CREDIT NOTE",
    docGeneric: "DOCUMENT",
    statusDocumentsTitle: "📋 Document Status",
    confirmNewDoc: "A document is in progress. Create a new document? Current data will be lost.",
    confirmReturn: "Confirm return for",
    confirmReturnStock: "Stock will be reinstated.",
    ofDocuments: "of documents",
    newProspect: "New Prospect",
    stockInsufficientFormat: "Insufficient stock. Available: {0}, required: {1}",
    stockInsufficientFor: "Insufficient stock for {0}: {1} available",
    dispoInfo: "Available: {0} | {1} | {2}",
    newDocCreatedFormat: "New {0} created: {1}",
    stockInsufficientItems: "Insufficient stock for: {0}",
    stockDeductedFormat: "Stock deducted for {0} items",
    stockReintegratedFormat: "Stock reinstated for {0} items (Credit Note)",
    docValidatedFormat: "Document {0} validated and locked",
    convertedToFormat: "Converted to {0}: {1}",
    docLoadedFormat: "Document {0} loaded",
    itemAddedFormat: "Item added: {0} ({1} units)",
    clientAddedFormat: "Client {0} added",
    clientInfoFormat: "Client: {0}",
    itemsImportedFormat: "{0} items imported",
    aiAnalyseTitle: "📊 Stock Analysis",
    aiAnalyseBody: "📦 Total stock: {0} units\n💰 Value: {1}\n📋 References: {2}\n⚠️ Stock alerts: {3}\n\n{4}",
    aiRestockTitle: "⚠️ Restock Alerts",
    aiNoAlerts: "No alerts — all stock levels are sufficient ✅",
    aiCriticalItem: "• {0} — {1}\n  Stock: {2} / Min: {3} | Supplier: {4}",
    aiCaTitle: "💰 Revenue",
    aiCaBody: "📈 Revenue Achieved: {0}\n🎯 Weighted Forecast: {1}\n✅ Deals won: {2}/{3}\n📉 Conversion rate: {4}%",
    aiPipelineTitle: "👥 CRM Pipeline",
    aiPipelineBody: "📊 Prospects: {0}\n💰 Total value: {1}\n🎯 Forecast: {2}\n\n📋 By stage:\n{3}",
    aiClientsTitle: "👤 Clients",
    aiClientsBody: "📋 Number of clients: {0}\n{1}",
    aiTopClient: "🏆 Largest balance: {0} ({1})",
    aiDefaultTitle: "🤖 IntelSpark ERP-AH Intelligence",
    aiDefaultCmds: "Available commands:\n• \"{0}\" → {1}\n• \"{2}\" → {3}\n• \"{4}\" → {5}\n• \"{6}\" → {7}\n• \"{8}\" → {9}",
    aiCmdAnalyse: "stock analysis",
    aiCmdDescAnalyse: "inventory and alerts",
    aiCmdRestock: "restock alerts",
    aiCmdDescRestock: "critical items",
    aiCmdCA: "revenue",
    aiCmdDescCA: "revenue and forecasts",
    aiCmdPipeline: "CRM pipeline",
    aiCmdDescPipeline: "prospect status",
    aiCmdClients: "clients",
    aiCmdDescClients: "client portfolio",
    aiDefaultFooter: "Current stock: {0} units | Revenue: {1}",
    emailSubject: "Subject: {0} N°{1}",
    emailGreeting: "Dear Sir/Madam,",
    emailAttach: "Please find attached the {0} N°{1}.",
    emailDetail: "Details:",
    emailLine: "• {0} — {1} x{2} = {3} HT",
    emailTvaLine: "VAT {0}% : {1}",
    emailTotalHT: "Total HT: {0}",
    emailTimbre: "Stamp tax: {0}",
    emailTotalTTC: "Total TTC: {0}",
    emailAcompte: "Deposit paid: {0}\nBalance due: {1}",
    emailPayment: "Payment method: {0}",
    emailDue: "Due date: {0}",
    emailClosing: "Sincerely,",
    emailCompanyFallback: "Our company",
    emailItemHT: "HT",
    itemDeletedFormat: "Item deleted: {0}",
    stockRestoredFormat: "Stock restored: +{0}",
    logDelete: "Delete x{0}",
    logDocValidated: "Document validated: {0}",
    logConversion: "Conversion → {0}: {1}",
    logSave: "Save: {0}",
    logPdfDownload: "PDF downloaded: {0}.pdf",
    logPrint: "Print",
    logCatalogAdd: "Catalog Add",
    logAdd: "Add x{0}",
    manualItem: "Manual Item",
    phoneLabel: "Tel",
    aiCriticalTitle: "Critical items:",
    supplierLabel: "Supplier",
    bulletinTitle: "Pay Slips",
    bulletinNoEmployees: "No employee found",
    bulletinNoEmployeesDesc: "Pay slips require employee records created in HR → Admin & Payroll → Employee Files.",
    bulletinPeriodMonth: "Month",
    bulletinPeriodYear: "Year",
    bulletinSearchPlaceholder: "Name, ID, position...",
    bulletinGenerate: "Generate monthly payslips",
    bulletinDownloadAll: "Download all PDFs",
    bulletinColSalarie: "Employee",
    bulletinColPeriode: "Period",
    bulletinColBrut: "Gross Salary",
    bulletinColNet: "Net Pay",
    bulletinColPdf: "PDF Document",
    bulletinColStatus: "Status",
    bulletinStatusGenerated: "Generated",
    bulletinMasseTotale: "Total monthly payroll:",
    bulletinTotalRetenues: "CNSS : -{0} · AMO : -{1} · IT : -{2}",
    bulletinNoBulletin: "No payslip generated yet",
    bulletinHint: "Select a period then click Generate monthly payslips",
    bulletinEmpty: "No employee with salary defined",
  },
  ES: {
    docTab: "Presupuesto", BLTab: "Albarán", BCTab: "Pedido", avoirTab: "Nota de Crédito",
    factTab: "Factura", refTab: "Catálogo", stockTab: "Stock", pipelineTab: "CRM",
    statsTab: "Informes", iaTab: "IA", histTab: "Historial", clientsTab: "Clientes", statusTab: "Estado",
    activeDoc: "Documento:", exportBtn: "Exportar", saveBtn: "Guardar",
    refLabel: "Referencia", descLabel: "Descripción", priceLabel: "Precio unitario", qtyLabel: "Cant", addBtn: "Añadir", itemFieldsRequired: "Complete referencia, descripción, cantidad y precio antes de añadir.",
    fournisseur: "Proveedor", dateEntree: "Entrada",
    currencyLabel: "Moneda", regionLabel: "Región", translationLabel: "Idioma",
    destinatary: "DATOS DEL CLIENTE", representative: "Representante", vRef: "Su Ref", dateDoc: "Fecha",
    totalTva: "IVA 20%:", netToPay: "TOTAL A PAGAR:",
    catalogTitle: "Catálogo", stockTitle: "Stock", crmTitle: "Pipeline CRM",
    addProspect: "+ Prospecto", clientAccount: "Cliente", valEst: "Valor", stage: "Etapa", prob: "Prob.",
    historyTitle: "Historial", clearLog: "Vaciar", colTime: "Hora", colRef: "Elemento afectado", colDesc: "Contexto", colAction: "Acción realizada",
    submit: "Analizar",
    kpiCa: "Ingresos", kpiGoal: "Objetivo", kpiSig: "Conversión", kpiVol: "Volumen",
    crmForecast: "Previsión",
    iaTitle: "IA Inteligente", emailTitle: "Email IA", emailBtn: "Redactar",
    exportPDF: "PDF", exportWord: "Word", print: "Imprimir",
    deleteLogo: "Eliminar logo", fontSettings: "Pantalla",
    fontSizeLabel: "Tamaño", fontFamilyLabel: "Fuente", fontColorLabel: "Color texto",
    stockPrice: "Precio", stockValue: "Valor stock", addCatalogBtn: "Añadir al catálogo",
    paymentMethod: "Método de pago", dueDate: "Vencimiento", tvaLabel: "IVA 20%",
    totalBrut: "Total HT:", baseHt: "Base", footerLabel: "Notas Legales",
    aiWelcome: "Esperando comandos...", aiPlaceholder: "Haga su pregunta...",
    aiStock: "Análisis de Stock", aiCA: "Ingresos", aiPipeline: "Pipeline CRM",
    stockError: "Stock insuficiente! Disponible: ",
    stockSuccess: "Artículo añadido",
    stockWarning: "Stock bajo después del pedido",
    ttcLabel: "Total TTC:",
    statusLabel: "Estado",
    docNum: "N.º documento",
    docType: "Tipo",
    docDate: "Fecha",
    validateDoc: "Validar",
    lockMsg: "Documento bloqueado — no modificable tras validación",
    newDoc: "Nuevo",
    convertToBL: "→ Albarán",
    convertToFact: "→ Factura",
    convertToAvoir: "→ Nota Créd.",
    oemLabel: "Ref. OEM",
    compatLabel: "Compatible",
    emplacLabel: "Ubicación",
    minStockLabel: "Stock mín.",
    categoryLabel: "Categoría",
    availableStock: "Disponible",
    reservedStock: "Reservado",
    clientsTitle: "Clientes",
    addClient: "+ Cliente",
    iceLabel: "NIF",
    limiteLabel: "Límite crédito",
    encoursLabel: "Pendiente",
    encaissLabel: "Cobros",
    paymentStatus: "Pago",
    totalHT: "Total HT", discountLabel: "Descuento",
    tvaAmt: "IVA (20%)",
    totalTTC: "Total TTC",
    docHistory: "Documentos",
    alertRestock: "Alertas de reposición",
    exportPDFBtn: "Descargar PDF",
    savedDocs: "Documentos guardados",
    validityLabel: "Validez",
    montantHT: "Importe HT",
    loadBtn: "Cargar",
    devInfo: "📄 Presupuesto — stock no deducido",
    blInfo: "🚚 Albarán enviado al almacén - stock actualizado al expedir",
    bcInfo: "📋 Pedido",
    factInfo: "💳 Factura — stock deducido al validar",
    chooseClient: "👤 Elegir cliente",
    chooseSupplier: "👤 Elegir proveedor",
    selectClient: "👤 Seleccionar un cliente",
    factOrig: "Factura orig.",
    paymentCheque: "Cheque",
    paymentCash: "Efectivo",
    paymentTransfer: "Transferencia",
    paymentEffet: "Efecto",
    timbreFiscal: "Timbre fiscal",
    acompte: "Anticipo",
    acompteVerse: "Anticipo pagado",
    restantDu: "Saldo pendiente",
    paid: "PAGADO",
    importCSV: "📥 Importar CSV",
    stockArticles: "📦 Artículos",
    stockEnStock: "✅ En stock",
    stockCritiques: "⚠️ Críticos",
    stockValeur: "💰 Valor stock",
    valeurLabel: "Valor",
    clientNameLabel: "Nombre *",
    clientAddressLabel: "Dirección",
    clientPhoneLabel: "Teléfono",
    clientEmailLabel: "Email",
    clientDeleted: "Cliente eliminado",
    stageNew: "Nuevo",
    stageQualified: "Calificado",
    stageSent: "Presupuesto Enviado",
    stageNegotiation: "Negociación",
    stageWon: "Ganado",
    stageLost: "Perdido",
    analyseFinanciere: "📊 Análisis Financiero Catálogo",
    valeurStock: "Valor Stock",
    totalValeurStock: "TOTAL VALOR STOCK DISPONIBLE",
    derniersDocuments: "💳 Últimos Documentos",
    noDocRecorded: "Ningún documento registrado",
    aiQuickAnalyse: "análisis de stock",
    aiQuickRestock: "alertas de reposición",
    aiQuickCA: "ingresos",
    aiQuickPipeline: "pipeline CRM",
    aiQuickClients: "clientes",
    contextLabel: "Contexto:",
    docContext: "Doc:",
    clientContext: "Cliente:",
    montantTTC: "Total TTC:",
    statusContext: "Estado:",
    emailPlaceholder: "Email generado automáticamente...",
    copyBtn: "📋 Copiar",
    emailCopied: "¡Email copiado!",
    historyCleared: "Historial vaciado",
    noDoc: "Ningún documento",
    actionsLabel: "Acciones", traceabilityLabel: "Trazabilidad",
    traceDraft: "Borrador guardado — esperando validación desde el documento",
    traceValidated: "Documento validado desde el formulario",
    traceSent: "Documento enviado",
    traceDelivered: "Documento entregado",
    tracePaid: "Pago registrado",
    traceReturned: "Documento devuelto",
    traceCancelled: "Documento cancelado",
    markedSent: "marcado Enviado",
    sendBtn: "📤 Enviar",
    markedDelivered: "marcado Entregado",
    deliverBtn: "📦 Entregar",
    markedPaid: "marcado Pagado",
    payBtn: "✅ Pagar",
    returnBtn: "↩️ Devolver",
    markedReturned: "marcado Devuelto — stock reintegrado",
    searchPlaceholder: "🔍 Buscar por n° doc, cliente, tipo...",
    noResult: "Sin resultados",
    refPlaceholder: "Ej: PC-020-A-19",
    descPlaceholder: "Descripción...",
    addLogo: "+ Logo",
    companyPlaceholder: "Nombre de la empresa",
    addressPlaceholder: "Dirección...",
    phonePlaceholder: "Teléfono...",
    clientPlaceholder: "Nombre y dirección del cliente...",
    compatPlaceholder: "Renault / MAN...",
    categoryPlaceholder: "Bombas, Motores...",
    supplierPlaceholder: "Proveedor",
    stockInitial: "Stock inicial",
    clientNamePlaceholder: "Nombre del cliente",
    clientAddressPlaceholder: "Dirección...",
    clientPhonePlaceholder: "0522...",
    clientEmailPlaceholder: "email@...",
    alertCountSingular: "alerta de stock",
    alertCountPlural: "alertas de stock",
    generating: "Generando...",
    refNotFound: "Referencia no encontrada en el catálogo",
    noItemDoc: "No hay artículos en el documento",
    iceRequired: "ICE del cliente obligatorio para validar factura",
    validateFirst: "Valide primero el documento",
    docSaved: "Documento guardado",
    noDocExport: "No hay documento para exportar",
    pdfDownloaded: "PDF descargado con éxito",
    pdfError: "Error al generar el PDF",
    docPrinted: "Documento enviado a impresión",
    catItemDeleted: "Artículo eliminado del catálogo",
    statusDraft: "",
    statusValidated: "Validado",
    statusSent: "Enviado",
    statusDelivered: "Entregado",
    statusPaid: "Pagado",
    statusReturned: "Devuelto",
    statusCancelled: "Cancelado",
    unknownLabel: "Desconocido",
    docDevis: "PRESUPUESTO",
    docBL: "ALBARÁN",
    docBC: "PEDIDO",
    docFact: "FACTURA",
    docAvoir: "NOTA DE CRÉDITO",
    docGeneric: "DOCUMENTO",
    statusDocumentsTitle: "📋 Estado de Documentos",
    confirmNewDoc: "Hay un documento en curso. ¿Crear nuevo documento? Los datos actuales se perderán.",
    confirmReturn: "Confirmar devolución para",
    confirmReturnStock: "El stock será reintegrado.",
    ofDocuments: "de documentos",
    newProspect: "Nuevo Prospecto",
    stockInsufficientFormat: "Stock insuficiente. Disponible: {0}, requerido: {1}",
    stockInsufficientFor: "Stock insuficiente para {0}: {1} disponible",
    dispoInfo: "Disponible: {0} | {1} | {2}",
    newDocCreatedFormat: "Nuevo {0} creado: {1}",
    stockInsufficientItems: "Stock insuficiente para: {0}",
    stockDeductedFormat: "Stock deducido para {0} artículos",
    stockReintegratedFormat: "Stock reintegrado para {0} artículos (Nota de Crédito)",
    docValidatedFormat: "Documento {0} validado y bloqueado",
    convertedToFormat: "Convertido a {0}: {1}",
    docLoadedFormat: "Documento {0} cargado",
    itemAddedFormat: "Artículo añadido: {0} ({1} unidades)",
    clientAddedFormat: "Cliente {0} añadido",
    clientInfoFormat: "Cliente: {0}",
    itemsImportedFormat: "{0} artículos importados",
    aiAnalyseTitle: "📊 Análisis de Stock",
    aiAnalyseBody: "📦 Stock total: {0} unidades\n💰 Valor: {1}\n📋 Referencias: {2}\n⚠️ Alertas de stock: {3}\n\n{4}",
    aiRestockTitle: "⚠️ Alertas de Reabastecimiento",
    aiNoAlerts: "Sin alertas — todos los stocks son suficientes ✅",
    aiCriticalItem: "• {0} — {1}\n  Stock: {2} / Mín: {3} | Proveedor: {4}",
    aiCaTitle: "💰 Volumen de Negocio",
    aiCaBody: "📈 Volumen realizado: {0}\n🎯 Previsión ponderada: {1}\n✅ Acuerdos ganados: {2}/{3}\n📉 Tasa de conversión: {4}%",
    aiPipelineTitle: "👥 Pipeline CRM",
    aiPipelineBody: "📊 Prospectos: {0}\n💰 Valor total: {1}\n🎯 Previsión: {2}\n\n📋 Por etapa:\n{3}",
    aiClientsTitle: "👤 Clientes",
    aiClientsBody: "📋 Número de clientes: {0}\n{1}",
    aiTopClient: "🏆 Mayor saldo: {0} ({1})",
    aiDefaultTitle: "🤖 IntelSpark ERP-AH Intelligence",
    aiDefaultCmds: "Comandos disponibles:\n• \"{0}\" → {1}\n• \"{2}\" → {3}\n• \"{4}\" → {5}\n• \"{6}\" → {7}\n• \"{8}\" → {9}",
    aiCmdAnalyse: "análisis de stock",
    aiCmdDescAnalyse: "inventario y alertas",
    aiCmdRestock: "alertas de reabastecimiento",
    aiCmdDescRestock: "artículos críticos",
    aiCmdCA: "volumen de negocio",
    aiCmdDescCA: "volumen y previsiones",
    aiCmdPipeline: "pipeline CRM",
    aiCmdDescPipeline: "estado de prospectos",
    aiCmdClients: "clientes",
    aiCmdDescClients: "cartera de clientes",
    aiDefaultFooter: "Stock actual: {0} unidades | Volumen: {1}",
    emailSubject: "Asunto: {0} N°{1}",
    emailGreeting: "Estimado/a,",
    emailAttach: "Adjunto encontrará el/la {0} N°{1}.",
    emailDetail: "Detalle:",
    emailLine: "• {0} — {1} x{2} = {3} HT",
    emailTvaLine: "IVA {0}% : {1}",
    emailTotalHT: "Total HT: {0}",
    emailTimbre: "Timbre fiscal: {0}",
    emailTotalTTC: "Total TTC: {0}",
    emailAcompte: "Anticipo pagado: {0}\nSaldo debido: {1}",
    emailPayment: "Método de pago: {0}",
    emailDue: "Vencimiento: {0}",
    emailClosing: "Atentamente,",
    emailCompanyFallback: "Nuestra empresa",
    emailItemHT: "HT",
    itemDeletedFormat: "Artículo eliminado: {0}",
    stockRestoredFormat: "Stock restaurado: +{0}",
    logDelete: "Eliminar x{0}",
    logDocValidated: "Documento validado: {0}",
    logConversion: "Conversión → {0}: {1}",
    logSave: "Guardado: {0}",
    logPdfDownload: "PDF descargado: {0}.pdf",
    logPrint: "Impresión",
    logCatalogAdd: "Añadir Catálogo",
    logAdd: "Añadir x{0}",
    manualItem: "Artículo Manual",
    phoneLabel: "Tel",
    aiCriticalTitle: "Artículos críticos:",
    supplierLabel: "Proveedor",
    bulletinTitle: "Nóminas",
    bulletinNoEmployees: "Ningún empleado encontrado",
    bulletinNoEmployeesDesc: "Las nóminas requieren los expedientes de empleados creados en RR.HH. → Admin y Nómina → Expedientes de Empleados.",
    bulletinPeriodMonth: "Mes",
    bulletinPeriodYear: "Año",
    bulletinSearchPlaceholder: "Nombre, ID, puesto...",
    bulletinGenerate: "Generar nóminas del mes",
    bulletinDownloadAll: "Descargar todos los PDF",
    bulletinColSalarie: "Empleado",
    bulletinColPeriode: "Período",
    bulletinColBrut: "Salario Bruto",
    bulletinColNet: "Neto a Pagar",
    bulletinColPdf: "Documento PDF",
    bulletinColStatus: "Estado",
    bulletinStatusGenerated: "Generado",
    bulletinMasseTotale: "Masa salarial total del mes",
    bulletinTotalRetenues: "CNSS : -{0} · AMO : -{1} · IRPF : -{2}",
    bulletinNoBulletin: "Ninguna nómina generada aún",
    bulletinHint: "Seleccione un período y haga clic en Generar nóminas del mes",
    bulletinEmpty: "Ningún empleado con salario definido",
  },
  DE: {
    docTab: "Angebot", BLTab: "Lieferschein", BCTab: "Bestellung", avoirTab: "Gutschrift",
    factTab: "Rechnung", refTab: "Katalog", stockTab: "Lager", pipelineTab: "CRM",
    statsTab: "Berichte", iaTab: "KI", histTab: "Verlauf", clientsTab: "Kunden", statusTab: "Status",
    activeDoc: "Dokument:", exportBtn: "Exportieren", saveBtn: "Speichern",
    refLabel: "Referenz", descLabel: "Bezeichnung", priceLabel: "Stückpreis", qtyLabel: "Menge", addBtn: "Hinzufügen", itemFieldsRequired: "Referenz, Bezeichnung, Menge und Preis vor dem Hinzufügen ausfüllen.",
    fournisseur: "Lieferant", dateEntree: "Eingang",
    currencyLabel: "Währung", regionLabel: "Region", translationLabel: "Sprache",
    destinatary: "KUNDENDATEN", representative: "Vertreter", vRef: "Ihre Ref", dateDoc: "Datum",
    totalTva: "MwSt 20%:", netToPay: "ZAHLUNGSBETRAG:",
    catalogTitle: "Katalog", stockTitle: "Lager", crmTitle: "CRM Pipeline",
    addProspect: "+ Interessent", clientAccount: "Kunde", valEst: "Wert", stage: "Stufe", prob: "Wahrsch.",
    historyTitle: "Verlauf", clearLog: "Leeren", colTime: "Zeit", colRef: "Betroffenes Element", colDesc: "Kontext", colAction: "Ausgeführte Aktion",
    submit: "Analysieren",
    kpiCa: "Umsatz", kpiGoal: "Ziel", kpiSig: "Konversion", kpiVol: "Volumen",
    crmForecast: "Prognose",
    iaTitle: "KI Intelligenz", emailTitle: "KI Email", emailBtn: "Verfassen",
    exportPDF: "PDF", exportWord: "Word", print: "Drucken",
    deleteLogo: "Logo löschen", fontSettings: "Anzeige",
    fontSizeLabel: "Größe", fontFamilyLabel: "Schriftart", fontColorLabel: "Textfarbe",
    stockPrice: "Preis", stockValue: "Lagerwert", addCatalogBtn: "Zum Katalog hinzufügen",
    paymentMethod: "Zahlungsmethode", dueDate: "Fällig am", tvaLabel: "MwSt 20%",
    totalBrut: "Gesamt HT:", baseHt: "Basis", footerLabel: "Rechtliche Hinweise",
    aiWelcome: "Warte auf Befehle...", aiPlaceholder: "Stellen Sie Ihre Frage...",
    aiStock: "Lageranalyse", aiCA: "Umsatz", aiPipeline: "CRM Pipeline",
    stockError: "Lagerbestand unzureichend! Verfügbar: ",
    stockSuccess: "Artikel hinzugefügt",
    stockWarning: "Niedriger Bestand nach Bestellung",
    ttcLabel: "Gesamt TTC:",
    statusLabel: "Status",
    docNum: "Dokumentnr.",
    docType: "Typ",
    docDate: "Datum",
    validateDoc: "Validieren",
    lockMsg: "Dokument gesperrt — nach Validierung nicht änderbar",
    newDoc: "Neu",
    convertToBL: "→ Lieferschein",
    convertToFact: "→ Rechnung",
    convertToAvoir: "→ Gutschrift",
    oemLabel: "OEM Ref.",
    compatLabel: "Kompatibel",
    emplacLabel: "Standort",
    minStockLabel: "Mindestbestand",
    categoryLabel: "Kategorie",
    availableStock: "Verfügbar",
    reservedStock: "Reserviert",
    clientsTitle: "Kunden",
    addClient: "+ Kunde",
    iceLabel: "Steuer-ID",
    limiteLabel: "Kreditlimit",
    encoursLabel: "Ausstehend",
    encaissLabel: "Eingänge",
    paymentStatus: "Zahlung",
    totalHT: "Gesamt HT", discountLabel: "Rabatt",
    tvaAmt: "MwSt (20%)",
    totalTTC: "Gesamt TTC",
    docHistory: "Dokumente",
    alertRestock: "Nachbestellungsalarme",
    exportPDFBtn: "PDF herunterladen",
    savedDocs: "Gespeicherte Dokumente",
    validityLabel: "Gültig bis",
    montantHT: "HT-Betrag",
    loadBtn: "Laden",
    devInfo: "📄 Angebot — Bestand nicht abgezogen",
    blInfo: "🚚 Lieferschein ans Lager gesendet - Bestand beim Versand aktualisiert",
    bcInfo: "📋 Bestellung",
    factInfo: "💳 Rechnung — Bestand bei Validierung abgezogen",
    chooseClient: "👤 Kunden wählen",
    chooseSupplier: "👤 Lieferanten wählen",
    selectClient: "👤 Kunden auswählen",
    factOrig: "Urspr. Rechnung",
    paymentCheque: "Scheck",
    paymentCash: "Bar",
    paymentTransfer: "Überweisung",
    paymentEffet: "Wechsel",
    timbreFiscal: "Stempelsteuer",
    acompte: "Anzahlung",
    acompteVerse: "Anzahlung geleistet",
    restantDu: "Restbetrag",
    paid: "BEZAHLT",
    importCSV: "📥 CSV importieren",
    stockArticles: "📦 Artikel",
    stockEnStock: "✅ Auf Lager",
    stockCritiques: "⚠️ Kritisch",
    stockValeur: "💰 Lagerwert",
    valeurLabel: "Wert",
    clientNameLabel: "Name *",
    clientAddressLabel: "Adresse",
    clientPhoneLabel: "Telefon",
    clientEmailLabel: "E-Mail",
    clientDeleted: "Kunde gelöscht",
    stageNew: "Neu",
    stageQualified: "Qualifiziert",
    stageSent: "Angebot Gesendet",
    stageNegotiation: "Verhandlung",
    stageWon: "Gewonnen",
    stageLost: "Verloren",
    analyseFinanciere: "📊 Finanzanalyse Katalog",
    valeurStock: "Lagerwert",
    totalValeurStock: "GESAMTER VERFÜGBARER LAGERWERT",
    derniersDocuments: "💳 Letzte Dokumente",
    noDocRecorded: "Keine Dokumente aufgezeichnet",
    aiQuickAnalyse: "Lageranalyse",
    aiQuickRestock: "Nachbestellungsalarme",
    aiQuickCA: "Umsatz",
    aiQuickPipeline: "CRM Pipeline",
    aiQuickClients: "Kunden",
    contextLabel: "Kontext:",
    docContext: "Dokument:",
    clientContext: "Kunde:",
    montantTTC: "Gesamtbetrag:",
    statusContext: "Status:",
    emailPlaceholder: "Automatisch generierte E-Mail...",
    copyBtn: "📋 Kopieren",
    emailCopied: "E-Mail kopiert!",
    historyCleared: "Verlauf gelöscht",
    noDoc: "Kein Dokument",
    actionsLabel: "Aktionen", traceabilityLabel: "Rückverfolgbarkeit",
    traceDraft: "Entwurf gespeichert — Validierung im Dokument ausstehend",
    traceValidated: "Dokument im Formular validiert",
    traceSent: "Dokument gesendet",
    traceDelivered: "Dokument geliefert",
    tracePaid: "Zahlung erfasst",
    traceReturned: "Dokument zurückgesendet",
    traceCancelled: "Dokument storniert",
    markedSent: "als Gesendet markiert",
    sendBtn: "📤 Senden",
    markedDelivered: "als Geliefert markiert",
    deliverBtn: "📦 Liefern",
    markedPaid: "als Bezahlt markiert",
    payBtn: "✅ Bezahlen",
    returnBtn: "↩️ Zurück",
    markedReturned: "als Zurück markiert — Bestand wieder eingegliedert",
    searchPlaceholder: "🔍 Suche nach Dok-Nr., Kunde, Typ...",
    noResult: "Keine Ergebnisse",
    refPlaceholder: "z.B. PC-020-A-19",
    descPlaceholder: "Bezeichnung...",
    addLogo: "+ Logo",
    companyPlaceholder: "Firmenname",
    addressPlaceholder: "Adresse...",
    phonePlaceholder: "Telefon...",
    clientPlaceholder: "Name und Adresse des Kunden...",
    compatPlaceholder: "Renault / MAN...",
    categoryPlaceholder: "Pumpen, Motoren...",
    supplierPlaceholder: "Lieferant",
    stockInitial: "Anfangsbestand",
    clientNamePlaceholder: "Kundenname",
    clientAddressPlaceholder: "Adresse...",
    clientPhonePlaceholder: "0522...",
    clientEmailPlaceholder: "email@...",
    alertCountSingular: "Lagerbestandsalarm",
    alertCountPlural: "Lagerbestandsalarme",
    generating: "Generiere...",
    refNotFound: "Referenz im Katalog nicht gefunden",
    noItemDoc: "Keine Artikel im Dokument",
    iceRequired: "Kunden-ICE zur Rechnungsvalidierung erforderlich",
    validateFirst: "Dokument zuerst validieren",
    docSaved: "Dokument gespeichert",
    noDocExport: "Kein Dokument zum Exportieren",
    pdfDownloaded: "PDF erfolgreich heruntergeladen",
    pdfError: "Fehler bei der PDF-Generierung",
    docPrinted: "Dokument zum Drucken gesendet",
    catItemDeleted: "Artikel aus dem Katalog entfernt",
    statusDraft: "",
    statusValidated: "Validiert",
    statusSent: "Gesendet",
    statusDelivered: "Geliefert",
    statusPaid: "Bezahlt",
    statusReturned: "Zurückgesendet",
    statusCancelled: "Storniert",
    unknownLabel: "Unbekannt",
    docDevis: "ANGEBOT",
    docBL: "LIEFERSCHEIN",
    docBC: "BESTELLUNG",
    docFact: "RECHNUNG",
    docAvoir: "GUTSCHRIFT",
    docGeneric: "DOKUMENT",
    statusDocumentsTitle: "📋 Dokumentenstatus",
    confirmNewDoc: "Ein Dokument ist in Bearbeitung. Neues Dokument erstellen? Aktuelle Daten gehen verloren.",
    confirmReturn: "Rückgabe bestätigen für",
    confirmReturnStock: "Der Bestand wird wiederhergestellt.",
    ofDocuments: "der Dokumente",
    newProspect: "Neuer Interessent",
    stockInsufficientFormat: "Unzureichender Bestand. Verfügbar: {0}, benötigt: {1}",
    stockInsufficientFor: "Unzureichender Bestand für {0}: {1} verfügbar",
    dispoInfo: "Verfügbar: {0} | {1} | {2}",
    newDocCreatedFormat: "Neues {0} erstellt: {1}",
    stockInsufficientItems: "Unzureichender Bestand für: {0}",
    stockDeductedFormat: "Bestand für {0} Artikel abgezogen",
    stockReintegratedFormat: "Bestand für {0} Artikel wiederhergestellt (Gutschrift)",
    docValidatedFormat: "Dokument {0} validiert und gesperrt",
    convertedToFormat: "Konvertiert zu {0}: {1}",
    docLoadedFormat: "Dokument {0} geladen",
    itemAddedFormat: "Artikel hinzugefügt: {0} ({1} Einheiten)",
    clientAddedFormat: "Kunde {0} hinzugefügt",
    clientInfoFormat: "Kunde: {0}",
    itemsImportedFormat: "{0} Artikel importiert",
    aiAnalyseTitle: "📊 Lageranalyse",
    aiAnalyseBody: "📦 Gesamtbestand: {0} Einheiten\n💰 Wert: {1}\n📋 Referenzen: {2}\n⚠️ Bestandsalarme: {3}\n\n{4}",
    aiRestockTitle: "⚠️ Nachbestellungsalarme",
    aiNoAlerts: "Keine Alarme — alle Bestände ausreichend ✅",
    aiCriticalItem: "• {0} — {1}\n  Bestand: {2} / Min: {3} | Lieferant: {4}",
    aiCaTitle: "💰 Umsatz",
    aiCaBody: "📈 Erzielter Umsatz: {0}\n🎯 Gewichtete Prognose: {1}\n✅ Gewonnene Deals: {2}/{3}\n📉 Conversion-Rate: {4}%",
    aiPipelineTitle: "👥 CRM-Pipeline",
    aiPipelineBody: "📊 Interessenten: {0}\n💰 Gesamtwert: {1}\n🎯 Prognose: {2}\n\n📋 Nach Phase:\n{3}",
    aiClientsTitle: "👤 Kunden",
    aiClientsBody: "📋 Anzahl Kunden: {0}\n{1}",
    aiTopClient: "🏆 Größter Saldo: {0} ({1})",
    aiDefaultTitle: "🤖 IntelSpark ERP-AH Intelligence",
    aiDefaultCmds: "Verfügbare Befehle:\n• \"{0}\" → {1}\n• \"{2}\" → {3}\n• \"{4}\" → {5}\n• \"{6}\" → {7}\n• \"{8}\" → {9}",
    aiCmdAnalyse: "Lageranalyse",
    aiCmdDescAnalyse: "Inventar und Alarme",
    aiCmdRestock: "Nachbestellungsalarme",
    aiCmdDescRestock: "kritische Artikel",
    aiCmdCA: "Umsatz",
    aiCmdDescCA: "Umsatz und Prognosen",
    aiCmdPipeline: "CRM-Pipeline",
    aiCmdDescPipeline: "Interessentenstatus",
    aiCmdClients: "Kunden",
    aiCmdDescClients: "Kundenportfolio",
    aiDefaultFooter: "Aktueller Bestand: {0} Einheiten | Umsatz: {1}",
    emailSubject: "Betreff: {0} N°{1}",
    emailGreeting: "Sehr geehrte Damen und Herren,",
    emailAttach: "Anbei finden Sie das {0} N°{1}.",
    emailDetail: "Einzelheiten:",
    emailLine: "• {0} — {1} x{2} = {3} HT",
    emailTvaLine: "MwSt {0}% : {1}",
    emailTotalHT: "Gesamt HT: {0}",
    emailTimbre: "Stempelsteuer: {0}",
    emailTotalTTC: "Gesamt TTC: {0}",
    emailAcompte: "Anzahlung: {0}\nRestbetrag: {1}",
    emailPayment: "Zahlungsmethode: {0}",
    emailDue: "Fälligkeitsdatum: {0}",
    emailClosing: "Mit freundlichen Grüßen,",
    emailCompanyFallback: "Unser Unternehmen",
    emailItemHT: "HT",
    itemDeletedFormat: "Artikel entfernt: {0}",
    stockRestoredFormat: "Bestand wiederhergestellt: +{0}",
    logDelete: "Löschen x{0}",
    logDocValidated: "Dokument validiert: {0}",
    logConversion: "Konvertierung → {0}: {1}",
    logSave: "Speichern: {0}",
    logPdfDownload: "PDF heruntergeladen: {0}.pdf",
    logPrint: "Drucken",
    logCatalogAdd: "Katalog Hinzufügen",
    logAdd: "Hinzufügen x{0}",
    manualItem: "Manueller Artikel",
    phoneLabel: "Tel",
    aiCriticalTitle: "Kritische Artikel:",
    supplierLabel: "Lieferant",
    bulletinTitle: "Gehaltsabrechnungen",
    bulletinNoEmployees: "Kein Mitarbeiter gefunden",
    bulletinNoEmployeesDesc: "Gehaltsabrechnungen erfordern Mitarbeiterdaten aus HR → Admin & Gehalt → Mitarbeiterakten.",
    bulletinPeriodMonth: "Monat",
    bulletinPeriodYear: "Jahr",
    bulletinSearchPlaceholder: "Name, ID, Position...",
    bulletinGenerate: "Monatliche Gehaltsabrechnungen erstellen",
    bulletinDownloadAll: "Alle PDFs herunterladen",
    bulletinColSalarie: "Mitarbeiter",
    bulletinColPeriode: "Zeitraum",
    bulletinColBrut: "Bruttogehalt",
    bulletinColNet: "Nettolohn",
    bulletinColPdf: "PDF-Dokument",
    bulletinColStatus: "Status",
    bulletinStatusGenerated: "Erstellt",
    bulletinMasseTotale: "Gesamte monatliche Lohnsumme",
    bulletinTotalRetenues: "Sozialversicherung: -{0} · AMO: -{1} · Lohnsteuer: -{2}",
    bulletinNoBulletin: "Noch keine Gehaltsabrechnung erstellt",
    bulletinHint: "Wählen Sie einen Zeitraum und klicken Sie auf Gehaltsabrechnungen erstellen",
    bulletinEmpty: "Kein Mitarbeiter mit definiertem Gehalt",
  },
  ZH: {
    docTab: "报价单", BLTab: "交货单", BCTab: "采购订单", avoirTab: "贷项通知单",
    factTab: "发票", refTab: "目录", stockTab: "库存", pipelineTab: "客户管理",
    statsTab: "报表", iaTab: "人工智能", histTab: "历史记录", clientsTab: "客户", statusTab: "状态",
    activeDoc: "文档:", exportBtn: "导出", saveBtn: "保存",
    refLabel: "参考号", descLabel: "名称", priceLabel: "单价", qtyLabel: "数量", addBtn: "添加", itemFieldsRequired: "添加前请填写参考号、名称、数量和价格。",
    fournisseur: "供应商", dateEntree: "入库",
    currencyLabel: "货币", regionLabel: "地区", translationLabel: "语言",
    destinatary: "客户信息", representative: "代表", vRef: "贵方编号", dateDoc: "日期",
    totalTva: "增值税 20%:", netToPay: "应付总额:",
    catalogTitle: "目录", stockTitle: "库存", crmTitle: "客户管理管道",
    addProspect: "+ 潜在客户", clientAccount: "客户", valEst: "价值", stage: "阶段", prob: "概率",
    historyTitle: "历史记录", clearLog: "清除", colTime: "时间", colRef: "相关项目", colDesc: "上下文", colAction: "已执行操作",
    submit: "分析",
    kpiCa: "收入", kpiGoal: "目标", kpiSig: "转化率", kpiVol: "数量",
    crmForecast: "预测",
    iaTitle: "智能助手", emailTitle: "邮件助手", emailBtn: "撰写",
    exportPDF: "PDF", exportWord: "Word", print: "打印",
    deleteLogo: "删除标志", fontSettings: "显示",
    fontSizeLabel: "字号", fontFamilyLabel: "字体", fontColorLabel: "文字颜色",
    stockPrice: "单价", stockValue: "库存价值", addCatalogBtn: "添加到目录",
    paymentMethod: "付款方式", dueDate: "到期日", tvaLabel: "增值税 20%",
    totalBrut: "总计 HT:", baseHt: "基数", footerLabel: "法律声明",
    aiWelcome: "等待指令...", aiPlaceholder: "请提问...",
    aiStock: "库存分析", aiCA: "收入", aiPipeline: "客户管理管道",
    stockError: "库存不足！可用: ",
    stockSuccess: "已添加商品",
    stockWarning: "添加后库存偏低",
    ttcLabel: "总价 TTC:",
    statusLabel: "状态",
    docNum: "文档编号",
    docType: "类型",
    docDate: "日期",
    validateDoc: "验证",
    lockMsg: "文档已锁定 — 验证后不可修改",
    newDoc: "新建",
    convertToBL: "→ 交货单",
    convertToFact: "→ 发票",
    convertToAvoir: "→ 贷项",
    oemLabel: "OEM编号",
    compatLabel: "兼容",
    emplacLabel: "位置",
    minStockLabel: "最低库存",
    categoryLabel: "类别",
    availableStock: "可用",
    reservedStock: "已预留",
    clientsTitle: "客户",
    addClient: "+ 客户",
    iceLabel: "税号",
    limiteLabel: "信用额度",
    encoursLabel: "未结",
    encaissLabel: "收款",
    paymentStatus: "付款",
    totalHT: "净总额", discountLabel: "折扣",
    tvaAmt: "增值税 (20%)",
    totalTTC: "含税总额",
    docHistory: "文档",
    alertRestock: "补货提醒",
    exportPDFBtn: "下载PDF",
    savedDocs: "已保存文档",
    validityLabel: "有效期至",
    montantHT: "净额",
    loadBtn: "加载",
    devInfo: "📄 报价单 — 不扣库存",
    blInfo: "🚚 交货单已发送至仓库 - 发货时更新库存",
    bcInfo: "📋 采购订单",
    factInfo: "💳 发票 — 验证时扣库存",
    chooseClient: "👤 选择客户",
    chooseSupplier: "👤 选择供应商",
    selectClient: "👤 选择一个客户",
    factOrig: "原始发票",
    paymentCheque: "支票",
    paymentCash: "现金",
    paymentTransfer: "转账",
    paymentEffet: "汇票",
    timbreFiscal: "印花税",
    acompte: "预付款",
    acompteVerse: "已付预付款",
    restantDu: "剩余应付款",
    paid: "已付款",
    importCSV: "📥 导入CSV",
    stockArticles: "📦 物品",
    stockEnStock: "✅ 有库存",
    stockCritiques: "⚠️ 临界",
    stockValeur: "💰 库存价值",
    valeurLabel: "价值",
    clientNameLabel: "名称 *",
    clientAddressLabel: "地址",
    clientPhoneLabel: "电话",
    clientEmailLabel: "邮箱",
    clientDeleted: "客户已删除",
    stageNew: "新建",
    stageQualified: "已合格",
    stageSent: "已发送报价",
    stageNegotiation: "谈判中",
    stageWon: "已赢得",
    stageLost: "已丢失",
    analyseFinanciere: "📊 目录财务分析",
    valeurStock: "库存价值",
    totalValeurStock: "可用库存总价值",
    derniersDocuments: "💳 最近文档",
    noDocRecorded: "无记录文档",
    aiQuickAnalyse: "库存分析",
    aiQuickRestock: "补货提醒",
    aiQuickCA: "收入",
    aiQuickPipeline: "客户管理管道",
    aiQuickClients: "客户",
    contextLabel: "上下文：",
    docContext: "文档：",
    clientContext: "客户：",
    montantTTC: "含税总额：",
    statusContext: "状态：",
    emailPlaceholder: "自动生成的邮件...",
    copyBtn: "📋 复制",
    emailCopied: "邮件已复制！",
    historyCleared: "历史已清除",
    noDoc: "无文档",
    actionsLabel: "操作", traceabilityLabel: "可追溯性",
    traceDraft: "草稿已保存 — 等待在文档中验证",
    traceValidated: "文档已在表单中验证",
    traceSent: "文档已发送",
    traceDelivered: "文档已交付",
    tracePaid: "付款已登记",
    traceReturned: "文档已退回",
    traceCancelled: "文档已取消",
    markedSent: "已标记为已发送",
    sendBtn: "📤 发送",
    markedDelivered: "已标记为已交货",
    deliverBtn: "📦 交货",
    markedPaid: "已标记为已付款",
    payBtn: "✅ 付款",
    returnBtn: "↩️ 退货",
    markedReturned: "已标记为退货 — 库存已恢复",
    searchPlaceholder: "🔍 按文档号、客户、类型搜索...",
    noResult: "无结果",
    refPlaceholder: "例如: PC-020-A-19",
    descPlaceholder: "名称...",
    addLogo: "+ 标志",
    companyPlaceholder: "公司名称",
    addressPlaceholder: "地址...",
    phonePlaceholder: "电话...",
    clientPlaceholder: "客户名称和地址...",
    compatPlaceholder: "Renault / MAN...",
    categoryPlaceholder: "泵、电机...",
    supplierPlaceholder: "供应商",
    stockInitial: "初始库存",
    clientNamePlaceholder: "客户名称",
    clientAddressPlaceholder: "地址...",
    clientPhonePlaceholder: "0522...",
    clientEmailPlaceholder: "email@...",
    alertCountSingular: "库存警报",
    alertCountPlural: "库存警报",
    generating: "生成中...",
    refNotFound: "目录中未找到参考",
    noItemDoc: "文档中没有商品",
    iceRequired: "验证发票需要客户ICE",
    validateFirst: "请先验证文档",
    docSaved: "文档已保存",
    noDocExport: "没有可导出的文档",
    pdfDownloaded: "PDF下载成功",
    pdfError: "生成PDF时出错",
    docPrinted: "文档已发送打印",
    catItemDeleted: "已从目录中删除商品",
    statusDraft: "",
    statusValidated: "已验证",
    statusSent: "已发送",
    statusDelivered: "已交付",
    statusPaid: "已付款",
    statusReturned: "已退回",
    statusCancelled: "已取消",
    unknownLabel: "未知",
    docDevis: "报价单",
    docBL: "交货单",
    docBC: "采购订单",
    docFact: "发票",
    docAvoir: "贷项通知单",
    docGeneric: "文档",
    statusDocumentsTitle: "📋 文档状态",
    confirmNewDoc: "文档正在进行中。创建新文档？当前数据将丢失。",
    confirmReturn: "确认退回",
    confirmReturnStock: "库存将恢复。",
    ofDocuments: "的文档",
    newProspect: "新潜在客户",
    stockInsufficientFormat: "库存不足。可用: {0}，需求: {1}",
    stockInsufficientFor: "{0} 库存不足: 可用 {1}",
    dispoInfo: "可用: {0} | {1} | {2}",
    newDocCreatedFormat: "新{0}已创建: {1}",
    stockInsufficientItems: "以下项目库存不足: {0}",
    stockDeductedFormat: "已扣除 {0} 件商品的库存",
    stockReintegratedFormat: "已恢复 {0} 件商品的库存 (贷项通知单)",
    docValidatedFormat: "文档 {0} 已验证并锁定",
    convertedToFormat: "已转换为 {0}: {1}",
    docLoadedFormat: "文档 {0} 已加载",
    itemAddedFormat: "已添加商品: {0} ({1} 件)",
    clientAddedFormat: "客户 {0} 已添加",
    clientInfoFormat: "客户: {0}",
    itemsImportedFormat: "已导入 {0} 件商品",
    aiAnalyseTitle: "📊 库存分析",
    aiAnalyseBody: "📦 总库存: {0} 件\n💰 价值: {1}\n📋 参考号: {2}\n⚠️ 库存警报: {3}\n\n{4}",
    aiRestockTitle: "⚠️ 补货警报",
    aiNoAlerts: "无警报 — 所有库存充足 ✅",
    aiCriticalItem: "• {0} — {1}\n  库存: {2} / 最低: {3} | 供应商: {4}",
    aiCaTitle: "💰 营业额",
    aiCaBody: "📈 实现营业额: {0}\n🎯 加权预测: {1}\n✅ 赢单: {2}/{3}\n📉 转化率: {4}%",
    aiPipelineTitle: "👥 客户管理管道",
    aiPipelineBody: "📊 潜在客户: {0}\n💰 总价值: {1}\n🎯 预测: {2}\n\n📋 按阶段:\n{3}",
    aiClientsTitle: "👤 客户",
    aiClientsBody: "📋 客户数量: {0}\n{1}",
    aiTopClient: "🏆 最大余额: {0} ({1})",
    aiDefaultTitle: "🤖 IntelSpark ERP-AH Intelligence",
    aiDefaultCmds: "可用命令:\n• \"{0}\" → {1}\n• \"{2}\" → {3}\n• \"{4}\" → {5}\n• \"{6}\" → {7}\n• \"{8}\" → {9}",
    aiCmdAnalyse: "库存分析",
    aiCmdDescAnalyse: "库存和警报",
    aiCmdRestock: "补货警报",
    aiCmdDescRestock: "关键商品",
    aiCmdCA: "营业额",
    aiCmdDescCA: "营业额和预测",
    aiCmdPipeline: "客户管理管道",
    aiCmdDescPipeline: "潜在客户状态",
    aiCmdClients: "客户",
    aiCmdDescClients: "客户组合",
    aiDefaultFooter: "当前库存: {0} 件 | 营业额: {1}",
    emailSubject: "主题: {0} 编号{1}",
    emailGreeting: "您好，",
    emailAttach: "请查收附件 {0} 编号{1}。",
    emailDetail: "详情:",
    emailLine: "• {0} — {1} x{2} = {3} 不含税",
    emailTvaLine: "增值税 {0}% : {1}",
    emailTotalHT: "不含税总额: {0}",
    emailTimbre: "印花税: {0}",
    emailTotalTTC: "含税总额: {0}",
    emailAcompte: "已付定金: {0}\n应付余额: {1}",
    emailPayment: "付款方式: {0}",
    emailDue: "到期日: {0}",
    emailClosing: "此致,",
    emailCompanyFallback: "本公司",
    emailItemHT: "不含税",
    itemDeletedFormat: "已删除商品: {0}",
    stockRestoredFormat: "库存已恢复: +{0}",
    logDelete: "删除 x{0}",
    logDocValidated: "文档已验证: {0}",
    logConversion: "转换 → {0}: {1}",
    logSave: "保存: {0}",
    logPdfDownload: "PDF已下载: {0}.pdf",
    logPrint: "打印",
    logCatalogAdd: "目录添加",
    logAdd: "添加 x{0}",
    manualItem: "手动商品",
    phoneLabel: "电话",
    aiCriticalTitle: "关键商品:",
    supplierLabel: "供应商",
    bulletinTitle: "工资单",
    bulletinNoEmployees: "未找到员工",
    bulletinNoEmployeesDesc: "工资单需要HR → 管理和薪资 → 员工档案中创建的员工记录。",
    bulletinPeriodMonth: "月",
    bulletinPeriodYear: "年",
    bulletinSearchPlaceholder: "姓名、工号、职位...",
    bulletinGenerate: "生成本月工资单",
    bulletinDownloadAll: "下载所有PDF",
    bulletinColSalarie: "员工",
    bulletinColPeriode: "期间",
    bulletinColBrut: "应发工资",
    bulletinColNet: "实发工资",
    bulletinColPdf: "PDF文档",
    bulletinColStatus: "状态",
    bulletinStatusGenerated: "已生成",
    bulletinMasseTotale: "本月工资总额",
    bulletinTotalRetenues: "社保: -{0} · 医保: -{1} · 个税: -{2}",
    bulletinNoBulletin: "暂无工资单",
    bulletinHint: "选择期间然后点击生成本月工资单",
    bulletinEmpty: "无定义工资的员工",
  },
};

// ============================================================
// LOCAL STORAGE HELPERS
// ============================================================
const ls = {
  get: (key, def) => { try { const v = localStorage.getItem(key); return v !== null ? v : def; } catch { return def; } },
  getJSON: (key, def) => { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; } },
  set: (key, val) => { try { localStorage.setItem(key, val); } catch {} },
  setJSON: (key, val) => { try { localStorage.setItem(key, JSON.stringify(val)); } catch {} },
};

const restoreTypographyBeforeAurora = () => {
  const auroraApplied = ls.get('is_aurora_typography_v2', '0') === '1'
    || ls.get('is_aurora_typography_v1', '0') === '1';
  if (!auroraApplied) return;
  ls.set('is_font_family', 'Arial, sans-serif');
  ls.set('is_font_color', '#171717');
  ls.setJSON('hz_settings_visual', {
    ...ls.getJSON('hz_settings_visual', {}),
    fontFamily: 'Arial',
    textColor: '#171717',
  });
  try {
    localStorage.removeItem('is_aurora_typography_v1');
    localStorage.removeItem('is_aurora_typography_v2');
  } catch {}
};

restoreTypographyBeforeAurora();

// ============================================================
// AUTO-NUMBERING
// ============================================================
const peekNextDocNumber = (type) => {
  const key = `is_counter_${type}`;
  const stored = parseInt(ls.get(key, '0'), 10);
  const current = Number.isFinite(stored) && stored >= 0 ? stored : 0;
  const next = current + 1;
  const year = new Date().getFullYear();
  const pad = String(next).padStart(4, '0');
  return `${type}-${year}-${pad}`;
};
const commitDocNumber = (type) => {
  const key = `is_counter_${type}`;
  const stored = parseInt(ls.get(key, '0'), 10);
  const current = Number.isFinite(stored) && stored >= 0 ? stored : 0;
  ls.set(key, String(current + 1));
};

// ============================================================
// NOTIFICATION
// ============================================================
const Notification = ({ msg, type, title, action, secondaryAction, onClose }) => {
  useEffect(() => {
    if (!msg) return undefined;
    const timer = setTimeout(onClose, ['Échéancier', 'Nouvel email reçu'].includes(title) ? 12000 : 3500);
    return () => clearTimeout(timer);
  }, [msg, title, onClose]);
  if (!msg) return null;
  const labels = { success: 'Opération réussie', error: 'Action impossible', warning: 'Attention', info: 'Information' };
  const openAction = () => { if (action) { action.onClick?.(); onClose(); } };
  return (
    <div className={`no-print app-toast app-toast-${type || 'info'} ${action ? 'app-toast-clickable' : ''}`} role="status" aria-live="polite"
      tabIndex={action ? 0 : undefined} onClick={openAction}
      onKeyDown={event => { if (action && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); openAction(); } }}>
      <span className="app-toast-mark" />
      <div><strong>{title || labels[type] || labels.info}</strong><span>{msg}</span>{secondaryAction && <button className="app-toast-action app-toast-seen" type="button" onClick={event => { event.stopPropagation(); secondaryAction.onClick?.(); onClose(); }}>{secondaryAction.label}</button>}</div>
      <button onClick={event => { event.stopPropagation(); onClose(); }} aria-label="Fermer">×</button>
    </div>
  );
};

// ============================================================
// STATUS BADGE
// ============================================================
const StatusBadge = ({ status, t }) => {
  const s = DOC_STATUSES[status] || DOC_STATUSES.draft;
  const label = t[s.labelKey];
  if (!label) return null;
  return (
    <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}40`, borderRadius: 20, padding: '3px 10px', fontSize: 11, fontWeight: 800 }}>
      {label}
    </span>
  );
};

const fmt = (str, ...args) => str.replace(/{(\d+)}/g, (_, i) => args[i] != null ? args[i] : '');

// ============================================================
// MOTEUR PAIE BULLETINS
// ============================================================
const PAYROLL = {
  cnss: (b) => Math.min(b, 6000) * 0.0448,
  amo:  (b) => b * 0.0226,
  ir:   (imp) => {
    if (imp <= 2500) return 0;
    if (imp <= 4166.67) return (imp - 2500) * 0.10;
    if (imp <= 5000)   return 166.67 + (imp - 4166.67) * 0.20;
    return 333.33 + (imp - 5000) * 0.30;
  },
};
const calcNet = (b) => {
  const cnss = PAYROLL.cnss(b), amo = PAYROLL.amo(b);
  const imp = Math.max(0, b - cnss - amo);
  const ir = PAYROLL.ir(imp);
  return { brut: b, cnss, amo, ir, net: b - cnss - amo - ir };
};
const fmtMoney = (n) => Number(n || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const loadEmployees = () => {
  const keys = ['is_employees', 'is_dossiers_salaries', 'is_paie_employees', 'is_dossiers', 'rh_employees', 'is_staff'];
  for (const k of keys) {
    const d = ls.getJSON(k, null);
    if (Array.isArray(d) && d.length > 0) return d;
  }
  return [];
};

const generateBulletinPDF = async (b, companyInfo) => {
  try {
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF('p', 'mm', 'a4');
    const W = pdf.internal.pageSize.getWidth();
    pdf.setFillColor(13, 148, 136);
    pdf.rect(0, 0, W, 32, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(20);
    pdf.text('BULLETIN DE PAIE', W / 2, 16, { align: 'center' });
    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'normal');
    pdf.text(`Période : ${b.periodLabel}`, W / 2, 24, { align: 'center' });
    pdf.setTextColor(40, 40, 40);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text(companyInfo.name, 15, 44);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    if (companyInfo.address) pdf.text(companyInfo.address, 15, 50);
    if (companyInfo.phone) pdf.text(`Tél : ${companyInfo.phone}`, 15, 55);
    if (companyInfo.email) pdf.text(`Email : ${companyInfo.email}`, 15, 60);
    pdf.setFontSize(10);
    pdf.setFont('helvetica', 'bold');
    pdf.text('SALARIÉ', W - 15, 44, { align: 'right' });
    pdf.setFont('helvetica', 'normal');
    pdf.text(`${b.prenom} ${b.nom}`, W - 15, 50, { align: 'right' });
    pdf.text(`Matricule : ${b.matricule}`, W - 15, 55, { align: 'right' });
    pdf.text(`Poste : ${b.poste}`, W - 15, 60, { align: 'right' });
    pdf.text(`CNSS : ${b.cnss}`, W - 15, 65, { align: 'right' });
    pdf.text(`CIN : ${b.cin}`, W - 15, 70, { align: 'right' });
    if (b.dateEmbauche) pdf.text(`Embauché le : ${b.dateEmbauche}`, W - 15, 75, { align: 'right' });
    pdf.setDrawColor(200);
    pdf.line(15, 85, W - 15, 85);
    pdf.setFillColor(241, 245, 249);
    pdf.rect(15, 90, W - 30, 9, 'F');
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.setTextColor(40);
    pdf.text('LIBELLÉ', 20, 96);
    pdf.text('BASE / GAINS', W / 2 + 5, 96, { align: 'right' });
    pdf.text('RETENUES', W - 20, 96, { align: 'right' });
    const rows = [
      ['Salaire de base', fmtMoney(b.brut), ''],
      ['CNSS (4,48%)', '', `-${fmtMoney(b.cnss)}`],
      ['AMO (2,26%)', '', `-${fmtMoney(b.amo)}`],
      ['Impôt sur le Revenu (IR)', '', `-${fmtMoney(b.ir)}`],
    ];
    pdf.setFont('helvetica', 'normal');
    let y = 106;
    rows.forEach(([lib, gain, ret]) => {
      pdf.text(lib, 20, y);
      if (gain) pdf.text(gain, W / 2 + 5, y, { align: 'right' });
      if (ret) pdf.text(ret, W - 20, y, { align: 'right' });
      pdf.setDrawColor(230);
      pdf.line(15, y + 2, W - 15, y + 2);
      y += 8;
    });
    y += 4;
    pdf.setFont('helvetica', 'bold');
    pdf.text('SALAIRE BRUT', 20, y);
    pdf.text(`${fmtMoney(b.brut)} MAD`, W - 20, y, { align: 'right' });
    pdf.line(15, y + 2, W - 15, y + 2);
    y += 10;
    pdf.text('TOTAL RETENUES', 20, y);
    pdf.text(`-${fmtMoney(b.cnss + b.amo + b.ir)} MAD`, W - 20, y, { align: 'right' });
    pdf.line(15, y + 2, W - 15, y + 2);
    y += 14;
    pdf.setFillColor(13, 148, 136);
    pdf.rect(15, y, W - 30, 18, 'F');
    pdf.setTextColor(255, 255, 255);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(13);
    pdf.text('NET À PAYER', 20, y + 11);
    pdf.setFontSize(16);
    pdf.text(`${fmtMoney(b.net)} MAD`, W - 20, y + 11, { align: 'right' });
    pdf.setTextColor(120);
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'italic');
    pdf.text(`Mode de paiement : ${b.modePaiement}`, 15, 275);
    if (b.iban && b.iban !== '—') pdf.text(`IBAN : ${b.iban}`, 15, 280);
    pdf.text(`Document généré le ${b.generatedAt}`, 15, 287);
    pdf.text('Ce bulletin est un document confidentiel.', W - 15, 287, { align: 'right' });
    pdf.save(`Bulletin_${b.matricule}_${b.periodLabel.replace(' ', '_')}.pdf`);
  } catch (e) {
    console.error(e);
    alert('Erreur PDF : ' + e.message);
  }
};

import { api, getAuthToken } from './api';

// ============================================================
// BULLETINS DE PAIE — COMPOSANT INTÉGRÉ
// ============================================================
const BulletinsPage = ({ t, language }) => {
  const today = new Date();
  const MONTHS = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];
  const [periodMonth, setPeriodMonth] = useState(today.getMonth());
  const [periodYear, setPeriodYear] = useState(today.getFullYear());
  const [employees, setEmployees] = useState([]);
  const [bulletins, setBulletins] = useState([]);
  const [generating, setGenerating] = useState(false);
  const [search, setSearch] = useState('');
  const [showEmptyMsg, setShowEmptyMsg] = useState(false);

  const companyInfo = {
    name: ls.get('is_company_name', 'IntelSheets SARL'),
    address: ls.get('is_company_address', ''),
    phone: ls.get('is_company_phone', ''),
    email: ls.get('is_company_email', ''),
  };

  useEffect(() => {
    api.getEmployes('').then(data => setEmployees(data || [])).catch(() => setEmployees([]));
  }, []);

  const handleGenerate = () => {
    if (employees.length === 0) return;
    setGenerating(true);
    setTimeout(() => {
      const generated = employees
        .filter(emp => Number(emp.salaire_base || 0) > 0)
        .map((emp, idx) => {
          const brut = Number(emp.salaire_base || 0);
          return {
            id: `${emp.id || emp.matricule || idx}-${periodYear}-${periodMonth}`,
            matricule: emp.matricule || emp.id || `EMP-${String(idx + 1).padStart(4, '0')}`,
            nom: (emp.nom || '').toUpperCase(),
            prenom: emp.prenom || '',
            poste: emp.poste || emp.fonction || '—',
            departement: emp.departement || '—',
            cnss: emp.cnss || emp.numeroCNSS || '—',
            cin: emp.cin || '—',
            dateEmbauche: emp.dateEmbauche || '',
            iban: emp.iban || '—',
            modePaiement: emp.modePaiement || 'Virement bancaire',
            ...calcNet(brut),
            periodMonth, periodYear,
            periodLabel: `${MONTHS[periodMonth]} ${periodYear}`,
            generatedAt: new Date().toLocaleString('fr-FR'),
          };
        });
      if (generated.length === 0) setShowEmptyMsg(true);
      else { setShowEmptyMsg(false); setBulletins(generated); }
      setGenerating(false);
    }, 500);
  };

  const totals = useMemo(() => bulletins.reduce((acc, b) => ({
    brut: acc.brut + b.brut, cnss: acc.cnss + b.cnss,
    amo: acc.amo + b.amo, ir: acc.ir + b.ir, net: acc.net + b.net,
  }), { brut: 0, cnss: 0, amo: 0, ir: 0, net: 0 }), [bulletins]);

  const filtered = useMemo(() => {
    if (!search.trim()) return bulletins;
    const q = search.toLowerCase();
    return bulletins.filter(b =>
      b.nom.toLowerCase().includes(q) || b.prenom.toLowerCase().includes(q) ||
      b.matricule.toLowerCase().includes(q) || b.poste.toLowerCase().includes(q));
  }, [bulletins, search]);

  const card = { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' };
  const labelStyle = { display: 'block', fontSize: 11, fontWeight: 800, color: '#475569', marginBottom: 6, textTransform: 'uppercase' };
  const inputStyle = { padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: 10, fontSize: 13, background: '#fff', outline: 'none', fontFamily: 'inherit', color: '#1e293b' };
  const btnBlue = { padding: '11px 22px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(59,130,246,0.3)' };
  const btnGreen = { padding: '11px 22px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 10, fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(16,185,129,0.3)' };

  if (employees.length === 0) {
    return (
      <div style={{ padding: 4 }}>
        <div style={card}>
          <div style={{ textAlign: 'center', padding: '50px 20px' }}>
            <div style={{ fontSize: 56, marginBottom: 14 }}>👥</div>
            <div style={{ fontWeight: 900, fontSize: 18, color: '#475569', marginBottom: 10 }}>{t.bulletinNoEmployees}</div>
            <div style={{ color: '#64748b', fontSize: 13, maxWidth: 520, margin: '0 auto', lineHeight: 1.6 }}>{t.bulletinNoEmployeesDesc}</div>
            <div style={{ marginTop: 22, padding: '14px 18px', background: '#f0fdf9', border: '1px solid #99f6e4', borderRadius: 10, fontSize: 12, color: '#0f766e', display: 'inline-block' }}>
              💡 Créez d'abord les fiches salariés dans RH → Admin & Paie → Dossiers Salariés
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 4 }}>
      <div>
        <h2 style={{ fontSize: 20, fontWeight: 900, color: '#1e293b', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          📄 {t.bulletinTitle}
        </h2>
        <p style={{ color: '#94a3b8', fontSize: 13, margin: '4px 0 0 0' }}>
          {employees.length} salarié(s) enregistré(s)
          {bulletins.length > 0 && <> · <strong style={{ color: '#10b981' }}>{bulletins.length} bulletin(s) généré(s)</strong> pour {`${MONTHS[periodMonth]} ${periodYear}`}</>}
        </p>
      </div>

      <div style={{ ...card, display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <label style={labelStyle}>📅 {t.bulletinPeriodMonth}</label>
          <select value={periodMonth} onChange={e => setPeriodMonth(Number(e.target.value))} style={{ ...inputStyle, minWidth: 160 }}>
            {MONTHS.map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
        </div>
        <div>
          <label style={labelStyle}>📅 {t.bulletinPeriodYear}</label>
          <select value={periodYear} onChange={e => setPeriodYear(Number(e.target.value))} style={{ ...inputStyle, minWidth: 110 }}>
            {Array.from({ length: 8 }, (_, i) => today.getFullYear() - 3 + i).map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1, minWidth: 160 }}>
          <label style={labelStyle}>🔍 Rechercher</label>
          <input type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={t.bulletinSearchPlaceholder} style={{ ...inputStyle, width: '100%' }} />
        </div>
        <button onClick={handleGenerate} disabled={generating} style={{ ...btnBlue, cursor: generating ? 'wait' : 'pointer', opacity: generating ? 0.7 : 1 }}>
          {generating ? '⏳ Génération...' : '🧾 ' + t.bulletinGenerate}
        </button>
        {bulletins.length > 0 && (
          <button onClick={() => bulletins.forEach((b, i) => setTimeout(() => generateBulletinPDF(b, companyInfo), i * 250))} style={btnGreen}>
            📥 {t.bulletinDownloadAll}
          </button>
        )}
      </div>

      {showEmptyMsg && (
        <div style={{ ...card, padding: 30, textAlign: 'center', background: '#fff7ed', border: '1px solid #fb923c' }}>
          <div style={{ color: '#9a3412', fontWeight: 700 }}>⚠️ {t.bulletinEmpty}</div>
        </div>
      )}

      {bulletins.length > 0 ? (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 800, color: '#475569', fontSize: 11, textTransform: 'uppercase', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>👤 {t.bulletinColSalarie}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'left', fontWeight: 800, color: '#475569', fontSize: 11, textTransform: 'uppercase', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>📅 {t.bulletinColPeriode}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: '#475569', fontSize: 11, textTransform: 'uppercase', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>💰 {t.bulletinColBrut}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: '#475569', fontSize: 11, textTransform: 'uppercase', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>💵 {t.bulletinColNet}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 800, color: '#475569', fontSize: 11, textTransform: 'uppercase', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>📄 {t.bulletinColPdf}</th>
                  <th style={{ padding: '12px 14px', textAlign: 'center', fontWeight: 800, color: '#475569', fontSize: 11, textTransform: 'uppercase', background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>⚡ {t.bulletinColStatus}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b, i) => (
                  <tr key={b.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f0fdf9'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fff' : '#fafbfc'}>
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ fontWeight: 700, color: '#1e293b' }}>{b.prenom} {b.nom}</div>
                      <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{b.matricule} · {b.poste}</div>
                    </td>
                    <td style={{ padding: '12px 14px', color: '#475569', fontWeight: 600 }}>{b.periodLabel}</td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>
                      {fmtMoney(b.brut)} <span style={{ fontSize: 10, color: '#94a3b8' }}>MAD</span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: 800, color: '#10b981', fontSize: 14 }}>
                      {fmtMoney(b.net)} <span style={{ fontSize: 10, color: '#94a3b8' }}>MAD</span>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <button onClick={() => generateBulletinPDF(b, companyInfo)}
                        style={{ padding: '6px 14px', background: '#0d9488', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        📄 PDF
                      </button>
                    </td>
                    <td style={{ padding: '12px 14px', textAlign: 'center' }}>
                      <span style={{ background: '#ecfdf5', color: '#059669', border: '1px solid #6ee7b7', borderRadius: 20, padding: '3px 12px', fontSize: 11, fontWeight: 800 }}>
                        ✓ {t.bulletinStatusGenerated}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: 'linear-gradient(135deg, #0d9488 0%, #14b8a6 100%)' }}>
                  <td colSpan={2} style={{ padding: '16px 14px', fontWeight: 800, color: '#fff', fontSize: 13 }}>
                    💰 {t.bulletinMasseTotale}
                  </td>
                  <td style={{ padding: '16px 14px', textAlign: 'right', fontWeight: 900, color: '#fff', fontSize: 15 }}>
                    {fmtMoney(totals.brut)} <span style={{ fontSize: 10, opacity: 0.8 }}>MAD</span>
                  </td>
                  <td style={{ padding: '16px 14px', textAlign: 'right', fontWeight: 900, color: '#fff', fontSize: 15 }}>
                    {fmtMoney(totals.net)} <span style={{ fontSize: 10, opacity: 0.8 }}>MAD</span>
                  </td>
                  <td colSpan={2} style={{ padding: '16px 14px', textAlign: 'center', color: '#fff', fontSize: 10, fontStyle: 'italic', opacity: 0.9 }}>
                    {fmt(t.bulletinTotalRetenues, fmtMoney(totals.cnss), fmtMoney(totals.amo), fmtMoney(totals.ir))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      ) : (
        <div style={{ ...card, textAlign: 'center', padding: '50px 20px', color: '#94a3b8' }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>📋</div>
          <div style={{ fontWeight: 800, color: '#475569', fontSize: 15 }}>{t.bulletinNoBulletin}</div>
          <div style={{ fontSize: 12, marginTop: 6, maxWidth: 400, margin: '6px auto 0' }}>{t.bulletinHint}</div>
        </div>
      )}
    </div>
  );
};

// ============================================================
// MAIN APP
// ============================================================
export default function App() {
  const { user, loading, logout, saveData, loadData, hasRole } = useAuth();
  const { connect, disconnect, onlineUsers, connected, lastNotification } = useWS();
  const i18n = useAppI18n();
  const canDelete = hasRole('admin');
  const cspNonce = typeof document !== 'undefined'
    ? (document.querySelector('script[nonce]')?.nonce || undefined)
    : undefined;

  useEffect(() => {
    const showClickFeedback = (event) => {
      const element = event.target.closest('button, a, [role="button"], .cd-row');
      if (!element || element.matches(':disabled')) return;
      element.classList.remove('ui-clicked');
      void element.offsetWidth;
      element.classList.add('ui-clicked');
      window.setTimeout(() => element.classList.remove('ui-clicked'), 350);
    };
    document.addEventListener('click', showClickFeedback);
    return () => document.removeEventListener('click', showClickFeedback);
  }, []);

  useEffect(() => {
    if (user) {
      const token = getAuthToken();
      if (token) connect(token);
      if (window.location.hash !== '#app') {
        const appUrl = `${window.location.pathname}${window.location.search}#app`;
        window.history.replaceState(null, '', appUrl);
      }
    } else {
      disconnect();
    }
  }, [user, connect, disconnect]);

  const [activePage, setActivePage] = useState(() => {
    return ls.get('is_active_page', 'home');
  });
  const sessionStateDoc = useUserDoc('ui_session_state', null);
  useEffect(() => {
    if (sessionStateDoc.loaded && sessionStateDoc.data?.activePage) setActivePage(sessionStateDoc.data.activePage);
  }, [sessionStateDoc.loaded]);
  useEffect(() => {
    ls.set('is_active_page', activePage);
    if (sessionStateDoc.loaded) sessionStateDoc.setData(current => ({ ...(current || {}), activePage, updatedAt: new Date().toISOString() }));
  }, [activePage, sessionStateDoc.loaded]);
  const [activeTheme, setActiveTheme] = useState(() => {
    const storedTheme = ls.get('is_theme', 'light');
    return THEMES[storedTheme] ? storedTheme : 'light';
  });
  const { language: contextLanguage } = useLanguage();
  const language = String(contextLanguage || 'fr').toUpperCase();
  const { code: currencyKey, setCode: setCurrencyKey } = useCurrency();
  const [notification, setNotification] = useState({ msg: '', type: 'info', title: '', action: null, secondaryAction: null });
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  const [menuSearch, setMenuSearch] = useState('');
  const [navUsage, setNavUsage] = useState(() => ls.getJSON(`nav_usage_${user?.id || 'anonymous'}`, {}));
  useEffect(() => {
    setNavUsage(ls.getJSON(`nav_usage_${user?.id || 'anonymous'}`, {}));
  }, [user?.id]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerSection, setDrawerSection] = useState('msgs');
  const shownEmailNotification = useRef('');
  const [disabledPages, setDisabledPages] = useState([]);
  const sidebarTimer = useRef(null);
  useEffect(() => () => { if (sidebarTimer.current) clearTimeout(sidebarTimer.current); }, []);
  useEffect(() => {
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setSidebarCollapsed(true);
    };
    window.addEventListener('keydown', closeOnEscape);
    document.body.style.overflow = sidebarCollapsed ? '' : 'hidden';
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      document.body.style.overflow = '';
    };
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!user) return undefined;
    let active = true;
    const applyConfig = (rows) => {
      const disabled = Array.isArray(rows)
        ? rows.find((item) => item.key === 'disabled_pages')?.value
        : [];
      if (active) setDisabledPages(Array.isArray(disabled) ? disabled : []);
    };
    const loadConfig = () => api.getPublicSystemConfig().then(applyConfig).catch(() => {});
    const handleConfig = (event) => {
      if (Array.isArray(event.detail?.disabled_pages)) setDisabledPages(event.detail.disabled_pages);
    };
    loadConfig();
    const timer = window.setInterval(loadConfig, 60_000);
    window.addEventListener('site:config-changed', handleConfig);
    return () => {
      active = false;
      window.clearInterval(timer);
      window.removeEventListener('site:config-changed', handleConfig);
    };
  }, [user]);

  useEffect(() => {
    if (disabledPages.includes(activePage)) setActivePage('home');
  }, [disabledPages, activePage]);

  useEffect(() => {
    if (!user) return;
    const rawRole = String(user.role || '').trim().toLowerCase();
    const roleAliases = { finance: 'financier', magasin: 'magasinier', warehouse: 'magasinier', hr: 'rh', ressources_humaines: 'rh', accounting: 'comptable', technician: 'technicien', sales: 'commercial' };
    const role = roleAliases[rawRole] || rawRole;
    const allowedByRole = {
      rh: ['home', 'rh_admin_paie', 'bulletins', 'temps_absences', 'notes_frais', 'suivi_temps', 'rh_recrutement', 'rh_developpement', 'rh_relations', 'hist', 'saved', 'settings'],
      admin: ['home', 'received_documents', 'chiffrage', 'catalogue', 'stock', 'clients', 'pipeline', 'echeancier',
'reporting', 'hist', 'status', 'saved', 'rh_admin_paie', 'bulletins', 'temps_absences', 'notes_frais', 'suivi_temps', 
'rh_recrutement', 'rh_developpement', 'rh_relations', 'admin_users', 'pcge', 'cpc', 'grand_livre', 'fec_marocain', 
'tva_taxes', 'compta_journaux_achats', 'compta_journaux_ventes', 'compta_journaux_banque', 'compta_journaux_od', 
'compta_journaux_salaires', 'compta_journaux_tva', 'magasin_reception', 
'magasin_preparation', 
'magasin_importation', 'magasin_expedition', 'magasin_gestion', 'settings'],
      commercial: ['home', 'received_documents', 'chiffrage', 'catalogue', 'stock', 'clients', 'pipeline', 'echeancier', 'reporting', 'hist', 'status', 'saved', 'settings'],
      comptable: ['home', 'received_documents', 'echeancier', 'compta_journaux_achats', 'compta_journaux_ventes', 'compta_journaux_banque', 'compta_journaux_od', 'compta_journaux_salaires', 'compta_journaux_tva', 'pcge', 'cpc', 'grand_livre', 'fec_marocain', 'tva_taxes', 'rh_admin_paie', 'bulletins', 'notes_frais', 'hist', 'saved', 'settings'],
      financier: ['home', 'received_documents', 'compta_journaux_achats', 'compta_journaux_ventes', 'compta_journaux_banque', 'compta_journaux_od', 'compta_journaux_salaires', 'compta_journaux_tva', 'reporting_global', 'hist', 'saved', 'settings'],
      magasinier: ['home', 'received_documents', 'magasin_reception', 'magasin_preparation', 
'magasin_importation', 'magasin_expedition', 'magasin_gestion', 'stock', 'hist', 'saved', 'settings'],
      technicien: ['home', 'received_documents', 'vehicules', 'maintenance', 'atelier', 'pneus', 'hist', 'saved', 'settings'],
      employe: ['home', 'received_documents', 'settings'],
    };
    const list = allowedByRole[role] || ['home', 'settings'];
    if (activePage === 'fournisseurs' && ['admin', 'commercial'].includes(role)) {
      setActivePage('clients');
      return;
    }
    if (!list.includes(activePage)) setActivePage(list[0]);
  }, [user?.role, activePage]);

  const [isExporting, setIsExporting] = useState(false);
  const [showClientModal, setShowClientModal] = useState(false);
  const [showDocHistory, setShowDocHistory] = useState(false);
  const [editMode, setEditMode] = useState(false);

  const [globalFontSize, setGlobalFontSize] = useState(() => Number(ls.get('is_font_size', '13')));
  const [globalFontFamily, setGlobalFontFamily] = useState(() => ls.get('is_font_family', 'Arial, sans-serif'));
  const [globalFontColor, setGlobalFontColor] = useState(() => ls.get('is_font_color', '#475569'));

  useEffect(() => {
    const applySettings = event => {
      const { visual, fiscal } = event.detail || {};
      if (visual) {
        setGlobalFontSize(Number(visual.fontSize) || 14);
        setGlobalFontFamily(visual.fontFamily || 'Inter');
        setGlobalFontColor(visual.textColor || '#111827');
      }
      if (fiscal && Number.isFinite(Number(fiscal.tvaRate))) setDocTvaRate(Number(fiscal.tvaRate));
    };
    const applyStoredSettings = event => {
      if (!event.key || event.key === 'is_font_size') setGlobalFontSize(Number(ls.get('is_font_size', '14')) || 14);
      if (!event.key || event.key === 'is_font_family') setGlobalFontFamily(ls.get('is_font_family', 'Inter'));
      if (!event.key || event.key === 'is_font_color') setGlobalFontColor(ls.get('is_font_color', '#111827'));
      if (event.key === 'is_theme' && event.newValue) setActiveTheme(event.newValue);
    };
    window.addEventListener('settings:changed', applySettings);
    window.addEventListener('storage', applyStoredSettings);
    return () => {
      window.removeEventListener('settings:changed', applySettings);
      window.removeEventListener('storage', applyStoredSettings);
    };
  }, []);

  useEffect(() => { ls.set('is_theme', activeTheme); }, [activeTheme]);
  useEffect(() => {
    const onSettings = event => {
      const selectedTheme = event.detail?.theme;
      if (selectedTheme) setActiveTheme(THEMES[selectedTheme] ? selectedTheme : 'light');
    };
    window.addEventListener('settings:changed', onSettings);
    return () => window.removeEventListener('settings:changed', onSettings);
  }, []);
  useEffect(() => { ls.set('is_font_size', String(globalFontSize)); }, [globalFontSize]);
  useEffect(() => { ls.set('is_font_family', globalFontFamily); }, [globalFontFamily]);
  useEffect(() => {
    ls.set('is_font_color', globalFontColor);
    document.documentElement.style.setProperty('--user-text-color', globalFontColor);
  }, [globalFontColor]);
  useEffect(() => {
    document.documentElement.style.setProperty('--user-font-family', globalFontFamily);
    document.documentElement.style.setProperty('--user-font-size', `${globalFontSize}px`);
  }, [globalFontFamily, globalFontSize]);

  const [companyLogo, setCompanyLogo] = useState(() => ls.get('is_logo', null));
  const [companyName, setCompanyName] = useState(() => ls.get('is_company_name', ''));
  const [companyAddress, setCompanyAddress] = useState(() => ls.get('is_company_address', ''));
  const [companyPhone, setCompanyPhone] = useState(() => ls.get('is_company_phone', ''));
  const [companyEmail, setCompanyEmail] = useState(() => ls.get('is_company_email', ''));
  const [companyFooter, setCompanyFooter] = useState(() => ls.get('is_footer', ''));
  const [brands, setBrands] = useState(() => ls.getJSON('is_brands', []));
  useEffect(() => { ls.set('is_company_name', companyName); }, [companyName]);
  useEffect(() => { ls.set('is_company_address', companyAddress); }, [companyAddress]);
  useEffect(() => { ls.set('is_company_phone', companyPhone); }, [companyPhone]);
  useEffect(() => { ls.set('is_company_email', companyEmail); }, [companyEmail]);
  useEffect(() => { ls.set('is_footer', companyFooter); }, [companyFooter]);
  useEffect(() => { ls.setJSON('is_brands', brands); }, [brands]);
  useEffect(() => { if (companyLogo) ls.set('is_logo', companyLogo); else localStorage.removeItem('is_logo'); }, [companyLogo]);

  const [documentType, setDocumentType] = useState(() => ls.get('is_doc_type', 'DEV'));
  const [requestedDocumentType, setRequestedDocumentType] = useState(null);
  const [documentNumber, setDocumentNumber] = useState(() => {
    const saved = ls.get('is_doc_num', '');
    return saved && !saved.includes('NaN') ? saved : peekNextDocNumber(documentType);
  });
  const [documentStatus, setDocumentStatus] = useState(() => ls.get('is_doc_status', 'draft'));
  const [documentDate, setDocumentDate] = useState(() => ls.get('is_doc_date', new Date().toLocaleDateString('fr-FR')));
  const [validityDate, setValidityDate] = useState(() => ls.get('is_validity_date', ''));
  const [clientDetails, setClientDetails] = useState(() => ls.get('is_client', ''));
  const [clientICE, setClientICE] = useState(() => ls.get('is_client_ice', ''));
  const [representative, setRepresentative] = useState(() => ls.get('is_rep', ''));
  const [supplierName, setSupplierName] = useState(() => ls.get('is_supplier', ''));
  const [orderRef, setOrderRef] = useState(() => ls.get('is_order_ref', ''));
  const [sourceDevisNumber, setSourceDevisNumber] = useState(() => ls.get('is_source_devis', ''));
  const [paymentMethod, setPaymentMethod] = useState(() => ls.get('is_payment', 'Virement'));
  const [paymentDueDate, setPaymentDueDate] = useState(() => ls.get('is_due_date', 'À réception'));
  const [paymentPaid, setPaymentPaid] = useState(false);
  const [parentFactRef, setParentFactRef] = useState('');
  const [docTvaRate, setDocTvaRate] = useState(20);
  const [timbreFiscal, setTimbreFiscal] = useState(0);
  const [acompte, setAcompte] = useState(0);

  useEffect(() => { ls.set('is_doc_num', documentNumber); }, [documentNumber]);
  useEffect(() => { ls.set('is_doc_status', documentStatus); }, [documentStatus]);
  useEffect(() => { ls.set('is_doc_date', documentDate); }, [documentDate]);
  useEffect(() => { ls.set('is_validity_date', validityDate); }, [validityDate]);
  useEffect(() => { ls.set('is_client', clientDetails); }, [clientDetails]);
  useEffect(() => { ls.set('is_client_ice', clientICE); }, [clientICE]);
  useEffect(() => { ls.set('is_rep', representative); }, [representative]);
  useEffect(() => { ls.set('is_supplier', supplierName); }, [supplierName]);
  useEffect(() => { ls.set('is_order_ref', orderRef); }, [orderRef]);
  useEffect(() => { ls.set('is_source_devis', sourceDevisNumber); }, [sourceDevisNumber]);
  useEffect(() => { ls.set('is_payment', paymentMethod); }, [paymentMethod]);
  useEffect(() => { ls.set('is_due_date', paymentDueDate); }, [paymentDueDate]);
  useEffect(() => { ls.set('is_parent_fact', parentFactRef); }, [parentFactRef]);

  const isLocked = documentStatus === 'validated' || documentStatus === 'sent' || documentStatus === 'paid' || documentStatus === 'cancelled';
  const stockOptionalForCurrentDocument = ['DEV', 'BC', 'AVOIR'].includes(documentType)
    || (documentType === 'FACT' && Boolean(sourceDevisNumber));

  const [catalog, setCatalog] = useState([]);
  const [items, setItems] = useState(() => ls.getJSON('is_items', []));
  const [leads, setLeads] = useState(() => ls.getJSON('is_leads', [
    { id: 1, client: 'CARRIERE MENARA', value: 4480, stage: 'Négociation', probability: 80, ref: 'REF 35765' },
    { id: 2, client: 'Marjane Holding', value: 1200, stage: 'Devis Envoyé', probability: 50, ref: 'P-102' },
  ]));
  const [clients, setClients] = useState(() => ls.getJSON('is_clients', INITIAL_CLIENTS));
  const audit = useAudit();
  const savedDocs = audit.savedDocs;
  // Pour la compat avec le code commercial existant : on patch directement user_data via fetch.
  const setSavedDocs = useCallback((updater) => {
    audit.setSavedDocs(updater);
  }, [audit]);
  const historyDoc = useUserDoc(`user_history_${user?.id || 'anonymous'}`, []);
  const documentHistory = historyDoc.data || [];
  const setDocumentHistory = historyDoc.setData;
  const [savedSearch, setSavedSearch] = useState('');
  const [isReturning, setIsReturning] = useState(false);
  useEffect(() => {
    if (!user?.id) return undefined;
    let cancelled = false;
    const refreshSharedStock = () => api.getProduits('').then(products => {
      if (!cancelled && Array.isArray(products)) setCatalog(products.map(sharedProductToCatalog));
    }).catch(() => {});
    refreshSharedStock();
    const interval = window.setInterval(refreshSharedStock, 5000);
    window.addEventListener('focus', refreshSharedStock);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener('focus', refreshSharedStock);
    };
  }, [user?.id]);

  useEffect(() => { ls.setJSON('is_catalog', catalog); }, [catalog]);
  useEffect(() => { ls.setJSON('is_items', items); }, [items]);
  useEffect(() => { ls.setJSON('is_leads', leads); }, [leads]);
  useEffect(() => { ls.setJSON('is_clients', clients); }, [clients]);
  useEffect(() => { ls.setJSON('is_history_log', documentHistory); }, [documentHistory]);

  const [searchRef, setSearchRef] = useState('');
  const [manualName, setManualName] = useState('');
  const [manualPrice, setManualPrice] = useState('');
  const [manualQty, setManualQty] = useState('');
  const [catRef, setCatRef] = useState('');
  const [catName, setCatName] = useState('');
  const [catPrice, setCatPrice] = useState('');
  const [catStockQty, setCatStockQty] = useState(10);
  const [catSupplier, setCatSupplier] = useState('');
  const [catOem, setCatOem] = useState('');
  const [catCompat, setCatCompat] = useState('');
  const [catEmplac, setCatEmplac] = useState('');
  const [catMinStock, setCatMinStock] = useState(2);
  const [catCategory, setCatCategory] = useState('');

  const [newClientName, setNewClientName] = useState('');
  const [newClientICE, setNewClientICE] = useState('');
  const [newClientAddress, setNewClientAddress] = useState('');
  const [newClientPhone, setNewClientPhone] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [newClientContact, setNewClientContact] = useState('');
  const [newClientSiret, setNewClientSiret] = useState('');
  const [newClientCategory, setNewClientCategory] = useState('');
  const [newClientNotes, setNewClientNotes] = useState('');
  const [newClientLimit, setNewClientLimit] = useState(50000);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLog, setAiLog] = useState([]);
  const [isAiLoading, setIsAiLoading] = useState(false);

  const logoInputRef = useRef(null);
  const brandInputRef = useRef(null);
  const documentRef = useRef(null);
  const tableWrapRef = useRef(null);
  const bodyWrapRef = useRef(null);
  const isPrintingRef = useRef(false);

  const [maxRows, setMaxRows] = useState(20);
  const printMinRows = 15;
  const maxRowsRef = useRef(20);
  const itemsLenRef = useRef(0);
  useEffect(() => {
    maxRowsRef.current = maxRows;
    itemsLenRef.current = items.length;
  }, [maxRows, items.length]);

  useLayoutEffect(() => {
    const el = bodyWrapRef.current;
    if (!el) return;
    const calc = () => {
      if (isPrintingRef.current) return;
      const el = bodyWrapRef.current;
      if (!el) return;
      const avail = el.clientHeight;
      const content = el.scrollHeight;
      const rowH = 32;
      const emptyCount = Math.max(0, maxRowsRef.current - itemsLenRef.current);
      if (content > avail && emptyCount > 0) {
        const overflow = content - avail;
        const remove = Math.min(emptyCount, Math.ceil(overflow / rowH));
        setMaxRows(prev => Math.max(itemsLenRef.current, prev - remove));
      } else if (avail - content >= rowH) {
        const space = avail - content;
        const add = Math.floor(space / rowH);
        setMaxRows(prev => Math.min(20, prev + add));
      }
    };
    calc();
    const ro = new ResizeObserver(calc);
    ro.observe(el);
    const onBefore = () => {
      isPrintingRef.current = true;
      flushSync(() => setMaxRows(Math.max(itemsLenRef.current, printMinRows)));
    };
    const onAfter = () => {
      isPrintingRef.current = false;
      setMaxRows(Math.max(itemsLenRef.current, 20));
      setTimeout(calc, 100);
    };
    window.addEventListener('beforeprint', onBefore);
    window.addEventListener('afterprint', onAfter);
    return () => {
      ro.disconnect();
      window.removeEventListener('beforeprint', onBefore);
      window.removeEventListener('afterprint', onAfter);
    };
  }, []);

  const t = useMemo(() => TRANSLATIONS[language] || TRANSLATIONS.FR, [language]);
  const localeMap = { FR: 'fr-FR', EN: 'en-US', ES: 'es-ES', DE: 'de-DE', ZH: 'zh-CN' };
  const localeStr = localeMap[language] || 'fr-FR';
  const effectiveTheme = activeTheme;
  const theme = useMemo(() => THEMES[effectiveTheme] || THEMES.light, [effectiveTheme]);
  const currencySymbol = CURRENCIES[currencyKey] || currencyKey;

  const convertPrice = useCallback((amount) => {
    if (!amount) return 0;
    const rate = EXCHANGE_RATES[currencyKey] || 1;
    return amount / rate;
  }, [currencyKey]);

  const getStockDisponible = useCallback((ref) => {
    const item = catalog.find(c => c.ref === ref);
    if (!item) return 0;
    return (item.stockPhysique || 0) - (item.stockReserve || 0);
  }, [catalog]);

  const totals = useMemo(() => {
    let totalBrut_MAD = 0, totalHT_MAD = 0, totalTVA_MAD = 0;
    items.forEach(i => {
      const brut = (i.priceHT || 0) * (i.qty || 1);
      const ht = brut * (1 - Math.min(100, Math.max(0, Number(i.discount || 0))) / 100);
      const rate = i.tvaRate != null ? i.tvaRate : docTvaRate;
      totalBrut_MAD += brut;
      totalHT_MAD += ht;
      totalTVA_MAD += ht * (rate / 100);
    });
    const timbre_MAD = timbreFiscal * (EXCHANGE_RATES[currencyKey] || 1);
    const acompte_MAD = acompte * (EXCHANGE_RATES[currencyKey] || 1);
    return {
      brut: convertPrice(totalBrut_MAD),
      discount: convertPrice(totalBrut_MAD - totalHT_MAD),
      ht: convertPrice(totalHT_MAD),
      tva: convertPrice(totalTVA_MAD),
      ttc: convertPrice(totalHT_MAD + totalTVA_MAD + timbre_MAD),
      restant: convertPrice(totalHT_MAD + totalTVA_MAD + timbre_MAD - acompte_MAD),
    };
  }, [items, docTvaRate, timbreFiscal, acompte, currencyKey, convertPrice]);

  const emptyRows = useMemo(() => Array.from({ length: Math.max(0, maxRows - items.length) }), [items, maxRows]);

  const docTitle = useMemo(() => {
    if (documentType === 'DEV') return t.docDevis;
    if (documentType === 'BL')  return t.docBL;
    if (documentType === 'BC')  return t.docBC;
    if (documentType === 'FACT')  return t.docFact;
    if (documentType === 'AVOIR') return t.docAvoir;
    return t.docGeneric;
  }, [documentType, t]);

  useEffect(() => {
    if (!documentNumber || (!items.length && !clientDetails.trim())) return;
    const timer = window.setTimeout(() => {
      const draft = {
        id: `AUTO-${documentType}-${documentNumber}`,
        type: documentType,
        number: documentNumber,
        client: clientDetails || '-',
        date: documentDate,
        status: documentStatus || 'draft',
        items,
        totalHT: totals.ht,
        totalTVA: totals.tva,
        totalTTC: totals.ttc,
        currency: currencyKey,
        autoSaved: true,
        updatedAt: new Date().toISOString(),
      };
      setSavedDocs(previous => {
        const list = Array.isArray(previous) ? previous : [];
        const index = list.findIndex(item => item.id === draft.id || item.number === draft.number);
        if (index < 0) return [draft, ...list];
        const next = [...list];
        next[index] = { ...next[index], ...draft };
        return next;
      });
    }, 800);
    return () => window.clearTimeout(timer);
  }, [documentType, documentNumber, documentDate, documentStatus, clientDetails, items, totals, currencyKey, setSavedDocs]);

  const addLog = useCallback((ref, name, action) => {
    const now = new Date();
    const entry = { id: `${now.getTime()}-${Math.random().toString(36).slice(2, 7)}`, time: now.toLocaleString(localeStr), ref: ref || '-', name: name || '-', action };
    setDocumentHistory(prev => [entry, ...(Array.isArray(prev) ? prev : []).slice(0, 1999)]);
  }, [localeStr, setDocumentHistory]);

  useEffect(() => {
    const recordMovement = (event) => {
      const movement = event.detail || {};
      addLog(movement.ref || movement.path || '-', movement.name || movement.module || '-', movement.action || 'Mouvement enregistré');
    };
    window.addEventListener('audit:movement', recordMovement);
    return () => window.removeEventListener('audit:movement', recordMovement);
  }, [addLog]);

  const previousPageRef = useRef(activePage);
  useEffect(() => {
    if (previousPageRef.current === activePage) return;
    addLog(activePage, user?.full_name || user?.username || '-', `Navigation : ${activePage}`);
    previousPageRef.current = activePage;
  }, [activePage, addLog, user?.full_name, user?.username]);

  const changeSavedDocumentStatus = useCallback((doc, status, paid = doc.paid) => {
    setSavedDocs(previous => (Array.isArray(previous) ? previous : []).map(item => (
      item.id === doc.id || (item.number === doc.number && item.type === doc.type)
        ? { ...item, status, paid }
        : item
    )));
    const statusKey = DOC_STATUSES[status]?.labelKey;
    addLog(doc.number, (doc.client || '').split('\n')[0] || '-', `Statut : ${statusKey ? (t[statusKey] || status) : status}`);
  }, [addLog, setSavedDocs, t]);

  const notify = useCallback((msg, type = 'info', title = '', action = null, secondaryAction = null) => setNotification({ msg, type, title, action, secondaryAction }), []);
  const closeNotify = useCallback(() => setNotification({ msg: '', type: 'info', title: '', action: null, secondaryAction: null }), []);
  const showScheduleReminder = useCallback((row, phase, additionalCount = 0) => {
    const dueNow = phase === 'due';
    const more = additionalCount > 0 ? `\nAutres échéances : ${additionalCount}` : '';
    notify(`${scheduleNotificationMessage(row, dueNow)}${more}`, dueNow ? 'warning' : 'info', 'Échéancier',
      { onClick: () => setActivePage('echeancier') },
      { label: 'Marquer comme vu', onClick: async () => {
        try {
          await api.acknowledgeEcheance(row.id, phase);
          window.dispatchEvent(new CustomEvent('echeancier:updated'));
        } catch (acknowledgeError) {
          notify(acknowledgeError.message || 'Confirmation impossible', 'error');
        }
      } });
  }, [notify]);

  const showEmailNotification = useCallback((entry) => {
    if (!entry?.id) return;
    const storageKey = `shown_email_notifs_${user?.id || 'guest'}`;
    let shownIds = [];
    try { shownIds = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch {}
    if (!Array.isArray(shownIds)) shownIds = [];
    if (shownEmailNotification.current === entry.id || shownIds.includes(entry.id)) return;
    shownEmailNotification.current = entry.id;
    try { localStorage.setItem(storageKey, JSON.stringify([...shownIds, entry.id].slice(-300))); } catch {}
    api.markNotificationRead(entry.id).catch(() => {});
    notify(entry.message || 'Nouveau message disponible.', 'info', entry.title || 'Nouvel email reçu', {
      onClick: () => {
        setDrawerSection('mail');
        setDrawerOpen(true);
      },
    });
  }, [notify, user?.id]);

  useEffect(() => {
    const entry = lastNotification?.notification || lastNotification;
    if (entry?.type === 'email') showEmailNotification(entry);
  }, [lastNotification, showEmailNotification]);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    const storageKey = `shown_email_notifs_${user.id}`;
    let storedIds = [];
    try { storedIds = JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch {}
    const shownSet = new Set(Array.isArray(storedIds) ? storedIds : []);
    const checkEmailNotifications = async () => {
      try {
        const entries = await api.getNotifications('?unread=true');
        if (!active) return;
        const notificationEntries = Array.isArray(entries) ? entries : [];
        const emailEntry = notificationEntries.find(entry => entry.type === 'email' && !shownSet.has(entry.id));
        if (emailEntry) {
          shownSet.add(emailEntry.id);
          showEmailNotification(emailEntry);
        }
      } catch {}
    };
    const timer = window.setInterval(checkEmailNotifications, 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [user?.id, showEmailNotification]);
  const notificationUserId = user?.id;
  const notificationRole = user?.role;

  useEffect(() => {
    if (!notificationUserId || !['admin', 'commercial'].includes(notificationRole)) return undefined;
    let active = true;
    const checkDuePayments = async () => {
      try {
        const rows = await api.getEcheancier('?status=unpaid');
        if (!active) return;
        const today = localTodayISO();
        const allRows = Array.isArray(rows) ? rows : [];
        const dueRows = allRows.filter(row => row.due_date && row.due_date <= today && !row.due_acknowledged);
        const scheduledRows = allRows.filter(row => (!row.due_date || row.due_date > today) && !row.scheduled_acknowledged);
        const first = dueRows[0] || scheduledRows[0];
        if (!first) return;
        const phase = dueRows.length ? 'due' : 'scheduled';
        const pendingCount = dueRows.length + scheduledRows.length - 1;
        showScheduleReminder(first, phase, pendingCount);
        window.dispatchEvent(new CustomEvent('echeancier:updated'));
      } catch {}
    };
    checkDuePayments();
    const timer = window.setInterval(checkDuePayments, 2 * 60_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [notificationUserId, notificationRole, showScheduleReminder]);

  const checkStock = useCallback((ref, qty) => {
    const normalizedRef = String(ref || '').trim().toUpperCase();
    const cat = catalog.find(c => String(c.ref || '').trim().toUpperCase() === normalizedRef);
    if (!cat) return { ok: false, dispo: 0, missing: true };
    const dispo = (cat.stockPhysique || 0) - (cat.stockReserve || 0);
    return dispo >= qty ? { ok: true, dispo, item: cat } : { ok: false, dispo, item: cat };
  }, [catalog]);

  const checkAndReserveStock = useCallback((ref, qty, isDevMode) => {
    const result = checkStock(ref, qty);
    if (!result.ok) return result;
    if (!isDevMode) {
      setCatalog(prev => prev.map(c => c.ref === ref ? { ...c, stockReserve: (c.stockReserve || 0) + qty } : c));
    }
    return result;
  }, [checkStock]);

  const releaseReservation = useCallback((ref, qty, isDevMode) => {
    if (isDevMode) return;
    setCatalog(prev => prev.map(c => c.ref === ref ? { ...c, stockReserve: Math.max(0, (c.stockReserve || 0) - qty) } : c));
  }, []);

  const adjustReservation = useCallback((ref, oldQty, newQty) => {
    setCatalog(prev => prev.map(c => c.ref === ref ? {
      ...c,
      stockReserve: Math.max(0, (c.stockReserve || 0) - (oldQty || 0) + (newQty || 0)),
    } : c));
  }, []);

  const confirmDeduction = useCallback((ref, qty) => {
    setCatalog(prev => prev.map(c => c.ref === ref ? {
      ...c,
      stockPhysique: Math.max(0, (c.stockPhysique || 0) - qty),
      stockReserve: Math.max(0, (c.stockReserve || 0) - qty),
    } : c));
  }, []);

  const reintegrateStock = useCallback((items) => {
    items.forEach(item => {
      setCatalog(prev => prev.some(c => c.ref === item.ref)
        ? prev.map(c => c.ref === item.ref ? {
            ...c,
            stockPhysique: (c.stockPhysique || 0) + (item.qty || 0),
            stockReserve: Math.max(0, (c.stockReserve || 0) - (item.qty || 0)),
          } : c)
        : prev
      );
    });
  }, []);

  const handleAddItem = (e) => {
    e.preventDefault();
    if (isLocked) { notify(t.lockMsg, 'warning'); return; }
    const ref = searchRef.trim().toUpperCase();
    const stockOptional = stockOptionalForCurrentDocument;
    const catalogItem = catalog.find(item => String(item.ref || '').trim().toUpperCase() === ref);
    if (!catalogItem && !stockOptional) {
      notify(t.refNotFound, 'error');
      return;
    }
    const name = manualName.trim() || catalogItem?.name || '';
    const enteredPrice = Number(manualPrice);
    const qty = Number(manualQty);
    if (!ref || !name || manualPrice === '' || manualQty === '' || !Number.isFinite(enteredPrice) || enteredPrice < 0 || !Number.isFinite(qty) || qty <= 0) {
      notify(t.itemFieldsRequired, 'warning');
      return;
    }
    const price = enteredPrice * (EXCHANGE_RATES[currencyKey] || 1);
    const result = stockOptional ? { ok: true } : checkAndReserveStock(ref, qty, false);
    if (!result.ok) { notify(`${t.stockError}${result.dispo}`, 'error'); return; }
    const dispo = stockOptional ? null : getStockDisponible(ref) - qty;
    if (!stockOptional && dispo !== null) {
      const cat = catalog.find(c => c.ref === ref);
      if (cat && dispo < (cat.minStock || 0)) notify(t.stockWarning, 'warning');
      else notify(t.stockSuccess, 'success');
    } else notify(t.stockSuccess, 'success');
    setItems(prev => [...prev, { ref, name, priceHT: price, qty, discount: 0, tvaRate: docTvaRate }]);
    addLog(ref, name, fmt(t.logAdd, qty));
    setSearchRef(''); setManualName(''); setManualPrice(''); setManualQty('');
  };

  const updateItem = (index, field, value) => {
    if (isLocked) { notify(t.lockMsg, 'warning'); return; }
    const oldItem = items[index];
    if (field === 'qty') {
      const newQty = Number(value);
      const stockOptional = stockOptionalForCurrentDocument;
      if (!stockOptional) {
        const cat = catalog.find(c => c.ref === oldItem.ref);
        if (!cat) { notify(t.refNotFound, 'error'); return; }
        const dispoActuelle = (cat.stockPhysique || 0) - (cat.stockReserve || 0);
        const dispoApresRelease = dispoActuelle + (oldItem.qty || 0);
        if (dispoApresRelease < newQty) {
          notify(fmt(t.stockInsufficientFormat, dispoApresRelease, newQty), 'error');
          return;
        }
        adjustReservation(oldItem.ref, oldItem.qty, newQty);
      }
      setItems(prev => { const u = [...prev]; u[index] = { ...u[index], qty: newQty }; return u; });
      return;
    }
    if (field === 'ref') {
      const stockOptional = stockOptionalForCurrentDocument;
      const normalizedRef = String(value || '').trim().toUpperCase();
      const nextCatalogItem = catalog.find(item => String(item.ref || '').trim().toUpperCase() === normalizedRef);
      if (!nextCatalogItem && !stockOptional) {
        notify(t.refNotFound, 'error');
        return;
      }
      if (!stockOptional) {
        const stockResult = checkStock(normalizedRef, oldItem.qty);
        if (!stockResult.ok) {
          notify(fmt(t.stockInsufficientFor, normalizedRef, stockResult.dispo), 'error');
          return;
        }
        releaseReservation(oldItem.ref, oldItem.qty, false);
        const result = checkAndReserveStock(normalizedRef, oldItem.qty, false);
        if (!result.ok) {
          checkAndReserveStock(oldItem.ref, oldItem.qty, false);
          notify(fmt(t.stockInsufficientFor, normalizedRef, result.dispo), 'error');
          return;
        }
      }
      setItems(prev => {
        const updated = [...prev];
        updated[index] = {
          ...updated[index],
          ref: normalizedRef,
          name: nextCatalogItem?.name || updated[index].name,
          priceHT: nextCatalogItem?.priceHT ?? updated[index].priceHT,
        };
        return updated;
      });
      return;
    }
    if (field === 'priceHT') {
      const rate = EXCHANGE_RATES[currencyKey] || 1;
      setItems(prev => { const u = [...prev]; u[index] = { ...u[index], priceHT: value === '' ? 0 : Number(value) * rate }; return u; });
      return;
    }
    setItems(prev => { const u = [...prev]; u[index] = { ...u[index], [field]: value }; return u; });
  };

  const removeItem = (index) => {
    if (isLocked) { notify(t.lockMsg, 'warning'); return; }
    const item = items[index];
    const stockOptional = stockOptionalForCurrentDocument;
    releaseReservation(item.ref, item.qty, stockOptional);
    setItems(prev => prev.filter((_, i) => i !== index));
    addLog(item.ref, item.name, fmt(t.logDelete, item.qty));
    notify(stockOptional ? fmt(t.itemDeletedFormat, item.ref) : fmt(t.stockRestoredFormat, item.qty), 'info');
  };

  const handleRefChange = (val) => {
    setSearchRef(val);
    const match = catalog.find(c => c.ref.toUpperCase() === val.toUpperCase());
    if (match) {
      setManualName(match.name);
      setManualPrice(convertPrice(match.priceHT).toFixed(2));
      const dispo = getStockDisponible(match.ref);
      notify(fmt(t.dispoInfo, dispo, match.name, match.emplacement || ''), 'info');
    } else { setManualName(''); setManualPrice(''); }
  };

  const handleNewDocument = (type) => {
    if (!stockOptionalForCurrentDocument) {
      items.forEach(item => releaseReservation(item.ref, item.qty, false));
    }
    const num = peekNextDocNumber(type);
    setDocumentType(type);
    ls.set('is_doc_type', type);
    setDocumentNumber(num);
    setDocumentStatus('draft');
    setItems([]);
    setClientDetails(''); setClientICE(''); setRepresentative('');
    setOrderRef(''); setDocumentDate(new Date().toLocaleDateString(localeStr));
    setSourceDevisNumber('');
    setValidityDate(''); setParentFactRef('');
    setPaymentPaid(false);
    setRequestedDocumentType(null);
    addLog(num, type, `Nouveau document : ${type} ${num}`);
    notify(fmt(t.newDocCreatedFormat, type, num), 'success');
  };

  const publishBonLivraison = async () => {
    if (!hasRole('admin', 'commercial')) {
      throw new Error('Le Bon de Livraison doit être créé et envoyé par la session commercial.');
    }
    const clientLines = clientDetails.split('\n').map((line) => line.trim()).filter(Boolean);
    await api.request('/warehouse/bons-livraison', {
      method: 'POST',
      body: JSON.stringify({
        numero: documentNumber,
        client_nom: clientLines[0] || 'Client à préciser',
        client_adresse: clientLines.slice(1).join(', '),
        chauffeur_livreur: representative,
        date_creation: documentDate,
        items: items.map((item) => ({
          reference: item.ref,
          designation: item.name,
          quantite: Number(item.qty || 0),
          prix_ht: Number(item.priceHT || 0),
          tva_rate: Number(item.tvaRate ?? docTvaRate ?? 20),
        })),
      }),
    });
  };

  const handleValidateDocument = async () => {
    if (items.length === 0) { notify(t.noItemDoc, 'warning'); return; }
    if (documentType === 'FACT' && !clientICE.trim()) {
      notify(t.iceRequired, 'error');
      return;
    }
    if (documentType === 'FACT' && !sourceDevisNumber) {
      const missing = items.filter(item => {
        const cat = catalog.find(c => c.ref === item.ref);
        return !cat || (cat.stockPhysique || 0) < (item.qty || 0);
      });
      if (missing.length > 0) {
        notify(fmt(t.stockInsufficientItems, missing.map(m => m.ref).join(', ')), 'error');
        return;
      }
      items.forEach(item => confirmDeduction(item.ref, item.qty));
      notify(fmt(t.stockDeductedFormat, items.length), 'info');
    }
    if (documentType === 'AVOIR') {
      reintegrateStock(items);
      notify(fmt(t.stockReintegratedFormat, items.length), 'info');
    }
    if (documentType === 'BL') {
      try {
        await publishBonLivraison();
      } catch (error) {
        notify(error.message || 'Impossible d’envoyer le Bon de Livraison au magasinier.', 'error');
        return;
      }
    }
    setDocumentStatus('validated');
    commitDocNumber(documentType);
    const doc = {
      id: Date.now(),
      number: documentNumber,
      type: documentType,
      status: 'validated',
      date: documentDate,
      client: clientDetails,
      items: [...items],
      totals: { ht: totals.ht, tva: totals.tva, ttc: totals.ttc },
      currency: currencyKey,
      paid: paymentPaid,
      orderRef: orderRef,
      sourceDevisNumber: sourceDevisNumber,
      supplierName: supplierName,
      representative: representative,
      validityDate: validityDate,
      parentFactRef: parentFactRef,
      timbreFiscal: timbreFiscal,
      acompte: acompte,
      dueDate: paymentDueDate,
    };
    setSavedDocs(prev => {
      const exist = prev.findIndex(d => d.number === doc.number && d.type === doc.type);
      if (exist >= 0) {
        const existing = prev[exist];
        if (existing.status !== 'draft' && existing.status !== doc.status) return prev;
        const upd = [...prev];
        upd[exist] = doc;
        return upd;
      }
      return [doc, ...prev.slice(0, 49)];
    });
    addLog('-', '-', fmt(t.logDocValidated, documentNumber));
    if (documentType === 'FACT') {
      const partyName = clientDetails.split('\n').map(line => line.trim()).find(Boolean) || supplierName || 'Client à préciser';
      try {
        const savedSchedule = await api.createEcheance({
          document_number: documentNumber,
          source_devis_number: sourceDevisNumber || null,
          party_type: supplierName && !clientDetails.trim() ? 'fournisseur' : 'client',
          party_name: partyName,
          party_ice: clientICE || null,
          invoice_date: normalizeScheduleDate(documentDate) || null,
          due_date: normalizeScheduleDate(paymentDueDate) || null,
          amount: Math.max(0, Number(totals.restant || totals.ttc || 0)),
          currency: currencyKey,
          paid: paymentPaid,
        });
        window.dispatchEvent(new CustomEvent('echeancier:updated'));
        if (!paymentPaid) showScheduleReminder(savedSchedule, 'scheduled');
        else notify(scheduleNotificationMessage(savedSchedule), paymentPaid ? 'success' : 'info', 'Échéancier', { onClick: () => setActivePage('echeancier') });
      } catch (scheduleError) {
        notify(`Facture validée. Échéancier indisponible : ${scheduleError.message}`, 'warning');
      }
    } else {
      notify(fmt(t.docValidatedFormat, documentNumber), 'success');
    }
  };

  const handleConvert = (targetType) => {
    if (documentStatus !== 'validated') { notify(t.validateFirst, 'warning'); return; }
    const num = peekNextDocNumber(targetType);
    if (documentType === 'DEV' && ['BL', 'FACT'].includes(targetType)) {
      setSourceDevisNumber(documentNumber);
    }
    commitDocNumber(targetType);
    setDocumentType(targetType);
    ls.set('is_doc_type', targetType);
    setDocumentNumber(num);
    setDocumentStatus('draft');
    if (targetType === 'AVOIR') {
      setParentFactRef(documentNumber);
    } else {
      setParentFactRef('');
    }
    notify(fmt(t.convertedToFormat, targetType, num), 'success');
    addLog('-', '-', fmt(t.logConversion, targetType, num));
  };

  const handleSaveDocument = () => {
    const doc = {
      id: Date.now(),
      number: documentNumber,
      type: documentType,
      status: documentStatus,
      date: documentDate,
      client: clientDetails,
      items: [...items],
      totals: { ht: totals.ht, tva: totals.tva, ttc: totals.ttc },
      currency: currencyKey,
      paid: paymentPaid,
      orderRef: orderRef,
      sourceDevisNumber: sourceDevisNumber,
      supplierName: supplierName,
      representative: representative,
      validityDate: validityDate,
      parentFactRef: parentFactRef,
      timbreFiscal: timbreFiscal,
      acompte: acompte,
      dueDate: paymentDueDate,
    };
    setSavedDocs(prev => {
      const exist = prev.findIndex(d => d.number === doc.number && d.type === doc.type);
      if (exist >= 0) {
        const upd = [...prev];
        upd[exist] = doc;
        return upd;
      }
      return [doc, ...prev.slice(0, 49)];
    });
    addLog('-', '-', fmt(t.logSave, documentNumber));
    notify(t.docSaved, 'success');
  };

  const handleCreateNewPage = () => {
    handleSaveDocument();
    if (documentStatus === 'draft') commitDocNumber(documentType);
    handleNewDocument(requestedDocumentType || documentType);
  };

  const handleLoadDoc = (doc) => {
    if (documentType !== 'DEV') {
      items.forEach(item => releaseReservation(item.ref, item.qty, false));
    }
    setDocumentType(doc.type);
    ls.set('is_doc_type', doc.type);
    setDocumentNumber(doc.number);
    setDocumentStatus(doc.status);
    setDocumentDate(doc.date);
    setClientDetails(doc.client || '');
    setItems(doc.items || []);
    setCurrencyKey(doc.currency || 'MAD');
    setPaymentPaid(doc.paid || false);
    setOrderRef(doc.orderRef || '');
    setSourceDevisNumber(doc.sourceDevisNumber || '');
    setSupplierName(doc.supplierName || '');
    setRepresentative(doc.representative || '');
    setValidityDate(doc.validityDate || '');
    setParentFactRef(doc.parentFactRef || '');
    setTimbreFiscal(doc.timbreFiscal || 0);
    setAcompte(doc.acompte || 0);
    setPaymentDueDate(doc.dueDate || 'À réception');
    setRequestedDocumentType(null);
    setShowDocHistory(false);
    setActivePage('chiffrage');
    addLog(doc.number, (doc.client || '').split('\n')[0] || doc.type, `Document ouvert : ${doc.number}`);
    notify(fmt(t.docLoadedFormat, doc.number), 'success');
  };

  const handleOpenDocumentType = (type) => {
    setActivePage('chiffrage');
    if (type === documentType) {
      setRequestedDocumentType(null);
      return;
    }
    const workspaceKey = `open_document_${user?.id || 'anonymous'}_${documentType}`;
    ls.setJSON(workspaceKey, {
      id: `OPEN-${documentType}-${documentNumber}`,
      number: documentNumber,
      type: documentType,
      status: documentStatus,
      date: documentDate,
      client: clientDetails,
      items: [...items],
      currency: currencyKey,
      paid: paymentPaid,
      orderRef,
      sourceDevisNumber,
      supplierName,
      representative,
      validityDate,
      parentFactRef,
      timbreFiscal,
      acompte,
      dueDate: paymentDueDate,
    });
    const targetKey = `open_document_${user?.id || 'anonymous'}_${type}`;
    const cachedDocument = ls.getJSON(targetKey, null);
    const latestSavedDocument = savedDocs.find(document => document.type === type);
    const targetDocument = cachedDocument || latestSavedDocument;
    if (targetDocument) {
      handleLoadDoc(targetDocument);
      return;
    }
    setRequestedDocumentType(type);
    notify(`Aucune page ${type} existante. Cliquez sur Nouvelle page pour la créer.`, 'info');
  };

  const buildExactPrintDocument = () => {
    const esc = (value) => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const lines = (value) => esc(value).replace(/\r?\n/g, '<br>');
    const safeImage = (value) => {
      const source = String(value || '');
      return /^(data:image\/|blob:|https?:\/\/|\/)/i.test(source) ? esc(source) : '';
    };
    const printItems = Array.isArray(items) ? items : [];
    const slotCount = Math.max(15, printItems.length);
    const blankCount = Math.max(0, slotCount - printItems.length);
    const rowHeight = 147 / slotCount;
    const blankHeight = rowHeight;
    const filledHeight = rowHeight;
    const filledRows = printItems.map((item) => {
      const qty = Number(item.qty || 1);
      const discount = Math.min(100, Math.max(0, Number(item.discount || 0)));
      const amount = convertPrice(Number(item.priceHT || 0) * qty * (1 - discount / 100));
      return `<tr style="height:${filledHeight.toFixed(2)}mm"><td class="ref">${esc(item.ref || '')}</td><td>${esc(item.name || '')}</td><td>${qty}</td><td>${convertPrice(Number(item.priceHT || 0)).toFixed(2)}</td><td>${discount}</td><td class="amount">${amount.toFixed(2)}</td></tr>`;
    }).join('');
    const blankRows = Array.from({ length: blankCount }, () => `<tr class="blank" style="height:${blankHeight.toFixed(2)}mm">${'<td>&nbsp;</td>'.repeat(6)}</tr>`).join('');
    const dateText = /^\d{4}-\d{2}-\d{2}$/.test(String(documentDate || '')) ? String(documentDate).split('-').reverse().join('/') : String(documentDate || '');
    const discountRate = totals.brut > 0 ? (totals.discount / totals.brut) * 100 : 0;
    const compactNumber = (value) => {
      const number = Number(value || 0);
      return Number.isInteger(number) ? number.toFixed(0) : number.toFixed(2);
    };
    const clientTitle = documentType === 'BC' ? t.fournisseur : 'Coordonnées du client';
    const repTitle = documentType === 'BL' ? 'Chauffeur / Livreur' : t.representative;
    const paymentChoices = [t.paymentCheque, t.paymentCash, t.paymentTransfer, t.paymentEffet]
      .map(method => {
        const selected = paymentMethod === method;
        return `<span class="choice"><i class="radio ${selected ? 'selected' : ''}">${selected ? '<b class="radio-dot"></b>' : ''}</i>${esc(method)}</span>`;
      }).join('');
    const legal = companyFooter || [companyName, companyAddress, companyEmail, companyPhone].filter(Boolean).join(' · ');
    const brandHtml = brands.map(brand => `<div class="brand"><img src="${safeImage(brand.logo)}" alt=""></div>`).join('');
    const logoHtml = companyLogo ? `<img class="company-logo" src="${safeImage(companyLogo)}" alt="Logo">` : '';

    return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><link rel="stylesheet" href="/print-document.css?v=20260718-5"><style${cspNonce ? ` nonce="${esc(cspNonce)}"` : ''}>
      @page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{width:210mm;height:297mm;margin:0;padding:0;overflow:hidden;background:#fff}body{font-family:Arial,Helvetica,sans-serif;color:#20252d;font-size:7.2pt;line-height:1.2}
      .sheet{width:210mm;height:297mm;padding:5mm 8mm 4mm;display:grid;grid-template-rows:38mm 10mm 14mm 155mm 26mm 18mm 22mm;gap:.5mm;overflow:hidden;background:#fff}
      .head{display:grid;grid-template-columns:22% 40% 38%;grid-template-rows:38mm;width:100%;height:38mm;align-items:start;border-bottom:.35mm solid #8f98a3;overflow:hidden}.head>.logo,.head>.company,.head>.client{width:100%;min-width:0;height:100%;min-height:0;max-height:100%;padding:0 2mm 2mm;align-self:start;overflow:hidden}.head>.company{padding-left:.5mm}.logo{display:grid;place-items:start start}.company-logo{display:block;width:38mm;height:24mm;object-fit:contain;object-position:left top}.logo-placeholder{margin-top:0;font-size:8pt;font-weight:700}
      .company,.client{display:grid;align-content:start;justify-items:start}.company strong,.client strong{display:block;margin-bottom:1.5mm;font-size:8.5pt;line-height:1.05;text-transform:uppercase}.company span,.client div,.client span{display:block;margin-bottom:1mm;font-size:7.4pt}.client div{font-weight:700;line-height:1.3}
      .title{display:grid;place-items:center;font-size:9pt;font-weight:900;letter-spacing:.08em;text-transform:uppercase}.meta{display:grid;grid-template-columns:1fr 1fr;border:.25mm solid #aab1ba}.meta-cell{padding:2mm 2.5mm;border-right:.25mm solid #aab1ba;overflow:hidden}.meta-cell:last-child{border-right:0}.meta-cell strong{display:block;margin-bottom:1.5mm;font-size:7.5pt;text-transform:uppercase}.meta-cell span{font-size:7.2pt}
      .items{width:100%;height:155mm;table-layout:fixed;border-collapse:collapse;border:.25mm solid #aab1ba;font-variant-numeric:tabular-nums}.items col:nth-child(1){width:17%}.items col:nth-child(2){width:33%}.items col:nth-child(3){width:8%}.items col:nth-child(4){width:16%}.items col:nth-child(5){width:11%}.items col:nth-child(6){width:15%}.items th,.items td{border:.22mm solid #b3bac3;padding:1mm 1.2mm;text-align:center;vertical-align:middle;overflow:hidden}.items thead tr{height:8mm}.items th{font-size:6.6pt;font-weight:800;white-space:nowrap}.items td{font-size:6.8pt}.items .ref{font-family:Consolas,monospace}.items .amount{font-weight:800}.items .blank td{padding:0}
      .summary{display:grid;grid-template-columns:38% 24% 38%;gap:.6mm;border:0;overflow:hidden}.box{min-width:0;padding:1.5mm 2mm;border:.25mm solid #aab1ba;border-radius:1mm;overflow:hidden}.box:last-child{border:.25mm solid #aab1ba}.sum-title{display:block;margin-bottom:1mm;text-align:center;font-size:7.4pt;font-weight:900;text-transform:uppercase}.methods{display:flex;justify-content:center;gap:2mm;margin-bottom:.8mm;white-space:nowrap}.choice{display:inline-flex;align-items:center;gap:.6mm;font-size:6.4pt}.radio{width:2.6mm;height:2.6mm;border:.28mm solid #6b7280;border-radius:50%;display:inline-block;position:relative;box-sizing:border-box;flex:0 0 auto;vertical-align:middle;background:#fff}.radio.selected{border-color:#1377b7;background:#fff}.radio-dot{display:block;width:1.7mm;height:1.7mm;border:.85mm solid #1377b7;border-radius:50%;box-sizing:border-box;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}.sum-line{display:flex;justify-content:space-between;gap:2mm;min-height:4mm;align-items:center;font-size:6.8pt;font-variant-numeric:tabular-nums}.sum-line strong{font-weight:800;white-space:nowrap}.tax{display:grid;align-content:center}.net{margin-top:.6mm;padding-top:.8mm;border-top:.3mm solid #8f98a3;font-size:7.2pt;font-weight:900;text-transform:uppercase}
      .legal{display:grid;align-content:center;justify-items:center;padding:1mm 8mm;text-align:center;overflow:hidden}.legal strong{display:block;margin-bottom:1mm;font-size:7.2pt}.legal div{font-size:6.7pt;line-height:1.3}.brands{margin:.8mm 8mm 0;padding:1mm 2mm;border:.25mm solid #c4c9cf;border-radius:1.5mm;display:flex;flex-wrap:wrap;justify-content:center;align-content:center;align-items:center;gap:1mm 2mm;overflow:hidden;background:#fff}.brand{flex:0 0 calc((100% - 14mm)/8);max-width:calc((100% - 14mm)/8);height:8mm;display:grid;place-items:center;overflow:hidden}.brand img{display:block;width:100%;height:8mm;object-fit:contain}.word{font-size:8pt;font-weight:900;letter-spacing:-.04em;color:#364152}.w1{font-style:italic}.w2{letter-spacing:.04em}.w3{border:.25mm solid #64748b;border-radius:50%;font-size:6.6pt}
    </style></head><body><article class="sheet">
      <header class="head"><div class="logo">${logoHtml}</div><div class="company"><strong>${esc(companyName || 'Entreprise')}</strong><span>${esc(companyAddress)}</span><span>${esc(companyPhone)}</span><span>${esc(companyEmail)}</span></div><div class="client"><strong>${esc(clientTitle)}</strong><div>${lines(clientDetails || 'Coordonnées client non renseignées')}</div>${clientICE ? `<span>ICE : ${esc(clientICE)}</span>` : ''}</div></header>
      <section class="title">${esc(docTitle)} N° ${esc(documentNumber)}</section>
      <section class="meta"><div class="meta-cell"><strong>${esc(repTitle)}</strong><span>${esc(representative)}</span></div><div class="meta-cell"><strong>${esc(t.dateDoc)}</strong><span>${esc(dateText)}</span></div></section>
      <table class="items"><colgroup><col><col><col><col><col><col></colgroup><thead><tr><th>${esc(t.refLabel)}</th><th>${esc(t.descLabel)}</th><th>${esc(t.qtyLabel)}</th><th>${esc(t.priceLabel)}</th><th>Remise %</th><th>${esc(t.montantHT)}</th></tr></thead><tbody>${filledRows}${blankRows}</tbody></table>
      <section class="summary"><div class="box payment-box"><strong class="sum-title">${esc(t.paymentMethod)}</strong><div class="methods">${paymentChoices}</div><div class="sum-line"><span>${esc(t.dueDate)} :</span><strong>${esc(paymentDueDate)}</strong></div><div class="sum-line"><span>${esc(t.timbreFiscal)} :</span><strong>${compactNumber(timbreFiscal)} ${esc(currencySymbol)}</strong></div><div class="sum-line"><span>${esc(t.acompte)} :</span><strong>${compactNumber(acompte)} ${esc(currencySymbol)}</strong></div></div><div class="box tax tax-box"><strong class="sum-title">Taxes</strong><div class="sum-line"><span>TVA %</span><strong>${compactNumber(docTvaRate)}</strong></div><div class="sum-line"><span>${esc(t.discountLabel)} %</span><strong>${discountRate.toFixed(2)}</strong></div></div><div class="box amounts-box"><div class="sum-line"><span>${esc(t.totalHT)}</span><strong>${totals.ht.toFixed(2)} ${esc(currencySymbol)}</strong></div><div class="sum-line"><span>TVA ${Number(docTvaRate || 0).toFixed(0)}%</span><strong>${totals.tva.toFixed(2)} ${esc(currencySymbol)}</strong></div><div class="sum-line net"><span>${esc(t.netToPay)}</span><strong>${totals.ttc.toFixed(2)} ${esc(currencySymbol)}</strong></div></div></section>
      <footer class="legal"><strong>${esc(t.footerLabel)}</strong><div>${lines(legal)}</div></footer><section class="brands">${brandHtml}</section>
    </article></body></html>`;
  };

  const mountExactDocumentFrame = () => new Promise((resolve, reject) => {
    const previousFrame = document.getElementById('erp-document-frame');
    if (previousFrame) previousFrame.remove();
    const previousPrintFrame = document.getElementById('erp-print-frame');
    if (previousPrintFrame) previousPrintFrame.remove();

    const frame = document.createElement('iframe');
    frame.id = 'erp-document-frame';
    frame.title = 'Document A4';
    frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0;opacity:0;pointer-events:none;background:#fff;';
    frame.srcdoc = buildExactPrintDocument();
    frame.onload = async () => {
      try {
        const frameDocument = frame.contentDocument;
        if (!frameDocument) throw new Error('Document A4 inaccessible');
        const images = Array.from(frameDocument.images);
        await Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(done => {
          image.addEventListener('load', done, { once: true });
          image.addEventListener('error', done, { once: true });
        })));
        await frameDocument.fonts?.ready;
        resolve(frame);
      } catch (error) {
        frame.remove();
        reject(error);
      }
    };
    frame.addEventListener('error', () => {
      frame.remove();
      reject(new Error('Chargement document A4 impossible'));
    }, { once: true });
    document.body.appendChild(frame);
  });

  const handleExportPDF = async () => {
    if (!documentRef.current) {
      notify(t.noDocExport, 'error');
      return;
    }
    setIsExporting(true);
    let frame;
    try {
      const [{ default: html2canvas }, { default: jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      frame = await mountExactDocumentFrame();
      const sheet = frame.contentDocument?.querySelector('.sheet');
      if (!sheet) throw new Error('Page A4 introuvable');
      const canvas = await html2canvas(sheet, {
        scale: 3,
        useCORS: true,
        allowTaint: false,
        logging: false,
        backgroundColor: '#ffffff',
        width: sheet.scrollWidth,
        height: sheet.scrollHeight,
        windowWidth: sheet.scrollWidth,
        windowHeight: sheet.scrollHeight,
      });
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      pdf.addImage(canvas.toDataURL('image/png'), 'PNG', 0, 0, 210, 297, undefined, 'FAST');
      pdf.save(`${documentNumber}.pdf`);
      addLog('-', '-', fmt(t.logPdfDownload, documentNumber));
      notify(t.pdfDownloaded, 'success');
    } catch (error) {
      console.error('Export PDF A4:', error);
      notify(t.pdfError, 'error');
    } finally {
      frame?.remove();
      setIsExporting(false);
    }
  };

  const handlePrint = () => {
    const source = documentRef.current;
    if (!source) {
      handlePrintPage();
      return;
    }

    mountExactDocumentFrame().then(frame => {
      frame.id = 'erp-print-frame';
      const printWindow = frame.contentWindow;
      if (!printWindow) {
        frame.remove();
        notify(t.noDocExport, 'error');
        return;
      }
      printWindow.onafterprint = () => frame.remove();
      requestAnimationFrame(() => {
        printWindow.focus();
        printWindow.print();
      });
    }).catch(() => notify(t.noDocExport, 'error'));
    addLog('-', '-', t.logPrint);
    notify(t.docPrinted, 'success');
  };

  const handlePrintPage = () => {
    const main = document.querySelector('.fleetparts-main');
    if (!main) { notify(t.noDocExport, 'error'); return; }

    const visibleTables = Array.from(main.querySelectorAll('table')).filter(table => {
      const style = window.getComputedStyle(table);
      return style.display !== 'none' && style.visibility !== 'hidden' && table.getBoundingClientRect().width > 0;
    });
    const escapeReport = value => String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    const safeReportImage = value => /^(data:image\/|blob:|https?:\/\/|\/)/i.test(String(value || '')) ? escapeReport(value) : '';
    const printableTables = visibleTables.map((table, tableIndex) => {
      const actionColumns = new Set();
      Array.from(table.rows).forEach(row => {
        Array.from(row.cells).forEach((cell, index) => {
          if (cell.matches('.no-print') || cell.querySelector('button,.no-print,input[type="file"]')) actionColumns.add(index);
        });
      });

      const clone = table.cloneNode(true);
      Array.from(clone.rows).forEach(row => {
        [...actionColumns].sort((left, right) => right - left).forEach(index => row.cells[index]?.remove());
      });
      clone.querySelectorAll('input,select,textarea').forEach(control => {
        let value = control.value || '';
        if (control.type === 'checkbox' || control.type === 'radio') value = control.checked ? 'Oui' : 'Non';
        if (control.tagName === 'SELECT') value = control.options?.[control.selectedIndex]?.text || value;
        const text = document.createElement('span');
        text.textContent = value;
        control.replaceWith(text);
      });
      clone.querySelectorAll('button,.no-print,script,style').forEach(element => element.remove());
      clone.querySelectorAll('[style]').forEach(element => element.removeAttribute('style'));
      clone.removeAttribute('style');
      clone.className = 'report-table';

      const rowCount = clone.tBodies?.[0]?.rows?.length || 0;
      return `<section class="report-section"><div class="report-section-heading"><h2>${escapeReport(currentSectionLabel)}${visibleTables.length > 1 ? ` · ${tableIndex + 1}` : ''}</h2><span>${rowCount} ligne${rowCount > 1 ? 's' : ''}</span></div>${clone.outerHTML}</section>`;
    }).join('');

    const totalRows = visibleTables.reduce((total, table) => total + Array.from(table.tBodies || []).reduce((rows, body) => rows + body.rows.length, 0), 0);
    const maxColumns = visibleTables.reduce((maximum, table) => Math.max(maximum, table.rows?.[0]?.cells?.length || 0), 0);
    const landscape = maxColumns > 7;
    const fallbackMessage = `<section class="report-empty"><strong>Aucune donnée tabulaire</strong><span>Page sans tableau imprimable.</span></section>`;
    const reportLogo = safeReportImage(companyLogo);
    const companyDetails = [companyAddress, companyPhone, companyEmail].filter(Boolean).map(value => `<span>${escapeReport(value)}</span>`).join('');
    const printedAt = new Date().toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
    const reportHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>${escapeReport(currentSectionLabel)} — Impression</title><style${cspNonce ? ` nonce="${escapeReport(cspNonce)}"` : ''}>
      @page{size:A4 ${landscape ? 'landscape' : 'portrait'};margin:10mm}
      *{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#17212b;font-family:Arial,Helvetica,sans-serif;font-size:11pt;line-height:1.42}
      body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.report{width:100%;margin:0 auto}.report-header{display:grid;grid-template-columns:42mm minmax(0,1fr) auto;align-items:start;gap:5mm;padding-bottom:5mm;border-bottom:.45mm solid #6f7f88}.report-logo{width:38mm;height:23mm;display:grid;place-items:start}.report-logo img{display:block;max-width:38mm;max-height:23mm;object-fit:contain;object-position:left top}.report-company{display:grid;align-content:start;gap:1mm}.report-company strong{font-size:13pt;line-height:1.15}.report-company span{font-size:9.5pt;color:#536570}.report-meta{text-align:right}.report-meta strong{display:block;font-size:9pt;text-transform:uppercase;letter-spacing:.08em;color:#067568}.report-meta span{display:block;margin-top:1mm;font-size:8.8pt;color:#61727c}.report-title{display:flex;align-items:end;justify-content:space-between;gap:8mm;padding:6mm 0 4mm}.report-title h1{margin:0;font-size:20pt;line-height:1.05;letter-spacing:-.02em}.report-title span{font-size:9pt;font-weight:700;color:#61727c;white-space:nowrap}.report-section{margin-bottom:7mm;break-inside:auto}.report-section-heading{display:flex;align-items:center;justify-content:space-between;gap:5mm;margin-bottom:2mm}.report-section-heading h2{margin:0;font-size:12pt}.report-section-heading span{font-size:8.5pt;font-weight:700;color:#61727c}.report-table{width:100%;border-collapse:collapse;table-layout:auto;font-variant-numeric:tabular-nums}.report-table thead{display:table-header-group}.report-table tr{break-inside:avoid;page-break-inside:avoid}.report-table th,.report-table td{border:.25mm solid #bdc8ce;padding:2.1mm 2.4mm;text-align:left;vertical-align:middle;font-size:${landscape ? '9.4pt' : '10.2pt'};line-height:1.25;overflow-wrap:anywhere}.report-table th{background:#edf3f4;color:#263740;font-weight:800;white-space:normal}.report-table tbody tr:nth-child(even){background:#f8fafb}.report-table img{max-width:18mm;max-height:12mm;object-fit:contain}.report-empty{display:grid;place-items:center;min-height:80mm;border:.3mm dashed #b7c5cb;color:#61727c}.report-empty strong{font-size:14pt}.report-empty span{font-size:10pt}.report-footer{display:flex;justify-content:space-between;gap:8mm;margin-top:6mm;padding-top:3mm;border-top:.25mm solid #c7d1d6;color:#71818a;font-size:8.5pt}@media print{.report{width:100%}}
    </style></head><body><main class="report"><header class="report-header"><div class="report-logo">${reportLogo ? `<img src="${reportLogo}" alt="Logo entreprise">` : ''}</div><div class="report-company"><strong>${escapeReport(companyName || 'Entreprise')}</strong>${companyDetails}</div><div class="report-meta"><strong>Rapport interne</strong><span>${escapeReport(printedAt)}</span></div></header><section class="report-title"><h1>${escapeReport(currentSectionLabel)}</h1><span>${totalRows} donnée${totalRows > 1 ? 's' : ''}</span></section>${printableTables || fallbackMessage}<footer class="report-footer"><span>${escapeReport(companyName || 'Entreprise')}</span><span>Imprimé par ${escapeReport(user?.full_name || user?.username || 'Utilisateur')}</span></footer></main></body></html>`;

    document.getElementById('erp-page-print-frame')?.remove();
    const frame = document.createElement('iframe');
    frame.id = 'erp-page-print-frame';
    frame.title = `Impression ${currentSectionLabel}`;
    frame.style.cssText = `position:fixed;left:-10000px;top:0;width:${landscape ? '297mm' : '210mm'};height:${landscape ? '210mm' : '297mm'};border:0;opacity:0;pointer-events:none;background:#fff;`;
    frame.onload = async () => {
      try {
        const frameDocument = frame.contentDocument;
        const frameWindow = frame.contentWindow;
        if (!frameDocument || !frameWindow) throw new Error('Impression inaccessible');
        const images = Array.from(frameDocument.images);
        await Promise.all(images.map(image => image.complete ? Promise.resolve() : new Promise(done => {
          image.addEventListener('load', done, { once: true });
          image.addEventListener('error', done, { once: true });
        })));
        await frameDocument.fonts?.ready;
        const cleanup = () => frame.remove();
        frameWindow.addEventListener('afterprint', cleanup, { once: true });
        requestAnimationFrame(() => {
          frameWindow.focus();
          frameWindow.print();
        });
        window.setTimeout(cleanup, 60000);
        addLog('-', '-', t.logPrint);
        notify(t.docPrinted, 'success');
      } catch (error) {
        frame.remove();
        notify(error.message || t.noDocExport, 'error');
      }
    };
    frame.addEventListener('error', () => {
      frame.remove();
      notify(t.noDocExport, 'error');
    }, { once: true });
    frame.srcdoc = reportHtml;
    document.body.appendChild(frame);
  };

  const handleAddCatalog = (e) => {
    e.preventDefault();
    if (!catRef || !catName) return;
    const item = {
      ref: catRef.toUpperCase(), name: catName, priceHT: parseFloat(catPrice) * (EXCHANGE_RATES[currencyKey] || 1) || 0,
      stockPhysique: Number(catStockQty) || 0, stockReserve: 0, minStock: Number(catMinStock) || 2,
      emplacement: catEmplac || '-', oem: catOem || '-', compatible: catCompat || '-',
      entryDate: new Date().toLocaleDateString(localeStr), supplier: catSupplier || '-', category: catCategory || '-',
    };
    setCatalog(prev => [...prev, item]);
    addLog(item.ref, item.name, t.logCatalogAdd);
    setCatRef(''); setCatName(''); setCatPrice(''); setCatStockQty(10); setCatSupplier('');
    setCatOem(''); setCatCompat(''); setCatEmplac(''); setCatMinStock(2); setCatCategory('');
    notify(fmt(t.itemAddedFormat, item.ref, item.stockPhysique), 'success');
  };

  const updateCatalog = (idx, field, value) => {
    setCatalog(prev => { const u = [...prev]; u[idx] = { ...u[idx], [field]: field === 'ref' ? value.toUpperCase() : (field === 'stockPhysique' || field === 'minStock' ? Number(value) : value) }; return u; });
  };

  const removeCatalog = (idx) => {
    setCatalog(prev => prev.filter((_, i) => i !== idx));
    notify(t.catItemDeleted, 'info');
  };

  const handleAddClient = (e) => {
    e.preventDefault();
    const c = {
      id: Date.now(),
      name: newClientName,
      contact: newClientContact,
      ice: newClientICE,
      siret: newClientSiret,
      address: newClientAddress,
      phone: newClientPhone,
      email: newClientEmail,
      category: newClientCategory,
      notes: newClientNotes,
      encours: 0,
      limiteCredit: Number(newClientLimit),
    };
    setClients(prev => [...prev, c]);
    setNewClientName(''); setNewClientContact(''); setNewClientICE(''); setNewClientSiret('');
    setNewClientAddress(''); setNewClientPhone(''); setNewClientEmail(''); setNewClientCategory(''); setNewClientNotes(''); setNewClientLimit(50000);
    notify(fmt(t.clientAddedFormat, c.name), 'success');
  };

  const handleAISubmit = async (e) => {
    e.preventDefault();
    const prompt = aiPrompt.trim();
    if (!prompt || isAiLoading) return;
    setIsAiLoading(true);
    try {
      const response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          prompt,
          context: {
            catalog: catalog.slice(0, 100),
            clients: clients.slice(0, 50),
            leads: leads.slice(0, 50),
            savedDocs: savedDocs.slice(0, 20),
            currency: currencyKey,
          },
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Service IA indisponible');
      setAiLog(current => [{ prompt, response: data.response || 'Aucune réponse.', time: new Date().toLocaleTimeString(localeStr) }, ...current]);
      setAiPrompt('');
    } catch (error) {
      setAiLog(current => [{ prompt, response: `Erreur : ${error.message}`, time: new Date().toLocaleTimeString(localeStr) }, ...current]);
    } finally {
      setIsAiLoading(false);
    }
  };

  const handleSelectClient = (client) => {
    setClientDetails([
      client.name,
      client.contact ? `Contact : ${client.contact}` : '',
      client.address,
      client.phone ? `${t.phoneLabel}: ${client.phone}` : '',
      client.email,
    ].filter(Boolean).join('\n'));
    setClientICE(client.ice);
    setShowClientModal(false);
    notify(fmt(t.clientInfoFormat, client.name), 'info');
  };

  const handleLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const maxSize = 2 * 1024 * 1024;
    if (file.size > maxSize) return notify('Logo trop volumineux (max 2 Mo)', 'error');
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) return notify('Format non supporté (PNG, JPG, WebP, SVG uniquement)', 'error');
    const reader = new FileReader();
    reader.onload = (ev) => setCompanyLogo(ev.target.result);
    reader.readAsDataURL(file);
  };

  const handleBrandLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) return notify('Logo trop volumineux (max 2 Mo)', 'error');
    const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
    if (!allowed.includes(file.type)) return notify('Format non supporté', 'error');
    const reader = new FileReader();
    reader.onload = (ev) => {
      setBrands(prev => [...prev, { id: Date.now(), logo: ev.target.result }]);
      notify('Logo ajouté', 'success');
    };
    reader.readAsDataURL(file);
  };

  const removeBrand = (id) => {
    setBrands(prev => prev.filter(b => b.id !== id));
    notify('Marque supprimée', 'info');
  };

  const moveBrand = (id, dir) => {
    setBrands(prev => {
      const idx = prev.findIndex(b => b.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      const target = idx + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const S = {
    input: { background: 'transparent', border: 'none', outline: 'none', fontFamily: 
'inherit', fontSize: 'inherit', color: 'inherit', width: '100%', padding: '1px 2px', margin: 0 },
    tableHeader: { background: '#e2e8f0', borderBottom: '2px solid #94a3b8', fontSize: 9, fontWeight: 800, color: '#1e293b', textTransform: 'uppercase', padding: '7px 5px' },
    tableRow: { borderBottom: '1px solid #e2e8f0', fontSize: 'inherit' },
    card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20, boxShadow: '0 1px 6px rgba(0,0,0,0.05)' },
    btn: (bg) => ({ background: bg || theme.btn, color: '#fff', border: 'none', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 'inherit', cursor: 'pointer', fontFamily: 'inherit', whiteSpace: 'nowrap' }),
    btnGhost: { background: '#f8fafc', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 10, padding: '8px 14px', fontWeight: 700, fontSize: 'inherit', cursor: 'pointer', fontFamily: 'inherit' },
    label: { display: 'block', fontSize: 10, fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', marginBottom: 3 },
    textInput: { width: '100%', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '7px 10px', fontSize: 'inherit', fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' },
  };

  const navItems = [
    { id: 'home', icon: '⌂', label: 'Accueil', roles: ['admin', 'commercial', 'magasinier', 'comptable', 'financier', 'rh', 'technicien', 'employe'] },
    { id: 'section-commercial', section: 'COMMERCIAL', roles: ['admin'] },
    { id: 'chiffrage', type: 'DEV',  icon: '📄', label: t.docTab, roles: ['admin', 'commercial'] },
    { id: 'chiffrage', type: 'BL',   icon: '🚚', label: t.BLTab, roles: ['admin', 'commercial'] },
    { id: 'chiffrage', type: 'BC',   icon: '📋', label: t.BCTab, roles: ['admin', 'commercial'] },
    { id: 'chiffrage', type: 'FACT', icon: '💳', label: t.factTab, roles: ['admin', 'commercial'] },
    { id: 'chiffrage', type: 'AVOIR', icon: '🔄', label: t.avoirTab, roles: ['admin', 'commercial'] },
    { id: 'catalogue', icon: '📚', label: t.refTab, roles: ['admin', 'commercial'] },
    { id: 'stock',     icon: '📦', label: t.stockTab, roles: ['admin', 'commercial'] },
    { id: 'clients',   icon: '👤', label: 'Clients', roles: ['admin', 'commercial'] },
    { id: 'pipeline',  icon: '👥', label: t.pipelineTab, roles: ['admin', 'commercial'] },
    { id: 'echeancier', icon: '📅', label: 'Échéancier', roles: ['admin', 'commercial', 'comptable'] },
    { id: 'reporting', icon: '📊', label: t.statsTab, roles: ['admin', 'commercial'] },
    { id: 'hist',      icon: '⏱️', label: t.histTab, roles: ['admin', 'commercial', 'magasinier', 'comptable', 'financier', 'rh', 'technicien'] },
    { id: 'status',    icon: '📋', label: t.statusTab, roles: ['admin', 'commercial'] },
    { id: 'saved',     icon: '📁', label: i18n.nav.saved, roles: ['admin', 'commercial', 'magasinier', 'comptable', 'financier', 'rh', 'technicien'] },
    { id: 'received_documents', icon: '▣', label: 'Documents reçus', roles: ['admin', 'commercial', 'magasinier', 'comptable', 'financier', 'technicien', 'employe'] },
    { id: 'section-magasin', section: 'MAGASIN', roles: ['admin'] },
    { id: '----------------', roles: ['admin', 'magasinier', 'comptable', 'rh'] },
    { id: 'magasin_reception',    icon: '📥', label: 'Réception', roles: ['admin', 'magasinier'] },
    { id: 'magasin_preparation',  icon: '📋', label: 'Préparation', roles: ['admin', 'magasinier'] },
    { id: 'magasin_expedition',   icon: '🚚', label: 'Expédition', roles: ['admin', 'magasinier'] },
    { id: 'magasin_gestion',      icon: '📦', label: 'Gestion Stock', roles: ['admin', 'magasinier'] },
    { id: 'section-comptable', section: 'COMPTABLE', roles: ['admin'] },
    { id: 'compta_journaux_achats',  icon: '📋', label: "Journal d'Achat", roles: ['admin', 'comptable', 'financier'] },
    { id: 'compta_journaux_ventes',  icon: '💰', label: 'Journal de Ventes', roles: ['admin', 'comptable', 'financier'] },
    { id: 'compta_journaux_banque',  icon: '🏦', label: 'Journal Banque', roles: ['admin', 'comptable', 'financier'] },
    { id: 'compta_journaux_od',      icon: '📝', label: 'Journal OD', roles: ['admin', 'comptable', 'financier'] },
    { id: 'compta_journaux_salaires', icon: '👥', label: 'Journal Salaires', roles: ['admin', 'comptable', 'financier'] },
    { id: 'compta_journaux_tva',     icon: '🧾', label: 'Journal TVA', roles: ['admin', 'comptable', 'financier'] },
    { id: 'pcge',                    icon: '📒', label: 'PCGE Marocain', roles: ['admin', 'comptable'] },
    { id: 'cpc',                     icon: '📊', label: 'CPC Marocain', roles: ['admin', 'comptable'] },
    { id: 'grand_livre',             icon: '📓', label: 'Grand Livre', roles: ['admin', 'comptable'] },
    { id: 'fec_marocain',            icon: '📤', label: 'FEC Marocain', roles: ['admin', 'comptable'] },
    { id: 'tva_taxes',               icon: '🧾', label: 'TVA & Taxes', roles: ['admin', 'comptable'] },
    { id: 'section-rh', section: 'RESSOURCES HUMAINES', roles: ['admin'] },
    { id: 'rh_recrutement',      icon: '🎯', label: i18n.nav.rh_recrutement, roles: ['admin', 'rh'] },
    { id: 'rh_admin_paie',       icon: '👥', label: i18n.nav.rh_admin_paie, roles: ['admin', 'rh'] },
    { id: 'suivi_temps',         icon: '⏱️', label: i18n.nav.suivi_temps, roles: ['admin', 'rh'] },
    { id: 'temps_absences',      icon: '🕒', label: i18n.nav.temps_absences, roles: ['admin', 'rh'] },
    { id: 'notes_frais',         icon: '🧾', label: i18n.nav.notes_frais, roles: ['admin', 'rh', 'comptable'] },
    { id: 'bulletins',           icon: '📄', label: i18n.nav.bulletins, roles: ['admin', 'rh', 'comptable'] },
    { id: 'rh_developpement',    icon: '📚', label: i18n.nav.rh_developpement, roles: ['admin', 'rh'] },
    { id: 'rh_relations',        icon: '🤝', label: i18n.nav.rh_relations, roles: ['admin', 'rh'] },
    { id: 'section-administration', section: 'ADMINISTRATION', roles: ['admin'] },
    { id: 'admin_users', icon: '🔐', label: 'Administration', roles: ['admin'] },
    { id: 'settings', icon: '⚙️', label: 'Paramètres', roles: ['admin', 'commercial', 'magasinier', 'rh', 'comptable', 'financier', 'technicien', 'employe'] },
    { id: '----------------', roles: ['admin', 'technicien', 'magasinier'] },
    { id: 'vehicules',   icon: '🚛', label: 'Véhicules Lourds', roles: ['technicien'] },
    { id: 'maintenance', icon: '🔧', label: 'Maintenance', roles: ['technicien'] },
    { id: 'atelier',     icon: '🔩', label: 'Atelier', roles: ['technicien'] },
    { id: 'pneus',       icon: '⭕', label: 'Pneumatiques', roles: ['technicien'] },
    { id: 'reporting_global', icon: '📊', label: 'Reporting Global', roles: ['financier'] },
  ];

  const localPreparationNav = navItems.find((item) => item.id === 'magasin_preparation');
  if (localPreparationNav) localPreparationNav.label = 'Préparation locale';
  const importPreparationNavIndex = navItems.findIndex((item) => item.id === 'magasin_expedition');
  if (importPreparationNavIndex >= 0) {
    navItems.splice(importPreparationNavIndex, 0, { id: 'magasin_importation', icon: '🚢', label: 'Préparation importation', roles: ['admin', 'magasinier'] });
  }

  const deptSubItems = useMemo(() => ({
    dept_magasinier: ['magasin_reception','magasin_preparation','magasin_importation','magasin_expedition','magasin_gestion'],
    dept_comptabilite: ['compta_journaux_achats','compta_journaux_ventes','compta_journaux_banque','compta_journaux_od','compta_journaux_salaires','compta_journaux_tva','pcge','cpc','grand_livre','fec_marocain','tva_taxes'],
    dept_rh: ['rh_admin_paie','rh_recrutement','rh_developpement','rh_relations'],
  }), []);

  const navItemsForDisplay = navItems.filter(item =>
    (!item.roles || item.roles.some(role => hasRole(role))) && !disabledPages.includes(item.id));

  const RESETTABLE_KEYS = [
    'is_catalog', 'is_items', 'is_leads', 'is_clients', 'is_saved_docs', 'is_history_log',
    'is_doc_type', 'is_doc_num', 'is_doc_status', 'is_doc_date', 'is_validity_date',
    'is_client', 'is_client_ice', 'is_rep', 'is_supplier', 'is_order_ref', 'is_source_devis',
    'is_payment', 'is_due_date', 'is_parent_fact', 'is_counter_DEV', 'is_counter_BL',
    'is_counter_BC', 'is_counter_FACT', 'is_counter_AVOIR',
  ];

  // SYNCHRONISATION SERVEUR
  const syncTimer = useRef(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (!user || mounted.current) return;
    const alreadyLoaded = localStorage.getItem('is_server_loaded');
    if (alreadyLoaded) { mounted.current = true; return; }
    loadData().then(serverData => {
      if (serverData && typeof serverData === 'object') {
        const serverResetVersion = String(serverData.is_data_reset_version || '');
        const localResetVersion = String(localStorage.getItem('is_data_reset_version') || '');
        const resetState = serverResetVersion && serverResetVersion !== localResetVersion;
        if (resetState) {
          for (const key of RESETTABLE_KEYS) {
            localStorage.removeItem(key);
          }
        }
        for (const [key, val] of Object.entries(serverData)) {
          if (key === 'is_data_reset_version') {
            localStorage.setItem(key, serverResetVersion || '');
            continue;
          }
          try {
            if (typeof val === 'object') {
              localStorage.setItem(key, JSON.stringify(val));
            } else {
              localStorage.setItem(key, String(val));
            }
          } catch {}
        }
      }
      localStorage.setItem('is_server_loaded', '1');
      mounted.current = true;
      window.location.reload();
    });
  }, [user]);

  const syncToServer = useCallback(() => {
    const data = {
      is_theme: activeTheme, is_lang: language, is_currency: currencyKey,
      is_font_size: String(globalFontSize), is_font_family: globalFontFamily, is_font_color: globalFontColor,
      is_company_name: companyName, is_company_address: companyAddress, is_company_phone: companyPhone,
      is_company_email: companyEmail, is_footer: companyFooter, is_logo: companyLogo,
      is_data_reset_version: localStorage.getItem('is_data_reset_version') || '',
      is_brands: brands,
      is_catalog: catalog, is_items: items, is_leads: leads, is_clients: clients,
      is_saved_docs: savedDocs, is_history_log: documentHistory,
      is_doc_type: documentType, is_doc_num: documentNumber, is_doc_status: documentStatus, is_doc_date: documentDate,
      is_validity_date: validityDate, is_client: clientDetails, is_client_ice: clientICE,
      is_rep: representative, is_supplier: supplierName, is_order_ref: orderRef,
      is_source_devis: sourceDevisNumber,
      is_payment: paymentMethod, is_due_date: paymentDueDate, is_parent_fact: parentFactRef,
      is_counter_DEV: peekNextDocNumber('DEV'), is_counter_BL: peekNextDocNumber('BL'),
      is_counter_BC: peekNextDocNumber('BC'), is_counter_FACT: peekNextDocNumber('FACT'),
      is_counter_AVOIR: peekNextDocNumber('AVOIR'),
    };
    saveData(data);
  }, [
    activeTheme, language, currencyKey, globalFontSize, globalFontFamily, globalFontColor,
    companyName, companyAddress, companyPhone, companyEmail, companyFooter, companyLogo,
    brands, catalog, items, leads, clients, savedDocs, documentHistory,
    documentType, documentNumber, documentStatus, documentDate, validityDate, clientDetails, clientICE,
    representative, supplierName, orderRef, sourceDevisNumber, paymentMethod, paymentDueDate, parentFactRef,
  ]);

  useEffect(() => {
    if (!mounted.current) return;
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(syncToServer, 3000);
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [syncToServer]);

  const autoSaveTimer = useRef(null);
  const autoSave = useCallback(() => {
    if (isLocked) return;
    if (!documentNumber && !clientDetails && items.length === 0) return;
    const doc = {
      id: Date.now(),
      number: documentNumber,
      type: documentType,
      status: documentStatus,
      date: documentDate,
      client: clientDetails,
      items: [...items],
      totals: { ht: totals.ht, tva: totals.tva, ttc: totals.ttc },
      currency: currencyKey,
      paid: paymentPaid,
      orderRef: orderRef,
      sourceDevisNumber: sourceDevisNumber,
      supplierName: supplierName,
      representative: representative,
      validityDate: validityDate,
      parentFactRef: parentFactRef,
      timbreFiscal: timbreFiscal,
      acompte: acompte,
      dueDate: paymentDueDate,
    };
    setSavedDocs(prev => {
      const exist = prev.findIndex(d => d.number === doc.number && d.type === doc.type);
      if (exist >= 0) {
        const upd = [...prev];
        upd[exist] = doc;
        return upd;
      }
      return [doc, ...prev.slice(0, 49)];
    });
  }, [isLocked, documentNumber, documentType, documentStatus, documentDate, clientDetails, items, totals, currencyKey, paymentPaid, orderRef, sourceDevisNumber, supplierName, representative, validityDate, parentFactRef, timbreFiscal, acompte, paymentDueDate]);

  useEffect(() => {
    if (!mounted.current) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(autoSave, 4000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [autoSave]);

  const alerteStock = useMemo(() => catalog.filter(c => (c.stockPhysique || 0) <= (c.minStock != null ? c.minStock : 2)), [catalog]);

  const globalStyle = `
    * { box-sizing: border-box; }
    @media screen {
      body, div, span, p, h1, h2, h3, h4, h5, h6, input, textarea, button, select, table, th, td, label {
        font-family: ${globalFontFamily} !important;
        font-size: ${globalFontSize}px !important;
        color: ${globalFontColor} !important;
      }
    }
    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 10px; }
    input[type=number]::-webkit-inner-spin-button { -webkit-appearance: none; }
    input[type=number] { -moz-appearance: textfield; }
    button:hover { opacity: .87; }
    textarea { white-space: pre-wrap !important; word-wrap: break-word !important; overflow-wrap: break-word !important; }
    .document-items-table th,
    .document-items-table td {
      text-align: center !important;
      vertical-align: middle !important;
    }
    .document-item-field {
      display: block !important;
      width: 100% !important;
      margin: 0 auto !important;
      padding: 4px !important;
      text-align: center !important;
      vertical-align: middle !important;
      box-sizing: border-box !important;
      line-height: 18px !important;
    }
    .document-item-designation {
      min-height: 28px !important;
      height: 28px;
      padding: 5px 4px !important;
      resize: none !important;
      overflow: hidden !important;
    }
    @media screen {
      .app-root table.compact-history-table {
        width: min(100%, 900px) !important;
      }
      .app-root table.compact-history-table th {
        height: 34px !important;
        padding: 5px 7px !important;
      }
      .app-root table.compact-history-table td {
        padding: 5px 7px !important;
      }
    }
    .print-payment-methods input[type="radio"] {
      appearance: none !important;
      -webkit-appearance: none !important;
      display: inline-grid !important;
      place-content: center !important;
      width: 11px !important;
      height: 11px !important;
      min-width: 11px !important;
      min-height: 11px !important;
      margin: 0 !important;
      padding: 0 !important;
      border: 1.5px solid #64748b !important;
      border-radius: 50% !important;
      background: #fff !important;
      box-sizing: border-box !important;
    }
    .print-payment-methods input[type="radio"]::before {
      content: "";
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #1377b7;
      transform: scale(0);
    }
    .print-payment-methods input[type="radio"]:checked {
      border-color: #1377b7 !important;
    }
    .print-payment-methods input[type="radio"]:checked::before {
      transform: scale(1);
    }
    @media print {
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .app-root > *:not(style):not(.fleetparts-workspace),
      .fleetparts-workspace > *:not(.fleetparts-main),
      .fleetparts-main > *:not(.print-document-host),
      .print-document-host > *:not(.print-card),
      aside, .no-print, nav { display: none !important; }
      col.no-print { width: 0 !important; }
      html, body, #root, .app-root, .fleetparts-workspace, .fleetparts-main, .print-document-host { display: block !important; margin: 0 !important; padding: 0 !important; width: 210mm !important; height: 297mm !important; min-height: 0 !important; max-height: 297mm !important; overflow: hidden !important; background: white !important; }
      .cd-toggle, .cd-drawer, .cd-overlay { display: none !important; }
      .print-only { display: block !important; }
      .print-card { position: fixed !important; inset: 0 !important; transform: none !important; width: 210mm !important; height: 297mm !important; min-height: 297mm !important; max-height: 297mm !important; overflow: hidden !important; display: flex !important; flex-direction: column !important; break-inside: avoid-page !important; page-break-inside: avoid !important; box-shadow: none !important; border: none !important; border-radius: 0 !important; margin: 0 !important; padding: 6mm !important; box-sizing: border-box !important; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .print-card, .print-card * { font-family: Arial, Helvetica, sans-serif !important; color: #111827 !important; }
      .print-card { font-size: 8pt !important; }
      .print-card td, .print-card th { padding: 2px 3px !important; box-sizing: border-box !important; vertical-align: middle !important; text-align: center !important; }
      .print-card table td:nth-child(2) { text-align: center !important; }
      .print-card table { width: 100% !important; table-layout: fixed !important; border-collapse: collapse !important; border-spacing: 0 !important; border: 1px solid #cbd5e1 !important; }
      .print-card table th, .print-card table td { border: 1px solid #cbd5e1 !important; box-shadow: inset -0.5px 0 #e2e8f0, inset 0 -0.5px #e2e8f0 !important; }
      .print-card table thead tr { border-bottom: 1.5px solid #94a3b8 !important; }
      .print-card table tbody tr { border-bottom: 1px solid #e2e8f0 !important; }
      .print-card table thead th { background: #f8fafc !important; font-weight: 800 !important; }
      .print-card input, .print-card textarea { border: none !important; outline: none !important; box-shadow: none !important; background: transparent !important; }
      .print-header { height: 38mm !important; min-height: 38mm !important; max-height: 38mm !important; padding: 0 0 3mm !important; margin: 0 0 2mm !important; gap: 2mm !important; align-items: flex-start !important; overflow: hidden !important; box-sizing: border-box !important; }
      .print-header > div:first-child { align-items: flex-start !important; }
      .print-logo-column { min-width: 38mm !important; width: 38mm !important; }
      .print-logo-column, .print-company-details, .print-client-box { align-self: flex-start !important; margin-top: 0 !important; padding-top: 0 !important; }
      .print-header img { display: block !important; max-height: 24mm !important; max-width: 40mm !important; object-position: left top !important; }
      .print-company-details input { min-height: 4mm !important; height: 4mm !important; margin: 0 !important; padding: 0 1mm !important; line-height: 1.05 !important; font-size: 8pt !important; }
      .print-company-details input:first-child { font-size: 9pt !important; font-weight: 900 !important; }
      .print-header textarea { display: none !important; }
      .print-client-box { width: 40% !important; border: none !important; background: transparent !important; padding: 0 1mm !important; overflow: hidden !important; }
      .print-client-box > span { position: static !important; display: block !important; padding: 0 !important; margin: 0 0 1mm !important; background: transparent !important; font-size: 8pt !important; }
      .print-client-details { min-height: 20mm !important; max-height: 26mm !important; overflow: hidden !important; white-space: pre-wrap !important; overflow-wrap: anywhere !important; line-height: 1.25 !important; font-size: 9pt !important; font-weight: 700 !important; }
      .print-title { min-height: 10mm !important; padding: 0 !important; margin: 0 0 1mm !important; display: flex !important; align-items: center !important; justify-content: center !important; }
      .print-title > span:first-child { font-size: 8.5pt !important; }
      .print-status { display: none !important; }
      .print-meta { min-height: 14mm !important; margin-bottom: 1mm !important; border-radius: 0 !important; }
      .print-meta > div { padding: 2mm 2mm !important; min-height: 14mm !important; }
      .print-meta input { min-height: 5mm !important; height: 5mm !important; padding: 0 !important; line-height: 1.1 !important; font-size: 8pt !important; }
      .print-summary-grid { grid-template-columns: 1.15fr .75fr 1.1fr !important; gap: 1mm !important; height: 28mm !important; min-height: 28mm !important; max-height: 28mm !important; overflow: hidden !important; }
      .print-summary-grid > div { min-height: 28mm !important; height: 28mm !important; max-height: 28mm !important; padding: 1mm 2mm !important; border-color: #cbd5e1 !important; border-radius: 0 !important; gap: 0 !important; line-height: 1.05 !important; box-sizing: border-box !important; overflow: hidden !important; }
      .print-summary-grid span, .print-summary-grid strong, .print-summary-grid label { font-size: 7pt !important; line-height: 1.05 !important; margin: 0 !important; padding-top: 0 !important; padding-bottom: 0 !important; }
      .print-summary-grid input { min-height: 3.2mm !important; height: 3.2mm !important; padding: 0 !important; font-size: 7pt !important; }
      .print-summary-grid > div > div { min-height: 0 !important; margin: 0 !important; padding-top: .25mm !important; padding-bottom: .25mm !important; }
      .print-payment-methods { display: flex !important; flex-wrap: nowrap !important; justify-content: center !important; gap: 1.5mm !important; height: 4mm !important; overflow: hidden !important; }
      .print-payment-methods label { white-space: nowrap !important; gap: .5mm !important; }
      .print-payment-methods input[type="radio"] { width: 2.5mm !important; height: 2.5mm !important; min-width: 2.5mm !important; min-height: 2.5mm !important; }
      .print-payment-methods input[type="radio"]::before { width: 1.1mm !important; height: 1.1mm !important; }
      .print-payment-row { height: 4mm !important; min-height: 4mm !important; display: flex !important; align-items: center !important; justify-content: center !important; gap: 1mm !important; border-top: 0 !important; }
      .print-totals-box > div { min-height: 4mm !important; align-items: center !important; }
      .print-tax-box { gap: 3px !important; }
      .print-summary-grid + div { padding: 2px 6px !important; margin-top: 2px !important; }
      .print-summary-grid + div textarea { min-height: 14px !important; height: 14px !important; line-height: 1 !important; }
      .print-legal-box { min-height: 22mm !important; max-height: 24mm !important; margin-top: 2mm !important; padding: 2mm 3mm !important; overflow: hidden !important; border: none !important; border-radius: 0 !important; background: #fff !important; }
      .print-legal-box textarea { display: none !important; }
      .print-legal-text { min-height: 12mm !important; max-height: 17mm !important; overflow: hidden !important; white-space: pre-wrap !important; overflow-wrap: anywhere !important; text-align: center !important; line-height: 1.25 !important; }
      .print-brands-box { display: block !important; min-height: 22mm !important; height: 22mm !important; max-height: 22mm !important; overflow: hidden !important; flex: 0 0 22mm !important; margin-top: 1mm !important; padding: 1mm 2mm !important; border: .25mm solid #c4c9cf !important; border-radius: 1.5mm !important; background: #fff !important; }
      .print-brands-grid { display: flex !important; flex-wrap: wrap !important; justify-content: center !important; align-content: center !important; align-items: center !important; gap: 1mm 2mm !important; width: 100% !important; }
      .print-brand-item { display: flex !important; flex: 0 0 calc((100% - 14mm) / 8) !important; max-width: calc((100% - 14mm) / 8) !important; min-width: 0 !important; align-items: center !important; justify-content: center !important; }
      .print-brands-box img { display: block !important; width: 100% !important; height: 7mm !important; max-height: 7mm !important; max-width: 20mm !important; object-fit: contain !important; }
      .print-card textarea { min-height: 18px !important; }
      .print-empty-row { display: table-row !important; height: 7.2mm !important; border-bottom: 1px solid #e2e8f0 !important; background: #fff !important; }
      .print-empty-row td { height: 7.2mm !important; padding: 0 !important; border: 1px solid #e2e8f0 !important; box-shadow: inset -0.5px 0 #f1f5f9, inset 0 -0.5px #f1f5f9 !important; background: #fff !important; }
      .print-card table { font-size: 8pt !important; }
      .print-card table th { font-size: 7.5pt !important; line-height: 1.1 !important; white-space: normal !important; }
      .print-card table :is(input, textarea, span) { font-size: 8pt !important; line-height: 1.15 !important; }
      .print-card tbody tr:not(.print-empty-row) { height: auto !important; }
      .print-card > div { break-inside: avoid-page !important; page-break-inside: avoid !important; }
      .print-table-wrap { flex: 0 0 auto !important; min-height: 0 !important; display: block !important; }
      .print-body-wrap { flex: 0 0 auto !important; min-height: 0 !important; overflow: visible !important; max-height: none !important; }
      .print-body-wrap table { height: auto !important; }
      .app-root { overflow: visible !important; }
      .print-meta { overflow: visible !important; }
      .print-card table { page-break-inside: avoid; break-inside: avoid-page; }
      .print-card tbody { page-break-inside: avoid; break-inside: avoid-page; }
      .print-card tr { page-break-inside: avoid; page-break-after: auto; }
      .print-card thead { display: table-header-group; }
      .print-card tfoot { display: table-footer-group; }
      .print-hidden { display: none !important; }
      @page { size: A4 portrait; margin: 0 !important; }
    }
  `;

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: 'linear-gradient(135deg, #e2f1f1 0%, #ccfbf1 100%)' }}>
        <div style={{ fontSize: 18, color: '#64748b' }}>Chargement...</div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const currentSectionLabel = (activePage === 'chiffrage'
    ? navItems.find((item) => item.id === activePage && item.type === documentType)?.label
    : navItems.find((item) => item.id === activePage)?.label)
    || (activePage.startsWith('compta_') ? 'Comptabilité'
      : activePage.startsWith('rh_') ? 'Ressources humaines'
      : activePage.startsWith('magasin_') ? 'Gestion du magasin'
      : 'Espace de travail');
  const filteredNavItems = navItemsForDisplay.filter((item) => {
    if (item.id === '----------------') return !menuSearch;
    if (item.section) return !menuSearch;
    return String(item.label || '').toLocaleLowerCase('fr').includes(menuSearch.trim().toLocaleLowerCase('fr'));
  });
  const usageSortedNavItems = hasRole('admin') || menuSearch
    ? filteredNavItems
    : filteredNavItems.filter(item => item.id !== '----------------').sort((a, b) => {
        if (a.id === 'home') return -1;
        if (b.id === 'home') return 1;
        if (a.id === 'settings') return 1;
        if (b.id === 'settings') return -1;
        return Number(navUsage[b.id] || 0) - Number(navUsage[a.id] || 0);
      });
  const fixedLastIds = ['received_documents', 'hist', 'saved', 'settings'];
  const visibleNavItems = [
    ...usageSortedNavItems.filter(item => !fixedLastIds.includes(item.id)),
    ...fixedLastIds.flatMap(id => usageSortedNavItems.filter(item => item.id === id)),
  ];

  return (
    <div className="app-root fleetparts-shell" data-section={activePage} data-user-role={user?.role || 'anonymous'} data-language={contextLanguage} data-currency={currencyKey} data-theme={effectiveTheme} data-theme-mode={activeTheme} style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: theme.bg, '--theme-canvas': theme.bg, '--theme-surface': theme.surface || '#fff', '--theme-soft': theme.light || '#f7f7f7', '--theme-border': theme.border || '#d9dde3', '--theme-text': theme.text || '#172033', '--theme-accent': theme.btn, '--app-bg': theme.bg, '--app-surface': theme.surface || '#fff', '--app-surface-muted': theme.light || '#f7f7f7', '--app-border': theme.border || '#d9dde3', '--app-text': globalFontColor, '--app-muted': globalFontColor, '--app-accent': theme.btn, '--user-text-color': globalFontColor, '--user-font-family': globalFontFamily, '--user-font-size': `${globalFontSize}px`, fontFamily: globalFontFamily, overflow: 'hidden', fontSize: `${globalFontSize}px`, color: globalFontColor }}>
      <style nonce={cspNonce}>{globalStyle}</style>
      <input type="file" ref={logoInputRef} onChange={handleLogoUpload} accept="image/*" style={{ display: 'none' }} />
      <input type="file" ref={brandInputRef} onChange={handleBrandLogoUpload} accept="image/*" style={{ display: 'none' }} />
      <Notification msg={notification.msg} type={notification.type} title={notification.title} action={notification.action} secondaryAction={notification.secondaryAction} onClose={closeNotify} />

      {/* HEADER */}
      <div className="no-print fleetparts-topbar" style={{ background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(20px)', borderBottom: '1px solid rgba(226,232,240,0.7)', padding: '10px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 20, gap: 12 }}>
        <div className="fleetparts-topbar-context" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button aria-label={sidebarCollapsed ? 'Ouvrir le menu' : 'Fermer le menu'} aria-expanded={!sidebarCollapsed} onClick={() => { if (sidebarTimer.current) clearTimeout(sidebarTimer.current); setSidebarCollapsed(prev => !prev); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 22, color: '#475569' }}>☰</button>
          <div className="fleetparts-current-section">
            <strong>{currentSectionLabel}</strong>
            <span>IntelSpark ERP-AH</span>
          </div>
          {alerteStock.length > 0 && (
            <div style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, padding: '4px 10px', fontSize: 11, fontWeight: 700, color: '#92400e', cursor: 'pointer' }}
              onClick={() => setActivePage('stock')} title={t.alertRestock}>
              ⚠️ {alerteStock.length} {alerteStock.length > 1 ? t.alertCountPlural : t.alertCountSingular}
            </div>
          )}
        </div>
        <div className="fleetparts-topbar-actions" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <button onClick={() => setShowDocHistory(true)} style={S.btnGhost}>📁 {t.savedDocs}</button>
          <button onClick={() => { setDrawerSection('msgs'); setDrawerOpen(true); }} style={S.btnGhost}>Messages</button>
          <button onClick={handleCreateNewPage} style={S.btn('#2563eb')}>Nouvelle page</button>
          <div style={{ position: 'relative' }}>
            <button onClick={() => setShowExportMenu(!showExportMenu)} style={S.btn()}>⏷ {t.exportBtn}</button>
            {showExportMenu && (
              <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, boxShadow: '0 12px 40px rgba(0,0,0,0.12)', zIndex: 50, minWidth: 190, overflow: 'hidden' }}>
                <button type="button" onClick={() => { handleExportPDF(); setShowExportMenu(false); }} disabled={isExporting} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '11px 16px', fontSize: 'inherit', cursor: 'pointer', color: '#374151', fontWeight: 700 }}>📄 {isExporting ? t.generating : t.exportPDFBtn}</button>
                <button type="button" onClick={() => { handlePrint(); setShowExportMenu(false); }} style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', border: 'none', padding: '11px 16px', fontSize: 'inherit', cursor: 'pointer', color: '#374151', fontWeight: 700 }}>🖨️ {t.print}</button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* MODAL DOCUMENTS SAUVEGARDÉS */}
      {showDocHistory && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: '#fff', borderRadius: 18, padding: 28, width: 900, maxHeight: '90vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 8 }}>
              <button onClick={() => setShowDocHistory(false)} style={{ background: 'none', border: 'none', fontSize: 22, cursor: 'pointer', color: '#94a3b8' }}>×</button>
            </div>
            <DocumentsSauvegardes
              savedDocs={savedDocs}
              onView={handleLoadDoc}
              onDelete={async (doc) => {
                if (!(await systemConfirm(`Supprimer ${doc.number || 'ce document'} ?`))) return;
                setSavedDocs(previous => previous.filter(item => !(item.id === doc.id || (item.type === doc.type && item.number === doc.number))));
              }}
              onChangeCurrency={(code) => { try { ls.set('is_currency', code); } catch {} }}
              language={language}
            />
          </div>
        </div>
      )}

      <div className="fleetparts-workspace" style={{ flex: 1, display: 'flex' }}>

        {/* SIDEBAR */}
        {!sidebarCollapsed && <div onClick={() => setSidebarCollapsed(true)} style={{ position: 'fixed', inset: 0, zIndex: 30, background: 'rgba(0,0,0,0.15)' }} />}
        <aside className={`no-print fleetparts-sidebar ${sidebarCollapsed ? 'fleetparts-sidebar-collapsed' : 'fleetparts-sidebar-open'}`} style={{ width: sidebarCollapsed ? 0 : 252, minWidth: sidebarCollapsed ? 0 : 252, overflow: 'hidden', transition: 'min-width .22s', background: 'rgba(255,255,255,0.9)', backdropFilter: 'blur(20px)', borderRight: '1px solid rgba(226,232,240,0.7)', display: 'flex', flexDirection: 'column', padding: sidebarCollapsed ? 0 : '16px 12px', gap: 8, overflowY: 'auto', zIndex: 31, position: 'relative' }}>
          <div className="fleetparts-brand">
            <IntelSheetsLogo size={42} />
            <div><strong>IntelSpark</strong><span>ERP-AH</span></div>
          </div>
          <label className="fleetparts-menu-search">
            <span>Rechercher une page</span>
            <input value={menuSearch} onChange={(event) => setMenuSearch(event.target.value)} placeholder="Ventes, stock, RH..." />
          </label>
          <nav style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {visibleNavItems.map((item, i) => {
              if (item.section) return <div key={item.id} className="fleetparts-nav-section">{item.section}</div>;
              if (item.id === '----------------') {
                return <div key={i} style={{ height: 1, background: '#e2e8f0', margin: '4px 0' }} />;
              }
              const active = activePage === item.id && (!item.type || documentType === item.type);
              return (
                <button key={i} onClick={() => { const targetId = item.id.startsWith('dept_') ? (deptSubItems[item.id]?.[0] || item.id) : item.id; const nextUsage = { ...navUsage, [targetId]: Number(navUsage[targetId] || 0) + 1 }; setNavUsage(nextUsage); ls.setJSON(`nav_usage_${user?.id || 'anonymous'}`, nextUsage); if (item.type) handleOpenDocumentType(item.type); else setActivePage(targetId); setSidebarCollapsed(true); }}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, border: 'none', background: active ? theme.light : 'transparent', color: active ? theme.btn : '#64748b', fontWeight: active ? 800 : 600, fontSize: 'inherit', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', borderLeft: active ? `3px solid ${theme.btn}` : '3px solid transparent' }}>
                  <span style={{ fontSize: 15 }}>{item.icon}</span><span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </aside>

        {/* MAIN */}
        <main className="fleetparts-main" style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <header className="fleetparts-page-heading no-print">
            <div>
              <span>OPÉRATIONS</span>
              <h1>{currentSectionLabel}</h1>
              <p>Gérez vos opérations, vos données et vos équipes depuis un espace unifié.</p>
            </div>
          </header>

          {activePage === 'home' && (
            <RoleHome
              user={user}
              navigation={navItemsForDisplay}
              onNavigate={(item) => { if (item.type) handleOpenDocumentType(item.type); else setActivePage(item.id); }}
            />
          )}

          {/* ============================== DOCUMENT (DEV/BL/BC/FACT) ============================== */}
          {activePage === 'chiffrage' && (
            <div className="print-document-host" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="no-print" style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '12px 16px' }}>
                <span style={{ fontWeight: 900, fontSize: 'inherit', color: '#475569' }}>{docTitle}</span>
                <input value={documentNumber} onChange={e => { if (!isLocked) setDocumentNumber(e.target.value); }}
                  style={{ ...S.textInput, width: 200, fontWeight: 700, fontSize: 'inherit', color: theme.btn }}
                  readOnly={isLocked} />
                <StatusBadge status={documentStatus} t={t} />
                <div style={{ flex: 1 }} />
                {!isLocked && items.length > 0 && (
                  <button key="btn-validate" onClick={handleValidateDocument} style={S.btn('#f59e0b')}>🔒 {t.validateDoc}</button>
                )}
                {documentStatus === 'validated' && documentType === 'DEV' && (
                  <button key="btn-dev2bl" onClick={() => handleConvert('BL')} style={S.btn('#3b82f6')}>{t.convertToBL}</button>
                )}
                {documentStatus === 'validated' && documentType === 'DEV' && (
                  <button key="btn-dev-fact" onClick={() => handleConvert('FACT')} style={S.btn('#8b5cf6')}>{t.convertToFact}</button>
                )}
                {documentStatus === 'validated' && documentType === 'BL' && (
                  <button key="btn-bl-fact" onClick={() => handleConvert('FACT')} style={S.btn('#8b5cf6')}>{t.convertToFact}</button>
                )}
                {documentStatus === 'validated' && documentType === 'FACT' && (
                  <button key="btn-fact2avoir" onClick={() => handleConvert('AVOIR')} style={S.btn('#dc2626')}>🔄 {t.convertToAvoir}</button>
                )}
                {isLocked && (
                  <span key="span-lockmsg" style={{ fontSize: 'inherit', color: '#ef4444', fontWeight: 700 }}>🔒 {t.lockMsg}</span>
                )}
              </div>

              {!isLocked && (
                <form onSubmit={handleAddItem} className="no-print" style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'flex-end', justifyContent: 'center', flexWrap: 'wrap', padding: 14, width: '100%', maxWidth: 1180, margin: '0 auto', boxSizing: 'border-box' }}>
                  <div style={{ width: 180 }}>
                    <label style={S.label}>{t.refLabel}</label>
                    <input value={searchRef} onChange={e => handleRefChange(e.target.value)} placeholder={t.refPlaceholder} required
                      list="catalog-refs"
                      style={{ ...S.textInput, fontFamily: 'monospace', fontWeight: 700 }} />
                    <datalist id="catalog-refs">{catalog.map(c => <option key={c.ref} value={c.ref}>{c.name}</option>)}</datalist>
                  </div>
                  <div style={{ flex: 2, minWidth: 160 }}>
                    <label style={S.label}>{t.descLabel}</label>
                    <input value={manualName} onChange={e => setManualName(e.target.value)} placeholder={t.descPlaceholder}
                      style={{ ...S.textInput, background: '#fff', textAlign: 'center' }} required />
                  </div>
                  <div style={{ width: 80 }}>
                    <label style={S.label}>{t.qtyLabel}</label>
                    <input type="number" min="1" step="1" value={manualQty} onChange={e => setManualQty(e.target.value)} style={{ ...S.textInput, textAlign: 'center' }} required />
                  </div>
                  <div style={{ width: 130 }}>
                    <label style={S.label}>{t.priceLabel} ({currencySymbol})</label>
                    <input type="number" min="0" step="0.01" value={manualPrice} onChange={e => setManualPrice(e.target.value)} placeholder="0.00" style={{ ...S.textInput, textAlign: 'right' }} required />
                  </div>
                  <button type="submit" style={{ ...S.btn(), height: 36 }}>{t.addBtn}</button>
                </form>
              )}

              {/* DOCUMENT IMPRIMABLE */}
              <div ref={documentRef} className="print-card" style={{
                background: '#fff', width: '100%', maxWidth: '1180px', margin: '0 auto',
                padding: '6mm 8mm', borderRadius: 8, border: '1px solid #cbd5e1',
                boxShadow: '0 4px 20px rgba(0,0,0,0.07)', display: 'flex', flexDirection: 'column',
                fontFamily: globalFontFamily, fontSize: `${globalFontSize}px`, color: globalFontColor,
                boxSizing: 'border-box', flex: '0 0 auto', minHeight: 0,
              }}>
                {/* EN-TÊTE */}
                <div className="print-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'stretch', paddingBottom: 6, borderBottom: '2px solid #cbd5e1', marginBottom: 6, gap: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4, flex: 1 }}>
                    <div className="print-logo-column" style={{ minWidth: 210 }}>
                      <div onClick={() => !isLocked && logoInputRef.current.click()} style={{ cursor: !isLocked ? 'pointer' : 'default' }}>
                        {companyLogo ? (
                          <img src={companyLogo} alt="Logo" style={{ maxHeight: 145, maxWidth: 230, objectFit: 'contain', borderRadius: 6 }} />
                        ) : (
                          <div style={{ background: '#f1f5f9', border: '2px dashed #cbd5e1', borderRadius: 6, padding: '20px 18px', fontSize: 'inherit', color: '#94a3b8', fontWeight: 700, textAlign: 'center', minHeight: 65, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{t.addLogo}</div>
                        )}
                      </div>
                      {companyLogo && !isLocked && canDelete && (
                        <button onClick={() => setCompanyLogo(null)} className="no-print admin-delete-action" style={{ background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca', borderRadius: 4, fontSize: 'inherit', padding: '2px 6px', cursor: 'pointer', fontWeight: 700, marginTop: 3 }}>{t.deleteLogo}</button>
                      )}
                    </div>
                    <div className="print-company-details" style={{ flex: 1 }}>
                      <input value={companyName} onChange={e => setCompanyName(e.target.value)} placeholder={t.companyPlaceholder}
                        style={{ ...S.input, fontSize: 24, fontWeight: 900, color: theme.btn, marginBottom: 5 }} readOnly={isLocked} />
                      <input value={companyAddress} onChange={e => setCompanyAddress(e.target.value)} placeholder={t.addressPlaceholder}
                        style={{ ...S.input, fontSize: 'inherit', color: '#64748b', marginBottom: 2 }} readOnly={isLocked} />
                      <input value={companyPhone} onChange={e => setCompanyPhone(e.target.value)} placeholder={t.phonePlaceholder}
                        style={{ ...S.input, fontSize: 'inherit', color: '#64748b', marginBottom: 2 }} readOnly={isLocked} />
                      <input value={companyEmail} onChange={e => setCompanyEmail(e.target.value)} placeholder="Email..."
                        style={{ ...S.input, fontSize: 'inherit', color: '#64748b', marginBottom: 2 }} readOnly={isLocked} />
                    </div>
                  </div>
                  <div className="print-client-box" style={{ border: '2px solid #cbd5e1', borderRadius: 6, padding: '14px 12px 10px', width: 390, minHeight: 120, background: '#f8fafc', position: 'relative' }}>
                    <span style={{ ...S.label, position: 'absolute', top: -10, left: 10, background: '#f8fafc', padding: '0 6px', marginBottom: 0, fontSize: 'inherit', fontWeight: 800, color: theme.btn }}>{documentType === 'BC' ? t.fournisseur : t.destinatary}</span>
                    <div className="no-print" style={{ marginBottom: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                      <button onClick={() => setShowClientModal(true)} style={{ ...S.btn(), fontSize: 'inherit', padding: '3px 8px' }}>{documentType === 'BC' ? t.chooseSupplier : t.chooseClient}</button>
                      {clientDetails && <button onClick={() => { if (!isLocked) { setClientDetails(''); setClientICE(''); } }} style={{ background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}>✕</button>}
                    </div>
                    <textarea rows={4} value={clientDetails} onChange={e => { if (!isLocked) setClientDetails(e.target.value); }} placeholder={t.clientPlaceholder}
                      style={{ ...S.input, resize: 'vertical', fontSize: 'inherit', lineHeight: 1.5, minHeight: 70, fontWeight: 600 }} readOnly={isLocked} />
                    <div className="print-only print-client-details">{clientDetails || 'Coordonnées client non renseignées'}</div>
                    {clientICE && <div style={{ fontSize: 'inherit', color: '#64748b', marginTop: 2 }}>{t.iceLabel}: <strong>{clientICE}</strong></div>}
                  </div>
                </div>

                {showClientModal && (
                  <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.35)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 500, maxHeight: '70vh', overflow: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                        <span style={{ fontWeight: 900, fontSize: 15 }}>{t.selectClient}</span>
                        <button onClick={() => setShowClientModal(false)} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer' }}>×</button>
                      </div>
                      {clients.map(c => (
                        <div key={c.id} onClick={() => handleSelectClient(c)} style={{ padding: '10px 14px', borderRadius: 8, border: '1px solid #e2e8f0', marginBottom: 8, cursor: 'pointer', background: '#f8fafc' }}
                          onMouseEnter={e => e.currentTarget.style.background = theme.light}
                          onMouseLeave={e => e.currentTarget.style.background = '#f8fafc'}>
                          <div style={{ fontWeight: 700, color: theme.btn, fontSize: 'inherit' }}>{c.name}</div>
                          <div style={{ fontSize: 'inherit', color: '#64748b' }}>{t.iceLabel}: {c.ice} | {c.phone}</div>
                          <div style={{ fontSize: 'inherit', color: '#94a3b8' }}>{c.address}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* TITRE */}
                <div className="print-title" style={{ textAlign: 'center', padding: '4px 0', marginBottom: 4 }}>
                  <span style={{ fontWeight: 900, fontSize: 'inherit', letterSpacing: '0.1em', color: '#475569', textTransform: 'uppercase' }}>{docTitle} N° {documentNumber}</span>
                  {documentType === 'AVOIR' && parentFactRef && (
                    <span key="span-avoir-ref" style={{ fontWeight: 700, fontSize: 'inherit', color: '#dc2626', marginLeft: 8 }}>— {t.docFact} {parentFactRef}</span>
                  )}
                  <span className="print-status" style={{ marginLeft: 12 }}><StatusBadge status={documentStatus} t={t} /></span>
                </div>

                {/* MÉTADONNÉES */}
                {(() => {
                  const cols = [];
                  if (documentType === 'BC') {
                    cols.push([t.vRef, orderRef, setOrderRef]);
                    cols.push([t.fournisseur, supplierName, setSupplierName]);
                    cols.push([t.dateDoc, documentDate, setDocumentDate]);
                  } else {
                    cols.push([documentType === 'BL' ? 'Chauffeur / Livreur' : t.representative, representative, setRepresentative]);
                    cols.push([t.dateDoc, documentDate, setDocumentDate]);
                    if (documentType === 'AVOIR' && parentFactRef) {
                      cols.push([t.factOrig, parentFactRef, () => {}]);
                    }
                  }
                  return (
                    <div className="print-meta" style={{ display: 'grid', gridTemplateColumns: `repeat(${cols.length}, 1fr)`, border: '2px solid #94a3b8', borderRadius: 5, overflow: 'hidden', marginBottom: 5 }}>
                      {cols.map(([label, val, setter], i) => (
                        <div key={i} style={{ padding: '5px 8px', borderRight: i < cols.length - 1 ? '2px solid #94a3b8' : 'none', background: '#fff' }}>
                          <span style={{ ...S.label, fontSize: 'inherit', marginBottom: 2 }}>{label}</span>
                          <input value={val} onChange={e => { if (!isLocked) setter(e.target.value); }}
                            style={{ ...S.input, fontSize: 'inherit', fontWeight: 700, color: i === cols.length - 1 ? theme.btn : '#475569' }}
                            readOnly={isLocked} />
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* TABLEAU ARTICLES */}
                <div ref={tableWrapRef} className="print-table-wrap" style={{ border: '2px solid #94a3b8', borderRadius: 5, marginBottom: 5, display: 'flex', flexDirection: 'column', width: '100%', boxSizing: 'border-box' }}>
                  <table className="document-items-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <colgroup>
                      {!isLocked && <col key="col-del" className="no-print" style={{ width: '4%' }} />}
                      {(isLocked ? [12, 28, 7, 14, 10, 14] : [12, 26, 7, 13, 9, 13]).map((width, index) => (
                        <col key={`col-head-${index}`} style={{ width: `${width}%` }} />
                      ))}
                    </colgroup>
                    <thead>
                      <tr>
                        {!isLocked && <th key="th-del" style={{ ...S.tableHeader, borderRight: 'none', textAlign: 'center' }} className="no-print" />}
                        {[t.refLabel, t.descLabel, t.qtyLabel, t.priceLabel, 'Remise %', t.montantHT].map((h, i) => (
                          <th key={i} style={{ ...S.tableHeader, textAlign: 'center', padding: '6px 3px' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                  </table>
                  <div ref={bodyWrapRef} style={{ background: '#fff' }} className="print-body-wrap">
                    <table className="document-items-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                      <colgroup>
                        {!isLocked && <col key="col-del2" className="no-print" style={{ width: '4%' }} />}
                        {(isLocked ? [12, 28, 7, 14, 10, 14] : [12, 26, 7, 13, 9, 13]).map((width, index) => (
                          <col key={`col-body-${index}`} style={{ width: `${width}%` }} />
                        ))}
                      </colgroup>
                      <tbody>
                        {items.map((item, index) => {
                          const amtHT_MAD = (item.priceHT || 0) * (item.qty || 1) * (1 - Math.min(100, Math.max(0, Number(item.discount || 0))) / 100);
                          return (
                            <tr key={index} style={{ borderBottom: '1px solid #e2e8f0', background: index % 2 === 0 ? '#fff' : '#fafbfc' }}>
                              {!isLocked && (
                                <td className="no-print" style={{ padding: '4px 3px', textAlign: 'center', verticalAlign: 'middle' }}>
                                  {canDelete && <button className="admin-delete-action" onClick={() => removeItem(index)} title="Supprimer" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 900, fontSize: 14, lineHeight: 1 }}>×</button>}
                                </td>
                              )}
                              <td style={{ padding: '2px 3px', borderRight: '2px solid #94a3b8', verticalAlign: 'middle' }}>
                                <input className="document-item-field" value={item.ref} readOnly
                                  style={{ ...S.input, textAlign: 'center', fontWeight: 700, color: theme.btn, fontSize: 'inherit', fontFamily: 'monospace' }} />
                              </td>
                              <td style={{ padding: '2px 3px', borderRight: '2px solid #94a3b8', verticalAlign: 'middle', textAlign: 'center' }}>
                                <textarea className="document-item-field document-item-designation" value={item.name}
                                  onChange={e => updateItem(index, 'name', e.target.value)} readOnly={isLocked}
                                  style={{ ...S.input, fontSize: 'inherit', fontWeight: 600, textAlign: 'center' }}
                                  onInput={e => { e.target.style.height = '28px'; e.target.style.height = `${Math.max(28, e.target.scrollHeight)}px`; }} />
                              </td>
                              <td style={{ padding: '2px 3px', borderRight: '2px solid #94a3b8', verticalAlign: 'middle', textAlign: 'center' }}>
                                <input className="document-item-field" type="number" min="1" value={item.qty} onChange={e => updateItem(index, 'qty', Number(e.target.value))} readOnly={isLocked}
                                  style={{ ...S.input, textAlign: 'center', fontWeight: 700, fontSize: 'inherit' }} />
                              </td>
                              <td style={{ padding: '2px 3px', borderRight: '2px solid #94a3b8', verticalAlign: 'middle', textAlign: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1 }}>
                                  <input className="document-item-field" value={convertPrice(item.priceHT).toFixed(2)} onChange={e => updateItem(index, 'priceHT', e.target.value)} readOnly={isLocked}
                                    style={{ ...S.input, textAlign: 'center', fontWeight: 600, fontSize: 'inherit', width: '80%' }} />
                                </div>
                              </td>
                              <td style={{ padding: '2px 3px', borderRight: '2px solid #94a3b8', verticalAlign: 'middle', textAlign: 'center' }}>
                                <input className="document-item-field" type="number" min="0" max="100" value={item.discount || 0} onChange={e => updateItem(index, 'discount', Math.min(100, Math.max(0, Number(e.target.value))))} readOnly={isLocked}
                                  style={{ ...S.input, textAlign: 'center', fontWeight: 700, fontSize: 'inherit' }} />
                              </td>
                              <td style={{ padding: '2px 3px', verticalAlign: 'middle', textAlign: 'center' }}>
                                <span style={{ fontSize: 'inherit', fontWeight: 700, color: theme.btn, display: 'block', textAlign: 'center' }}>
                                  {convertPrice(amtHT_MAD).toFixed(2)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                        {emptyRows.map((_, i) => (
                          <tr key={`e${i}`} className="print-empty-row" style={{ height: 32, background: '#fff' }}>
                            {[...Array(!isLocked ? 7 : 6)].map((__, j) => {
                              const isDel = !isLocked && j === 0;
                              return (
                                <td key={j} className={isDel ? 'no-print' : ''} style={{ padding: 3, textAlign: 'center', color: '#eef0f3' }}>&nbsp;</td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* PIED DE PAGE : PAIEMENT + TOTAUX */}
                <div style={{ marginBottom: 5 }}>
                  <div className="print-summary-grid" style={{ display: 'grid', gridTemplateColumns: '1.15fr .75fr 1.1fr', gap: 8 }}>
                    <div className="print-payment-box" style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', background: '#f8fafc' }}>
                      <span style={{ ...S.label, textAlign: 'center', display: 'block', marginBottom: 5, fontSize: 'inherit' }}>{t.paymentMethod}</span>
                      <div className="print-payment-methods" style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'center' }}>
                        {[t.paymentCheque, t.paymentCash, t.paymentTransfer, t.paymentEffet].map(m => (
                          <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 'inherit', fontWeight: 600 }}>
                            <input type="radio" name="paymentMethod" checked={paymentMethod === m} onChange={() => { if (!isLocked) setPaymentMethod(m); }} style={{ accentColor: theme.btn, width: 10, height: 10 }} />{m}
                          </label>
                        ))}
                      </div>
                      <div className="print-payment-row" style={{ borderTop: '1px dashed #e2e8f0', marginTop: 5, paddingTop: 4, fontSize: 'inherit', color: '#64748b', textAlign: 'center' }}>
                        {t.dueDate}: <input value={paymentDueDate} onChange={e => { if (!isLocked) setPaymentDueDate(e.target.value); }}
                          style={{ ...S.input, display: 'inline', width: 90, fontWeight: 700, textDecoration: 'underline', fontSize: 'inherit' }} readOnly={isLocked} />
                      </div>
                      <div className="print-payment-row" style={{ borderTop: '1px dashed #e2e8f0', marginTop: 5, paddingTop: 4, fontSize: 'inherit', color: '#64748b', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
                        <span>{t.timbreFiscal}:</span>
                        <input type="number" min="0" step="0.1" value={timbreFiscal} onChange={e => { if (!isLocked) setTimbreFiscal(Math.max(0, Number(e.target.value))); }}
                          style={{ ...S.input, display: 'inline', width: 60, fontWeight: 700, textAlign: 'right', fontSize: 'inherit' }} readOnly={isLocked} />
                        <span style={{ fontSize: 'inherit' }}>{currencySymbol}</span>
                      </div>
                      <div className="print-payment-row" style={{ borderTop: '1px dashed #e2e8f0', marginTop: 5, paddingTop: 4, fontSize: 'inherit', color: '#64748b', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 6 }}>
                        <span>{t.acompte}:</span>
                        <input type="number" min="0" step="0.01" value={acompte} onChange={e => { if (!isLocked) setAcompte(Math.max(0, Number(e.target.value))); }}
                          style={{ ...S.input, display: 'inline', width: 70, fontWeight: 700, textAlign: 'right', fontSize: 'inherit' }} readOnly={isLocked} />
                        <span style={{ fontSize: 'inherit' }}>{currencySymbol}</span>
                      </div>
                      {paymentPaid && <div style={{ textAlign: 'center', marginTop: 4, fontSize: 'inherit', fontWeight: 800, color: '#10b981' }}>✅ {t.paid}</div>}
                    </div>

                    <div className="print-tax-box" style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 10px', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
                      <span style={{ ...S.label, textAlign: 'center', display: 'block', marginBottom: 2, fontWeight: 900 }}>TAXES</span>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}><span>TVA %</span><strong>{docTvaRate}</strong></div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                        <span>{t.discountLabel} %</span>
                        <strong>{totals.brut > 0 ? ((totals.discount / totals.brut) * 100).toFixed(2) : '0.00'}</strong>
                      </div>
                    </div>

                    <div className="print-totals-box" style={{ border: '1px solid #e2e8f0', borderRadius: 6, padding: '8px 12px', background: '#f8fafc', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 3 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'inherit', color: '#475569' }}>
                        <span>{t.totalHT}</span><span style={{ fontWeight: 800 }}>{totals.ht.toFixed(2)} {currencySymbol}</span>
                      </div>
                      {(() => {
                        const tvaByRate = {};
                        items.forEach(i => {
                          const rate = i.tvaRate != null ? i.tvaRate : docTvaRate;
                          const ht = (i.priceHT || 0) * (i.qty || 1) * (1 - Math.min(100, Math.max(0, Number(i.discount || 0))) / 100);
                          tvaByRate[rate] = (tvaByRate[rate] || 0) + ht * (rate / 100);
                        });
                        return Object.entries(tvaByRate).map(([rate, tva]) => (
                          <div key={rate} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'inherit', color: '#475569' }}>
                            <span>TVA {rate}%</span><span style={{ fontWeight: 700 }}>{convertPrice(tva).toFixed(2)} {currencySymbol}</span>
                          </div>
                        ));
                      })()}
                      {timbreFiscal > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'inherit', color: '#475569' }}>
                          <span>{t.timbreFiscal}</span><span style={{ fontWeight: 700 }}>{timbreFiscal.toFixed(2)} {currencySymbol}</span>
                        </div>
                      )}
                      {acompte > 0 && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'inherit', color: '#475569' }}>
                          <span>{t.acompteVerse}</span><span style={{ fontWeight: 700, color: '#10b981' }}>−{acompte.toFixed(2)} {currencySymbol}</span>
                        </div>
                      )}
                      <div style={{ display: 'flex', justifyContent: 'space-between', borderTop: acompte > 0 ? 'none' : '2px solid #cbd5e1', paddingTop: acompte > 0 ? 0 : 4, marginTop: acompte > 0 ? 0 : 2 }}>
                        <span style={{ fontSize: 'inherit', fontWeight: 800, color: '#475569', textTransform: 'uppercase' }}>{t.netToPay}</span>
                        <span style={{ fontWeight: 900, fontSize: 14, color: theme.btn }}>{totals.ttc.toFixed(2)} {currencySymbol}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* FOOTER RÉGLEMENTAIRE */}
                <div className="print-legal-box" style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '5px 10px', background: '#f8fafc', marginTop: 'auto' }}>
                  <div style={{ fontSize: 'inherit', fontWeight: 800, color: theme.btn, textAlign: 'center', borderBottom: '1px dashed #cbd5e1', paddingBottom: 3, marginBottom: 3 }}>⚖️ {t.footerLabel}</div>
                  <textarea value={companyFooter} onChange={e => setCompanyFooter(e.target.value)} rows={2}
                    style={{ ...S.input, fontSize: 'inherit', lineHeight: 1.4, background: 'transparent', resize: 'none', textAlign: 'center', minHeight: 28 }} readOnly={isLocked} />
                  <div className="print-only print-legal-text">{companyFooter || 'Saisissez vos informations réglementaires.'}</div>
                </div>

                {/* MARQUES */}
                <div className="no-print" style={{ display: 'flex', justifyContent: 'center', marginTop: 3, marginBottom: 2 }}>
                  <button onClick={() => setEditMode(!editMode)} style={{ background: editMode ? '#f59e0b' : '#64748b', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 10px', fontWeight: 700, fontSize: 10, cursor: 'pointer', fontFamily: 'inherit' }}>✎ {editMode ? 'Édition ON' : 'Édition'}</button>
                </div>
                <div className="print-brands-box" style={{ border: '1px solid #cbd5e1', borderRadius: 6, padding: '5px 8px', background: '#fff', marginTop: 3 }}>
                  {brands.length > 0 && (
                    <div className="print-brands-grid" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, justifyContent: 'center', alignItems: 'center' }}>
                      {brands.map((b, i) => (
                        <div key={b.id} className="print-brand-item" style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                          {editMode && !isLocked && (
                            <div className="no-print" style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                              <button onClick={() => moveBrand(b.id, -1)} disabled={i === 0} style={{ background: 'none', border: 'none', cursor: i === 0 ? 'default' : 'pointer', color: i === 0 ? '#d1d5db' : '#475569', fontSize: 10, padding: 0, lineHeight: 1 }}>▲</button>
                              <button onClick={() => moveBrand(b.id, 1)} disabled={i === brands.length - 1} style={{ background: 'none', border: 'none', cursor: i === brands.length - 1 ? 'default' : 'pointer', color: i === brands.length - 1 ? '#d1d5db' : '#475569', fontSize: 10, padding: 0, lineHeight: 1 }}>▼</button>
                            </div>
                          )}
                          <div style={{ position: 'relative' }}>
                            <img src={b.logo} alt="logo marque" style={{ height: 30, maxWidth: 80, objectFit: 'contain' }} />
                            {editMode && !isLocked && canDelete && (
                              <button onClick={() => removeBrand(b.id)} className="no-print admin-delete-action" title="Supprimer" style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff', border: 'none', borderRadius: '50%', width: 16, height: 16, fontSize: 10, cursor: 'pointer', lineHeight: 1, padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>×</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  {editMode && !isLocked && (
                    <div className="no-print" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', marginTop: brands.length > 0 ? 5 : 0 }}>
                      <button onClick={() => brandInputRef.current.click()} style={S.btn('#0d9488')}>+ Logo</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================== CATALOGUE ============================== */}
          {activePage === 'catalogue' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <form onSubmit={handleAddCatalog} style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 16 }}>
                <div style={{ width: 160 }}><label style={S.label}>{t.refLabel} *</label><input value={catRef} onChange={e => setCatRef(e.target.value)} placeholder="P-106" required style={S.textInput} /></div>
                <div style={{ flex: 2, minWidth: 180 }}><label style={S.label}>{t.descLabel} *</label><input value={catName} onChange={e => setCatName(e.target.value)} placeholder={t.descPlaceholder} required style={S.textInput} /></div>
                <div style={{ width: 110 }}><label style={S.label}>{t.priceLabel} ({currencySymbol}) *</label><input value={catPrice} onChange={e => setCatPrice(e.target.value)} placeholder="0.00" required style={{ ...S.textInput, textAlign: 'right' }} /></div>
                <div style={{ width: 80 }}><label style={S.label}>{t.stockInitial}</label><input type="number" value={catStockQty} onChange={e => setCatStockQty(Number(e.target.value))} style={{ ...S.textInput, textAlign: 'center' }} /></div>
                <div style={{ width: 75 }}><label style={S.label}>{t.minStockLabel}</label><input type="number" value={catMinStock} onChange={e => setCatMinStock(Number(e.target.value))} style={{ ...S.textInput, textAlign: 'center' }} /></div>
                <div style={{ width: 140 }}><label style={S.label}>{t.oemLabel}</label><input value={catOem} onChange={e => setCatOem(e.target.value)} placeholder="OEM-123" style={S.textInput} /></div>
                <div style={{ width: 170 }}><label style={S.label}>{t.compatLabel}</label><input value={catCompat} onChange={e => setCatCompat(e.target.value)} placeholder={t.compatPlaceholder} style={S.textInput} /></div>
                <div style={{ width: 100 }}><label style={S.label}>{t.emplacLabel}</label><input value={catEmplac} onChange={e => setCatEmplac(e.target.value)} placeholder="A1-E3" style={S.textInput} /></div>
                <div style={{ width: 130 }}><label style={S.label}>{t.categoryLabel}</label><input value={catCategory} onChange={e => setCatCategory(e.target.value)} placeholder={t.categoryPlaceholder} style={S.textInput} /></div>
                <div style={{ width: 150 }}><label style={S.label}>{t.fournisseur}</label><input value={catSupplier} onChange={e => setCatSupplier(e.target.value)} placeholder={t.supplierPlaceholder} style={S.textInput} /></div>
                <button type="submit" style={S.btn()}>+ {t.addCatalogBtn}</button>
              </form>
              <div style={{ ...S.card, flex: 1, overflow: 'auto', padding: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: '#475569', marginBottom: 14 }}>📚 {t.catalogTitle} ({catalog.length})</div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
                  <label style={{ background: theme.btn, border: 'none', borderRadius: 6, padding: '6px 14px', cursor: 'pointer', fontSize: 12, color: '#fff', fontWeight: 700 }}>
                    {t.importCSV}
                    <input type="file" accept=".csv" style={{ display: 'none' }} onChange={e => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = (ev) => {
                        const text = ev.target.result;
                        const lines = text.split('\n').filter(l => l.trim());
                        const newItems = lines.slice(1).map(line => {
                          const cols = line.split(';').map(c => c.trim());
                          return { ref: cols[0] || '', name: cols[1] || '', priceHT: parseFloat(cols[2]) || 0, stockPhysique: parseInt(cols[3]) || 0, stockReserve: 0, minStock: parseInt(cols[4]) || 2, oem: cols[5] || '', compatible: cols[6] || '', emplacement: cols[7] || '', category: cols[8] || '', supplier: cols[9] || '', entryDate: new Date().toLocaleDateString('fr-FR') };
                        }).filter(i => i.ref);
                        setCatalog(prev => [...prev, ...newItems]);
                        notify(fmt(t.itemsImportedFormat, newItems.length), 'success');
                      };
                      reader.readAsText(file);
                      e.target.value = '';
                    }} />
                  </label>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit' }}>
                  <thead><tr>
                    {[t.refLabel, t.descLabel, t.priceLabel, t.availableStock, t.reservedStock, t.minStockLabel, t.oemLabel, t.compatLabel, t.emplacLabel, t.categoryLabel, t.fournisseur, ''].map((h, i) => (
                      <th key={i} style={{ ...S.tableHeader, textAlign: 'left', padding: '8px 7px', borderRight: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {catalog.map((item, idx) => {
                      const dispo = (item.stockPhysique || 0) - (item.stockReserve || 0);
                      const alerte = (item.stockPhysique || 0) <= (item.minStock || 2);
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: alerte ? '#fff7ed' : 'transparent' }}>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0' }}>
                            <input value={item.ref} onChange={e => updateCatalog(idx, 'ref', e.target.value)} style={{ ...S.input, fontWeight: 700, color: theme.btn, fontFamily: 'monospace', fontSize: 'inherit' }} />
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0', minWidth: 160 }}>
                            <input value={item.name} onChange={e => updateCatalog(idx, 'name', e.target.value)} style={{ ...S.input, fontSize: 'inherit' }} />
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0', whiteSpace: 'nowrap' }}>
                            <div style={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                              <input value={convertPrice(item.priceHT).toFixed(2)} onChange={e => { const rate = EXCHANGE_RATES[currencyKey]||1; updateCatalog(idx, 'priceHT', Number(e.target.value)*rate); }} style={{ ...S.input, textAlign: 'right', width: 75, fontSize: 'inherit' }} />
                              <span style={{ fontSize: 'inherit', color: '#94a3b8' }}>{currencySymbol}</span>
                            </div>
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>
                            <span style={{ background: dispo <= (item.minStock||2) ? '#fef2f2' : '#f0fdf4', color: dispo <= (item.minStock||2) ? '#ef4444' : '#16a34a', borderRadius: 12, padding: '2px 8px', fontWeight: 800, fontSize: 'inherit', display: 'inline-block' }}>
                              {dispo}
                            </span>
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>
                            <span style={{ fontSize: 'inherit', color: '#f59e0b', fontWeight: 700 }}>{item.stockReserve || 0}</span>
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0', textAlign: 'center' }}>
                            <input type="number" value={item.minStock || 2} onChange={e => updateCatalog(idx, 'minStock', Number(e.target.value))} style={{ ...S.input, textAlign: 'center', width: 45, fontSize: 'inherit' }} />
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0' }}>
                            <input value={item.oem || '-'} onChange={e => updateCatalog(idx, 'oem', e.target.value)} style={{ ...S.input, fontSize: 'inherit', fontFamily: 'monospace' }} />
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0', minWidth: 120 }}>
                            <input value={item.compatible || '-'} onChange={e => updateCatalog(idx, 'compatible', e.target.value)} style={{ ...S.input, fontSize: 'inherit' }} />
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0' }}>
                            <input value={item.emplacement || '-'} onChange={e => updateCatalog(idx, 'emplacement', e.target.value)} style={{ ...S.input, fontSize: 'inherit', fontFamily: 'monospace' }} />
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0' }}>
                            <input value={item.category || '-'} onChange={e => updateCatalog(idx, 'category', e.target.value)} style={{ ...S.input, fontSize: 'inherit' }} />
                          </td>
                          <td style={{ padding: '6px 7px', borderRight: '1px solid #e2e8f0' }}>
                            <input value={item.supplier || '-'} onChange={e => updateCatalog(idx, 'supplier', e.target.value)} style={{ ...S.input, fontSize: 'inherit' }} />
                          </td>
                          <td style={{ padding: '6px 7px', textAlign: 'center' }}>
                            {canDelete && <button className="admin-delete-action" onClick={() => removeCatalog(idx)} title="Supprimer" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>×</button>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================== STOCK ============================== */}
          {activePage === 'stock' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              {alerteStock.length > 0 && (
                <div style={{ background: '#fffbeb', border: '2px solid #fbbf24', borderRadius: 12, padding: '12px 16px' }}>
                  <div style={{ fontWeight: 800, color: '#92400e', fontSize: 13, marginBottom: 10 }}>⚠️ {t.alertRestock} ({alerteStock.length})</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {alerteStock.map(c => (
                      <div key={c.ref} style={{ background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 8, padding: '6px 12px', fontSize: 'inherit' }}>
                        <strong style={{ color: '#92400e' }}>{c.ref}</strong> — {c.name}<br />
                        <span style={{ color: '#ef4444', fontWeight: 700 }}>Stock: {c.stockPhysique} / Min: {c.minStock}</span>
                        <span style={{ color: '#64748b', marginLeft: 8 }}>{t.supplierLabel}: {c.supplier}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  [t.stockArticles, catalog.length, theme.btn],
                  [t.stockEnStock, catalog.filter(c => (c.stockPhysique||0) > 0).length, '#10b981'],
                  [t.stockCritiques, alerteStock.length, '#f59e0b'],
                  [t.stockValeur, convertPrice(catalog.reduce((s,c) => s+(c.stockPhysique||0)*c.priceHT, 0)).toFixed(0)+` ${currencySymbol}`, '#8b5cf6'],
                ].map(([label, val, color], i) => (
                  <div key={i} style={{ ...S.card, padding: 16 }}>
                    <span style={{ fontSize: 'inherit', fontWeight: 800, color: '#94a3b8', display: 'block', marginBottom: 6 }}>{label}</span>
                    <span style={{ fontWeight: 900, fontSize: 22, color }}>{val}</span>
                  </div>
                ))}
              </div>
              <div style={{ ...S.card, flex: 1, overflow: 'auto', padding: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: '#475569', marginBottom: 14 }}>📦 {t.stockTitle}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit' }}>
                  <thead><tr>
                    {[t.refLabel, t.descLabel, t.oemLabel, t.emplacLabel, t.availableStock, t.reservedStock, t.minStockLabel, t.priceLabel, t.valeurLabel, t.fournisseur].map((h, i) => (
                      <th key={i} style={{ ...S.tableHeader, textAlign: 'left', padding: '8px 7px', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {catalog.map((item, idx) => {
                      const dispo = (item.stockPhysique||0) - (item.stockReserve||0);
                      const alerte = dispo <= (item.minStock||2);
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: alerte ? '#fff7ed' : 'transparent' }}>
                          <td style={{ padding: '8px 7px', fontWeight: 700, color: theme.btn, fontFamily: 'monospace', fontSize: 'inherit' }}>{item.ref}</td>
                          <td style={{ padding: '8px 7px', fontSize: 'inherit', fontWeight: 600 }}>{item.name}</td>
                          <td style={{ padding: '8px 7px', fontSize: 'inherit', fontFamily: 'monospace', color: '#64748b' }}>{item.oem || '-'}</td>
                          <td style={{ padding: '8px 7px', fontSize: 'inherit', fontFamily: 'monospace', color: '#64748b' }}>{item.emplacement || '-'}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'center' }}>
                            <span style={{ background: alerte ? '#fef2f2' : '#f0fdf4', color: alerte ? '#ef4444' : '#16a34a', borderRadius: 12, padding: '3px 10px', fontWeight: 800, fontSize: 'inherit' }}>
                              {dispo}
                            </span>
                          </td>
                          <td style={{ padding: '8px 7px', textAlign: 'center', fontWeight: 700, color: '#f59e0b' }}>{item.stockReserve || 0}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
                              <input type="number" value={item.minStock || 2} onChange={e => updateCatalog(idx, 'minStock', Number(e.target.value))}
                                style={{ ...S.textInput, width: 50, textAlign: 'center', padding: '3px 5px', fontSize: 'inherit' }} />
                            </div>
                          </td>
                          <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 700 }}>{convertPrice(item.priceHT).toFixed(2)} {currencySymbol}</td>
                          <td style={{ padding: '8px 7px', textAlign: 'right', fontWeight: 800, color: '#059669' }}>{convertPrice((item.stockPhysique||0) * item.priceHT).toFixed(2)} {currencySymbol}</td>
                          <td style={{ padding: '8px 7px', color: '#64748b', fontSize: 'inherit' }}>{item.supplier || '-'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================== CLIENTS ============================== */}
          {activePage === 'clients' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ ...S.card, padding: 14 }}>
                <div>
                  <div style={{ fontWeight: 900, fontSize: 16, color: '#1e293b' }}>Clients</div>
                  <div style={{ color: '#64748b', fontSize: 11 }}>Chaque client sauvegardé apparaît automatiquement dans vos documents commerciaux.</div>
                </div>
              </div>
              <section aria-labelledby="relations-clients-title" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div id="relations-clients-title" style={{ fontWeight: 900, fontSize: 15, color: '#1e293b', paddingInline: 2 }}>👤 Clients</div>
              <form onSubmit={handleAddClient} style={{ ...S.card, display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', padding: 16 }}>
                <div style={{ flex: 2, minWidth: 160 }}><label style={S.label}>{t.clientNameLabel}</label><input value={newClientName} onChange={e => setNewClientName(e.target.value)} required placeholder={t.clientNamePlaceholder} style={S.textInput} /></div>
                <div style={{ flex: 1, minWidth: 150 }}><label style={S.label}>Contact</label><input value={newClientContact} onChange={e => setNewClientContact(e.target.value)} placeholder="Contact..." style={S.textInput} /></div>
                <div style={{ width: 160 }}><label style={S.label}>{t.iceLabel}</label><input value={newClientICE} onChange={e => setNewClientICE(e.target.value)} placeholder="ICE..." style={S.textInput} /></div>
                <div style={{ width: 160 }}><label style={S.label}>SIRET</label><input value={newClientSiret} onChange={e => setNewClientSiret(e.target.value)} placeholder="SIRET..." style={S.textInput} /></div>
                <div style={{ flex: 2, minWidth: 160 }}><label style={S.label}>{t.clientAddressLabel}</label><input value={newClientAddress} onChange={e => setNewClientAddress(e.target.value)} placeholder={t.clientAddressPlaceholder} style={S.textInput} /></div>
                <div style={{ width: 130 }}><label style={S.label}>{t.clientPhoneLabel}</label><input value={newClientPhone} onChange={e => setNewClientPhone(e.target.value)} placeholder={t.clientPhonePlaceholder} style={S.textInput} /></div>
                <div style={{ width: 160 }}><label style={S.label}>{t.clientEmailLabel}</label><input value={newClientEmail} onChange={e => setNewClientEmail(e.target.value)} placeholder={t.clientEmailPlaceholder} style={S.textInput} /></div>
                <div style={{ width: 150 }}><label style={S.label}>Catégorie</label><input value={newClientCategory} onChange={e => setNewClientCategory(e.target.value)} placeholder="Catégorie..." style={S.textInput} /></div>
                <div style={{ flex: 2, minWidth: 180 }}><label style={S.label}>Notes</label><input value={newClientNotes} onChange={e => setNewClientNotes(e.target.value)} placeholder="Notes..." style={S.textInput} /></div>
                <div style={{ width: 130 }}><label style={S.label}>{t.limiteLabel} ({currencySymbol})</label><input type="number" value={newClientLimit} onChange={e => setNewClientLimit(Number(e.target.value))} style={{ ...S.textInput, textAlign: 'right' }} /></div>
                <button type="submit" style={S.btn()}>+ {t.addClient}</button>
              </form>
              <div style={{ ...S.card, flex: 1, overflow: 'auto', padding: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: '#475569', marginBottom: 14 }}>👤 {t.clientsTitle} ({clients.length})</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit' }}>
                  <thead><tr>
                    {[t.clientNameLabel, 'Contact', t.iceLabel, 'SIRET', t.clientAddressLabel, t.clientPhoneLabel, t.clientEmailLabel, 'Catégorie', t.limiteLabel, 'Notes', ''].map((h, i) => (
                      <th key={i} style={{ ...S.tableHeader, textAlign: 'left', padding: '8px 10px' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {clients.map((c, idx) => (
                      <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px', fontWeight: 700, color: theme.btn }}>{c.name}</td>
                        <td style={{ padding: '10px', color: '#475569' }}>{c.contact || '-'}</td>
                        <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: 'inherit' }}>{c.ice}</td>
                        <td style={{ padding: '10px', fontFamily: 'monospace', fontSize: 'inherit' }}>{c.siret || '-'}</td>
                        <td style={{ padding: '10px', color: '#64748b' }}>{c.address}</td>
                        <td style={{ padding: '10px' }}>{c.phone}</td>
                        <td style={{ padding: '10px', color: '#64748b' }}>{c.email}</td>
                        <td style={{ padding: '10px', color: '#64748b' }}>{c.category || '-'}</td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>{convertPrice(c.limiteCredit).toFixed(0)} {currencySymbol}</td>
                        <td style={{ padding: '10px', color: '#64748b' }}>{c.notes || '-'}</td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={async () => { if (!(await systemConfirm(`Supprimer ${c.name} ?`))) return; setClients(prev => prev.filter(cl => cl.id !== c.id)); notify(t.clientDeleted, 'info'); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>×</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </section>
            </div>
          )}

          {/* ============================== CRM PIPELINE ============================== */}
          {activePage === 'pipeline' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ ...S.card, flex: 1, overflow: 'auto', padding: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                  <div>
                    <span style={{ fontWeight: 900, fontSize: 14, color: '#475569' }}>👥 {t.crmTitle}</span>
                    <span style={{ fontSize: 'inherit', color: '#94a3b8', marginLeft: 12 }}>{t.crmForecast}: <strong style={{ color: theme.btn }}>{convertPrice(leads.reduce((s,l) => s+l.value*(l.probability/100), 0)).toFixed(2)} {currencySymbol}</strong></span>
                  </div>
                  <button onClick={() => { const lead = { id: Date.now(), client: t.newProspect, value: 1000, stage: 'Nouveau', probability: 20, ref: '-' }; setLeads(prev => [...prev, lead]); }} style={S.btn()}>{t.addProspect}</button>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr>
                    {[t.clientAccount, t.valEst, t.stage, t.prob, ''].map((h, i) => (
                      <th key={i} style={{ ...S.tableHeader, textAlign: i === 1 ? 'right' : 'left', padding: '8px 10px' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {leads.map(lead => (
                      <tr key={lead.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                        <td style={{ padding: '10px', fontWeight: 700 }}>
                          <input value={lead.client} onChange={e => setLeads(prev => prev.map(l => l.id===lead.id ? {...l,client:e.target.value} : l))}
                            style={{ ...S.input, fontWeight: 700 }} />
                        </td>
                        <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>
                          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 3, alignItems: 'center' }}>
                            <input type="number" value={convertPrice(lead.value).toFixed(0)} onChange={e => { const rate=EXCHANGE_RATES[currencyKey]||1; setLeads(prev => prev.map(l => l.id===lead.id ? {...l,value:Number(e.target.value)*rate} : l)); }}
                              style={{ ...S.input, textAlign: 'right', width: 90 }} />
                            <span style={{ fontSize: 'inherit', color: '#94a3b8' }}>{currencySymbol}</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px' }}>
                          <select value={lead.stage} onChange={e => setLeads(prev => prev.map(l => l.id===lead.id ? {...l,stage:e.target.value} : l))}
                            style={{ ...S.textInput, width: 'auto', padding: '5px 8px' }}>
                            {['Nouveau','Qualifié','Devis Envoyé','Négociation','Gagné','Perdu'].map((s, i) => <option key={s} value={s}>{[t.stageNew, t.stageQualified, t.stageSent, t.stageNegotiation, t.stageWon, t.stageLost][i]}</option>)}
                          </select>
                        </td>
                        <td style={{ padding: '10px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="range" min="0" max="100" value={lead.probability}
                              onChange={e => setLeads(prev => prev.map(l => l.id===lead.id ? {...l,probability:Number(e.target.value)} : l))}
                              style={{ flex: 1, accentColor: theme.btn }} />
                            <span style={{ fontSize: 'inherit', fontWeight: 700, minWidth: 32, color: theme.btn }}>{lead.probability}%</span>
                          </div>
                        </td>
                        <td style={{ padding: '10px', textAlign: 'center' }}>
                          {canDelete && <button className="admin-delete-action" title="Supprimer" onClick={async () => { if (!(await systemConfirm(`Supprimer ${lead.client || 'ce prospect'} ?`))) return; setLeads(prev => prev.filter(l => l.id !== lead.id)); }} style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontWeight: 900, fontSize: 15 }}>×</button>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ============================== REPORTING ============================== */}
          {activePage === 'reporting' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14, overflow: 'auto' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                {[
                  [t.kpiCa, convertPrice(leads.filter(l=>l.stage==='Gagné').reduce((s,l)=>s+l.value,0)).toFixed(2), theme.btn],
                  [t.crmForecast, convertPrice(leads.reduce((s,l)=>s+l.value*(l.probability/100),0)).toFixed(0), '#4f46e5'],
                  [t.kpiSig, (leads.length > 0 ? (leads.filter(l=>l.stage==='Gagné').length/leads.length*100).toFixed(1) : 0)+'%', '#059669'],
                  [t.valeurStock, convertPrice(catalog.reduce((s,c)=>s+(c.stockPhysique||0)*c.priceHT,0)).toFixed(0), '#f59e0b'],
                ].map(([label, val, color], i) => (
                  <div key={i} style={{ ...S.card, padding: 18 }}>
                    <span style={{ fontSize: 'inherit', fontWeight: 800, color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>{label}</span>
                    <span style={{ fontWeight: 900, fontSize: 24, color }}>{val} {currencySymbol}</span>
                  </div>
                ))}
              </div>
              <div style={{ ...S.card, overflow: 'auto', padding: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: '#475569', marginBottom: 14 }}>{t.analyseFinanciere}</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit' }}>
                  <thead><tr>
                    {[t.refLabel, t.descLabel, t.categoryLabel, t.priceLabel, t.availableStock, t.valeurStock].map((h, i) => (
                      <th key={i} style={{ ...S.tableHeader, textAlign: i >= 3 ? 'right' : 'left', padding: '8px 10px' }}>{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {catalog.map((item, idx) => {
                      const dispo = (item.stockPhysique||0)-(item.stockReserve||0);
                      return (
                        <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '9px 10px', fontFamily: 'monospace', fontWeight: 700, color: theme.btn, fontSize: 'inherit' }}>{item.ref}</td>
                          <td style={{ padding: '9px 10px', fontWeight: 600 }}>{item.name}</td>
                          <td style={{ padding: '9px 10px', color: '#64748b', fontSize: 'inherit' }}>{item.category || '-'}</td>
                          <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 700 }}>{convertPrice(item.priceHT).toFixed(2)} {currencySymbol}</td>
                          <td style={{ padding: '9px 10px', textAlign: 'right' }}>
                            <span style={{ background: dispo <= (item.minStock||2) ? '#fef2f2' : '#f0fdf4', color: dispo <= (item.minStock||2) ? '#ef4444' : '#16a34a', borderRadius: 12, padding: '2px 8px', fontWeight: 800, fontSize: 'inherit' }}>{dispo}</span>
                          </td>
                          <td style={{ padding: '9px 10px', textAlign: 'right', fontWeight: 800, color: '#059669' }}>{convertPrice(dispo * item.priceHT).toFixed(2)} {currencySymbol}</td>
                        </tr>
                      );
                    })}
                    <tr style={{ borderTop: '2px solid #94a3b8' }}>
                      <td colSpan="5" style={{ padding: '10px', fontWeight: 700, color: '#475569' }}>{t.totalValeurStock}</td>
                      <td style={{ padding: '10px', textAlign: 'right', fontWeight: 900, fontSize: 14, color: theme.btn }}>
                        {convertPrice(catalog.reduce((s,c) => s+((c.stockPhysique||0)-(c.stockReserve||0))*c.priceHT, 0)).toFixed(2)} {currencySymbol}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ ...S.card, overflow: 'auto', padding: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 14, color: '#475569', marginBottom: 14 }}>{t.derniersDocuments}</div>
                {savedDocs.length === 0 ? <div style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>{t.noDocRecorded}</div> : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit' }}>
                    <thead><tr>
                      {[t.docNum || 'N° document', t.docType || 'Type', t.docDate || 'Date', t.clientAccount, t.statusLabel, t.totalTTC].map((h, i) => (
                        <th key={i} style={{ ...S.tableHeader, textAlign: 'left', padding: '8px 10px' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {savedDocs.slice(0, 10).map(doc => (
                        <tr key={doc.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '8px 10px', fontWeight: 700, color: theme.btn }}>{doc.number}</td>
                          <td style={{ padding: '8px 10px' }}>{doc.type}</td>
                          <td style={{ padding: '8px 10px', color: '#64748b' }}>{doc.date}</td>
                          <td style={{ padding: '8px 10px' }}>{(doc.client||'').split('\n')[0]}</td>
                          <td style={{ padding: '8px 10px' }}><StatusBadge status={doc.status} t={t} /></td>
                          <td style={{ padding: '8px 10px', fontWeight: 800, color: '#059669' }}>{documentAmount(doc, 'ttc').toFixed(2)} {doc.currency || currencyKey}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ============================== HISTORIQUE ============================== */}
          {activePage === 'hist' && (
            <div style={{ flex: 1, ...S.card, overflow: 'hidden', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <span style={{ fontWeight: 900, fontSize: 14, color: '#475569' }}>⏱️ {t.historyTitle} ({documentHistory.length})</span>
                <button onClick={() => { setDocumentHistory([]); notify(t.historyCleared, 'info'); }} style={S.btn('#ef4444')}>{t.clearLog}</button>
              </div>
              <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(280px, 1fr)', gap: 12, minHeight: 0 }}>
                <div style={{ minHeight: 0, overflow: 'auto' }}>
                  <table className="compact-history-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed', fontSize: 'inherit' }}>
                    <colgroup><col style={{ width: '18%' }} /><col style={{ width: '22%' }} /><col style={{ width: '30%' }} /><col style={{ width: '30%' }} /></colgroup>
                    <thead><tr>
                      {[t.colTime, t.colRef, t.colDesc, t.colAction].map((h, i) => (
                        <th key={i} style={{ ...S.tableHeader, textAlign: 'left', padding: '6px 7px' }}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody>
                      {documentHistory.map(h => (
                        <tr key={h.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '6px 7px', fontFamily: 'monospace', fontSize: 'inherit', color: '#94a3b8' }}>{h.time}</td>
                          <td style={{ padding: '6px 7px', fontFamily: 'monospace', fontWeight: 700, color: theme.btn, fontSize: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.ref}</td>
                          <td style={{ padding: '6px 7px', color: '#475569', overflow: 'hidden', textOverflow: 'ellipsis' }}>{h.name}</td>
                          <td style={{ padding: '6px 7px' }}>
                            <span style={{ background: theme.light, color: theme.btn, borderRadius: 12, padding: '3px 10px', fontSize: 'inherit', fontWeight: 700 }}>{h.action}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ minHeight: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ ...S.card, padding: 14, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 900, color: '#334155', marginBottom: 10 }}>Résumé rapide</div>
                    <div style={{ display: 'grid', gap: 8 }}>
                      {[
                        { label: 'Entrées totales', value: documentHistory.length },
                        { label: 'Dernier élément', value: documentHistory[0]?.ref || 'Aucun' },
                        { label: 'Dernière action', value: documentHistory[0]?.action || 'Aucune' },
                      ].map((item) => (
                        <div key={item.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 10, background: '#fff', border: '1px solid #e2e8f0' }}>
                          <span style={{ color: '#64748b', fontWeight: 700 }}>{item.label}</span>
                          <span style={{ color: '#0f172a', fontWeight: 900, textAlign: 'right', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(item.value)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ ...S.card, flex: 1, minHeight: 0, padding: 14, background: '#f8fafc', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ fontWeight: 900, color: '#334155', marginBottom: 10 }}>Derniers événements</div>
                    <div style={{ flex: 1, overflow: 'auto', display: 'grid', gap: 8 }}>
                      {(documentHistory.slice(0, 6)).map((entry) => (
                        <div key={`mini-${entry.id}`} style={{ border: '1px solid #e2e8f0', borderRadius: 10, background: '#fff', padding: '8px 10px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <strong style={{ color: theme.btn, fontSize: 'inherit', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{entry.ref}</strong>
                            <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 12 }}>{entry.time}</span>
                          </div>
                          <div style={{ color: '#475569', marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>{entry.name}</div>
                          <div style={{ marginTop: 6 }}>
                            <span style={{ display: 'inline-block', background: theme.light, color: theme.btn, borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 800 }}>{entry.action}</span>
                          </div>
                        </div>
                      ))}
                      {documentHistory.length === 0 && (
                        <div style={{ color: '#94a3b8', textAlign: 'center', padding: 20 }}>Aucun événement à afficher</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================== STATUT ============================== */}
          {activePage === 'status' && (
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ ...S.card, padding: 16 }}>
                <div style={{ fontWeight: 900, fontSize: 16, color: '#475569', marginBottom: 14 }}>{t.statusDocumentsTitle}</div>
                {savedDocs.filter(d => STATUS_DOCUMENT_TYPES.has(String(d.type || '').toUpperCase())).length === 0 ? (
                  <div style={{ color: '#94a3b8', textAlign: 'center', padding: 40 }}>{t.noDoc}</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'inherit' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid #e2e8f0' }}>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748b', fontWeight: 700 }}>{t.docNum || 'N° document'}</th>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748b', fontWeight: 700 }}>{t.docType || 'Type'}</th>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748b', fontWeight: 700 }}>{t.docDate || 'Date'}</th>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748b', fontWeight: 700 }}>{t.clientAccount}</th>
                        <th style={{ padding: '10px 8px', textAlign: 'left', color: '#64748b', fontWeight: 700 }}>{t.statusLabel}</th>
                        <th style={{ padding: '10px 8px', textAlign: 'right', color: '#64748b', fontWeight: 700 }}>{t.totalTTC}</th>
                        <th style={{ padding: '10px 8px', textAlign: 'center', color: '#64748b', fontWeight: 700 }}>{t.actionsLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {savedDocs.filter(d => STATUS_DOCUMENT_TYPES.has(String(d.type || '').toUpperCase())).map(doc => (
                        <tr key={doc.id || `${doc.type}-${doc.number}`} style={{ borderBottom: '1px solid #f1f5f9' }}>
                          <td style={{ padding: '10px 8px', fontWeight: 700, color: theme.btn, fontSize: 13 }}>{doc.number || '—'}</td>
                          <td style={{ padding: '10px 8px', fontWeight: 600 }}>{doc.type || '—'}</td>
                          <td style={{ padding: '10px 8px', color: '#64748b' }}>{doc.date || '—'}</td>
                          <td style={{ padding: '10px 8px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{(doc.client || '').split('\n')[0] || '—'}</td>
                          <td style={{ padding: '10px 8px' }}>
                            <span style={{ display: 'inline-block', padding: '3px 12px', borderRadius: 12, fontSize: 12, fontWeight: 700, color: DOC_STATUSES[doc.status]?.color || '#94a3b8', background: DOC_STATUSES[doc.status]?.bg || '#f1f5f9' }}>
                              {t[DOC_STATUSES[doc.status]?.labelKey] || doc.status || t.statusDraft}
                            </span>
                          </td>
                          <td style={{ padding: '10px 8px', fontWeight: 700, textAlign: 'right', fontSize: 13 }}>{documentAmount(doc, 'ttc').toFixed(2)} {doc.currency || currencyKey}</td>
                          <td style={{ padding: '10px 8px', textAlign: 'center', whiteSpace: 'nowrap' }}>
                            {doc.status === 'draft' && (
                              <button onClick={() => { changeSavedDocumentStatus(doc, 'validated'); notify(`${doc.number} ${t.markedValidated || 'validé'}`, 'success'); }}
                                style={{ background: '#d97706', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#fff', marginRight: 4 }}>
                                {t.validateBtn || 'Valider'}
                              </button>
                            )}
                            {(doc.status === 'validated' || doc.status === 'returned') && (
                              <button onClick={() => { changeSavedDocumentStatus(doc, 'sent'); notify(`${doc.number} ${t.markedSent}`, 'success'); }}
                                style={{ background: '#0284c7', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#fff', marginRight: 4 }}>
                                {t.sendBtn}
                              </button>
                            )}
                            {doc.status === 'sent' && (
                              <button onClick={() => { changeSavedDocumentStatus(doc, 'delivered'); notify(`${doc.number} ${t.markedDelivered}`, 'success'); }}
                                style={{ background: '#8b5cf6', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#fff', marginRight: 4 }}>
                                {t.deliverBtn}
                              </button>
                            )}
                            {(doc.status === 'sent' || doc.status === 'delivered') && (
                              <button onClick={() => { changeSavedDocumentStatus(doc, 'paid', true); notify(`${doc.number} ${t.markedPaid}`, 'success'); }}
                                style={{ background: '#10b981', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#fff', marginRight: 4 }}>
                                {t.payBtn}
                              </button>
                            )}
                          {(doc.status === 'sent' || doc.status === 'delivered' || doc.status === 'paid') && (
                              <button onClick={async () => {
                                 if (isReturning) return;
                                 if (!(await systemConfirm(t.confirmReturn + ` ${doc.number} ? ` + t.confirmReturnStock, { confirmLabel: t.returnBtn }))) return;
                                setIsReturning(true);
                                changeSavedDocumentStatus(doc, 'returned', false);
                                if (doc.items) reintegrateStock(doc.items);
                                notify(`${doc.number} ${t.markedReturned}`, 'warning');
                                setTimeout(() => setIsReturning(false), 500);
                              }}
                                style={{ background: '#dc2626', border: 'none', borderRadius: 6, padding: '4px 12px', cursor: 'pointer', fontSize: 12, color: '#fff' }}>
                                {t.returnBtn}
                              </button>
                            )}
                            {canDelete && (
                              <button
                                type="button"
                                className="admin-delete-action"
                                title="Supprimer"
                                onClick={async () => {
                                  if (!(await systemConfirm(`Supprimer ${doc.number || 'ce document'} ?`))) return;
                                  setSavedDocs(previous => previous.filter(item => !(item.id === doc.id || (item.type === doc.type && item.number === doc.number))));
                                }}
                                style={{ marginLeft: 6, background: '#fff', color: '#dc2626', border: '1px solid #fecaca', borderRadius: 6, width: 26, height: 26, padding: 0, fontWeight: 900, cursor: 'pointer' }}
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ============================== DOCUMENTS SAUVEGARDÉS ============================== */}
          {activePage === 'saved' && (
            <div style={{ flex: 1, ...S.card, padding: 16, overflow: 'auto' }}>
              <DocumentsSauvegardes
                savedDocs={savedDocs}
                onView={handleLoadDoc}
                onDelete={async (doc) => {
                  if (!(await systemConfirm(`Supprimer ${doc.number || 'ce document'} ?`))) return;
                  setSavedDocs(previous => previous.filter(item => !(item.id === doc.id || (item.type === doc.type && item.number === doc.number))));
                }}
                onChangeCurrency={(code) => { try { ls.set('is_currency', code); } catch {} }}
                language={language}
              />
            </div>
          )}

          {activePage === 'received_documents' && hasRole('admin', 'commercial', 'magasinier', 'comptable', 'financier', 'technicien', 'employe') && (
            <ReceivedDocuments />
          )}

          {/* ============================== BULLETINS DE PAIE (PAGE INTÉGRÉE) ============================== */}
          {activePage === 'bulletins' && (
            <div style={{ flex: 1 }}>
              <BulletinsPage t={t} language={language} />
            </div>
          )}

          {/* ============================== TEMPS & ABSENCES ============================== */}
          {activePage === 'temps_absences' && (
            <div style={{ flex: 1 }}>
              <TempsAbsences language={language} />
            </div>
          )}

          {/* ============================== NOTES DE FRAIS ============================== */}
          {activePage === 'notes_frais' && (
            <div style={{ flex: 1 }}>
              <NotesFrais language={language} />
            </div>
          )}

          {/* ============================== SUIVI DU TEMPS ============================== */}
          {activePage === 'suivi_temps' && (
            <div style={{ flex: 1 }}>
              <SuiviTemps language={language} />
            </div>
          )}

          {/* ============================== DÉPARTEMENTS ============================== */}
          {activePage.startsWith('dept_') && (
            <div className="module-page-shell" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="module-page-surface" style={{ ...S.card, flex: 1, overflow: 'auto', padding: 16 }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div style={{ fontWeight: 900, fontSize: 18, color: '#1e293b' }}>{activePage === 'dept_magasinier' ? '📦 Magasinier' : activePage === 'dept_comptabilite' ? '💰 Comptabilité' : '👥 RH'}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {(deptSubItems[activePage] || []).map(subId => {
                      const subItem = navItems.find(n => n.id === subId);
                      if (!subItem) return null;
                      return (
                        <button key={subId} onClick={() => setActivePage(subItem.id)}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px', borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', fontWeight: 600, fontSize: 'inherit', cursor: 'pointer', fontFamily: 'inherit' }}>
                          <span>{subItem.icon}</span><span>{subItem.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================== PAGES SPÉCIALISÉES ============================== */}
          {['magasin_reception','magasin_preparation','magasin_importation','magasin_expedition','magasin_gestion',
            'compta_journaux_achats','compta_journaux_ventes','compta_journaux_banque','compta_journaux_od','compta_journaux_salaires','compta_journaux_tva',
            'rh_admin_paie','rh_recrutement','rh_developpement','rh_relations',
            'admin_users','vehicules','maintenance','atelier','pcge','cpc','grand_livre','fec_marocain','tva_taxes','echeancier','settings'].includes(activePage) && (
            <div className="module-page-shell" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="module-page-surface" style={{ ...S.card, flex: 1, overflow: 'auto', padding: 16 }}>
                {activePage === 'magasin_reception' && <ReceptionTab canEdit={hasRole('admin', 'magasinier')} canDelete={canDelete} showMsg={notify} />}
                {activePage === 'magasin_preparation' && <PreparationLocale canEdit={hasRole('admin', 'magasinier')} canDelete={canDelete} showMsg={notify} />}
                {activePage === 'magasin_importation' && <PreparationImportation canEdit={hasRole('admin', 'magasinier')} canDelete={canDelete} showMsg={notify} onOpenReception={() => setActivePage('magasin_reception')} />}
                {activePage === 'magasin_expedition' && <ExpeditionManuelle canEdit={hasRole('admin', 'magasinier')} showMsg={notify} />}
                {activePage === 'magasin_gestion' && <GestionStockTab canEdit={hasRole('admin', 'magasinier')} canDelete={canDelete} showMsg={notify} />}
                {activePage.startsWith('compta_journaux_') && <ComptaJournaux key={activePage} initialJournal={activePage.replace('compta_journaux_', '')} />}
                {activePage.startsWith('rh_') && <RHSections key={activePage} initialTab={activePage.replace('rh_', '')} />}
                {activePage === 'admin_users' && <AdminUsersPage onlineUsers={onlineUsers} />}
                {activePage === 'vehicules' && <VehiculesPage />}
                {activePage === 'maintenance' && <MaintenancePage />}
                {activePage === 'atelier' && <AtelierPage />}
                {activePage === 'pcge' && <PCGE showMsg={notify} />}
                {activePage === 'cpc' && <CPCPage showMsg={notify} />}
                {activePage === 'grand_livre' && <GrandLivrePage showMsg={notify} />}
                {activePage === 'fec_marocain' && <FECPage showMsg={notify} />}
                {activePage === 'tva_taxes' && <TVAPage showMsg={notify} />}
                {activePage === 'echeancier' && <EcheancierPage onDueDateChange={(row) => showScheduleReminder(row, 'scheduled')} onPaidChange={(number, paid) => {
                  setSavedDocs(previous => (Array.isArray(previous) ? previous : []).map(doc => doc.number === number ? { ...doc, paid, status: paid ? 'paid' : (doc.status === 'paid' ? 'validated' : doc.status) } : doc));
                  if (paid && notification.title === 'Échéancier') closeNotify();
                }} />}
                {activePage === 'settings' && <SettingsPage />}
              </div>
            </div>
          )}

          {['pneus','reporting_complet','reporting_global'].includes(activePage) && (
            <div className="module-page-shell" style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="module-page-surface" style={{ ...S.card, flex: 1, overflow: 'auto', padding: 16 }}>
                {activePage === 'pneus' && <PneusPage />}
                {(activePage === 'reporting_complet' || activePage === 'reporting_global') && <ReportingPage />}
              </div>
            </div>
          )}

        </main>

        <CommunicationDrawer
          isOpen={drawerOpen}
          onToggle={() => setDrawerOpen(true)}
          onClose={() => setDrawerOpen(false)}
          initialTab={drawerSection}
          user={user}
          savedDocs={savedDocs}
          onOpenDocument={(doc) => {
            setSavedDocs(previous => {
              const remaining = previous.filter(item => !(item.id === doc.id || (item.type === doc.type && item.number === doc.number)));
              return [doc, ...remaining].slice(0, 50);
            });
            handleLoadDoc(doc);
            setActivePage('chiffrage');
            setDrawerOpen(false);
            notify(`Devis ${doc.number} ouvert`, 'success');
          }}
          hideToggle
        />

      </div>
    </div>
  );
}
