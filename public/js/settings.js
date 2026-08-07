(async function () {
  const syncPill = document.getElementById('sync-pill');
  const resultBox = document.getElementById('result');
  const configuredBadge = document.getElementById('configured-badge');
  const notAdmin = document.getElementById('not-admin');
  const notAdminMessage = document.getElementById('not-admin-message');
  const appContent = document.getElementById('app-content');
  const btnLogin = document.getElementById('btn-login');
  const btnLogout = document.getElementById('btn-logout');

  const FIELDS = ['server', 'port', 'database', 'user', 'password', 'view', 'companiesView'];
  const CHECKBOXES = ['encrypt', 'trustServerCertificate'];
  const REQUIRED = ['server', 'database', 'user', 'view', 'companiesView'];
  const LABELS = {
    server: 'Servidor', database: 'Base de datos', user: 'Usuario',
    view: 'Vista de movimientos', companiesView: 'Vista de empresas',
  };

  function fieldEl(name) { return document.getElementById('s-' + name); }
  function badgeEl(name) { return document.getElementById('badge-' + name); }

  /** Fields the user must fill in themselves — skips any field locked by an Azure env var. */
  function findMissingRequired() {
    return REQUIRED.filter((name) => {
      const el = fieldEl(name);
      return !el.disabled && !el.value.trim();
    });
  }

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
    const missing = findMissingRequired();
    if (missing.length) {
      showResult(false, 'Completa estos campos antes de probar: ' + missing.map((n) => LABELS[n]).join(', '));
      return;
    }
    showResult(true, 'Probando conexión…');
    try {
      const result = await CTB.fetchJSON('/api/settings/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(collectForm()),
      });
      const base = `Conexión exitosa. Se leyeron ${result.rowCount} fila(s) de muestra de la vista de movimientos (${result.columns.length} columnas).`;
      const companiesMsg = result.companiesOk
        ? ' Vista de empresas OK.'
        : ` Ojo: la vista de empresas dio error → ${result.companiesError}`;
      showResult(result.companiesOk, base + companiesMsg);
    } catch (err) {
      showResult(false, 'Error de conexión: ' + err.message);
    }
  });

  document.getElementById('btn-save').addEventListener('click', async () => {
    const missing = findMissingRequired();
    if (missing.length) {
      showResult(false, 'Completa estos campos antes de guardar: ' + missing.map((n) => LABELS[n]).join(', '));
      return;
    }
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

  const status = await CTB.fetchJSON('/api/settings/whoami');
  if (!status.isAdmin) {
    appContent.style.display = 'none';
    notAdmin.style.display = 'block';
    if (status.email) {
      notAdminMessage.textContent = `Conectado como ${status.email}, que no está autorizado para administrar la conexión. Contacta a TI si necesitas acceso.`;
      btnLogout.style.display = 'inline-block';
    } else {
      notAdminMessage.textContent = 'Este módulo solo está disponible para administradores. Inicia sesión con tu cuenta Microsoft para continuar.';
      btnLogin.href = '/.auth/login/aad?post_login_redirect_uri=/settings.html';
      btnLogin.style.display = 'inline-block';
    }
    syncPill.textContent = 'Acceso restringido';
    return;
  }
  appContent.style.display = 'block';
  await load();
})();
