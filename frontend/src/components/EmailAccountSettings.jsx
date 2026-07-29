import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';

const ROLES = [
  ['admin', 'Administrateur'],
  ['commercial', 'Commercial'],
  ['comptable', 'Comptable'],
  ['magasinier', 'Magasinier'],
  ['rh', 'Ressources humaines'],
  ['financier', 'Financier'],
  ['technicien', 'Technicien'],
  ['employe', 'Employé'],
];
const DOCUMENTS = [
  ['DEV', 'Devis'],
  ['FACT', 'Factures'],
  ['BL', 'Bons livraison'],
  ['BC', 'Bons commande'],
  ['AVOIR', 'Avoirs'],
  ['RELANCE', 'Relances'],
  ['RH', 'Documents RH'],
];

const emptyShared = {
  account_type: 'organization',
  email_address: '',
  app_password: '',
  sender_name: '',
  is_active: true,
  is_default: false,
  smtp_enabled: true,
  imap_enabled: true,
  permissions: [],
};

const STATUS_TEXT = {
  connected: 'Connexion réussie',
  refused: 'Identifiants refusés',
  smtp_unavailable: 'SMTP indisponible',
  imap_unavailable: 'IMAP indisponible',
  configuration_incomplete: 'Configuration incomplète',
};

function permissionKey(permission) {
  return permission.user_id ? `user:${permission.user_id}` : `role:${permission.role_name}`;
}

export default function EmailAccountSettings({ user, onNotice }) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [personal, setPersonal] = useState(null);
  const [personalForm, setPersonalForm] = useState({
    email_address: '',
    app_password: '',
    sender_name: '',
    is_default: true,
    smtp_enabled: true,
    imap_enabled: true,
  });
  const [editingPersonal, setEditingPersonal] = useState(true);
  const [sharedAccounts, setSharedAccounts] = useState([]);
  const [users, setUsers] = useState([]);
  const [sharedForm, setSharedForm] = useState(emptyShared);
  const [editingSharedId, setEditingSharedId] = useState(null);
  const isAdmin = user?.role === 'admin';

  const notify = useCallback((message, type = 'success') => {
    onNotice?.({ message, type });
  }, [onNotice]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const personalAccount = await api.getPersonalEmailAccount();
      setPersonal(personalAccount?.configured ? personalAccount : null);
      setPersonalForm(current => ({
        ...current,
        email_address: personalAccount?.email_address || '',
        app_password: '',
        sender_name: personalAccount?.sender_name || user?.full_name || '',
        is_default: personalAccount?.is_default ?? true,
        smtp_enabled: personalAccount?.smtp_enabled ?? true,
        imap_enabled: personalAccount?.imap_enabled ?? true,
      }));
      setEditingPersonal(!personalAccount?.configured);
      if (isAdmin) {
        const [accounts, organizationUsers] = await Promise.all([
          api.getOrganizationEmailAccounts(),
          api.getUsers(),
        ]);
        setSharedAccounts(accounts);
        setUsers(organizationUsers);
      }
    } catch (error) {
      notify(error.message || 'Chargement Gmail impossible', 'error');
    } finally {
      setLoading(false);
    }
  }, [isAdmin, notify, user?.full_name]);

  useEffect(() => { refresh(); }, [refresh]);

  async function testPersonal() {
    setBusy(true);
    try {
      const result = await api.testPersonalEmailAccount(personalForm);
      notify(STATUS_TEXT[result.status] || 'Test Gmail impossible', result.status === 'connected' ? 'success' : 'error');
    } catch (error) {
      notify(error.message || 'Test Gmail impossible', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function savePersonal() {
    setBusy(true);
    try {
      const result = await api.savePersonalEmailAccount(personalForm);
      setPersonal(result.account);
      setPersonalForm(current => ({ ...current, app_password: '' }));
      setEditingPersonal(false);
      notify('Gmail personnel enregistré');
    } catch (error) {
      notify(error.message || 'Enregistrement Gmail impossible', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deletePersonal() {
    if (!(await systemConfirm('Déconnecter votre Gmail personnel ?', {
      danger: true,
      confirmLabel: 'Déconnecter',
    }))) return;
    setBusy(true);
    try {
      await api.deletePersonalEmailAccount();
      setPersonal(null);
      setPersonalForm({ ...emptyShared, account_type: undefined, is_default: true });
      setEditingPersonal(true);
      notify('Gmail personnel déconnecté');
    } catch (error) {
      notify(error.message || 'Déconnexion impossible', 'error');
    } finally {
      setBusy(false);
    }
  }

  function editShared(account) {
    setEditingSharedId(account.id);
    setSharedForm({
      account_type: account.account_type,
      email_address: account.email_address,
      app_password: '',
      sender_name: account.sender_name || '',
      is_active: account.is_active,
      is_default: account.is_default,
      smtp_enabled: account.smtp_enabled,
      imap_enabled: account.imap_enabled,
      permissions: account.permissions || [],
    });
  }

  function resetShared() {
    setEditingSharedId(null);
    setSharedForm(emptyShared);
  }

  function updatePermission(subject, patch) {
    const key = permissionKey(subject);
    const current = sharedForm.permissions.find(item => permissionKey(item) === key);
    const next = {
      user_id: subject.user_id || null,
      role_name: subject.role_name || null,
      can_send: current?.can_send || false,
      can_read: current?.can_read || false,
      allowed_document_types: current?.allowed_document_types || [],
      ...patch,
    };
    setSharedForm(form => ({
      ...form,
      permissions: [
        ...form.permissions.filter(item => permissionKey(item) !== key),
        next,
      ].filter(item => item.can_send || item.can_read),
    }));
  }

  async function saveShared() {
    setBusy(true);
    try {
      if (editingSharedId) await api.updateOrganizationEmailAccount(editingSharedId, sharedForm);
      else await api.createOrganizationEmailAccount(sharedForm);
      notify(editingSharedId ? 'Compte partagé modifié' : 'Compte partagé ajouté');
      resetShared();
      await refresh();
    } catch (error) {
      notify(error.message || 'Enregistrement partagé impossible', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function testShared(account) {
    setBusy(true);
    try {
      const result = await api.testOrganizationEmailAccount(account.id);
      notify(STATUS_TEXT[result.status] || 'Test Gmail impossible', result.status === 'connected' ? 'success' : 'error');
    } catch (error) {
      notify(error.message || 'Test Gmail impossible', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function deleteShared(account) {
    if (!(await systemConfirm(`Supprimer ${account.email_address} ?`, {
      danger: true,
      confirmLabel: 'Supprimer',
    }))) return;
    setBusy(true);
    try {
      await api.deleteOrganizationEmailAccount(account.id);
      notify('Compte partagé supprimé');
      if (editingSharedId === account.id) resetShared();
      await refresh();
    } catch (error) {
      notify(error.message || 'Suppression impossible', 'error');
    } finally {
      setBusy(false);
    }
  }

  const permissionMap = useMemo(
    () => new Map(sharedForm.permissions.map(item => [permissionKey(item), item])),
    [sharedForm.permissions],
  );

  return (
    <div className="email-account-settings">
      <section className="email-account-card">
        <header>
          <div>
            <strong>Mon Gmail personnel</strong>
            <small>Accessible uniquement depuis votre compte.</small>
          </div>
          {personal?.configured && !editingPersonal && (
            <button type="button" onClick={() => setEditingPersonal(true)}>Modifier</button>
          )}
        </header>
        <div className="settings-form-grid settings-form-grid-email">
          <label>
            <span>Adresse Gmail</span>
            <input
              type="email"
              disabled={loading || busy || !editingPersonal}
              value={personalForm.email_address}
              onChange={event => setPersonalForm({ ...personalForm, email_address: event.target.value })}
              placeholder="nom@gmail.com"
            />
          </label>
          <label>
            <span>Mot passe application</span>
            <input
              type="password"
              disabled={loading || busy || !editingPersonal}
              value={personalForm.app_password}
              onChange={event => setPersonalForm({ ...personalForm, app_password: event.target.value })}
              placeholder={personal?.configured ? 'Vide conserve secret actuel' : '16 caractères Google'}
              autoComplete="new-password"
            />
          </label>
          <label>
            <span>Nom expéditeur</span>
            <input
              disabled={loading || busy || !editingPersonal}
              value={personalForm.sender_name}
              onChange={event => setPersonalForm({ ...personalForm, sender_name: event.target.value })}
            />
          </label>
        </div>
        <div className="email-account-options">
          <label><input type="checkbox" disabled={!editingPersonal} checked={personalForm.is_default} onChange={event => setPersonalForm({ ...personalForm, is_default: event.target.checked })} /> Expéditeur défaut</label>
          <label><input type="checkbox" disabled={!editingPersonal} checked={personalForm.smtp_enabled} onChange={event => setPersonalForm({ ...personalForm, smtp_enabled: event.target.checked })} /> Envoi SMTP</label>
          <label><input type="checkbox" disabled={!editingPersonal} checked={personalForm.imap_enabled} onChange={event => setPersonalForm({ ...personalForm, imap_enabled: event.target.checked })} /> Lecture IMAP</label>
        </div>
        <div className="settings-session-actions">
          <button type="button" disabled={loading || busy || !editingPersonal} onClick={testPersonal}>Tester connexion</button>
          {editingPersonal && <button type="button" disabled={loading || busy} onClick={savePersonal}>{personal ? 'Enregistrer modifications' : 'Connecter mon Gmail'}</button>}
          {personal && <button type="button" className="is-danger" disabled={busy} onClick={deletePersonal}>Déconnecter mon Gmail</button>}
        </div>
      </section>

      {isAdmin && (
        <section className="email-account-card">
          <header>
            <div>
              <strong>Gmail entreprise</strong>
              <small>Comptes communs, rôles, utilisateurs, documents.</small>
            </div>
            <button type="button" onClick={resetShared}>Nouveau compte</button>
          </header>

          {sharedAccounts.length > 0 && (
            <div className="email-account-list">
              {sharedAccounts.map(account => (
                <article key={account.id}>
                  <span><strong>{account.sender_name || account.email_address}</strong><small>{account.email_address} · {account.is_active ? 'Actif' : 'Inactif'}</small></span>
                  <button type="button" disabled={busy} onClick={() => testShared(account)}>Tester</button>
                  <button type="button" disabled={busy} onClick={() => editShared(account)}>Éditer</button>
                  <button type="button" className="is-danger" disabled={busy} onClick={() => deleteShared(account)}>Supprimer</button>
                </article>
              ))}
            </div>
          )}

          <div className="settings-form-grid">
            <label><span>Type</span><select value={sharedForm.account_type} onChange={event => setSharedForm({ ...sharedForm, account_type: event.target.value })}><option value="organization">Général entreprise</option><option value="shared">Partagé</option></select></label>
            <label><span>Adresse Gmail</span><input type="email" value={sharedForm.email_address} onChange={event => setSharedForm({ ...sharedForm, email_address: event.target.value })} /></label>
            <label><span>Nom expéditeur</span><input value={sharedForm.sender_name} onChange={event => setSharedForm({ ...sharedForm, sender_name: event.target.value })} /></label>
            <label><span>Mot passe application</span><input type="password" autoComplete="new-password" value={sharedForm.app_password} onChange={event => setSharedForm({ ...sharedForm, app_password: event.target.value })} placeholder={editingSharedId ? 'Vide conserve secret actuel' : '16 caractères Google'} /></label>
          </div>
          <div className="email-account-options">
            <label><input type="checkbox" checked={sharedForm.is_active} onChange={event => setSharedForm({ ...sharedForm, is_active: event.target.checked })} /> Compte actif</label>
            <label><input type="checkbox" checked={sharedForm.is_default} onChange={event => setSharedForm({ ...sharedForm, is_default: event.target.checked })} /> Compte défaut</label>
            <label><input type="checkbox" checked={sharedForm.smtp_enabled} onChange={event => setSharedForm({ ...sharedForm, smtp_enabled: event.target.checked })} /> SMTP</label>
            <label><input type="checkbox" checked={sharedForm.imap_enabled} onChange={event => setSharedForm({ ...sharedForm, imap_enabled: event.target.checked })} /> IMAP</label>
          </div>

          <div className="email-permission-grid">
            <header><strong>Autorisations rôles</strong><small>Lecture, envoi, documents.</small></header>
            {ROLES.map(([role, label]) => {
              const permission = permissionMap.get(`role:${role}`) || {};
              return (
                <div key={role}>
                  <strong>{label}</strong>
                  <label><input type="checkbox" checked={Boolean(permission.can_send)} onChange={event => updatePermission({ role_name: role }, { can_send: event.target.checked })} /> Envoyer</label>
                  <label><input type="checkbox" checked={Boolean(permission.can_read)} onChange={event => updatePermission({ role_name: role }, { can_read: event.target.checked })} /> Lire</label>
                  <span>{DOCUMENTS.map(([type, labelDoc]) => (
                    <label key={type}><input type="checkbox" checked={(permission.allowed_document_types || []).includes(type)} onChange={event => updatePermission({ role_name: role }, {
                      allowed_document_types: event.target.checked
                        ? [...new Set([...(permission.allowed_document_types || []), type])]
                        : (permission.allowed_document_types || []).filter(value => value !== type),
                    })} /> {labelDoc}</label>
                  ))}</span>
                </div>
              );
            })}
          </div>

          {users.length > 0 && (
            <div className="email-permission-grid">
              <header><strong>Autorisations utilisateurs</strong><small>Priorité utilisateur.</small></header>
              {users.map(accountUser => {
                const permission = permissionMap.get(`user:${accountUser.id}`) || {};
                return (
                  <div key={accountUser.id}>
                    <strong>{accountUser.full_name || accountUser.username}</strong>
                    <label><input type="checkbox" checked={Boolean(permission.can_send)} onChange={event => updatePermission({ user_id: accountUser.id }, { can_send: event.target.checked })} /> Envoyer</label>
                    <label><input type="checkbox" checked={Boolean(permission.can_read)} onChange={event => updatePermission({ user_id: accountUser.id }, { can_read: event.target.checked })} /> Lire</label>
                  </div>
                );
              })}
            </div>
          )}

          <div className="settings-session-actions">
            <button type="button" disabled={busy || !sharedForm.email_address} onClick={saveShared}>{editingSharedId ? 'Enregistrer compte' : 'Ajouter compte partagé'}</button>
          </div>
        </section>
      )}
    </div>
  );
}
