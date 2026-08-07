# Inspecciones Verde Innova

App web (funciona en el navegador de cualquier celular o computadora, sin instalar
nada) para llenar de forma remota los formatos de inspección de calzado de Verde
Innova:

- **Checklist de calzado por SKU** — basado en `Apparel Inspection Sheet.xlsx`: una
  revisión punto por punto (etiquetas, empaque, calidad del zapato) por cada
  estilo/color del packing list del embarque.
- **Informe general de inspección** — basado en
  `Formulario de Inspeccion de Productos VI RINCON HOOKA.xlsx`: el reporte completo
  del embarque (cajas muestreadas, muestreo, hallazgos, conclusión, firmas,
  evidencia fotográfica, anomalías y medidas).

Manual de uso paso a paso para inspectores: [`docs/Manual de Uso - App de Inspecciones Verde Innova.docx`](docs/Manual%20de%20Uso%20-%20App%20de%20Inspecciones%20Verde%20Innova.docx).

Cada inspección enviada se guarda automáticamente como fila nueva en un Google
Sheet (incluyendo enlaces a las fotos, guardadas en Drive) — ver
[`apps-script/INSTRUCCIONES.md`](apps-script/INSTRUCCIONES.md) para conectar tu
propio Google Sheet la primera vez.

La app funciona sin conexión: todo se guarda en el dispositivo y se envía solo en
cuanto vuelve la señal (útil en bodegas/almacenes). Después de la primera visita
con internet, también carga sin conexión gracias a un service worker (`sw.js`).

## Los formatos cambian por embarque

Los ítems del checklist de SKU se pueden editar directamente en la app
("Editar checklist", dentro de la sección de Checklist) para ajustarlos al
packing list u hoja de descripción de mercancía de cada embarque, sin tocar
código. La plantilla ajustada se puede exportar/importar como archivo para
repartirla entre varios celulares antes del mismo embarque.

El **informe general** sí mantiene una estructura fija (secciones y campos),
igual que el formato Excel original en el que se basa — es el checklist de SKU
el que está pensado para variar según el packing list de cada embarque.

## Cómo se relacionan el checklist y el informe general

Ambos formularios usan el mismo campo **Referencia / PO** para identificar el
embarque. Escribe el mismo valor en los dos al trabajar en el mismo embarque —
así se pueden cruzar los datos de `Checklist_SKU` y `Reportes_Generales` en el
Sheet sin trabajo manual.

## Seguridad (léelo antes de usar con datos reales de clientes)

- El backend (Google Apps Script) exige un token compartido en cada envío
  (ver `js/app.js` → `TOKEN_APP` y `apps-script/Code.gs`). No es un secreto
  perfecto — al ser una app 100% de navegador, el token es técnicamente visible
  para quien revise el código — pero filtra bots/envíos automatizados y es
  rotable sin volver a publicar el Apps Script.
- Las fotos y firmas se guardan en Drive como "cualquiera con el enlace puede
  ver". Es una decisión consciente para que el Sheet las muestre sin pedir
  login, pero cualquier persona que consiga ese enlace puntual podrá verlas.
  Si el cliente y Verde Innova comparten un dominio de Google Workspace, se
  puede restringir a ese dominio (ver `apps-script/INSTRUCCIONES.md`).
- Cada envío tiene un ID único para que un reintento por mala señal no duplique
  la fila en el Sheet.
- No subas a este repositorio (es público) ningún documento que describa
  vulnerabilidades o datos de inspecciones reales de clientes.

## Publicar / actualizar

Es un sitio estático (HTML/CSS/JS, sin build). Cualquier cambio en estos archivos
se refleja en GitHub Pages apenas se hace `git push` a la rama `main`. Si cambias
`apps-script/Code.gs`, también hay que volver a implementarlo desde el editor de
Apps Script (ver el paso final de `apps-script/INSTRUCCIONES.md`) — eso no se
actualiza solo con el `git push`.

## Estructura

```
index.html            Menú principal
checklist.html/.js    Checklist por SKU
reporte.html/.js      Informe general
config.html           Conexión con Google Sheets + envíos pendientes
css/app.css           Estilos compartidos
js/app.js             Utilidades: guardado local, cola de envío, fotos, token, escape de HTML
manifest.json, sw.js  App instalable / disponible sin conexión desde el segundo uso
apps-script/          Código del backend (Google Apps Script) e instrucciones
docs/                 Manual de uso para inspectores
```
