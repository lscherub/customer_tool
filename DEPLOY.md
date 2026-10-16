# Deployment — Genesis Nutrition on Vercel + Supabase
## 1. Supabase
- New project → Settings → API → copy URL, anon key, service_role key.
- SQL Editor → run supabase/schema.sql → run supabase/rls.sql (order matters).
- Authentication → enable Email → create staff user(s).
- Optional: Storage not required (exports generated client-side; file bytes not stored, only metadata).
## 2. Vercel
- Import repo / folder `genesis-nutrition`.
- Env vars: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
- Build: `npm run build`. Output: Next.js default.
- Region yvr1 (Vancouver) suggested in vercel.json.
## 3. Local
- `npm install && npm run dev` → http://localhost:3000
- Samples: samples/sample-customers.xlsx, samples/sample-sales.xlsx
- Tests: `npm test` (8 spec checks).
## 4. Updating safely
- DB: write new `supabase/migration-XXX.sql`, run in Supabase SQL editor, then deploy app.
- App: push → Vercel preview → promote to production.
- Never commit `.env.local` or service-role key to git.
