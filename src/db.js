const sql = require('mssql');
const { getEffectiveSettings, isConfigured } = require('./settingsStore');

let poolPromise = null;

function buildConfig(settings) {
  return {
    server: settings.server,
    port: Number(settings.port) || 1433,
    database: settings.database,
    user: settings.user,
    password: settings.password,
    options: {
      encrypt: Boolean(settings.encrypt),
      trustServerCertificate: Boolean(settings.trustServerCertificate),
      enableArithAbort: true,
    },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
    requestTimeout: 60000,
    connectionTimeout: 15000,
  };
}

/** Lazily creates (and reuses) the connection pool built from the effective settings. */
function getPool() {
  if (!isConfigured()) {
    return Promise.reject(new Error('La conexion a la base de datos aun no esta configurada. Ve a Mantenedor.'));
  }
  if (!poolPromise) {
    const { settings } = getEffectiveSettings();
    const pool = new sql.ConnectionPool(buildConfig(settings));
    pool.on('error', (err) => {
      console.error('Error en el pool de SQL Server:', err.message);
      poolPromise = null;
    });
    poolPromise = pool.connect().catch((err) => {
      poolPromise = null;
      throw err;
    });
  }
  return poolPromise;
}

/** Forces a fresh pool on next query — call after Mantenedor settings change. */
async function resetPool() {
  if (poolPromise) {
    try {
      const pool = await poolPromise;
      await pool.close();
    } catch (err) {
      // ignore close errors, we're discarding this pool anyway
    }
  }
  poolPromise = null;
}

/** One-off connection test using arbitrary settings, independent of the live pool. */
async function testConnection(settings) {
  const testPool = new sql.ConnectionPool(buildConfig(settings));
  try {
    await testPool.connect();
    const result = await testPool.request().query(`SELECT TOP 5 * FROM ${settings.view}`);
    const rowCount = result.recordset.length;
    const columns = result.recordset.columns ? Object.keys(result.recordset.columns) : Object.keys(result.recordset[0] || {});

    let companiesOk = true;
    let companiesError = null;
    try {
      await testPool.request().query(`SELECT TOP 1 CodEmpresa, NomEmpresa FROM ${settings.companiesView}`);
    } catch (err) {
      companiesOk = false;
      companiesError = err.message;
    }

    return { ok: true, rowCount, columns, companiesOk, companiesError };
  } finally {
    await testPool.close();
  }
}

module.exports = { sql, getPool, resetPool, testConnection };
