# Conectar el Apps Script (generación del Doc/PDF) con Supabase

Los datos y las fotos de las inspecciones viven en Supabase (ver
`supabase/schema.sql`). Este Apps Script ya **no** recibe nada del navegador —
su único trabajo es generar el Google Doc/PDF del informe general cuando
Supabase le avisa que se creó uno nuevo, y devolverle a Supabase las URLs.

## 1. Publica (o re-publica) el Apps Script

1. En el editor de Apps Script del proyecto, pega el contenido de [`Code.gs`](Code.gs).
2. Revisa que `appsscript.json` tenga los permisos de [`appsscript.json`](appsscript.json) de este repositorio (Docs y Drive).
3. **Implementar → Gestionar implementaciones** → lápiz en la implementación activa → **Nueva versión** → **Implementar** (o **Nueva implementación** si es la primera vez, tipo **Aplicación web**, ejecutar como tú, acceso **Cualquier usuario**).
4. Copia la **URL de la aplicación web** (termina en `/exec`).

## 2. Configura las Propiedades del script

**Configuración del proyecto → Propiedades del script → Añadir propiedad de script**, dos en total:

| Propiedad | Valor |
|---|---|
| `SUPABASE_URL` | La URL del proyecto, ej. `https://xxxxx.supabase.co` |
| `TOKEN_WEBHOOK` | Un texto largo cualquiera que invente (o el que le haya dado Claude), solo lo comparten este script y las funciones RPC del paso 3 |

Este script **nunca necesita la `service_role`/secret key** de Supabase: la
clave publicable ya está escrita en `Code.gs` (constante `SUPABASE_ANON_KEY`,
la misma que usa `js/app.js` — es segura de tener en código) y el
`TOKEN_WEBHOOK` hace de autorización extra para las dos únicas operaciones
que este script necesita del lado de Supabase.

## 3. Aviso desde Supabase hacia Apps Script (y de vuelta)

**Supabase → Apps Script:** resuelto en `supabase/schema.sql` (sección 5), un
trigger en `reportes_generales` que usa `pg_net` para avisarle a este Apps
Script en cada `INSERT`.

(El wizard de Studio en **Database → Webhooks** no funcionó en este proyecto
porque depende del esquema `supabase_functions`, que no existe aquí — por eso
se optó por el trigger directo con `pg_net`.)

Apps Script no puede leer headers personalizados en `doPost`, por eso el
token va en la URL en vez de en un header.

**Apps Script → Supabase:** resuelto en `supabase/schema.sql` (sección 6), dos
funciones RPC (`webhook_leer_informe`, `webhook_marcar_documento`) que exigen
el mismo `TOKEN_WEBHOOK` como parámetro antes de leer/escribir nada — así
`anon` (la clave publicable) solo puede tocar exactamente esas dos
operaciones, nunca el resto de las tablas.

Si rotas `TOKEN_WEBHOOK`, actualiza el literal en `trg_generar_doc_informe()`
**y** en las dos funciones RPC de la sección 6, con `create or replace
function`.

## Qué hace el script

- Cuando llega el webhook, pide vía RPC (`webhook_leer_informe`) el informe
  completo con sus cajas, anomalías, medidas y fotos, genera el Doc y el PDF
  con el mismo formato de siempre, los guarda
  en una carpeta de Drive por informe (dentro de **"Inspecciones Verde Innova
  - Fotos"**), y actualiza las columnas `informe_doc`/`informe_pdf` de la fila
  en Supabase.
- Si algo falla generando el Doc, esa fila simplemente se queda sin
  `informe_doc`/`informe_pdf` — los datos ya están seguros en Supabase de
  todas formas.
- El Doc/PDF quedan compartidos como "cualquiera con el enlace puede ver" en
  Drive, igual que las fotos en Supabase Storage.
- Limita cuántas veces por minuto puede llegar tráfico a esta URL (defensa
  adicional al token, ya que sigue siendo una URL técnicamente pública).

## Cada vez que edites `Code.gs`

Vuelve a pegar el código y repite el paso 1.3 (**Nueva versión**), no hace
falta tocar las Propiedades del script ni el webhook si no cambiaron.
