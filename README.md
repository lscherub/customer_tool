# Genesis Nutrition — Referral Rewards (Amber POS companion)
Internal tool: customer imports, referral matching, reward calculation, POS point-import exports, batch history with safe confirmation.
## Quick start
npm install; npm run dev (http://localhost:3000); npm run build; node --test tests/run.mjs
Works immediately with browser localStorage. Add Supabase env vars for Postgres.
## Supabase setup
1. Create project, copy URL + anon + service-role keys. 2. Run supabase/schema.sql then supabase/rls.sql. 3. Enable email Auth, create staff users. 4. Vercel env: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (server only). 5. Deploy via Vercel; schema changes = new SQL + redeploy.
## Workflow
1. All Customers: import Amber export, preview, confirm. Never deletes missing. 2. Referral Sales: set period, upload summary, review map (group2=phone, Subtotal=net), import. 3. Resolve shared phones, select rows, override %/ppd, Export Rewards (.xlsx CustomerID+Points). 4. History: after POS import click Confirm POS Import (20+10=30 applied once, audited). Re-download never re-applies.
## Scale
Chunked client import handles 20k+. Postgres path: POST ~1000-row chunks to /api/customers-bulk using bulk_upsert_customers.
## Deploy on Vercel
Standard Next.js deploy; see https://nextjs.org/docs/app/building-your-application/deploying
