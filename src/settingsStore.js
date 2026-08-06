const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./security');

const CONFIG_FILE = path.join(__dirname, '..', 'data', 'db-settings.enc.json');

// Field definition: key -> { envVar, type, default }
// The env var is the Azure App Service "Application Settings" name. When present,
// it always wins over whatever is saved in the local Mantenedor screen — that is
// the hybrid model: edit locally for day-to-day use, pin it in Azure for prod.
const FIELDS = {
  server: { envVar: 'DB_SERVER', type: 'string', default: '' },
  port: { envVar: 'DB_PORT', type: 'number', default: 1433 },
  database: { envVar: 'DB_DATABASE', type: 'string', default: '' },
  user: { envVar: 'DB_USER', type: 'string', default: '' },
  password: { envVar: 'DB_PASSWORD', type: 'string', default: '' },
  view: { envVar: 'DB_VIEW', type: 'string', default: 'dwh.FIN_VW_PBI_TH_MovimientosContabilidad' },
  encrypt: { envVar: 'DB_ENCRYPT', type: 'boolean', default: true },
  trustServerCertificate: { envVar: 'DB_TRUST_CERT', type: 'boolean', default: false },
};

function coerce(type, raw) {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (type === 'number') return Number(raw);
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    return String(raw).toLowerCase() === 'true' || raw === '1';
  }
  return String(raw);
}

function readLocalFile() {
  if (!fs.existsSync(CONFIG_FILE)) return {};
  try {
    const payload = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    return decrypt(payload);
  } catch (err) {
    console.error('No se pudo leer la configuracion guardada localmente:', err.message);
    return {};
  }
}

function writeLocalFile(values) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(encrypt(values)), { mode: 0o600 });
}

/**
 * Returns the effective settings used to connect: local (Mantenedor) values,
 * overridden field-by-field by an Azure App Setting / env var when one exists.
 * Also returns which fields are currently locked by the environment, so the
 * UI can show a badge instead of letting someone edit a value Azure controls.
 */
function getEffectiveSettings() {
  const local = readLocalFile();
  const effective = {};
  const overriddenByEnv = {};

  for (const [key, def] of Object.entries(FIELDS)) {
    const envRaw = process.env[def.envVar];
    const envVal = coerce(def.type, envRaw);
    if (envVal !== undefined) {
      effective[key] = envVal;
      overriddenByEnv[key] = true;
    } else {
      const localVal = coerce(def.type, local[key]);
      effective[key] = localVal !== undefined ? localVal : def.default;
      overriddenByEnv[key] = false;
    }
  }
  return { settings: effective, overriddenByEnv };
}

function isConfigured() {
  const { settings } = getEffectiveSettings();
  return Boolean(settings.server && settings.database && settings.user && settings.password && settings.view);
}

/** Saves only the fields that are NOT currently locked by an env var. */
function saveLocalSettings(incoming) {
  const { overriddenByEnv } = getEffectiveSettings();
  const current = readLocalFile();
  const next = { ...current };
  for (const key of Object.keys(FIELDS)) {
    if (overriddenByEnv[key]) continue; // Azure owns this field, ignore edits
    if (incoming[key] !== undefined) next[key] = incoming[key];
  }
  writeLocalFile(next);
  return getEffectiveSettings();
}

function getMaskedSettings() {
  const { settings, overriddenByEnv } = getEffectiveSettings();
  return {
    ...settings,
    password: settings.password ? '••••••••' : '',
    overriddenByEnv,
    configured: isConfigured(),
  };
}

module.exports = { getEffectiveSettings, saveLocalSettings, getMaskedSettings, isConfigured, FIELDS };
