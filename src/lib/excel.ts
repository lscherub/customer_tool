import * as XLSX from 'xlsx';
import { cleanMatrix, normalizeHeader } from './utils';

export interface ParsedSheet {
  headers: string[];
  headerIndex: Record<string, number>;
  rows: Record<string, unknown>[];
  cleanedAoa: unknown[][];
}

/** Parse first sheet of an .xlsx/.csv File or ArrayBuffer, cleaning Amber POS quirks. */
export async function parseWorkbookFile(input: File | ArrayBuffer): Promise<ParsedSheet> {
  const buf = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
  const cleaned = cleanMatrix(aoa as unknown[][]);
  if (!cleaned.length) return { headers: [], headerIndex: {}, rows: [], cleanedAoa: [] };
  // Find header row: first row with at least 2 non-empty cells
  let headerRowIdx = 0;
  for (let i = 0; i < Math.min(cleaned.length, 5); i++) {
    const nonEmpty = (cleaned[i] as unknown[]).filter((c) => c !== null && c !== undefined && String(c).trim() !== '').length;
    if (nonEmpty >= 2) { headerRowIdx = i; break; }
  }
  const headers = ((cleaned[headerRowIdx] as unknown[]) ?? []).map((h) => String(h ?? '').trim());
  const headerIndex: Record<string, number> = {};
  headers.forEach((h, i) => { headerIndex[normalizeHeader(h)] = i; });
  const rows: Record<string, unknown>[] = [];
  for (let i = headerRowIdx + 1; i < cleaned.length; i++) {
    const r = cleaned[i] as unknown[];
    if (!r || r.every((c) => c === null || c === undefined || String(c).trim() === '')) continue;
    const obj: Record<string, unknown> = {};
    headers.forEach((h, col) => { obj[h] = r[col] ?? null; });
    rows.push(obj);
  }
  return { headers, headerIndex, rows, cleanedAoa: cleaned as unknown[][] };
}

export function getByHeaders(row: Record<string, unknown>, candidates: string[]): unknown {
  const norm: Record<string, unknown> = {};
  for (const k of Object.keys(row)) norm[normalizeHeader(k)] = row[k];
  for (const c of candidates) {
    const v = norm[normalizeHeader(c)];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return null;
}

export function buildWorkbook(headers: string[], rows: (string | number | null)[][], textColumns?: string[]): XLSX.WorkBook {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  // Preserve CustomerID-like text columns: force text format
  if (textColumns?.length) {
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    const textSet = new Set(textColumns.map((t) => t.toLowerCase()));
    headers.forEach((h, c) => {
      if (!textSet.has(h.toLowerCase()) && h.toLowerCase() !== 'customerid') return;
      for (let r = 1; r <= range.e.r; r++) {
        const addr = XLSX.utils.encode_cell({ r, c });
        const cell = ws[addr];
        if (cell && cell.v !== null && cell.v !== undefined) {
          cell.t = 's';
          cell.v = String(cell.v);
        }
      }
    });
    ws['!cols'] = headers.map(() => ({ wch: 18 }));
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Rewards');
  return wb;
}

export function downloadWorkbook(wb: XLSX.WorkBook, filename: string): void {
  XLSX.writeFile(wb, filename);
}
