const { sql, getPool } = require('./db');
const { getEffectiveSettings } = require('./settingsStore');
const companiesCache = require('./companiesCache');

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

/** Shared WHERE-clause builder for the period/company/country/search filters every list query accepts. */
function addCommonFilterConditions(request, dim, { companies, countries, years, months, search } = {}) {
  const conditions = [`f.Año IS NOT NULL`, `f.Año <> ''`];

  const companiesCondition = addResolvedCodeClause(request, 'company', companies, (names) =>
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
    .map((r) => ({
      Sociedad: companiesCache.labelFor(r.CodEmpresa, dim),
      Pais: companiesCache.countryFor(r.CodEmpresa, dim),
      G_L_Account_No: r.G_L_Account_No,
      G_L_Account_Name: r.G_L_Account_Name,
      Anio: r.Anio,
      Mes: r.Mes,
      Saldo: r.Saldo,
      Movimientos: r.Movimientos,
    }))
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

module.exports = { getCompanies, getCountries, getYears, getMovementSummary, getMovementDetail };
