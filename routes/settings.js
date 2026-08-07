const express = require('express');
const router = express.Router();
const settingsStore = require('../src/settingsStore');
const { testConnection, resetPool } = require('../src/db');
const companiesCache = require('../src/companiesCache');
const adminAuth = require('../src/adminAuth');

// Public: lets every page (and settings.html itself) know whether to show/hide
// the Mantenedor module, without needing admin rights just to ask.
router.get('/whoami', (req, res) => {
  res.json(adminAuth.getAuthStatus(req));
});

router.use(adminAuth.requireAdmin);

router.get('/', (req, res) => {
  res.json(settingsStore.getMaskedSettings());
});

router.post('/', async (req, res) => {
  try {
    const incoming = { ...req.body };
    // Never overwrite a real saved password with the masked placeholder the UI sent back.
    if (incoming.password === '••••••••') delete incoming.password;
    settingsStore.saveLocalSettings(incoming);
    await resetPool();
    companiesCache.resetCache();
    res.json(settingsStore.getMaskedSettings());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post('/test', async (req, res) => {
  try {
    const incoming = { ...req.body };
    const { settings: current } = settingsStore.getEffectiveSettings();
    if (incoming.password === '••••••••' || !incoming.password) incoming.password = current.password;
    const merged = { ...current, ...incoming };
    const result = await testConnection(merged);
    res.json(result);
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

module.exports = router;
