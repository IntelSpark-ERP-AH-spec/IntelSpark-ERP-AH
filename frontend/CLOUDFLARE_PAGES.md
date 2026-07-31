# Cloudflare Pages — temporary preview (Netlify unchanged)

## Build settings

- Root Directory: `frontend`
- Build command: `npm ci && npm run build`
- Build output directory: `dist`
- Compatibility: Node.js 20+

## Environment variables (Pages)

Public (build-time):

- `VITE_API_URL=https://intelspark-erp-api.intelspark-erp-ah.workers.dev`
- `VITE_SUPABASE_URL` (publishable project URL only)
- `VITE_SUPABASE_PUBLISHABLE_KEY` (anon/publishable key only)

Runtime (Pages Functions):

- `API_UPSTREAM=https://intelspark-erp-api.intelspark-erp-ah.workers.dev`

Worker secrets `ALLOWED_ORIGINS` must include exact Pages URLs (no wildcards):

- `https://preview.intelspark-erp-web.pages.dev`
- `https://intelspark-erp-web.pages.dev`
- each deployment URL used for tests (example: `https://6fc1f28f.intelspark-erp-web.pages.dev`)
- existing Netlify origin(s)

Update with:

```bash
cd worker
npx wrangler secret put ALLOWED_ORIGINS
```

Also set Pages project env:

- Build: `VITE_API_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
- Functions: `API_UPSTREAM=https://intelspark-erp-api.intelspark-erp-ah.workers.dev`


## SPA fallback

`public/_redirects` contains `/* /index.html 200`.

## Dual mode

- Netlify remains the production frontend until validation completes.
- Express `server.js` remains available for local and fallback.
- Do not change DNS in this phase.

## Manual deploy

```bash
cd frontend
npm ci
$env:VITE_API_URL="https://intelspark-erp-api.intelspark-erp-ah.workers.dev"
npm run build
npx wrangler pages deploy dist --project-name intelspark-erp-web
```
