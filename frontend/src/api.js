const API = '/api';
const TRANSIENT_SERVER_STATUSES = new Set([502, 503, 504]);
const TRANSIENT_RETRY_DELAYS_MS = [700, 1_500, 3_000];

function wait(delayMs) {
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
}

function canRetryRequest(method, path) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method) || path === '/auth/login';
}

async function fetchWithRetry(url, fetchOptions, method, path) {
  const retryDelays = canRetryRequest(method, path) ? TRANSIENT_RETRY_DELAYS_MS : [];

  for (let attempt = 0; ; attempt += 1) {
    try {
      const response = await fetch(url, fetchOptions);
      if (!TRANSIENT_SERVER_STATUSES.has(response.status) || attempt >= retryDelays.length) {
        return response;
      }
    } catch (error) {
      if (error?.name === 'AbortError' || attempt >= retryDelays.length) throw error;
    }
    await wait(retryDelays[attempt]);
  }
}

export function getAuthToken() {
  return sessionStorage.getItem('auth_token') || '';
}

export function setAuthToken(token) {
  if (token) sessionStorage.setItem('auth_token', token);
  else sessionStorage.removeItem('auth_token');
}

export function getCsrfToken() {
  const entry = document.cookie.split('; ').find((item) => item.startsWith('XSRF-TOKEN='));
  return entry ? decodeURIComponent(entry.split('=').slice(1).join('=')) : '';
}

async function request(path, options = {}) {
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': 'application/json',
    ...options.headers,
  };
  const method = (options.method || 'GET').toUpperCase();
  const token = getAuthToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const csrfToken = getCsrfToken();
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && csrfToken) headers['X-CSRF-Token'] = csrfToken;
  if (options.skipContentType) delete headers['Content-Type'];
  const fetchOptions = {
    ...options,
    headers,
    credentials: 'same-origin',
  };
  const res = await fetchWithRetry(`${API}${path}`, fetchOptions, method, path);
  const responseText = await res.text();
  let data;
  try {
    data = responseText ? JSON.parse(responseText) : {};
  } catch {
    if (!res.ok) {
      throw new Error('Connexion momentanément indisponible. Réessayez dans quelques secondes.');
    }
    throw new Error('Le serveur a renvoyé une réponse invalide.');
  }
  if (!res.ok) {
    if (res.status === 401 && path !== '/auth/login') {
      setAuthToken(null);
      window.location.hash = '#login';
    }
    const unavailable = TRANSIENT_SERVER_STATUSES.has(res.status);
    const error = new Error(data.error || (res.status === 401
      ? 'Session expirée'
      : unavailable
        ? 'Connexion momentanément indisponible. Réessayez dans quelques secondes.'
        : 'Erreur serveur'));
    error.code = data.code;
    error.status = res.status;
    throw error;
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && !path.startsWith('/auth/') && !path.startsWith('/data/doc/')) {
    const actionByMethod = { POST: 'Création', PUT: 'Modification', PATCH: 'Modification', DELETE: 'Suppression' };
    const moduleName = path.split('/').filter(Boolean)[0] || 'application';
    window.dispatchEvent(new CustomEvent('audit:movement', {
      detail: {
        ref: path,
        name: moduleName,
        action: `${actionByMethod[method] || method} · ${path}`,
      },
    }));
  }
  return data;
}

async function downloadMessagePdf(id, fileName = 'document.pdf') {
  const headers = { 'X-Requested-With': 'XMLHttpRequest' };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}/messages/${encodeURIComponent(id)}/pdf`, {
    headers,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let errorMessage = 'Téléchargement PDF impossible';
    try { errorMessage = (await res.json()).error || errorMessage; } catch {}
    throw new Error(errorMessage);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = String(fileName || 'document.pdf');
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const api = {
  // Auth
  login: (username, password) =>
    request('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) }),
  me: () => request('/auth/me'),
  logout: () => request('/auth/logout', { method: 'POST' }),
  getMySmtp: () => request('/auth/me/smtp'),
  saveMySmtp: (data) => request('/auth/me/smtp', { method: 'PUT', body: JSON.stringify(data) }),

  // Stock
  getProduits: (params = '') => request(`/stock${params}`),
  getProduit: (id) => request(`/stock/${id}`),
  createProduit: (data) => request('/stock', { method: 'POST', body: JSON.stringify(data) }),
  updateProduit: (id, data) => request(`/stock/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteProduit: (id) => request(`/stock/${id}`, { method: 'DELETE' }),
  getMouvements: (id) => request(`/stock/${id}/mouvements`),
  entreeStock: (id, quantite, motif) =>
    request(`/stock/${id}/entree`, { method: 'POST', body: JSON.stringify({ quantite, motif }) }),
  sortieStock: (id, quantite, motif) =>
    request(`/stock/${id}/sortie`, { method: 'POST', body: JSON.stringify({ quantite, motif }) }),
  inventaireStock: (id, quantite_reelle, motif) =>
    request(`/stock/${id}/inventaire`, { method: 'POST', body: JSON.stringify({ quantite_reelle, motif }) }),
  stockStats: () => request('/stock/stats/global'),
  exportStockCSV: () => request('/stock/export/csv'),

  // RH
  getEmployes: (params = '') => request(`/rh${params}`),
  getEmploye: (id) => request(`/rh/${id}`),
  createEmploye: (data) => request('/rh', { method: 'POST', body: JSON.stringify(data) }),
  updateEmploye: (id, data) => request(`/rh/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEmploye: (id) => request(`/rh/${id}`, { method: 'DELETE' }),
  addContrat: (id, data) => request(`/rh/${id}/contrat`, { method: 'POST', body: JSON.stringify(data) }),
  addAbsence: (id, data) => request(`/rh/${id}/absence`, { method: 'POST', body: JSON.stringify(data) }),
  addPaie: (id, data) => request(`/rh/${id}/paie`, { method: 'POST', body: JSON.stringify(data) }),
  getCandidatures: (params = '') => request(`/rh/candidatures${params}`),
  createCandidature: (data) => request('/rh/candidatures', { method: 'POST', body: JSON.stringify(data) }),
  updateCandidature: (id, data) => request(`/rh/candidatures/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCandidature: (id) => request(`/rh/candidatures/${id}`, { method: 'DELETE' }),
  getFormations: () => request('/rh/formations'),
  createFormation: (data) => request('/rh/formations', { method: 'POST', body: JSON.stringify(data) }),
  updateFormation: (id, data) => request(`/rh/formations/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFormation: (id) => request(`/rh/formations/${id}`, { method: 'DELETE' }),
  getFormationParticipants: (id) => request(`/rh/formations/${id}/participants`),
  addFormationParticipant: (id, data) => request(`/rh/formations/${id}/participants`, { method: 'POST', body: JSON.stringify(data) }),

  // Compta
  getCompta: (params = '') => request(`/compta${params}`),
  getSolde: () => request('/compta/solde'),
  getRecettes: (params = '') => request(`/compta/recettes${params}`),
  getDepenses: (params = '') => request(`/compta/depenses${params}`),
  createEcriture: (data) => request('/compta', { method: 'POST', body: JSON.stringify(data) }),
  updateEcriture: (id, data) => request(`/compta/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteEcriture: (id) => request(`/compta/${id}`, { method: 'DELETE' }),
  rapportMensuel: () => request('/compta/rapport/mensuel'),

  // Clients
  getClients: (params = '') => request(`/clients${params}`),
  getClient: (id) => request(`/clients/${id}`),
  createClient: (data) => request('/clients', { method: 'POST', body: JSON.stringify(data) }),
  updateClient: (id, data) => request(`/clients/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteClient: (id) => request(`/clients/${id}`, { method: 'DELETE' }),

  // Dashboard
  getDashboard: () => request('/dashboard'),

  // Users (admin)
  getUsers: () => request('/users'),
  createUser: (data) => request('/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id, data) => request(`/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id) => request(`/users/${id}`, { method: 'DELETE' }),
  resetPassword: (id) => request(`/users/${id}/reset-password`, { method: 'POST' }),

  // Véhicules
  getVehicules: (params = '') => request(`/vehicules${params}`),
  getVehicule: (id) => request(`/vehicules/${id}`),
  createVehicule: (data) => request('/vehicules', { method: 'POST', body: JSON.stringify(data) }),
  updateVehicule: (id, data) => request(`/vehicules/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteVehicule: (id) => request(`/vehicules/${id}`, { method: 'DELETE' }),
  vehiculeStats: () => request('/vehicules/stats'),
  updateKilometrage: (id, km) => request(`/vehicules/${id}/kilometrage`, { method: 'POST', body: JSON.stringify({ kilometrage: km }) }),

  // Maintenance
  getMaintenance: (params = '') => request(`/maintenance${params}`),
  getMaintenanceTask: (id) => request(`/maintenance/${id}`),
  createMaintenance: (data) => request('/maintenance', { method: 'POST', body: JSON.stringify(data) }),
  updateMaintenance: (id, data) => request(`/maintenance/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteMaintenance: (id) => request(`/maintenance/${id}`, { method: 'DELETE' }),
  maintenanceStats: () => request('/maintenance/stats'),

  // Atelier
  getAtelierOrders: (params = '') => request(`/atelier${params}`),
  getAtelierOrder: (id) => request(`/atelier/${id}`),
  createAtelierOrder: (data) => request('/atelier', { method: 'POST', body: JSON.stringify(data) }),
  updateAtelierOrder: (id, data) => request(`/atelier/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAtelierOrder: (id) => request(`/atelier/${id}`, { method: 'DELETE' }),
  atelierStats: () => request('/atelier/stats'),
  addAtelierOperation: (orderId, data) => request(`/atelier/${orderId}/operations`, { method: 'POST', body: JSON.stringify(data) }),
  updateAtelierOperation: (orderId, opId, data) => request(`/atelier/${orderId}/operations/${opId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteAtelierOperation: (orderId, opId) => request(`/atelier/${orderId}/operations/${opId}`, { method: 'DELETE' }),

  // Fournisseurs
  getFournisseurs: (params = '') => request(`/fournisseurs${params}`),
  getFournisseur: (id) => request(`/fournisseurs/${id}`),
  createFournisseur: (data) => request('/fournisseurs', { method: 'POST', body: JSON.stringify(data) }),
  updateFournisseur: (id, data) => request(`/fournisseurs/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteFournisseur: (id) => request(`/fournisseurs/${id}`, { method: 'DELETE' }),

  // Commandes d'achat
  getCommandes: (params = '') => request(`/commandes${params}`),
  getCommande: (id) => request(`/commandes/${id}`),
  createCommande: (data) => request('/commandes', { method: 'POST', body: JSON.stringify(data) }),
  updateCommande: (id, data) => request(`/commandes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteCommande: (id) => request(`/commandes/${id}`, { method: 'DELETE' }),
  receptionCommande: (id, items) => request(`/commandes/${id}/reception`, { method: 'POST', body: JSON.stringify({ items }) }),
  commandesStats: () => request('/commandes/stats'),

  // Pneus
  getPneus: (params = '') => request(`/pneus${params}`),
  getPneu: (id) => request(`/pneus/${id}`),
  createPneu: (data) => request('/pneus', { method: 'POST', body: JSON.stringify(data) }),
  updatePneu: (id, data) => request(`/pneus/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePneu: (id) => request(`/pneus/${id}`, { method: 'DELETE' }),

  // Messages
  getMessages: (params = '') => request(`/messages${params}`),
  sendMessage: (data) => request('/messages', { method: 'POST', body: JSON.stringify(data) }),
  sendPdfMessage: async ({ recipient_id, recipient_role, content, file }) => request('/messages/pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-File-Name': encodeURIComponent(file.name),
      'X-Message-Content': encodeURIComponent(String(content || '').slice(0, 1000)),
      ...(recipient_id ? { 'X-Recipient-Id': String(recipient_id) } : {}),
      ...(recipient_role ? { 'X-Recipient-Role': String(recipient_role) } : {}),
    },
    body: await file.arrayBuffer(),
  }),
  markMessageRead: (id) => request(`/messages/${id}/read`, { method: 'PUT' }),
  getMessageUsers: () => request('/messages/users'),
  getUnreadCount: () => request('/messages/unread-count'),
  getConversations: () => request('/messages/conversations'),
  getReceivedDocuments: () => request('/messages/received-documents'),
  readConversation: (userId) => request('/messages/read-conversation', {
    method: 'PUT',
    body: JSON.stringify({ user_id: userId }),
  }),
  deleteMessage: (id) => request(`/messages/${id}`, { method: 'DELETE' }),
  deleteMessages: (ids) => request('/messages/delete-selection', { method: 'POST', body: JSON.stringify({ ids }) }),
  downloadMessagePdf,

  // Notifications
  getNotifications: (params = '') => request(`/notifications${params}`),
  getNotificationsUnreadCount: () => request('/notifications/unread-count'),
  createNotification: (data) => request('/notifications/create', { method: 'POST', body: JSON.stringify(data) }),
  markNotificationRead: (id) => request(`/notifications/${id}/read`, { method: 'PUT' }),
  markAllRead: () => request('/notifications/read-all', { method: 'PUT' }),
  deleteNotification: (id) => request(`/notifications/${id}`, { method: 'DELETE' }),

  // Échéancier partagé
  getEcheancier: (params = '') => request(`/echeancier${params}`),
  createEcheance: (data) => request('/echeancier', { method: 'POST', body: JSON.stringify(data) }),
  updateEcheance: (id, data) => request(`/echeancier/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteEcheance: (id) => request(`/echeancier/${id}`, { method: 'DELETE' }),
  acknowledgeEcheance: (id, phase) => request(`/echeancier/${id}/acknowledge`, { method: 'POST', body: JSON.stringify({ phase }) }),

  // Backup
  createBackup: () => request('/backup', { method: 'POST' }),
  getBackups: () => request('/backup'),
  restoreBackup: (filename) => request(`/backup/restore/${filename}`, { method: 'POST' }),
  deleteBackup: (filename) => request(`/backup/${filename}`, { method: 'DELETE' }),

  // Mail
  sendEmail: (data) => request('/mail/send', { method: 'POST', body: JSON.stringify(data) }),
  getMailUsers: () => request('/mail/users'),
  getMailHistory: () => request('/mail/history'),
  syncMail: () => request('/mail/sync', { method: 'POST' }),
  markMailRead: (id) => request(`/mail/${id}/read`, { method: 'PUT' }),
  deleteMail: (id) => request(`/mail/${id}`, { method: 'DELETE' }),

  // Systeme
  getPublicSystemConfig: () => request('/system/config/public'),
  getSystemConfig: () => request('/system/config'),
  updateSystemConfig: (key, value) => request(`/system/config/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify({ value }) }),
  getMigrationStatus: () => request('/system/migrations'),

  // Generic
  request: (path, options) => request(path, options),

  // Reporting
  getFullDashboard: () => request('/reporting/dashboard-complet'),
  getSalesReport: (params = '') => request(`/reporting/ventes${params}`),
  getStockMouvements: (params = '') => request(`/reporting/stock-mouvements${params}`),
  getMaintenanceReport: (params = '') => request(`/reporting/maintenance${params}`),
  getAuditLog: (params = '') => request(`/reporting/audit${params}`),
};
