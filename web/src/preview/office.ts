import { MAX_SHEET_COLUMNS, MAX_SHEET_ROWS, srcdocFor, type SheetModel } from './render.js';

// Both libraries are loaded only when a DOCX or XLSX is previewed (D-M2-10), so they stay out of the main bundle.

/** A DOCX as one `srcdoc` document. The renderer works on a detached element: nothing is added to the page. */
export async function docxSrcdoc(file: Blob): Promise<string> {
  const { renderAsync } = await import('docx-preview');
  const holder = document.createElement('div');
  await renderAsync(file, holder, holder, { inWrapper: true, ignoreWidth: false });
  return srcdocFor(holder.innerHTML, 'body{background:#e9ecf1;padding:16px}');
}

/** The sheets of an XLSX as plain text cells, limited in rows and columns. */
export async function xlsxSheets(file: Blob): Promise<SheetModel[]> {
  const { default: ExcelJS } = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  return workbook.worksheets.map((sheet) => {
    const rowCount = sheet.rowCount;
    const columnCount = sheet.columnCount;
    const rows: string[][] = [];
    for (let r = 1; r <= Math.min(rowCount, MAX_SHEET_ROWS); r += 1) {
      const row = sheet.getRow(r);
      const cells: string[] = [];
      for (let c = 1; c <= Math.min(columnCount, MAX_SHEET_COLUMNS); c += 1) cells.push(row.getCell(c).text);
      rows.push(cells);
    }
    return { name: sheet.name, rows, rowCount, columnCount };
  });
}
