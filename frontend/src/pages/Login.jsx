import { useState } from 'react';
import { useAuth } from '../AuthContext';

export default function LoginPage({ onSuccess }) {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
      onSuccess?.();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const theme = { btn: '#0f766e' };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f1f5f9' }}>
      <form onSubmit={handleSubmit} style={{ background: '#fff', padding: '40px 36px', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,.1)', width: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, fontWeight: 900, color: theme.btn, letterSpacing: -1 }}>IntelSpark ERP-AH</div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>Connexion à l'application</div>
        </div>
        {error && <div style={{ background: '#fef2f2', color: '#dc2626', padding: '8px 12px', borderRadius: 6, fontSize: 13, marginBottom: 16, textAlign: 'center' }}>{error}</div>}
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="Nom d'utilisateur" required
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, marginBottom: 12, outline: 'none', boxSizing: 'border-box' }} />
        <input value={password} onChange={e => setPassword(e.target.value)} type="password" placeholder="Mot de passe" required
          style={{ width: '100%', padding: '10px 12px', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 14, marginBottom: 20, outline: 'none', boxSizing: 'border-box' }} />
        <button type="submit" disabled={busy} style={{ width: '100%', padding: '10px', background: theme.btn, color: '#fff', border: 'none', borderRadius: 6, fontSize: 15, fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer', opacity: busy ? 0.6 : 1 }}>
          {busy ? 'Connexion...' : 'Se connecter'}
        </button>
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
          Serveur local — {import.meta.env.VITE_API_URL || 'http://localhost:3001'}
        </div>
      </form>
    </div>
  );
}
