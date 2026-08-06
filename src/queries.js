const { sql, getPool } = require('./db');
const { getEffectiveSettings } = require('./settingsStore');

const VIEW_NAME_PATTERN = /^[A-Za-z0-9_.\[\]]+$/;

function getViewName() {
  const { settings } = getEffectiveSettings();
  if (!VIEW_NAME_PATTERN.test(settings.view || '')) {
    throw new Error('Nombre de vista invalido en Mantenedor.');
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

async function getCompanies() {
  const pool = await getPool();
  const result = await pool.request().query(
    `SELECT DISTINCT Sociedad FROM ${getViewName()} WHERE Sociedad IS NOT NULL ORDER BY Sociedad`
  );
  return result.recordset.map((r) => r.Sociedad);
}

async function getYears() {
  const pool = await getPool();
  const result = await pool.request().query(
    `SELECT DISTINCT YEAR(Posting_Date) AS Anio FROM ${getViewName()} WHERE Posting_Date IS NOT NULL ORDER BY Anio`
  );
  return result.recordset.map((r) => r.Anio);
}

/**
 * Core aggregation: one row per Sociedad + Cuenta + Anio + Mes with the summed
 * "Importe divisa-adicional" (Additional_Currency_Amount) — this is the number
 * both the pivot report and the dashboard build on top of.
 */
async function getMovementSummary({ companies, years, months, search } = {}) {
  const pool = await getPool();
  const request = pool.request();

  const conditions = ['Posting_Date IS NOT NULL'];

  const companiesClause = addInClause(request, 'company', companies, sql.NVarChar(200));
  if (companiesClause) conditions.push(`Sociedad IN ${companiesClause}`);

  const yearsClause = addInClause(request, 'year', years, sql.Int);
  if (yearsClause) conditions.push(`YEAR(Posting_Date) IN ${yearsClause}`);

  const monthsClause = addInClause(request, 'month', months, sql.Int);
  if (monthsClause) conditions.push(`MONTH(Posting_Date) IN ${monthsClause}`);

  if (search) {
    request.input('search', sql.NVarChar(200), `%${search}%`);
    conditions.push('(G_L_Account_No LIKE @search OR G_L_Account_Name LIKE @search)');
  }

  const query = `
    SELECT
      Sociedad,
      G_L_Account_No,
      G_L_Account_Name,
      YEAR(Posting_Date) AS Anio,
      MONTH(Posting_Date) AS Mes,
      SUM(Additional_Currency_Amount) AS Saldo,
      COUNT(*) AS Movimientos
    FROM ${getViewName()}
    WHERE ${conditions.join(' AND ')}
    GROUP BY Sociedad, G_L_Account_No, G_L_Account_Name, YEAR(Posting_Date), MONTH(Posting_Date)
    ORDER BY Sociedad, G_L_Account_No, Anio, Mes
  `;

  const result = await request.query(query);
  return result.recordset;
}

module.exports = { getCompanies, getYears, getMovementSummary };
