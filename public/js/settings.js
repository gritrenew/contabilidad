(async function () {
  const syncPill = document.getElementById('sync-pill');
  const resultBox = document.getElementById('result');
  const configuredBadge = document.getElementById('configured-badge');

  const FIELDS = ['server', 'port', 'database', 'user', 'password', 'view'];
  const CHECKBOXES = ['encrypt', 'trustServerCertificate'];

  function fieldEl(name) { return document.getElementById('s-' + name); }
  function badgeEl(name) { return document.getElementById('badge-' + name); }

  function applySettings(data) {
    FIELDS.forEach((name) => {
      const el = fieldEl(name);
      el.value = data[name] ?? '';
      const locked = Boolean(data.overriddenByEnv && data.overriddenByEnv[name]);
      el.disabled = locked;
      badgeEl(name).style.display = locked ? 'inline-block' : 'none';
    });
    CHECKBOXES.forEach((name) => {
      const el = fieldEl(name);
      el.checked = Boolean(data[name]);
      const locked = Boolean(data.overriddenByEnv && data.overriddenByEnv[name]);
      el.disabled = locked;
      badgeEl(name).style.display = locked ? 'inline-block' : 'none';
    });
    configuredBadge.textContent = data.configured ? 'Conexión configurada' : 'Falta configurar';
    configuredBadge.className = 'badge ' + (data.configured ? 'ok' : 'err');
    syncPill.textContent = data.configured ? 'Conectado' : 'Sin configurar';
  }

  function collectForm() {
    const payload = {};
    FIELDS.forEach((name) => {
      const el = fieldEl(name);
      if (!el.disabled) payload[name] = el.value;
    });
    CHECKBOXES.forEach((name) => {
      const el = fieldEl(name);
      if (!el.disabled) payload[name] = el.checked;
    });
    return payload;
  }

  function showResult(ok, message) {
    resultBox.style.display = 'block';
    resultBox.className = 'result-box ' + (ok ? 'ok' : 'err');
    resultBox.textContent = message;
  }

  async function load() {
    const data = await CTB.fetchJSON('/api/settings');
    applySettings(data);
  }

  document.getElementById('btn-test').addEventListener('click', async () => {
    showResult(true, 'Probando conexión…');
    try {
      const result = await CTB.fetchJSON('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectForm()),
      });
      showResult(true, `Conexión exitosa. Se leyeron ${result.rowCount} fila(s) de muestra de la vista. Columnas detectadas: ${result.columns.slice(0, 8).join(', ')}${result.columns.length > 8 ? '…' : ''}`);
    } catch (err) {
      showResult(false, 'Error de conexión: ' + err.message);
    }
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    try {
      const data = await CTB.fetchJSON('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectForm()),
      });
      applySettings(data);
      showResult(true, 'Configuración guardada.');
    } catch (err) {
      showResult(false, 'No se pudo guardar: ' + err.message);
    }
  });

  await load();
})();
