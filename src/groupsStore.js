// Admin-editable mapping of company (by display name, same identifier used
// everywhere else in this app — see companiesCache) to a business "Grupo"
// classification (e.g. "Holding", "Grupo Palmas y spv's") plus an optional free
// tag. Purely app-side metadata: the DWH view has no such column. Stored as a
// plain local JSON file (not encrypted — it holds no credentials) so it
// round-trips independently of the DB connection settings.
const fs = require('fs');
const path = require('path');

const FILE_PATH = path.join(__dirname, '..', 'data', 'company-groups.json');

let cache = null; // Map<lowercased company name, { grupo, tag }>

function normalizeKey(name) {
  return String(name || '').trim().toLowerCase();
}

function load() {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = fs.readFileSync(FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    Object.entries(parsed).forEach(([name, entry]) => {
      cache.set(normalizeKey(name), { name, grupo: entry.grupo || '', tag: entry.tag || '' });
    });
  } catch (err) {
    // No file yet, or unreadable — start empty; saveAll() will create it.
  }
  return cache;
}

function persist() {
  const obj = {};
  load().forEach((entry) => {
    obj[entry.name] = { grupo: entry.grupo, tag: entry.tag };
  });
  fs.mkdirSync(path.dirname(FILE_PATH), { recursive: true });
  fs.writeFileSync(FILE_PATH, JSON.stringify(obj, null, 2), 'utf8');
}

/** { name -> { grupo, tag } }, keyed by the exact company display name. */
function getEntry(name) {
  return load().get(normalizeKey(name)) || { name, grupo: '', tag: '' };
}

/** All distinct, non-empty Grupo values currently assigned to any company. */
function getDistinctGroups() {
  const set = new Set();
  load().forEach((entry) => { if (entry.grupo) set.add(entry.grupo); });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
}

/** Company names (exact display name) currently assigned to any of `grupos`. */
function companiesInGroups(grupos) {
  if (!grupos || !grupos.length) return [];
  const wanted = new Set(grupos);
  const names = [];
  load().forEach((entry) => { if (wanted.has(entry.grupo)) names.push(entry.name); });
  return names;
}

/**
 * Replaces the whole mapping in one shot — the Mantenedor UI sends the full
 * edited table back on save, since editing ~250 rows one at a time would mean
 * 250 round trips for no benefit (this file is small and local, not a DB).
 * rows: [{ name, grupo, tag }]
 */
function saveAll(rows) {
  const next = new Map();
  (rows || []).forEach((r) => {
    const name = String(r.name || '').trim();
    if (!name) return;
    next.set(normalizeKey(name), { name, grupo: String(r.grupo || '').trim(), tag: String(r.tag || '').trim() });
  });
  cache = next;
  persist();
}

module.exports = { getEntry, getDistinctGroups, companiesInGroups, saveAll, load };
