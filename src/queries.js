const { sql, getPool } = require('./db');
const { getEffectiveSettings } = require('./settingsStore');
const companiesCache = require('./companiesCache');
const groupsStore = require('./groupsStore');

const VIEW_NAME_PATTERN = /^[A-Za-z0-9_.\[\]]+$/;

function getMovementsView() {
  const { settings } = getEffectiveSettings();
  if (!VIEW_NAME_PATTERN.test(settings.view || '')) {
    throw new Error('Nombre de vista de movimientos invalido en Mantenedor.');
  }
  return settings.view;
}

/** Adds a parameterized IN(...) clause to `request`; returns the SQL fragment or null when values is empty. */
function addInClause(request, prefix, values, sqlType) {
  if (!values || values.length === 0) return null;
  const names = values.map((v, i) => {
    const paramName = `${prefix}${i}`;
    request.input(paramName, sqlType, v);
    return `@${paramName}`;
  });
  return `(${names.join(', ')})`;
}

/**
 * Builds a `column IN (...)` condition from user-facing filter values (company
 * names, country names) that first need resolving to CodEmpresa GUIDs via the
 * cached dimension. If the caller asked for a filter and it resolves to zero
 * codes (e.g. stale selection), we return an always-false condition instead of
 * silently dropping the filter — better an empty result than the wrong data.
 */
function addResolvedCodeClause(request, prefix, requestedValues, resolveToCodes) {
  if (!requestedValues || requestedValues.length === 0) return null;
  const codes = resolveToCodes(requestedValues);
  if (codes.length === 0) return '1 = 0';
  const clause = addInClause(request, prefix, codes, sql.NVarChar(80));
  return `f.CodEmpresa IN ${clause}`;
}

async function getCompanies() {
  const movements = getMovementsView();
  const dim = await companiesCache.loadCompanies();
  const pool = await getPool();
  const result = await pool.request().query(`SELECT DISTINCT CodEmpresa FROM ${movements}`);
  const names = new Set(result.recordset.map((r) => companiesCache.labelFor(r.CodEmpresa, dim)));
  return Array.from(names).sort();
}

async function getCountries() {
  const movements = getMovementsView();
  const dim = await companiesCache.loadCompanies();
  const pool = await getPool();
  const result = await pool.request().query(`SELECT DISTINCT CodEmpresa FROM ${movements}`);
  const countries = new Set();
  result.recordset.forEach((r) => {
    const pais = companiesCache.countryFor(r.CodEmpresa, dim);
    if (pais) countries.add(pais);
  });
  return Array.from(countries).sort();
}

async function getYears() {
  const movements = getMovementsView();
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT CAST(Año AS INT) AS Anio
    FROM ${movements}
    WHERE Año IS NOT NULL AND Año <> ''
    ORDER BY Anio
  `);
  return result.recordset.map((r) => r.Anio);
}

/**
 * Shared WHERE-clause builder for the period/company/country/search filters
 * every list query accepts. Two ways to scope by period, usable independently
 * or together:
 *  - years/months: discrete IN-lists (Reporte/Vista Anual — pick specific,
 *    possibly non-contiguous years and months).
 *  - periodFrom/periodTo: a true continuous range as a YYYYMM integer (e.g.
 *    202512 for Dec 2025). This is NOT the same as years IN (...) AND months
 *    IN (...): that combination would also match e.g. Jan 2025 when the range
 *    is Dec 2025 - Jun 2026, because the year and month lists are independent
 *    of each other. The Dashboard's date-range picker needs the real range.
 */
function addCommonFilterConditions(request, dim, { companies, countries, years, months, periodFrom, periodTo, search, grupos } = {}) {
  const conditions = [`f.Año IS NOT NULL`, `f.Año <> ''`];

  // "Grupo" is app-side metadata (see groupsStore) with no column in the DWH
  // view, so a Grupo filter is resolved to the company names in it first, then
  // intersected with any explicit Empresa selection. If Grupo was requested and
  // that intersection is empty, force zero rows instead of silently ignoring
  // the filter (same "stale selection" reasoning as addResolvedCodeClause).
  let effectiveCompanies = companies;
  if (grupos && grupos.length) {
    const groupCompanySet = new Set(groupsStore.companiesInGroups(grupos));
    effectiveCompanies = (companies && companies.length)
      ? companies.filter((c) => groupCompanySet.has(c))
      : Array.from(groupCompanySet);
    if (!effectiveCompanies.length) conditions.push('1 = 0');
  }

  const companiesCondition = addResolvedCodeClause(request, 'company', effectiveCompanies, (names) =>
    companiesCache.resolveCompanyCodes(names, dim)
  );
  if (companiesCondition) conditions.push(companiesCondition);

  const countriesCondition = addResolvedCodeClause(request, 'country', countries, (names) =>
    companiesCache.resolveCountryCodes(names, dim)
  );
  if (countriesCondition) conditions.push(countriesCondition);

  const yearsClause = addInClause(request, 'year', years, sql.Int);
  if (yearsClause) conditions.push(`CAST(f.Año AS INT) IN ${yearsClause}`);

  const monthsClause = addInClause(request, 'month', months, sql.Int);
  if (monthsClause) conditions.push(`CAST(f.Mes AS INT) IN ${monthsClause}`);

  if (periodFrom || periodTo) {
    const periodExpr = `(CAST(f.Año AS INT) * 100 + CAST(f.Mes AS INT))`;
    if (periodFrom) {
      request.input('periodFrom', sql.Int, periodFrom);
      conditions.push(`${periodExpr} >= @periodFrom`);
    }
    if (periodTo) {
      request.input('periodTo', sql.Int, periodTo);
      conditions.push(`${periodExpr} <= @periodTo`);
    }
  }

  if (search) {
    request.input('search', sql.NVarChar(200), `%${search}%`);
    conditions.push('(f.CodCuenta LIKE @search OR f.Nomcuenta LIKE @search)');
  }

  return conditions;
}

/**
 * Core aggregation: one row per Sociedad + Cuenta + Anio + Mes with the summed
 * "Importe divisa-adicional" (addCurrAmount) — this is the number both the
 * pivot report and the dashboard build on top of. Deliberately does NOT join
 * the companies view in SQL (see companiesCache.js for why) — CodEmpresa is
 * translated to Sociedad/Pais in JS afterwards. Output shape is kept as
 * {Sociedad, Pais, G_L_Account_No, G_L_Account_Name, Anio, Mes, Saldo,
 * Movimientos} on purpose, so analytics.js and the frontend don't need to
 * know about the real column names underneath.
 */
async function getMovementSummary(filters = {}) {
  const movements = getMovementsView();
  const dim = await companiesCache.loadCompanies();
  const pool = await getPool();
  const request = pool.request();

  const conditions = addCommonFilterConditions(request, dim, filters);

  const query = `
    SELECT
      f.CodEmpresa,
      f.CodCuenta AS G_L_Account_No,
      f.Nomcuenta AS G_L_Account_Name,
      CAST(f.Año AS INT) AS Anio,
      CAST(f.Mes AS INT) AS Mes,
      SUM(f.addCurrAmount) AS Saldo,
      COUNT(*) AS Movimientos
    FROM ${movements} f
    WHERE ${conditions.join(' AND ')}
    GROUP BY f.CodEmpresa, f.CodCuenta, f.Nomcuenta, CAST(f.Año AS INT), CAST(f.Mes AS INT)
  `;

  const result = await request.query(query);
  return result.recordset
    .map((r) => {
      const sociedad = companiesCache.labelFor(r.CodEmpresa, dim);
      const groupEntry = groupsStore.getEntry(sociedad);
      return {
        Sociedad: sociedad,
        Pais: companiesCache.countryFor(r.CodEmpresa, dim),
        Grupo: groupEntry.grupo || null,
        Tag: groupEntry.tag || null,
        G_L_Account_No: r.G_L_Account_No,
        G_L_Account_Name: r.G_L_Account_Name,
        Anio: r.Anio,
        Mes: r.Mes,
        Saldo: r.Saldo,
        Movimientos: r.Movimientos,
      };
    })
    .sort((a, b) => a.Sociedad.localeCompare(b.Sociedad) || a.G_L_Account_No.localeCompare(b.G_L_Account_No) || a.Anio - b.Anio || a.Mes - b.Mes);
}

const DETAIL_ROW_LIMIT = 500;

/**
 * Transaction-level detail behind one pivot row (one Sociedad + Cuenta), scoped
 * by the same filters applied to the summary so the numbers tie out to what
 * was summed. Capped at DETAIL_ROW_LIMIT rows (most recent first) — `total`
 * tells the caller whether it got truncated, so nothing is silently hidden.
 */
async function getMovementDetail({ company, accountNo, years, months } = {}) {
  const movements = getMovementsView();
  const dim = await companiesCache.loadCompanies();
  const pool = await getPool();

  const unknownMatch = String(company || '').match(companiesCache.UNKNOWN_LABEL_PATTERN);
  const companyCodes = unknownMatch ? [unknownMatch[1]] : dim.byName.get(company) || [];
  if (!companyCodes.length) return { total: 0, rows: [] };

  function whereFor(request) {
    const conditions = [`f.Año IS NOT NULL`, `f.Año <> ''`, `f.CodCuenta = @account`];
    request.input('account', sql.NVarChar(60), accountNo);
    const codesClause = addInClause(request, 'code', companyCodes, sql.NVarChar(80));
    conditions.push(`f.CodEmpresa IN ${codesClause}`);

    const yearsClause = addInClause(request, 'year', years, sql.Int);
    if (yearsClause) conditions.push(`CAST(f.Año AS INT) IN ${yearsClause}`);
    const monthsClause = addInClause(request, 'month', months, sql.Int);
    if (monthsClause) conditions.push(`CAST(f.Mes AS INT) IN ${monthsClause}`);
    return conditions.join(' AND ');
  }

  const countRequest = pool.request();
  const countResult = await countRequest.query(`
    SELECT COUNT(*) AS total FROM ${movements} f WHERE ${whereFor(countRequest)}
  `);

  const rowsRequest = pool.request();
  const rowsResult = await rowsRequest.query(`
    SELECT TOP ${DETAIL_ROW_LIMIT}
      f.Fecha,
      f.TipoDocumento,
      f.NumDocumento,
      f.Descripcion,
      f.Importe,
      f.addCurrAmount AS ImporteDivisa,
      f.CodUsuario,
      f.NomProyectoTarea
    FROM ${movements} f
    WHERE ${whereFor(rowsRequest)}
    ORDER BY f.Fecha DESC, f.NumEntrada DESC
  `);

  return { total: countResult.recordset[0].total, rows: rowsResult.recordset };
}

/**
 * Cumulative balance per Sociedad + Cuenta from the start of available data
 * through `periodTo` (inclusive) — a trial-balance-style snapshot "as of"
 * a closing month, not a single month's movement. Deliberately reuses
 * addCommonFilterConditions but never passes years/months/periodFrom, so only
 * the periodTo upper bound narrows the WHERE clause (see that function's
 * comment on why a continuous range isn't the same as years/months IN-lists).
 * Note: this is only as complete as the DWH view itself — if the view's
 * earliest data is Dec 2025, "acumulado" starts there, not from account
 * inception in the ERP.
 */
async function getCumulativeBalance(filters = {}) {
  const movements = getMovementsView();
  const dim = await companiesCache.loadCompanies();
  const pool = await getPool();
  const request = pool.request();

  const { companies, countries, grupos, search, periodTo } = filters;
  const conditions = addCommonFilterConditions(request, dim, { companies, countries, grupos, search, periodTo });

  const query = `
    SELECT
      f.CodEmpresa,
      f.CodCuenta AS G_L_Account_No,
      f.Nomcuenta AS G_L_Account_Name,
      SUM(f.addCurrAmount) AS Saldo
    FROM ${movements} f
    WHERE ${conditions.join(' AND ')}
    GROUP BY f.CodEmpresa, f.CodCuenta, f.Nomcuenta
  `;

  const result = await request.query(query);
  return result.recordset.map((r) => ({
    Sociedad: companiesCache.labelFor(r.CodEmpresa, dim),
    Pais: companiesCache.countryFor(r.CodEmpresa, dim),
    G_L_Account_No: r.G_L_Account_No,
    G_L_Account_Name: r.G_L_Account_Name,
    Saldo: r.Saldo,
  }));
}

const EXPORT_DETAIL_ROW_LIMIT = 20000;

/**
 * Bulk transaction detail for Excel export — only for the (company, account)
 * pairs the user actually expanded on screen before exporting (deliberate
 * scope choice: exporting detail for every filtered row, expanded or not,
 * could mean tens of thousands of accounts across months of movements in one
 * file). Groups requested pairs by company so each company needs exactly one
 * query no matter how many of its accounts were expanded, instead of one
 * query per pair.
 */
async function getMovementDetailBulk(pairs, { years, months } = {}) {
  const movements = getMovementsView();
  const dim = await companiesCache.loadCompanies();
  const pool = await getPool();

  const byCompany = new Map();
  for (const { company, accountNo } of pairs || []) {
    if (!byCompany.has(company)) byCompany.set(company, new Set());
    byCompany.get(company).add(accountNo);
  }

  const rows = [];
  let truncated = false;
  for (const [company, accountSet] of byCompany.entries()) {
    if (rows.length >= EXPORT_DETAIL_ROW_LIMIT) { truncated = true; break; }

    const unknownMatch = String(company).match(companiesCache.UNKNOWN_LABEL_PATTERN);
    const companyCodes = unknownMatch ? [unknownMatch[1]] : dim.byName.get(company) || [];
    if (!companyCodes.length) continue;

    const request = pool.request();
    const conditions = [`f.Año IS NOT NULL`, `f.Año <> ''`];
    const codesClause = addInClause(request, 'code', companyCodes, sql.NVarChar(80));
    conditions.push(`f.CodEmpresa IN ${codesClause}`);
    const accountsClause = addInClause(request, 'acct', Array.from(accountSet), sql.NVarChar(60));
    conditions.push(`f.CodCuenta IN ${accountsClause}`);
    const yearsClause = addInClause(request, 'year', years, sql.Int);
    if (yearsClause) conditions.push(`CAST(f.Año AS INT) IN ${yearsClause}`);
    const monthsClause = addInClause(request, 'month', months, sql.Int);
    if (monthsClause) conditions.push(`CAST(f.Mes AS INT) IN ${monthsClause}`);

    const remaining = EXPORT_DETAIL_ROW_LIMIT - rows.length;
    const result = await request.query(`
      SELECT TOP ${remaining}
        f.CodCuenta AS G_L_Account_No,
        f.Fecha, f.TipoDocumento, f.NumDocumento, f.Descripcion,
        f.Importe, f.addCurrAmount AS ImporteDivisa, f.CodUsuario
      FROM ${movements} f
      WHERE ${conditions.join(' AND ')}
      ORDER BY f.CodCuenta, f.Fecha, f.NumEntrada
    `);
    result.recordset.forEach((r) => rows.push({ ...r, Sociedad: company }));
    if (result.recordset.length >= remaining) truncated = true;
  }

  return { rows, truncated };
}

module.exports = {
  getCompanies, getCountries, getYears, getMovementSummary, getMovementDetail,
  getCumulativeBalance, getMovementDetailBulk,
};
