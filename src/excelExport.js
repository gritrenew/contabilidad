const ExcelJS = require('exceljs');

const MONEY_FMT = '#,##0.00;[Red]-#,##0.00';
const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A20' } };
const HEADER_FONT = { color: { argb: 'FFFFFFFF' }, bold: true };

function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = HEADER_FONT;
  });
  row.commit();
}

function monthLabel(periodKey) {
  const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const [y, m] = periodKey.split('-');
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/**
 * Builds the Reporte export workbook: a "Resumen" sheet mirroring the on-screen
 * pivot, a "Por Grupo" sheet with subtotals by the admin-managed Grupo
 * classification, and — only when the caller expanded rows on screen before
 * exporting — a "Detalle" sheet with the individual transactions behind each
 * expanded account, using native Excel row grouping (outlineLevel) so they
 * collapse/expand per account, the same way the original spreadsheet macro did.
 */
function buildReportWorkbook({ pivot, groupSummary, multiCompany, details, detailTruncated }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grenergy · Panel Financiero';
  wb.created = new Date();

  // ---- Resumen ----
  const summarySheet = wb.addWorksheet('Resumen');
  const periodCols = pivot.periods.map((p) => ({ header: monthLabel(p), key: p, width: 12 }));
  summarySheet.columns = [
    ...(multiCompany ? [{ header: 'Empresa', key: 'sociedad', width: 32 }] : []),
    { header: 'Grupo', key: 'grupo', width: 20 },
    { header: 'N° cuenta', key: 'accountNo', width: 14 },
    { header: 'Nombre cuenta', key: 'name', width: 34 },
    ...periodCols,
    { header: 'Total', key: 'total', width: 14 },
  ];
  pivot.items.forEach((item) => {
    const row = {
      sociedad: item.sociedad,
      grupo: item.grupo || 'Sin grupo',
      accountNo: item.accountNo,
      name: item.name,
      total: item.total,
    };
    pivot.periods.forEach((p) => { row[p] = item.periods[p] || 0; });
    summarySheet.addRow(row);
  });
  periodCols.concat([{ key: 'total' }]).forEach((c) => {
    summarySheet.getColumn(c.key).numFmt = MONEY_FMT;
  });
  styleHeaderRow(summarySheet.getRow(1));
  summarySheet.views = [{ state: 'frozen', ySplit: 1 }];
  summarySheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: summarySheet.columns.length } };

  // ---- Por Grupo ----
  const groupSheet = wb.addWorksheet('Por Grupo');
  groupSheet.columns = [
    { header: 'Grupo', key: 'grupo', width: 26 },
    ...periodCols,
    { header: 'Total', key: 'total', width: 14 },
  ];
  (groupSummary || []).forEach((g) => {
    const row = { grupo: g.grupo, total: g.total };
    pivot.periods.forEach((p) => { row[p] = g.periods[p] || 0; });
    groupSheet.addRow(row);
  });
  periodCols.concat([{ key: 'total' }]).forEach((c) => {
    groupSheet.getColumn(c.key).numFmt = MONEY_FMT;
  });
  styleHeaderRow(groupSheet.getRow(1));

  // ---- Detalle (solo filas que el usuario expandió antes de exportar) ----
  if (details && details.length) {
    const detailSheet = wb.addWorksheet('Detalle');
    detailSheet.properties.outlineLevelRow = 1;
    detailSheet.properties.outlineProperties = { summaryBelow: false, summaryRight: false };
    detailSheet.columns = [
      { header: 'Empresa / Cuenta', key: 'label', width: 46 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Documento', key: 'documento', width: 22 },
      { header: 'Descripción', key: 'descripcion', width: 40 },
      { header: 'Importe', key: 'importe', width: 14 },
      { header: 'Importe divisa', key: 'importeDivisa', width: 14 },
      { header: 'Usuario', key: 'usuario', width: 14 },
    ];
    styleHeaderRow(detailSheet.getRow(1));
    detailSheet.getColumn('importe').numFmt = MONEY_FMT;
    detailSheet.getColumn('importeDivisa').numFmt = MONEY_FMT;

    if (detailTruncated) {
      const note = detailSheet.addRow({ label: 'Se alcanzó el límite de filas exportables — acota los filtros para ver el resto del detalle.' });
      note.font = { italic: true, color: { argb: 'FFDC2626' } };
    }

    details.forEach(({ sociedad, accountNo, name, rows }) => {
      const headerRow = detailSheet.addRow({ label: `${sociedad} — ${accountNo} ${name || ''}`.trim() });
      headerRow.font = { bold: true };
      headerRow.outlineLevel = 0;
      if (!rows.length) {
        const emptyRow = detailSheet.addRow({ descripcion: 'Sin movimientos individuales para este cruce de filtros.' });
        emptyRow.outlineLevel = 1;
        return;
      }
      rows.forEach((r) => {
        const row = detailSheet.addRow({
          fecha: r.Fecha ? new Date(r.Fecha) : null,
          documento: [r.TipoDocumento, r.NumDocumento].filter(Boolean).join(' '),
          descripcion: r.Descripcion || '',
          importe: Number(r.Importe) || 0,
          importeDivisa: Number(r.ImporteDivisa) || 0,
          usuario: r.CodUsuario || '',
        });
        row.getCell('fecha').numFmt = 'dd/mm/yyyy';
        row.outlineLevel = 1;
      });
    });
  }

  return wb;
}

/** Builds the Saldo al Cierre export: one sheet, Sociedad as columns, cumulative balance as of the closing period. */
function buildClosingBalanceWorkbook({ pivot, periodLabel }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grenergy · Panel Financiero';
  wb.created = new Date();

  const sheet = wb.addWorksheet(`Cierre ${periodLabel}`.slice(0, 31));
  sheet.columns = [
    { header: 'N° cuenta', key: 'accountNo', width: 14 },
    { header: 'Nombre cuenta', key: 'name', width: 34 },
    ...pivot.companies.map((c, i) => ({ header: c, key: `c${i}`, width: 22 })),
    { header: 'Total', key: 'total', width: 14 },
  ];
  pivot.items.forEach((item) => {
    const row = { accountNo: item.accountNo, name: item.name, total: item.total };
    pivot.companies.forEach((c, i) => { row[`c${i}`] = item.balances[c] || 0; });
    sheet.addRow(row);
  });
  pivot.companies.forEach((c, i) => { sheet.getColumn(`c${i}`).numFmt = MONEY_FMT; });
  sheet.getColumn('total').numFmt = MONEY_FMT;
  styleHeaderRow(sheet.getRow(1));
  sheet.views = [{ state: 'frozen', ySplit: 1, xSplit: 2 }];

  return wb;
}

/** Flat transaction-list export (Movimientos): one row per movement, no aggregation. */
function buildMovementsWorkbook({ rows, truncated }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Grenergy · Panel Financiero';
  wb.created = new Date();

  const sheet = wb.addWorksheet('Movimientos');
  sheet.columns = [
    { header: 'Fecha', key: 'fecha', width: 12 },
    { header: 'Empresa', key: 'sociedad', width: 32 },
    { header: 'Grupo', key: 'grupo', width: 20 },
    { header: 'País', key: 'pais', width: 14 },
    { header: 'N° cuenta', key: 'accountNo', width: 14 },
    { header: 'Nombre cuenta', key: 'name', width: 32 },
    { header: 'Tipo documento', key: 'tipoDocumento', width: 16 },
    { header: 'N° documento', key: 'numDocumento', width: 16 },
    { header: 'Descripción', key: 'descripcion', width: 40 },
    { header: 'Proyecto/Tarea', key: 'proyecto', width: 20 },
    { header: 'Importe', key: 'importe', width: 14 },
    { header: 'Importe divisa', key: 'importeDivisa', width: 14 },
    { header: 'Usuario', key: 'usuario', width: 14 },
  ];
  styleHeaderRow(sheet.getRow(1));
  sheet.getColumn('importe').numFmt = MONEY_FMT;
  sheet.getColumn('importeDivisa').numFmt = MONEY_FMT;
  sheet.getColumn('fecha').numFmt = 'dd/mm/yyyy';
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };

  if (truncated) {
    const note = sheet.addRow({ descripcion: 'Se alcanzó el límite de filas exportables — acota los filtros (empresa, grupo, año) para ver el resto.' });
    note.font = { italic: true, color: { argb: 'FFDC2626' } };
  }

  rows.forEach((r) => {
    sheet.addRow({
      fecha: r.Fecha ? new Date(r.Fecha) : null,
      sociedad: r.Sociedad,
      grupo: r.Grupo || 'Sin grupo',
      pais: r.Pais || '',
      accountNo: r.G_L_Account_No,
      name: r.G_L_Account_Name,
      tipoDocumento: r.TipoDocumento || '',
      numDocumento: r.NumDocumento || '',
      descripcion: r.Descripcion || '',
      proyecto: r.NomProyectoTarea || '',
      importe: Number(r.Importe) || 0,
      importeDivisa: Number(r.ImporteDivisa) || 0,
      usuario: r.CodUsuario || '',
    });
  });

  return wb;
}

module.exports = { buildReportWorkbook, buildClosingBalanceWorkbook, buildMovementsWorkbook };
