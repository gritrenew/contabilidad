const { getPool } = require('./db');
const { getEffectiveSettings } = require('./settingsStore');

const VIEW_NAME_PATTERN = /^[A-Za-z0-9_.\[\]]+$/;
const TTL_MS = 10 * 60 * 1000;

let cache = null; // { byCode: Map<code,{nombre,pais}>, byName: Map<name,code[]>, loadedAt }

/**
 * The companies dimension (dwh.FIN_VW_PBI_TD_Empresas) is tiny (~300 rows) and
 * changes rarely, but joining it in SQL against the 500k-row movements view
 * costs ~2.5s extra per query on this Synapse pool (measured: 1.4s grouped
 * without the join vs 3.8s with it — almost certainly a data-movement/shuffle
 * cost for the join in the distributed engine). Caching it here and doing the
 * CodEmpresa -> Nombre/Pais lookup in JS avoids that cost on every request.
 */
async function loadCompanies(force = false) {
  if (cache && !force && Date.now() - cache.loadedAt < TTL_MS) return cache;

  const { settings } = getEffectiveSettings();
  if (!VIEW_NAME_PATTERN.test(settings.companiesView || '')) {
    throw new Error('Nombre de vista de empresas invalido en Mantenedor.');
  }
  const pool = await getPool();
  const result = await pool.request().query(`SELECT CodEmpresa, NomEmpresa, NomPais FROM ${settings.companiesView}`);

  const byCode = new Map();
  const byName = new Map();
  for (const row of result.recordset) {
    byCode.set(row.CodEmpresa, { nombre: row.NomEmpresa, pais: row.NomPais });
    if (row.NomEmpresa) {
      if (!byName.has(row.NomEmpresa)) byName.set(row.NomEmpresa, []);
      byName.get(row.NomEmpresa).push(row.CodEmpresa);
    }
  }
  cache = { byCode, byName, loadedAt: Date.now() };
  return cache;
}

function resetCache() {
  cache = null;
}

const UNKNOWN_LABEL_PATTERN = /^Empresa sin nombre \((.+)\)$/;

function labelFor(codEmpresa, dim) {
  const info = dim.byCode.get(codEmpresa);
  return info && info.nombre ? info.nombre : `Empresa sin nombre (${codEmpresa})`;
}

function countryFor(codEmpresa, dim) {
  const info = dim.byCode.get(codEmpresa);
  return info ? info.pais || null : null;
}

/** Translates the friendly company names the UI filters by back into CodEmpresa GUIDs. */
function resolveCompanyCodes(names, dim) {
  const codes = [];
  for (const name of names) {
    const unknownMatch = name.match(UNKNOWN_LABEL_PATTERN);
    if (unknownMatch) {
      codes.push(unknownMatch[1]);
      continue;
    }
    const found = dim.byName.get(name);
    if (found) codes.push(...found);
  }
  return codes;
}

function resolveCountryCodes(countries, dim) {
  const wanted = new Set(countries);
  const codes = [];
  for (const [code, info] of dim.byCode.entries()) {
    if (info.pais && wanted.has(info.pais)) codes.push(code);
  }
  return codes;
}

module.exports = { loadCompanies, resetCache, labelFor, countryFor, resolveCompanyCodes, resolveCountryCodes, UNKNOWN_LABEL_PATTERN };
