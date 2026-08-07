// Restricts the Mantenedor module (DB connection settings) to a handful of
// admin accounts, using Azure App Service Authentication ("Easy Auth") with the
// Microsoft identity provider — see docs/azure-easy-auth.md for the one-time
// Azure Portal setup this depends on.
const DEFAULT_ADMIN_EMAILS = ['adminit@grenergy.eu', 'galvarezc@grenergy.eu', 'itglobal@grenergy.eu'];

function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS;
  const list = raw ? raw.split(',') : DEFAULT_ADMIN_EMAILS;
  return list.map((e) => e.trim().toLowerCase()).filter(Boolean);
}

// Easy Auth verifies the Microsoft login and then injects this header on its way
// into the app; it strips any client-supplied header with the same name first, so
// a caller cannot forge it.
function getPrincipalEmail(req) {
  const header = req.headers['x-ms-client-principal-name'];
  return header ? String(header).toLowerCase() : null;
}

// Easy Auth's reverse proxy only exists once deployed to Azure App Service —
// locally there's no login flow, so local dev keeps working exactly as before.
function isRunningOnAzure() {
  return Boolean(process.env.WEBSITE_INSTANCE_ID);
}

function getAuthStatus(req) {
  if (!isRunningOnAzure()) return { isAdmin: true, email: null, authRequired: false };
  const email = getPrincipalEmail(req);
  if (!email) return { isAdmin: false, email: null, authRequired: true };
  return { isAdmin: getAdminEmails().includes(email), email, authRequired: true };
}

function requireAdmin(req, res, next) {
  const status = getAuthStatus(req);
  if (!status.authRequired) return next();
  if (!status.email) {
    return res.status(401).json({
      error: 'No autenticado. Inicia sesión con tu cuenta Microsoft.',
      loginUrl: '/.auth/login/aad?post_login_redirect_uri=/settings.html',
    });
  }
  if (!status.isAdmin) {
    return res.status(403).json({ error: `Acceso restringido a administradores (conectado como ${status.email}).` });
  }
  next();
}

module.exports = { getAdminEmails, getAuthStatus, requireAdmin };
