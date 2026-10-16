# Deployment — Genesis Nutrition on Vercel + Supabase

## 1. Supabase (shared multi-device database)
- New project → Settings → API → copy URL, anon key, service_role key.
- SQL Editor → run in order:
  1. `supabase/schema.sql`
  2. `supabase/rls.sql`
  3. `supabase/migration-manual-points.sql` (if upgrading an existing project)
  4. `supabase/migration-shared-db.sql` (**required for multi-device sync** — adds
     `client_id` + `data jsonb` columns, `referral_aggregates` table, manual-reward
     columns, staff RLS policies, and the full-fidelity `bulk_upsert_customers`
     function). All statements are idempotent — safe to re-run.
- Authentication → enable Email → create one staff user per device/operator
  (e.g. `davie@store.com`, `westbroadway@store.com`). These are the accounts
  staff sign into from the app banner.

## 2. Vercel
- Import repo / folder `genesis-nutrition`.
- Env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- Build: `npm run build`. Output: Next.js default.
- Region yvr1 (Vancouver) suggested in vercel.json.

## 3. How sync works once deployed
- On app load each device signs in (banner at top) and pulls all customers,
  sales, referrals, batches, adjustments, manual rewards, settings from Supabase,
  merging with the local offline cache so nothing is ever lost.
- Every change is diff-uploaded (only new/changed rows) 600ms after you make it.
- localStorage remains an offline cache; Supabase is the source of truth.

## 4. Two-device acceptance test
1. Device A: sign in → import `samples/sample-customers.xlsx` on All Customers.
2. Device B: refresh → customers appear without any re-import.
3. Device B: import `samples/sample-sales.xlsx` on Referral Sales → export a batch.
4. Device A: refresh → batch visible in Reward History with the same totals.
5. Manual Reward on A (net $20 @ 5% × 10ppd = 10 pts) → confirm → balance updates
   on both devices; confirming twice is blocked.

## 5. Local
- `npm install && npm run dev` → http://localhost:3000
- Samples: samples/sample-customers.xlsx, samples/sample-sales.xlsx
- Tests: `npm test` (12 spec checks).

## 6. Updating safely
- DB: write new `supabase/migration-XXX.sql`, run in Supabase SQL editor, then deploy app.
- App: push → Vercel preview → promote to production.
- Never commit `.env.local` or service-role key to git.
