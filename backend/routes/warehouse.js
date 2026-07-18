import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { dbQuery, dbGet, dbRun, dbTransaction } from '../db.js';
import { authMiddleware, roleMiddleware } from '../auth.js';

const router = Router();
router.use(authMiddleware);

const validStatuses = ['brouillon', 'prete', 'expediee', 'annulee'];

function sanitizeStr(v, maxLen = 200) {
  if (typeof v !== 'string') return '';
  return v.trim().slice(0, maxLen);
}

function parsePositiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function catalogueItem(item) {
  const product = item.produit_id
    ? dbGet('SELECT id, reference, designation, prix_ht, prix_vente, poids_unitaire, volume_unitaire, emplacement FROM produits WHERE id=? AND actif=1', [item.produit_id])
    : dbGet('SELECT id, reference, designation, prix_ht, prix_vente, poids_unitaire, volume_unitaire, emplacement FROM produits WHERE lower(reference)=lower(?) AND actif=1', [sanitizeStr(item.reference, 80)]);
  const qty = parsePositiveNumber(item.quantite, 0);
  if (!qty || qty > 999999) return null;
  const cataloguePrice = product ? (parsePositiveNumber(product.prix_ht) || parsePositiveNumber(product.prix_vente)) : 0;
  return {
    produit_id: product?.id || null,
    reference: product?.reference || sanitizeStr(item.reference, 80),
    designation: product?.designation || sanitizeStr(item.designation, 250),
    quantite: qty,
    prix_unitaire: parsePositiveNumber(item.prix_unitaire, cataloguePrice),
    poids_unitaire: parsePositiveNumber(item.poids_unitaire, product?.poids_unitaire || 0),
    volume_unitaire: parsePositiveNumber(item.volume_unitaire, product?.volume_unitaire || 0),
    emplacement: sanitizeStr(item.emplacement, 100) || product?.emplacement || '',
  };
}

function nextPurchaseNumber() {
  return `BCF-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().slice(0, 6).toUpperCase()}`;
}

function nextImportNumber() {
  return `BCI-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${uuidv4().slice(0, 6).toUpperCase()}`;
}

function deliveryNotePayload(order) {
  const items = dbQuery(`SELECT di.id, di.produit_id, di.designation, di.quantite, di.prix_ht, di.tva_rate,
    p.reference, p.emplacement, p.poids_unitaire
    FROM document_items di LEFT JOIN produits p ON p.id=di.produit_id WHERE di.document_id=?`, [order.id]);
  let metadata = {};
  try { metadata = JSON.parse(order.data_json || '{}'); } catch {}
  return {
    id: order.id,
    numero: order.numero,
    client_nom: order.client_nom || metadata.client_nom || 'Client à préciser',
    chauffeur_livreur: metadata.chauffeur_livreur || metadata.representative || 'À affecter',
    items: items.map((item) => ({
      ...item,
      quantite_attendue: Number(item.quantite || 0),
      poids_unitaire: Number(item.poids_unitaire || 0),
    })),
  };
}

// Réceptions
router.get('/receptions', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const rows = dbQuery(`SELECT wr.*, p.reference, p.designation FROM warehouse_receptions wr LEFT JOIN produits p ON p.id = wr.produit_id ORDER BY wr.created_at DESC`);
  res.json(rows);
});

router.post('/receptions', roleMiddleware('admin', 'magasinier'), (req, res) => {
  if (Array.isArray(req.body.items)) {
    const { fournisseur_nom, fournisseur, num_bl, bon_livraison, commande_id, items } = req.body;
    const supplier = sanitizeStr(fournisseur_nom || fournisseur, 160);
    const deliveryNote = sanitizeStr(num_bl || bon_livraison, 120);
    const validItems = items.map((item) => ({
      produit_id: item.produit_id,
      quantite: Number(item.quantite_recue || 0),
      item_id: item.item_id,
      emplacement: sanitizeStr(item.emplacement, 100),
    })).filter((item) => item.quantite > 0);
    if (!deliveryNote || !validItems.length) return res.status(400).json({ error: 'Bon de livraison et au moins une pièce reçue sont requis' });
    if (validItems.some((item) => !item.produit_id || !Number.isFinite(item.quantite))) {
      return res.status(400).json({ error: 'Chaque pièce reçue doit être liée au catalogue' });
    }
    try {
      dbTransaction(() => {
        for (const item of validItems) {
          const product = dbGet('SELECT id, emplacement FROM produits WHERE id=? AND actif=1', [item.produit_id]);
          if (!product) throw new Error('Produit introuvable dans le catalogue');
          const stockBefore = dbGet(`SELECT COALESCE(SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite ELSE 0 END),0) AS stock FROM stock_mouvements WHERE produit_id=?`, [item.produit_id]).stock;
          dbRun('INSERT INTO stock_mouvements (id, produit_id, type, quantite, stock_avant, stock_apres, motif, user_id) VALUES (?,?,?,?,?,?,?,?)',
            [uuidv4(), item.produit_id, 'entree', item.quantite, stockBefore, Number(stockBefore) + item.quantite, `Réception BL ${deliveryNote}`, req.user.id]);
          dbRun('INSERT INTO warehouse_receptions (id, produit_id, quantite_recue, fournisseur, emplacement, bon_livraison, user_id) VALUES (?,?,?,?,?,?,?)',
            [uuidv4(), item.produit_id, item.quantite, supplier, item.emplacement || product.emplacement || null, deliveryNote, req.user.id]);
          if (commande_id && item.item_id) {
            const commandItem = dbGet('SELECT quantite_recue FROM commandes_achat_items WHERE id=? AND commande_id=?', [item.item_id, commande_id]);
            if (commandItem) dbRun('UPDATE commandes_achat_items SET quantite_recue=? WHERE id=?', [Number(commandItem.quantite_recue || 0) + item.quantite, item.item_id]);
          }
        }
        if (commande_id) {
          const commandItems = dbQuery('SELECT quantite_commandee, quantite_recue FROM commandes_achat_items WHERE commande_id=?', [commande_id]);
          if (commandItems.length) {
            const fullyReceived = commandItems.every((item) => Number(item.quantite_recue) >= Number(item.quantite_commandee));
            const partiallyReceived = commandItems.some((item) => Number(item.quantite_recue) > 0);
            dbRun('UPDATE commandes_achat SET status=? WHERE id=?', [fullyReceived ? 'livree' : partiallyReceived ? 'livree_partielle' : 'en_attente', commande_id]);
          }
        }
      });
      return res.status(201).json({ success: true, pieces_entrees: validItems.length });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Impossible de mettre le stock à jour' });
    }
  }

  const { produit_id, quantite_recue, fournisseur, emplacement, bon_livraison } = req.body;
  if (!produit_id || !quantite_recue) return res.status(400).json({ error: 'produit_id et quantite_recue requis' });
  const qty = Number(quantite_recue);
  if (isNaN(qty) || qty <= 0 || qty > 999999) return res.status(400).json({ error: 'Quantité invalide' });
  const id = uuidv4();
  dbRun('INSERT INTO warehouse_receptions (id, produit_id, quantite_recue, fournisseur, emplacement, bon_livraison, user_id) VALUES (?,?,?,?,?,?,?)',
    [id, produit_id, qty, sanitizeStr(fournisseur), sanitizeStr(emplacement), sanitizeStr(bon_livraison), req.user.id]);
  res.json({ id, success: true });
});

router.delete('/receptions/:id', roleMiddleware('admin'), (req, res) => {
  dbRun('DELETE FROM warehouse_receptions WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Préparations
router.get('/preparations', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const rows = dbQuery(`SELECT wp.*, p.reference, p.designation FROM warehouse_preparations wp LEFT JOIN produits p ON p.id = wp.produit_id ORDER BY wp.created_at DESC`);
  res.json(rows);
});

router.post('/preparations', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { produit_id, quantite, destination, reference } = req.body;
  if (!produit_id || !quantite) return res.status(400).json({ error: 'produit_id et quantite requis' });
  const qty = Number(quantite);
  if (isNaN(qty) || qty <= 0 || qty > 999999) return res.status(400).json({ error: 'Quantité invalide' });
  const id = uuidv4();
  dbRun('INSERT INTO warehouse_preparations (id, reference, produit_id, quantite, destination, user_id) VALUES (?,?,?,?,?,?)',
    [id, sanitizeStr(reference), produit_id, qty, sanitizeStr(destination), req.user.id]);
  res.json({ id, success: true });
});

router.put('/preparations/:id', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { status } = req.body;
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  dbRun('UPDATE warehouse_preparations SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
});

router.delete('/preparations/:id', roleMiddleware('admin'), (req, res) => {
  dbRun('DELETE FROM warehouse_preparations WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Préparation locale : génère un bon de commande fournisseur et prévient la comptabilité.
router.get('/preparations-locales', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const rows = dbQuery(`SELECT pal.*, ca.numero AS commande_numero FROM preparations_achat_local pal
    LEFT JOIN commandes_achat ca ON ca.id=pal.commande_id ORDER BY pal.created_at DESC LIMIT 50`);
  res.json(rows.map((row) => ({ ...row, items: JSON.parse(row.items_json || '[]') })));
});

router.post('/preparations-locales', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { fournisseur_nom, date_demande, status, items } = req.body;
  if (!sanitizeStr(fournisseur_nom, 160) || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Fournisseur et au moins une pièce sont requis' });
  }
  const normalizedItems = items.map(catalogueItem).filter(Boolean);
  if (!normalizedItems.length || normalizedItems.some((item) => !item.designation)) {
    return res.status(400).json({ error: 'Chaque ligne doit avoir une désignation et une quantité valide' });
  }
  const supplierName = sanitizeStr(fournisseur_nom, 160);
  let supplier = dbGet('SELECT id FROM fournisseurs WHERE lower(nom)=lower(?) AND actif=1', [supplierName]);
  if (!supplier) {
    supplier = { id: uuidv4() };
    dbRun('INSERT INTO fournisseurs (id, nom, categorie) VALUES (?,?,?)', [supplier.id, supplierName, 'Fournisseur local']);
  }
  const purchaseId = uuidv4();
  const localId = uuidv4();
  const totalHt = normalizedItems.reduce((sum, item) => sum + item.quantite * item.prix_unitaire, 0);
  const tva = totalHt * 0.2;
  const purchaseStatus = status === 'envoye_fournisseur' ? 'validee' : 'en_attente';
  const number = nextPurchaseNumber();
  dbRun('INSERT INTO commandes_achat (id, numero, fournisseur_id, date_commande, status, total_ht, total_ttc, notes, user_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [purchaseId, number, supplier.id, date_demande || new Date().toISOString().slice(0, 10), purchaseStatus, totalHt, totalHt + tva, 'Achat local — CGNC 611100 / TVA 345500', req.user.id]);
  for (const item of normalizedItems) {
    dbRun('INSERT INTO commandes_achat_items (id, commande_id, produit_id, designation, quantite_commandee, prix_unitaire_ht, tva_rate) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), purchaseId, item.produit_id, item.designation, item.quantite, item.prix_unitaire, 20]);
  }
  dbRun('INSERT INTO preparations_achat_local (id, commande_id, fournisseur_nom, date_demande, status, reception_status, total_ht, items_json, user_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [localId, purchaseId, supplierName, date_demande || new Date().toISOString().slice(0, 10), status === 'envoye_fournisseur' ? 'envoye_fournisseur' : 'en_projet', 'en_attente', totalHt, JSON.stringify(normalizedItems), req.user.id]);
  const accountants = dbQuery("SELECT id FROM users WHERE active=1 AND role='comptable'");
  const message = `Commande locale ${number} : ${totalHt.toFixed(2)} DH HT. Prévoir 611100 (achats de marchandises au Maroc) et TVA récupérable 345500 à 20%.`;
  for (const accountant of accountants) {
    dbRun('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?,?,?,?,?)', [uuidv4(), accountant.id, 'achat_local', 'Commande d’achat local à enregistrer', message]);
  }
  res.status(201).json({ id: localId, commande_id: purchaseId, numero: number, total_ht: totalHt, total_ttc: totalHt + tva });
});

router.put('/preparations-locales/:id/reception', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const preparation = dbGet('SELECT id FROM preparations_achat_local WHERE id=?', [req.params.id]);
  if (!preparation) return res.status(404).json({ error: 'Préparation locale introuvable' });
  dbRun("UPDATE preparations_achat_local SET reception_status='recu' WHERE id=?", [req.params.id]);
  res.json({ success: true, reception_status: 'recu' });
});

router.delete('/preparations-locales/:id', roleMiddleware('admin'), (req, res) => {
  const result = dbRun('DELETE FROM preparations_achat_local WHERE id=?', [req.params.id]);
  if (!result.changes) return res.status(404).json({ error: 'Préparation locale introuvable' });
  res.json({ success: true });
});

// Préparation importation : pilotage logistique et transfert contrôlé vers la réception.
router.get('/preparations-importation', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const rows = dbQuery('SELECT * FROM preparations_importation ORDER BY eta ASC, created_at DESC LIMIT 50');
  res.json(rows.map((row) => ({ ...row, items: JSON.parse(row.items_json || '[]') })));
});

router.post('/preparations-importation', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { fournisseur_nom, eta, type_transport, items } = req.body;
  if (!sanitizeStr(fournisseur_nom, 160) || !Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: 'Fournisseur et au moins une pièce sont requis' });
  }
  const normalizedItems = items.map(catalogueItem).filter(Boolean).map((item, index) => ({
    ...item,
    emplacement: item.emplacement || `Allée ${String.fromCharCode(65 + (index % 6))} / Sol`,
    statut_espace: item.emplacement ? 'Espace à confirmer' : 'Alerte dépôt saturé',
  }));
  if (!normalizedItems.length || normalizedItems.some((item) => !item.designation)) {
    return res.status(400).json({ error: 'Chaque ligne doit avoir une désignation et une quantité valide' });
  }
  const totalWeight = normalizedItems.reduce((sum, item) => sum + item.quantite * item.poids_unitaire, 0);
  const totalVolume = normalizedItems.reduce((sum, item) => sum + item.quantite * item.volume_unitaire, 0);
  const id = uuidv4();
  const number = nextImportNumber();
  dbRun('INSERT INTO preparations_importation (id, numero, fournisseur_nom, eta, type_transport, poids_total, volume_total, items_json, user_id) VALUES (?,?,?,?,?,?,?,?,?)',
    [id, number, sanitizeStr(fournisseur_nom, 160), eta || null, sanitizeStr(type_transport, 120), totalWeight, totalVolume, JSON.stringify(normalizedItems), req.user.id]);
  res.status(201).json({ id, numero: number, poids_total: totalWeight, volume_total: totalVolume, items: normalizedItems });
});

router.post('/preparations-importation/:id/basculer-reception', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const preparation = dbGet('SELECT * FROM preparations_importation WHERE id=?', [req.params.id]);
  if (!preparation) return res.status(404).json({ error: 'Préparation importation introuvable' });
  if (preparation.status === 'annulee') return res.status(400).json({ error: 'Cette préparation est annulée' });
  dbRun("UPDATE preparations_importation SET status='pret_reception' WHERE id=?", [preparation.id]);
  res.json({
    success: true,
    receptionDraft: {
      fournisseur_nom: preparation.fournisseur_nom,
      date_reception: new Date().toISOString().slice(0, 10),
      num_bl: `IMPORT-${preparation.id.slice(0, 8).toUpperCase()}`,
      items: JSON.parse(preparation.items_json || '[]').map((item) => ({ ...item, quantite_recue: item.quantite })),
    },
  });
});

router.delete('/preparations-importation/:id', roleMiddleware('admin'), (req, res) => {
  const result = dbRun('DELETE FROM preparations_importation WHERE id=?', [req.params.id]);
  if (!result.changes) return res.status(404).json({ error: 'Préparation importation introuvable' });
  res.json({ success: true });
});

// Expéditions
// Bons de livraison envoyés par le commercial. Le magasinier n'expédie que ces BL.
router.get('/bons-livraison', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const query = sanitizeStr(req.query.recherche || '', 80).toLowerCase();
  const rows = dbQuery(`SELECT id, numero, client_nom, status, date_creation, data_json
    FROM documents WHERE lower(type)='bl' AND status NOT IN ('expedie', 'expedie_partiel', 'annule', 'annulee')
    ORDER BY created_at DESC LIMIT 100`);
  const results = rows.map((row) => {
    let metadata = {};
    try { metadata = JSON.parse(row.data_json || '{}'); } catch {}
    return {
      id: row.id,
      numero: row.numero,
      client_nom: row.client_nom || metadata.client_nom || 'Client à préciser',
      chauffeur_livreur: metadata.chauffeur_livreur || metadata.representative || 'À affecter',
      status: row.status,
      date_creation: row.date_creation,
    };
  }).filter((row) => !query || `${row.numero} ${row.client_nom} ${row.chauffeur_livreur}`.toLowerCase().includes(query));
  res.json(results);
});

router.post('/bons-livraison', roleMiddleware('admin', 'commercial'), (req, res) => {
  const numero = sanitizeStr(req.body.numero, 80);
  const clientNom = sanitizeStr(req.body.client_nom, 180);
  const clientAdresse = sanitizeStr(req.body.client_adresse, 500);
  const chauffeurLivreur = sanitizeStr(req.body.chauffeur_livreur, 160);
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!numero || !clientNom || !items.length) return res.status(400).json({ error: 'Numéro du BL, client et au moins une pièce sont requis' });
  const normalizedItems = items.map((item) => {
    const reference = sanitizeStr(item.reference, 80);
    const designation = sanitizeStr(item.designation, 250);
    const quantite = Number(item.quantite || 0);
    const product = reference ? dbGet('SELECT id FROM produits WHERE lower(reference)=lower(?) AND actif=1', [reference]) : null;
    return { reference, designation, quantite, prix_ht: parsePositiveNumber(item.prix_ht, 0), tva_rate: parsePositiveNumber(item.tva_rate, 20), produit_id: product?.id || null };
  }).filter((item) => item.reference && item.designation && Number.isFinite(item.quantite) && item.quantite > 0 && item.quantite <= 999999);
  if (normalizedItems.length !== items.length) return res.status(400).json({ error: 'Chaque ligne doit contenir une référence, une désignation et une quantité valide' });
  const totalHt = normalizedItems.reduce((sum, item) => sum + item.quantite * item.prix_ht, 0);
  const totalTtc = totalHt + normalizedItems.reduce((sum, item) => sum + item.quantite * item.prix_ht * item.tva_rate / 100, 0);
  const metadata = JSON.stringify({ chauffeur_livreur: chauffeurLivreur, representative: chauffeurLivreur, origine: 'commercial' });
  try {
    const existing = dbGet(`SELECT id FROM documents WHERE numero=? AND lower(type)='bl' ORDER BY created_at DESC LIMIT 1`, [numero]);
    const documentId = existing?.id || uuidv4();
    dbTransaction(() => {
      if (existing) {
        dbRun(`UPDATE documents SET client_nom=?, client_adresse=?, date_creation=?, status='pret_expedition', total_ht=?, total_ttc=?, data_json=?, user_id=? WHERE id=?`,
          [clientNom, clientAdresse, sanitizeStr(req.body.date_creation, 30) || new Date().toISOString().slice(0, 10), totalHt, totalTtc, metadata, req.user.id, documentId]);
        dbRun('DELETE FROM document_items WHERE document_id=?', [documentId]);
      } else {
        dbRun(`INSERT INTO documents (id, type, numero, client_nom, client_adresse, date_creation, status, total_ht, total_ttc, user_id, data_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [documentId, 'BL', numero, clientNom, clientAdresse, sanitizeStr(req.body.date_creation, 30) || new Date().toISOString().slice(0, 10), 'pret_expedition', totalHt, totalTtc, req.user.id, metadata]);
      }
      for (const item of normalizedItems) dbRun(`INSERT INTO document_items (id, document_id, produit_id, designation, quantite, prix_ht, tva_rate) VALUES (?,?,?,?,?,?,?)`,
        [uuidv4(), documentId, item.produit_id, item.designation, item.quantite, item.prix_ht, item.tva_rate]);
      for (const magasinier of dbQuery("SELECT id FROM users WHERE active=1 AND role='magasinier'")) dbRun('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?,?,?,?,?)',
        [uuidv4(), magasinier.id, 'bon_livraison', 'Bon de livraison à expédier', `BL ${numero} envoyé par le commercial pour ${clientNom}.`]);
    });
    res.status(existing ? 200 : 201).json({ id: documentId, numero, status: 'pret_expedition' });
  } catch (error) { res.status(400).json({ error: error.message || 'Impossible d’enregistrer le bon de livraison' }); }
});

router.get('/bons-livraison/:numero', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const order = dbGet(`SELECT * FROM documents WHERE numero=? AND lower(type)='bl' AND status NOT IN ('expedie', 'expedie_partiel', 'annule', 'annulee') ORDER BY created_at DESC LIMIT 1`, [sanitizeStr(req.params.numero, 80)]);
  if (!order) return res.status(404).json({ error: 'Bon de livraison introuvable ou déjà expédié' });
  res.json(deliveryNotePayload(order));
});

router.get('/expedition-commandes/:numero', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const order = dbGet(`SELECT * FROM documents WHERE numero=? AND lower(type) IN ('bc','bon_commande','commande','commande_client') ORDER BY created_at DESC LIMIT 1`, [sanitizeStr(req.params.numero, 80)]);
  if (!order) return res.status(404).json({ error: 'Bon de commande client introuvable' });
  const items = dbQuery(`SELECT di.id, di.produit_id, di.designation, di.quantite, di.prix_ht, di.tva_rate, p.reference, p.emplacement, p.poids_unitaire FROM document_items di LEFT JOIN produits p ON p.id=di.produit_id WHERE di.document_id=?`, [order.id]);
  let metadata = {};
  try { metadata = JSON.parse(order.data_json || '{}'); } catch {}
  res.json({ id: order.id, numero: order.numero, client_nom: order.client_nom || metadata.client?.name || 'Client à préciser', destination: order.client_adresse || metadata.client?.address || metadata.destination || 'Destination à préciser', transport: metadata.transporteur || metadata.transport || 'Livraison à confirmer', items: items.map((item) => ({ ...item, quantite_commandee: item.quantite, poids_unitaire: Number(item.poids_unitaire || 0) })) });
});

router.post('/bons-livraison/:id/valider', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const order = dbGet(`SELECT * FROM documents WHERE id=? AND lower(type)='bl'`, [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Bon de livraison introuvable' });
  if (['expedie', 'expedie_partiel', 'annule', 'annulee'].includes(order.status)) return res.status(400).json({ error: 'Ce bon de livraison a déjà été traité' });
  if (!Array.isArray(req.body.items) || !req.body.items.length) return res.status(400).json({ error: 'Aucune pièce à expédier' });
  const orderedItems = dbQuery('SELECT di.*, p.reference FROM document_items di LEFT JOIN produits p ON p.id=di.produit_id WHERE di.document_id=?', [order.id]);
  const ids = new Set(req.body.items.map((row) => row.item_id));
  const rows = req.body.items.map((row) => ({ ordered: orderedItems.find((item) => item.id === row.item_id), shipped: Number(row.quantite_expediee || 0), verified: row.verifie === true })).filter((row) => row.ordered);
  if (rows.length !== orderedItems.length || ids.size !== rows.length || !rows.length || rows.some((row) => !Number.isFinite(row.shipped) || row.shipped < 0 || row.shipped > Number(row.ordered.quantite))) return res.status(400).json({ error: 'Les lignes ou quantités expédiées sont invalides' });
  if (rows.some((row) => row.shipped > 0 && !row.verified)) return res.status(400).json({ error: 'Cochez le contrôle visuel de chaque pièce chargée' });
  const missing = rows.filter((row) => row.shipped < Number(row.ordered.quantite));
  if (missing.length && !req.body.confirmer_partiel) {
    const count = missing.reduce((sum, row) => sum + (Number(row.ordered.quantite) - row.shipped), 0);
    return res.status(409).json({ error: `Écart détecté avec le BL : ${count} pièce(s) manquante(s). Confirmez l’expédition partielle.` });
  }
  if (rows.every((row) => row.shipped === 0)) return res.status(400).json({ error: 'Saisissez au moins une pièce chargée' });
  const totalHt = rows.reduce((sum, row) => sum + row.shipped * Number(row.ordered.prix_ht || 0), 0);
  const tva = totalHt * 0.2;
  const totalTtc = totalHt + tva;
  try {
    dbTransaction(() => {
      for (const row of rows.filter((row) => row.shipped > 0)) {
        if (!row.ordered.produit_id) throw new Error(`Produit non lié au catalogue : ${row.ordered.designation}`);
        const stockBefore = dbGet(`SELECT COALESCE(SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite ELSE 0 END),0) AS stock FROM stock_mouvements WHERE produit_id=?`, [row.ordered.produit_id]).stock;
        if (Number(stockBefore) < row.shipped) throw new Error(`Stock insuffisant pour ${row.ordered.designation}`);
        dbRun('INSERT INTO stock_mouvements (id, produit_id, type, quantite, stock_avant, stock_apres, motif, user_id, document_id) VALUES (?,?,?,?,?,?,?,?,?)',
          [uuidv4(), row.ordered.produit_id, 'sortie', row.shipped, stockBefore, Number(stockBefore) - row.shipped, `Expédition BL ${order.numero}`, req.user.id, order.id]);
        dbRun('INSERT INTO warehouse_expeditions (id, preparation_id, produit_id, quantite, client_nom, adresse_livraison, transporteur, status, user_id) VALUES (?,?,?,?,?,?,?,?,?)',
          [uuidv4(), order.id, row.ordered.produit_id, row.shipped, order.client_nom || '', order.client_adresse || '', '', 'expediee', req.user.id]);
      }
      dbRun('UPDATE documents SET status=? WHERE id=?', [missing.length ? 'expedie_partiel' : 'expedie', order.id]);
      dbRun('INSERT INTO comptabilite (id, type, categorie, montant, description, date_operation, document_id, user_id, compte, rapproche) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [uuidv4(), 'recette', 'Vente marchandises Maroc', totalTtc, `À facturer - BL ${order.numero} : 711100 HT ${totalHt.toFixed(2)} DH, TVA 20% ${tva.toFixed(2)} DH, client 342100`, new Date().toISOString().slice(0, 10), order.id, req.user.id, '342100', 0]);
      for (const accountant of dbQuery("SELECT id FROM users WHERE active=1 AND role='comptable'")) dbRun('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?,?,?,?,?)',
        [uuidv4(), accountant.id, 'expedition', 'Ordre de facturation à préparer', `BL ${order.numero} expédié : débit 342100 ${totalTtc.toFixed(2)} DH TTC ; crédit 711100 ${totalHt.toFixed(2)} DH HT ; TVA 20% ${tva.toFixed(2)} DH.`]);
    });
  } catch (error) { return res.status(400).json({ error: error.message || 'Impossible de valider l’expédition' }); }
  res.json({ success: true, partial: missing.length > 0, total_ht: totalHt, total_ttc: totalTtc });
});

router.post('/expedition-commandes/:id/valider', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const order = dbGet('SELECT * FROM documents WHERE id=?', [req.params.id]);
  if (!order) return res.status(404).json({ error: 'Bon de commande client introuvable' });
  if (!Array.isArray(req.body.items) || !req.body.items.length) return res.status(400).json({ error: 'Aucune pièce à expédier' });
  const orderedItems = dbQuery('SELECT di.*, p.reference FROM document_items di LEFT JOIN produits p ON p.id=di.produit_id WHERE di.document_id=?', [order.id]);
  const rows = req.body.items.map((row) => ({ ordered: orderedItems.find((item) => item.id === row.item_id), shipped: Number(row.quantite_expediee || 0), verified: row.verifie === true })).filter((row) => row.ordered);
  if (!rows.length || rows.some((row) => !Number.isFinite(row.shipped) || row.shipped < 0 || row.shipped > Number(row.ordered.quantite))) return res.status(400).json({ error: 'Quantité expédiée invalide' });
  if (rows.some((row) => row.shipped > 0 && !row.verified)) return res.status(400).json({ error: 'Cochez la vérification visuelle de chaque pièce expédiée' });
  const missing = rows.filter((row) => row.shipped < Number(row.ordered.quantite));
  if (missing.length && !req.body.confirmer_partiel) {
    const count = missing.reduce((sum, row) => sum + (Number(row.ordered.quantite) - row.shipped), 0);
    return res.status(409).json({ error: `Expédition incomplète : ${count} pièce(s) manquante(s). Confirmez le départ partiel.` });
  }
  if (rows.every((row) => row.shipped === 0)) return res.status(400).json({ error: 'Saisissez au moins une pièce expédiée' });
  const totalHt = rows.reduce((sum, row) => sum + row.shipped * Number(row.ordered.prix_ht || 0), 0);
  const tva = totalHt * 0.2;
  const totalTtc = totalHt + tva;
  try {
    dbTransaction(() => {
      for (const row of rows.filter((row) => row.shipped > 0)) {
        if (!row.ordered.produit_id) throw new Error(`Produit non lié : ${row.ordered.designation}`);
        const stockBefore = dbGet(`SELECT COALESCE(SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite ELSE 0 END),0) AS stock FROM stock_mouvements WHERE produit_id=?`, [row.ordered.produit_id]).stock;
        if (Number(stockBefore) < row.shipped) throw new Error(`Stock insuffisant pour ${row.ordered.designation}`);
        dbRun('INSERT INTO stock_mouvements (id, produit_id, type, quantite, stock_avant, stock_apres, motif, user_id, document_id) VALUES (?,?,?,?,?,?,?,?,?)', [uuidv4(), row.ordered.produit_id, 'sortie', row.shipped, stockBefore, Number(stockBefore) - row.shipped, `Expédition client ${order.numero}`, req.user.id, order.id]);
        dbRun('INSERT INTO warehouse_expeditions (id, preparation_id, produit_id, quantite, client_nom, adresse_livraison, transporteur, status, user_id) VALUES (?,?,?,?,?,?,?,?,?)', [uuidv4(), order.id, row.ordered.produit_id, row.shipped, order.client_nom || '', order.client_adresse || '', '', 'expediee', req.user.id]);
      }
      dbRun('UPDATE documents SET status=? WHERE id=?', [missing.length ? 'expedie_partiel' : 'expedie', order.id]);
      dbRun('INSERT INTO comptabilite (id, type, categorie, montant, description, date_operation, document_id, user_id, compte, rapproche) VALUES (?,?,?,?,?,?,?,?,?,?)', [uuidv4(), 'recette', 'Vente marchandises Maroc', totalTtc, `À facturer — BC ${order.numero} : 711100 HT ${totalHt.toFixed(2)} DH, TVA 20% ${tva.toFixed(2)} DH, client 342100`, new Date().toISOString().slice(0, 10), order.id, req.user.id, '342100', 0]);
      for (const accountant of dbQuery("SELECT id FROM users WHERE active=1 AND role='comptable'")) dbRun('INSERT INTO notifications (id, user_id, type, title, message) VALUES (?,?,?,?,?)', [uuidv4(), accountant.id, 'expedition', 'Ordre de facturation à préparer', `BC ${order.numero} expédié : débit 342100 ${totalTtc.toFixed(2)} DH TTC ; crédit 711100 ${totalHt.toFixed(2)} DH HT ; TVA 20% ${tva.toFixed(2)} DH.`]);
    });
  } catch (error) { return res.status(400).json({ error: error.message || 'Impossible de valider l’expédition' }); }
  res.json({ success: true, partial: missing.length > 0, total_ht: totalHt, total_ttc: totalTtc });
});

router.get('/expeditions', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const rows = dbQuery(`SELECT we.*, p.reference, p.designation FROM warehouse_expeditions we LEFT JOIN produits p ON p.id = we.produit_id ORDER BY we.created_at DESC`);
  res.json(rows);
});

router.post('/expeditions', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { produit_id, quantite, client_nom, adresse_livraison, transporteur, preparation_id } = req.body;
  if (!produit_id || !quantite) return res.status(400).json({ error: 'produit_id et quantite requis' });
  const qty = Number(quantite);
  if (isNaN(qty) || qty <= 0 || qty > 999999) return res.status(400).json({ error: 'Quantité invalide' });
  const id = uuidv4();
  dbRun('INSERT INTO warehouse_expeditions (id, preparation_id, produit_id, quantite, client_nom, adresse_livraison, transporteur, user_id) VALUES (?,?,?,?,?,?,?,?)',
    [id, preparation_id || null, produit_id, qty, sanitizeStr(client_nom), sanitizeStr(adresse_livraison), sanitizeStr(transporteur), req.user.id]);
  res.json({ id, success: true });
});

router.put('/expeditions/:id', roleMiddleware('admin', 'magasinier'), (req, res) => {
  const { status } = req.body;
  if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Statut invalide' });
  dbRun('UPDATE warehouse_expeditions SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
});

router.delete('/expeditions/:id', roleMiddleware('admin'), (req, res) => {
  dbRun('DELETE FROM warehouse_expeditions WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Emplacements stock
router.get('/emplacements', (req, res) => {
  const rows = dbQuery(`SELECT p.emplacement, COUNT(*) as count,
    COALESCE(SUM(COALESCE((SELECT SUM(CASE WHEN type='entree' THEN quantite WHEN type='sortie' THEN -quantite WHEN type='inventaire' THEN quantite ELSE 0 END) FROM stock_mouvements WHERE produit_id=p.id), 0)), 0) as total
    FROM produits p WHERE p.emplacement IS NOT NULL AND p.emplacement != '' AND p.actif = 1 GROUP BY p.emplacement ORDER BY p.emplacement`);
  res.json(rows);
});

export default router;
