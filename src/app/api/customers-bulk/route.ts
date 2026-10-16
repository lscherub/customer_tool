import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
export async function POST(req: Request) {
try {
const url = process.env.NEXT_PUBLIC_SUPABASE_URL; const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !svc) return NextResponse.json({ mode: 'local', note: 'Supabase not configured; browser localStorage handles data. Set env vars for Postgres bulk path.' });
const { customers } = await req.json();
if (!Array.isArray(customers) || !customers.length) return NextResponse.json({ error: 'customers[] required' }, { status: 400 });
const sb = createClient(url, svc);
let added = 0, updated = 0;
for (let i = 0; i < customers.length; i += 1000) {
const chunk = customers.slice(i, i + 1000);
const { data, error } = await sb.rpc('bulk_upsert_customers', { payload: chunk });
if (error) throw error;
added += data?.added ?? 0; updated += data?.updated ?? 0;
}
return NextResponse.json({ added, updated });
} catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 }); } }
