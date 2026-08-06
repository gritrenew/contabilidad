const express = require('express');
const router = express.Router();
const settingsStore = require('../src/settingsStore');
const { testConnection, resetPool } = require('../src/db');

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
