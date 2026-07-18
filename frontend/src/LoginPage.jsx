import { useState } from 'react';
import { useAuth } from './AuthContext';
import './LoginPage.css';

export default function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
      window.location.reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="login-shell">
      <section className="login-brand" aria-hidden="true">
        <div className="login-brand__grid" />
        <div className="login-brand__orb login-brand__orb--one" />
        <div className="login-brand__orb login-brand__orb--two" />
        <div className="login-brand__content">
          <span className="login-brand__eyebrow">GESTION INTELLIGENTE</span>
          <h1 className="login-black-title"><span>Pilotez chaque pièce.</span><br /><span>Gardez une longueur d'avance.</span></h1>
          <p>Stocks, ventes, ateliers et opérations réunis dans un espace conçu pour votre entreprise.</p>
        </div>
      </section>
      <section className="login-panel">
        <form className="login-card" onSubmit={handleSubmit}>
          <div className="login-identity">
            <div className="login-logo"><img src="/login-logo-transparent.png?v=3" alt="Logo INTELSPARK" /></div>
            <img className="login-wordmark" src="/login-wordmark-transparent.png?v=1" alt="INTELSPARK ERP-AH" />
          </div>
          <p className="login-overline">ESPACE SÉCURISÉ</p>
          <h2>Connexion</h2>
          <p className="login-subtitle">Connectez-vous à votre espace de travail.</p>

          {error && <div className="login-error" role="alert">{error}</div>}

          <label className="login-field">
            <span>Identifiant</span>
            <input
              placeholder="Votre identifiant"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </label>
          <label className="login-field">
            <span>Mot de passe</span>
            <input
              type="password"
              placeholder="Votre mot de passe"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          <button className="login-submit" type="submit" disabled={busy}>
            {busy ? 'Connexion en cours…' : 'Se connecter'} <span aria-hidden="true">→</span>
          </button>
          <p className="login-hint">Accès réservé aux collaborateurs autorisés.</p>
        </form>
      </section>
    </main>
  );
}
