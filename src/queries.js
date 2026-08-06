const { sql, getPool } = require('./db');
const { getEffectiveSettings } = require('./settingsStore');

const VIEW_NAME_PATTERN = /^[A-Za-z0-9_.\[\]]+$/;

function getViewNames() {
  const { settings } = getEffectiveSettings();
  if (!VIEW_NAME_PATTERN.test(settings.view || '')) {
    throw new Error('Nombre de vista de movimientos invalido en Mantenedor.');
  }
  if (!VIEW_NAME_PATTERN.test(settings.companiesView || '')) {
    throw new Error('Nombre de vista de empresas invalido en Mantenedor.');
  }
  return { movements: settings.view, companies: settings.companiesView };
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

// CodEmpresa is a Business Central company GUID with no readable name of its own —
// dwh.FIN_VW_PBI_TD_Empresas is the dimension table that maps it to NomEmpresa/NomPais.
// A handful of very recently created companies (~0.1% of rows) aren't in that table
// yet, so every join below is a LEFT JOIN with a visible fallback label instead of
// silently dropping their rows from totals.
function unknownCompanyExpr(factAlias) {
  return `CONCAT('Empresa sin nombre (', ${factAlias}.CodEmpresa, ')')`;
}

async function getCompanies() {
  const { movements, companies } = getViewNames();
  const pool = await getPool();
  const named = await pool.request().query(`
    SELECT DISTINCT e.NomEmpresa AS Nombre
    FROM ${companies} e
    WHERE e.NomEmpresa IS NOT NULL
      AND EXISTS (SELECT 1 FROM ${movements} f WHERE f.CodEmpresa = e.CodEmpresa)
  `);
  const unnamed = await pool.request().query(`
    SELECT DISTINCT ${unknownCompanyExpr('f')} AS Nombre
    FROM ${movements} f
    WHERE NOT EXISTS (SELECT 1 FROM ${companies} e WHERE e.CodEmpresa = f.CodEmpresa)
  `);
  return [...named.recordset, ...unnamed.recordset].map((r) => r.Nombre).sort();
}

async function getCountries() {
  const { movements, companies } = getViewNames();
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT DISTINCT e.NomPais AS Pais
    FROM ${companies} e
    WHERE e.NomPais IS NOT NULL
      AND EXISTS (SELECT 1 FROM ${movements} f WHERE f.CodEmpresa = e.CodEmpresa)
    ORDER BY e.NomPais
  `);
  return result.recordset.map((r) => r.Pais);
}

async function getYears() {
  const { movements } = getViewNames();
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
 * Core aggregation: one row per Sociedad + Cuenta + Anio + Mes with the summed
 * "Importe divisa-adicional" (addCurrAmount) — this is the number both the
 * pivot report and the dashboard build on top of. Output shape is kept as
 * {Sociedad, G_L_Account_No, G_L_Account_Name, Anio, Mes, Saldo, Movimientos}
 * on purpose, so analytics.js and the frontend don't need to know about the
 * real column names underneath.
 */
async function getMovementSummary({ companies, countries, years, months, search } = {}) {
  const { movements, companies: companiesView } = getViewNames();
  const pool = await getPool();
  const request = pool.request();

  const sociedadExpr = `COALESCE(e.NomEmpresa, ${unknownCompanyExpr('f')})`;
  const conditions = [`f.Año IS NOT NULL`, `f.Año <> ''`];

  const companiesClause = addInClause(request, 'company', companies, sql.NVarChar(300));
  if (companiesClause) conditions.push(`${sociedadExpr} IN ${companiesClause}`);

  const countriesClause = addInClause(request, 'country', countries, sql.NVarChar(200));
  if (countriesClause) conditions.push(`e.NomPais IN ${countriesClause}`);

  const yearsClause = addInClause(request, 'year', years, sql.Int);
  if (yearsClause) conditions.push(`CAST(f.Año AS INT) IN ${yearsClause}`);

  const monthsClause = addInClause(request, 'month', months, sql.Int);
  if (monthsClause) conditions.push(`CAST(f.Mes AS INT) IN ${monthsClause}`);

  if (search) {
    request.input('search', sql.NVarChar(200), `%${search}%`);
    conditions.push('(f.CodCuenta LIKE @search OR f.Nomcuenta LIKE @search)');
  }

  const query = `
    SELECT
      ${sociedadExpr} AS Sociedad,
      e.NomPais AS Pais,
      f.CodCuenta AS G_L_Account_No,
      f.Nomcuenta AS G_L_Account_Name,
      CAST(f.Año AS INT) AS Anio,
      CAST(f.Mes AS INT) AS Mes,
      SUM(f.addCurrAmount) AS Saldo,
      COUNT(*) AS Movimientos
    FROM ${movements} f
    LEFT JOIN ${companiesView} e ON e.CodEmpresa = f.CodEmpresa
    WHERE ${conditions.join(' AND ')}
    GROUP BY ${sociedadExpr}, e.NomPais, f.CodCuenta, f.Nomcuenta, CAST(f.Año AS INT), CAST(f.Mes AS INT)
    ORDER BY Sociedad, G_L_Account_No, Anio, Mes
  `;

  const result = await request.query(query);
  return result.recordset;
}

module.exports = { getCompanies, getCountries, getYears, getMovementSummary };
