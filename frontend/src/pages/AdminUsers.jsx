import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { systemConfirm } from '../SystemConfirm';

const emptyForm = {
  username: '', password: '', role: 'employe', department: '', full_name: '', email: '',
};

const roles = [
  ['employe', 'Employé'], ['admin', 'Administrateur'], ['comptable', 'Comptable'],
  ['commercial', 'Commercial'], ['rh', 'Ressources humaines'], ['financier', 'Financier'],
  ['magasinier', 'Magasinier'], ['technicien', 'Technicien'],
];

const departments = [
  ['', 'Aucun département'], ['direction', 'Direction'], ['comptabilite', 'Comptabilité'],
  ['commercial', 'Commercial'], ['rh', 'Ressources humaines'], ['finance', 'Finance'],
  ['magasin', 'Magasin'], ['atelier', 'Atelier'],
];

export default function AdminUsersPage({ onlineUsers = [] }) {
  const [users, setUsers] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  function showMessage(message, type = 'success') {
    setNotice({ message, type });
    window.setTimeout(() => setNotice(null), 3200);
  }

  async function load() {
    setLoading(true);
    try {
      const data = await api.getUsers();
      setUsers(Array.isArray(data) ? data : []);
    } catch (error) {
      showMessage(error.message || 'Chargement impossible', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function updateField(field, value) {
    setForm(current => ({ ...current, [field]: value }));
  }

  async function save(event) {
    event.preventDefault();
    if (!form.username.trim() || !form.password.trim()) {
      showMessage('Identifiant et mot de passe requis', 'error');
      return;
    }
    setSaving(true);
    try {
      await api.createUser(form);
      showMessage('Utilisateur créé avec succès');
      setShowForm(false);
      setForm(emptyForm);
      await load();
    } catch (error) {
      showMessage(error.message || 'Création impossible', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user) {
    try {
      await api.updateUser(user.id, { active: user.active ? 0 : 1 });
      showMessage(user.active ? 'Compte désactivé' : 'Compte activé');
      await load();
    } catch (error) { showMessage(error.message, 'error'); }
  }

  async function remove(id) {
    if (!(await systemConfirm('Supprimer définitivement cet utilisateur ?'))) return;
    try {
      await api.deleteUser(id);
      showMessage('Utilisateur supprimé');
      await load();
    } catch (error) { showMessage(error.message, 'error'); }
  }

  const filteredUsers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(user => [user.username, user.full_name, user.email, user.role, user.department]
      .some(value => String(value || '').toLowerCase().includes(needle)));
  }, [query, users]);

  const onlineIds = useMemo(() => new Set(onlineUsers.map(item => String(item.userId))), [onlineUsers]);

  return (
    <section className="users-page">
      {notice && <div className={`users-notice users-notice-${notice.type}`} role="status">{notice.message}</div>}

      <header className="users-hero">
        <div>
          <span className="users-eyebrow">Administration · Accès</span>
          <h1>Gestion des utilisateurs</h1>
          <p>Centralisez comptes, rôles et autorisations depuis un espace sécurisé.</p>
        </div>
        <button className="users-primary" onClick={() => setShowForm(value => !value)} aria-expanded={showForm}>
          <span>{showForm ? '×' : '+'}</span>{showForm ? 'Fermer' : 'Nouvel utilisateur'}
        </button>
      </header>

      {showForm && (
        <form className="users-create" onSubmit={save}>
          <header><div><span>Nouveau compte</span><h2>Informations utilisateur</h2></div><small>* Champs obligatoires</small></header>
          <div className="users-form-grid">
            <label><span>Nom complet</span><input value={form.full_name} onChange={event => updateField('full_name', event.target.value)} placeholder="Prénom et nom" /></label>
            <label><span>Adresse email</span><input type="email" value={form.email} onChange={event => updateField('email', event.target.value)} placeholder="nom@entreprise.ma" /></label>
            <label><span>Identifiant *</span><input required autoComplete="off" value={form.username} onChange={event => updateField('username', event.target.value)} placeholder="ex. a.amine" /></label>
            <label><span>Mot de passe *</span><input required type="password" autoComplete="new-password" value={form.password} onChange={event => updateField('password', event.target.value)} placeholder="8 caractères minimum" /></label>
            <label><span>Rôle</span><select value={form.role} onChange={event => updateField('role', event.target.value)}>{roles.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label><span>Département</span><select value={form.department} onChange={event => updateField('department', event.target.value)}>{departments.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </div>
          <footer><button type="button" className="users-secondary" onClick={() => setShowForm(false)}>Annuler</button><button className="users-primary" disabled={saving}>{saving ? 'Création…' : 'Créer utilisateur'}</button></footer>
        </form>
      )}

      <div className="users-directory">
        <header>
          <div><span>Annuaire</span><h2>Utilisateurs et accès</h2></div>
          <label className="users-search"><span aria-hidden="true">⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Rechercher un utilisateur…" aria-label="Rechercher un utilisateur" /></label>
        </header>

        <div className="users-table-wrap">
          <table>
            <thead><tr><th>Utilisateur</th><th>Rôle</th><th>Département</th><th>Statut</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {loading && <tr><td colSpan="5"><div className="users-state">Chargement des utilisateurs…</div></td></tr>}
              {!loading && filteredUsers.map(user => (
                <tr key={user.id}>
                  <td><div className="users-person"><span className="users-avatar">{String(user.full_name || user.username || '?').trim().charAt(0).toUpperCase()}</span><div><strong>{user.full_name || user.username}</strong><small>@{user.username}{user.email ? ` · ${user.email}` : ''}</small></div></div></td>
                  <td><span className={`users-role users-role-${user.role || 'employe'}`}>{roles.find(([value]) => value === user.role)?.[1] || user.role || 'Employé'}</span></td>
                  <td>{departments.find(([value]) => value === user.department)?.[1] || user.department || 'Non affecté'}</td>
                  <td><span className={`users-status ${!user.active ? 'is-inactive' : onlineIds.has(String(user.id)) ? 'is-online' : 'is-offline'}`}><i />{!user.active ? 'Désactivé' : onlineIds.has(String(user.id)) ? 'En ligne' : 'Hors ligne'}</span></td>
                  <td><div className="users-actions"><button onClick={() => toggleActive(user)}>{user.active ? 'Désactiver' : 'Activer'}</button><button className="is-danger" onClick={() => remove(user.id)} aria-label={`Supprimer ${user.username}`}>Supprimer</button></div></td>
                </tr>
              ))}
              {!loading && filteredUsers.length === 0 && <tr><td colSpan="5"><div className="users-state"><strong>Aucun utilisateur trouvé</strong><span>Modifiez votre recherche.</span></div></td></tr>}
            </tbody>
          </table>
        </div>
        <footer><span>{filteredUsers.length} résultat{filteredUsers.length > 1 ? 's' : ''}</span><span>Accès administrateur requis</span></footer>
      </div>
    </section>
  );
}
