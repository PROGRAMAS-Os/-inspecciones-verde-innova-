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

Cada inspección enviada se guarda automáticamente como fila nueva en un Google
Sheet (incluyendo enlaces a las fotos, guardadas en Drive) — ver
[`apps-script/INSTRUCCIONES.md`](apps-script/INSTRUCCIONES.md) para conectar tu
propio Google Sheet la primera vez.

La app funciona sin conexión: todo se guarda en el dispositivo y se envía solo en
cuanto vuelve la señal (útil en bodegas/almacenes).

## Publicar / actualizar

Es un sitio estático (HTML/CSS/JS, sin build). Cualquier cambio en estos archivos
se refleja en GitHub Pages apenas se hace `git push` a la rama `main`.

## Los formatos cambian por embarque

Los ítems del checklist de SKU se pueden editar directamente en la app
("Editar checklist", dentro de la sección de Checklist) para ajustarlos al
packing list u hoja de descripción de mercancía de cada embarque, sin tocar
código.

## Estructura

```
index.html          Menú principal
checklist.html/.js   Checklist por SKU
reporte.html/.js      Informe general
config.html          Conexión con Google Sheets + envíos pendientes
css/app.css          Estilos compartidos
js/app.js            Utilidades: guardado local, cola de envío, fotos
apps-script/         Código del backend (Google Apps Script) e instrucciones
```
