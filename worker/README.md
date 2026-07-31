# Cloudflare Worker API — Root Directory: worker
#
# Build (CI / local):
#   npm ci
#   npm test
#   npm run typecheck
#   npx wrangler deploy --dry-run
#
# Deploy (manual / approved only):
#   npx wrangler deploy
#
# Required Worker secrets (set via `wrangler secret put`, never commit values):
#   SUPABASE_URL
#   SUPABASE_SERVICE_ROLE_KEY
#   ALLOWED_ORIGINS
#   JWT_SECRET
#
# Windows start.bat is for local Express+Vite only. Never use it on Linux CI or Cloudflare.
