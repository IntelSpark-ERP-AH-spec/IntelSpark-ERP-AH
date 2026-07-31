# Cloudflare Worker API — Root Directory: worker

## Local checks

```bash
npm ci
npm test
npm run typecheck
npx wrangler deploy --dry-run
```

## Deploy (approved only)

```bash
npx wrangler deploy
```

Required secrets via `wrangler secret put` (never commit values):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGINS`
- `JWT_SECRET`

Windows `start.bat` is for local Express+Vite only. Never use it on Linux CI or Cloudflare.

## Dual mode (current)

| Surface | Status |
|---------|--------|
| Express `server.js` | Kept; SPA / Netlify still use it when `VITE_API_URL` empty |
| Worker auth + users + data + stock + fournisseurs + commandes + dashboard + BL | Migrated (P0–P2) |
| Coverage gate | `npm run coverage:check` fails if P0/P1/P2 frontend routes missing |
| Frontend Cloudflare Pages | Prepared (see `frontend/CLOUDFLARE_PAGES.md`) |
| Netlify / DNS | Unchanged |

## Route matrix (critical path)

Commercial devis / BC / BL / factures / clients / catalog: persisted as `organization_documents` via `/api/data/*` (not separate REST).

See `src/coverage.ts` for the authoritative frontend-used P0–P2 list.


## Route matrix

### Auth

| Method | Path | Express | Worker | Notes |
|--------|------|---------|--------|-------|
| POST | `/api/auth/login` | yes | yes | Bearer token; clears legacy `token` cookie |
| POST | `/api/auth/logout` | yes | yes | Blacklists jti |
| GET | `/api/auth/me` | yes | yes | Public profile |
| PUT | `/api/auth/me` | yes | yes | Only `full_name`, `email` |
| PUT | `/api/auth/password` | yes | yes | Not `/change-password` |
| GET/PUT | `/api/auth/me/smtp*` | yes | no | Stay on Express (Gmail crypto) |
| POST | `/api/auth/refresh` | no | no | Absent in both |
| POST | `/api/auth/reset-password` | no | no | Admin reset is under `/api/users/:id/reset-password` |

### Users (admin)

| Method | Path | Express | Worker | Notes |
|--------|------|---------|--------|-------|
| GET | `/api/users` | yes | yes | Org-scoped |
| POST | `/api/users` | yes | yes | Creates UUID ids on Worker |
| PUT | `/api/users/:id` | yes | yes | Role/active/profile; org-scoped |
| DELETE | `/api/users/:id` | yes | yes | Hard delete + dependent cleanup; last-admin protected |
| POST | `/api/users/:id/reset-password` | yes | yes | Returns `temporary_password` once |
| GET | `/api/users/:id` | no | no | Not created |
| PATCH | `/api/users/:id/status\|role\|permissions` | no | no | Not created |

### Still Express-only (examples)

- Messages, notifications, documents, RH, stock, websocket, SMTP/Gmail, most domain APIs

## JWT / cookies

- Auth uses `Authorization: Bearer` (frontend `sessionStorage`), same as Express.
- Login clears cookie `token` (HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0).
- CORS: allowlist only; credentials true; never `*`.
