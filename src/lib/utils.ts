export function normalizeHeader(h: unknown): string {
  return String(h ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function normalizePhone(p: unknown): string {
  if (p === null || p === undefined) return '';
  return String(p).replace(/[^\d]/g, '');
}

export function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const s = String(v).replace(/[$,\s]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function parsePoints(v: unknown): number {
  const n = parseNumber(v);
  if (n === null) return 0;
  return Math.round(n);
}

export function cad(n: number): string {
  return new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(n || 0);
}

export function todayStamp(): string {
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function simpleHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return `h${(h >>> 0).toString(16)}-${text.length}`;
}

/** Remove blank first column and blank second row typical of Amber POS exports. */
export function cleanMatrix(aoa: unknown[][]): unknown[][] {
  if (!aoa.length) return aoa;
  let rows = aoa.map((r) => [...r]);
  // Drop fully-empty leading columns (usually exactly 1 blank col)
  while (rows.length && rows.every((r) => r[0] === null || r[0] === undefined || String(r[0]).trim() === '')) {
    rows = rows.map((r) => r.slice(1));
    if (!rows[0]?.length) break;
  }
  // Drop blank second row (index 1) if every cell blank
  if (rows.length >= 2) {
    const second = rows[1];
    const blank = second.every((c) => c === null || c === undefined || String(c).trim() === '');
    if (blank) rows = [rows[0], ...rows.slice(2)];
  }
  // Drop trailing fully-empty rows
  while (rows.length && rows[rows.length - 1].every((c) => c === null || c === undefined || String(c).trim() === '')) {
    rows.pop();
  }
  return rows;
}

export function isSummaryRowText(v: unknown): boolean {
  const s = String(v ?? '').toLowerCase();
  return /total|summary|grand/.test(s);
}

export function calcReward(netSales: number, rewardPct: number, ppd: number, rounding: 'nearest' | 'floor' | 'ceil' = 'nearest'): { rewardValue: number; points: number } {
  const rewardValue = (Number(netSales) || 0) * (Number(rewardPct) || 0) / 100;
  const rawPoints = rewardValue * (Number(ppd) || 0);
  let points = Math.round(rawPoints);
  if (rounding === 'floor') points = Math.floor(rawPoints);
  if (rounding === 'ceil') points = Math.ceil(rawPoints);
  return { rewardValue: Math.round(rewardValue * 100) / 100, points };
}
