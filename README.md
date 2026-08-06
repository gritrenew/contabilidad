# Contabilidad — Dashboard ejecutivo multiempresa

App Node.js/Express que se conecta de solo lectura a la vista
`dwh.FIN_VW_PBI_TH_MovimientosContabilidad` (Business Central) y expone:

- **Dashboard ejecutivo** (`/`): KPIs (Activo, Pasivo, Patrimonio, Resultado) y
  gráficos consolidados, filtrables por empresa y año.
- **Reporte** (`/report.html`): tabla tipo pivote — N° cuenta, Nombre de
  cuenta y Saldo (divisa adicional) por año/mes, filtrable por empresa,
  cuenta, rubro, año y mes, con export a CSV. Reemplaza el proceso manual de
  descargar y armar la tabla dinámica en Excel cada vez.
- **Mantenedor** (`/settings.html`): pantalla para configurar servidor, base
  de datos, usuario, contraseña y vista de origen, con botón de "Probar
  conexión".

## Cómo se guardan las credenciales

Modelo híbrido:

1. Lo que se guarda desde **Mantenedor** queda cifrado (AES-256-GCM) en
   `data/db-settings.enc.json`, que **nunca se sube a git** (ver
   `.gitignore`). La llave de cifrado se genera sola en `data/.appkey` la
   primera vez que la app corre.
2. En producción (Azure Web App → Configuration → Application settings),
   podés fijar las mismas variables como variables de entorno:
   `DB_SERVER`, `DB_PORT`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD`,
   `DB_VIEW`, `DB_ENCRYPT`, `DB_TRUST_CERT`. Cualquier variable presente en
   el entorno **siempre gana** sobre lo guardado en Mantenedor, y esos
   campos aparecen bloqueados (badge "Azure") en la pantalla — evita que
   alguien pise en producción lo que Azure ya tiene fijado.
3. Opcional: `APP_SECRET` fija la llave de cifrado en vez de generarla
   (recomendado en Azure, para que sobreviva un reinicio del contenedor).

## Correr localmente

```bash
npm install
npm start
```

Abrí `http://localhost:8080`, andá a **Mantenedor**, cargá los datos de
conexión (servidor, base de datos, usuario, contraseña y la vista) y
guardá. El Dashboard y el Reporte quedan disponibles apenas la conexión
prueba OK.

## Nota de seguridad

Por ahora la app queda sin login (decisión explícita) — cualquiera con la
URL de Azure ve los datos financieros del grupo. Si más adelante se quiere
agregar una contraseña de acceso, es un cambio acotado en `server.js`.
