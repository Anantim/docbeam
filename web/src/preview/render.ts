// Turning DOCX and XLSX files into read-only HTML for the preview dialog. The result always goes into an iframe
// with `sandbox=""` (no scripts, no same origin), so it is safe for files other people sent too (D-M2-20).

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const MAX_SHEET_ROWS = 500;
export const MAX_SHEET_COLUMNS = 50;

export interface SheetModel {
  name: string;
  /** Row by row, already limited to MAX_SHEET_ROWS x MAX_SHEET_COLUMNS. */
  rows: string[][];
  rowCount: number;
  columnCount: number;
}

const PAGE_STYLE = 'body{margin:0;font:13px "IBM Plex Sans",system-ui,sans-serif;color:#101828;background:#fff}';

/** A whole document for `srcdoc`. `inner` must already be safe HTML from the renderer or from `sheetHtml`. */
export function srcdocFor(inner: string, extraStyle = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${PAGE_STYLE}${extraStyle}</style></head><body>${inner}</body></html>`;
}

const columnName = (index: number): string => {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
};

const SHEET_STYLE =
  'table{border-collapse:collapse;width:100%}th,td{border:1px solid #e4e7ec;padding:6px 10px;white-space:nowrap;text-align:left}' +
  'th{background:#f2f4f7;font-weight:600;color:#475467}td.n{background:#f9fafb;color:#667085;text-align:center}.note{padding:8px 10px;color:#475467}';

/** One sheet as a table with column letters and row numbers. Every cell is escaped text. */
export function sheetHtml(sheet: SheetModel): string {
  const width = Math.max(1, ...sheet.rows.map((r) => r.length));
  const head = `<tr><th></th>${Array.from({ length: width }, (_, i) => `<th>${columnName(i)}</th>`).join('')}</tr>`;
  const body = sheet.rows
    .map((row, r) => `<tr><td class="n">${r + 1}</td>${Array.from({ length: width }, (_, c) => `<td>${escapeHtml(row[c] ?? '')}</td>`).join('')}</tr>`)
    .join('');
  const cut =
    sheet.rowCount > sheet.rows.length || sheet.columnCount > width
      ? `<div class="note">Showing the first ${sheet.rows.length.toLocaleString('en-US')} rows and ${width.toLocaleString('en-US')} columns of ${sheet.rowCount.toLocaleString('en-US')} rows and ${sheet.columnCount.toLocaleString('en-US')} columns.</div>`
      : '';
  return srcdocFor(`<table><thead>${head}</thead><tbody>${body}</tbody></table>${cut}`, SHEET_STYLE);
}
