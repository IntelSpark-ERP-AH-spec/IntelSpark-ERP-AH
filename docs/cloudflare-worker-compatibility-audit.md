# Audit Cloudflare Workers

Date: 2026-07-30

## Périmètre

- Frontend: `frontend/`, React 19, Vite 8, React Router avec `BrowserRouter`.
- Backend: racine du dépôt, entrée `server.js`, Express 5.
- API: 213 routes actives, dont 207 routes dans `backend/routes/`.
- Base: PostgreSQL Supabase via `DATABASE_URL`.
- Temps réel: serveur `ws` sur `/ws`, Redis Pub/Sub facultatif.
- Gmail: Nodemailer SMTP, ImapFlow IMAP, synchronisation périodique.
- PDF: génération navigateur et stockage local des PDF de messagerie.

## Compatibilité

| Fonction | Fichiers principaux | Compatibilité Worker | Adaptation | Risque | Solution | Tests |
|---|---|---|---|---|---|---|
| Frontend SPA | `frontend/src`, `frontend/vite.config.js` | Directe via Pages | Redirection SPA, origines API/WS publiques | Faible | Cloudflare Pages | build, routes directes, cache |
| Express | `server.js`, `backend/routes/*` | Partielle | Migrer route par route vers handlers Fetch | Élevé | Worker séparé | parité HTTP complète |
| Auth JWT | `backend/auth.js`, `backend/routes/auth.js` | Adaptable | Web Crypto ou librairie compatible, stockage blacklist Supabase | Élevé | Conserver contrats JWT | rôles, organisation, expiration |
| PostgreSQL | `backend/postgres-compat.js`, `backend/postgres-worker.js` | Incompatible actuellement | Supprimer dépendance `worker_threads` dans code migré | Critique | Supabase HTTPS/RPC; Hyperdrive si SQL direct | lecture, écriture réversible |
| WebSocket | `backend/websocket.js` | Incompatible directement | Remplacer coordination mémoire et serveur `ws` | Critique | Supabase Realtime privé prioritaire | deux comptes, reconnexion |
| Redis | `backend/realtime-bus.js` | Non nécessaire après Realtime | Remplacer Pub/Sub | Moyen | Supabase Realtime, KV/DO seulement si besoin | événements multi-session |
| Gmail SMTP | `backend/email-account-service.js`, `backend/routes/mail.js` | À prototyper | TCP/TLS, temps CPU, erreurs réseau | Élevé | Gmail API OAuth 2.0 prioritaire | envoi, refus, pièces jointes |
| Gmail IMAP | `backend/mail-connection.js`, `backend/mail-sync-service.js` | Inadaptée au polling permanent | Transformer en tâches planifiées bornées | Critique | Gmail API + Cron/Queues | synchronisation incrémentale |
| Chiffrement Gmail | `backend/secrets.js` | Adaptable | Web Crypto AES-GCM, conserver clé stable et format | Critique | compatibilité chiffrés existants | vecteurs de migration |
| PDF navigateur | `frontend/src/App.jsx`, pages RH/compta | Directe | Aucune | Faible | Conserver | rendu, export, impression |
| PDF messagerie | `backend/message-pdf-storage.js`, `backend/routes/messages.js` | Incompatible durablement | Remplacer disque local | Critique | Supabase Storage privé | upload, URL signée, suppression |
| Sauvegardes | `backend/backup-service.js`, `backend/offsite-backup.js` | Inadaptée telle quelle | Tâches planifiées et stockage objet | Élevé | Supabase backups + Storage | restauration contrôlée |
| Plugins locaux | `backend/plugin-manager.js`, `plugins/` | Incompatible dynamique | Registre statique ou abandon contrôlé | Élevé | Imports statiques | allowlist, permissions |
| Monitoring | `backend/monitoring.js` | Adaptable | Requêtes bornées, logs structurés | Moyen | Workers Logs | erreurs sans secrets |
| Agent autonome | `backend/site-agent-autonomy.js` | Incompatible permanent | Cron/Queues/Workflows | Élevé | Cron déclenchant tâche bornée | idempotence, timeout |

## Routes Express

| Préfixe | Fichier | Routes |
|---|---|---:|
| `/api/atelier` | `backend/routes/atelier.js` | 9 |
| `/api/auth` | `backend/routes/auth.js` | 8 |
| `/api/backup` | `backend/routes/backup.js` | 6 |
| `/api/clients` | `backend/routes/clients.js` | 5 |
| `/api/commandes` | `backend/routes/commandes.js` | 7 |
| `/api/compta` | `backend/routes/compta.js` | 9 |
| `/api/dashboard` | `backend/routes/dashboard.js` | 1 |
| `/api/data` | `backend/routes/data.js` | 9 |
| `/api/echeancier` | `backend/routes/echeancier.js` | 5 |
| `/api/fournisseurs` | `backend/routes/fournisseurs.js` | 6 |
| `/api/mail` | `backend/routes/mail.js` | 18 |
| `/api/maintenance` | `backend/routes/maintenance.js` | 6 |
| `/api/messages` | `backend/routes/messages.js` | 12 |
| `/api/notifications` | `backend/routes/notifications.js` | 6 |
| `/api/plugins` | `backend/routes/plugins.js` | 2 |
| `/api/pneus` | `backend/routes/pneus.js` | 5 |
| `/api/reporting` | `backend/routes/reporting.js` | 5 |
| `/api/rh` | `backend/routes/rh.js` | 20 |
| `/api/site-agent` | `backend/routes/site-agent.js` | 11 |
| `/api/stock` | `backend/routes/stock.js` | 12 |
| `/api/system` | `backend/routes/system.js` | 7 |
| `/api/users` | `backend/routes/users.js` | 5 |
| `/api/vehicules` | `backend/routes/vehicules.js` | 7 |
| `/api/warehouse` | `backend/routes/warehouse.js` | 26 |
| `/api/user-data` | `src/userDataRoutes.js` | 2 |
| routes racine | `server.js` | 4 |

## Décision

`server.js` ne peut pas être copié dans Workers.

Migration progressive obligatoire:

1. Worker santé isolé.
2. Connexion Supabase HTTPS.
3. Auth et autorisations.
4. CRUD par domaine.
5. Conversations via Supabase Realtime privé.
6. PDF privés via Supabase Storage.
7. Gmail après prototype OAuth.
8. Tâches périodiques via Cron/Queues.

Netlify reste intact. Ancien backend reste disponible pendant validation.
