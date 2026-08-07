# Conectar la app a Google Sheets (una sola vez)

Esto crea el "backend" gratuito que recibe cada inspección y la guarda como fila
en un Google Sheet, incluyendo las fotos (se guardan en una carpeta de tu Drive
y el Sheet queda con el enlace a cada una).

No necesitas instalar nada ni saber programar: todo se hace desde tu navegador,
en tu propia cuenta de Google. Nosotros (la app) nunca vemos tu contraseña ni tus
credenciales.

## 1. Crea el Google Sheet

1. Ve a [sheets.google.com](https://sheets.google.com) y crea una hoja de cálculo nueva.
2. Ponle un nombre, por ejemplo **"Inspecciones Verde Innova"**.

## 2. Abre el editor de Apps Script

1. En el Sheet, ve al menú **Extensiones → Apps Script**.
2. Se abre un editor con un archivo `Código.gs` vacío (o con `function myFunction() {}`).
3. Borra todo su contenido.

## 3. Copia el código

1. Abre el archivo [`Code.gs`](Code.gs) de este repositorio.
2. Copia **todo** su contenido y pégalo en el editor de Apps Script (reemplazando lo que había).
3. Guarda con el ícono de disquete o `Ctrl+S`.

## 4. Publica como aplicación web

1. Arriba a la derecha, clic en **Implementar → Nueva implementación**.
2. En "Selecciona el tipo", elige **Aplicación web**.
3. Configura:
   - **Ejecutar como:** Yo (tu cuenta)
   - **Quién tiene acceso:** Cualquier usuario
4. Clic en **Implementar**.
5. Google pedirá autorizar permisos (es tu propio script, sobre tu propio Sheet/Drive):
   - Si aparece "Google no ha verificado esta app", clic en **Configuración avanzada** → **Ir a [nombre del proyecto] (no seguro)** → **Permitir**. Es seguro: es tu propio código, en tu propia cuenta.
6. Copia la **URL de la aplicación web** que te da (termina en `/exec`).

## 5. Configura el token de seguridad (importante)

Sin este paso, cualquier persona que encuentre la URL del paso 4 podría escribir
en tu Google Sheet o subir archivos a tu Drive.

1. En el editor de Apps Script, ve a **Configuración del proyecto** (ícono de
   engranaje, a la izquierda).
2. Busca la sección **Propiedades del script** → **Añadir propiedad de script**.
3. Como **Propiedad** escribe exactamente `TOKEN_APP`.
4. Como **Valor**, pega el mismo texto que aparece en el archivo `js/app.js` de
   este repositorio en la constante `TOKEN_APP` (una cadena larga de letras y
   números).
5. Guarda.

Si más adelante quieres rotar el token: cambia el valor aquí Y en `js/app.js`
(luego vuelve a publicar la app en GitHub — no hace falta redeployar el Apps
Script).

## 6. Pégala en la app de inspecciones

1. Abre la app publicada (o `config.html` en local) → **Configuración**.
2. Pega la URL en "URL del Web App" y presiona **Guardar**.
3. Presiona **Probar conexión** — debe decir "Conectado correctamente". Si dice
   "No autorizado", revisa que el token del paso 5 sea idéntico al de `js/app.js`.

## 7. Cada vez que edites el código

Si en el futuro cambias `Code.gs` (por ejemplo para agregar una columna nueva):

1. Vuelve a pegar el código actualizado en el editor de Apps Script.
2. **Implementar → Gestionar implementaciones** → ícono de lápiz en la implementación activa → **Nueva versión** → **Implementar**.
   (Si creas una implementación totalmente nueva en vez de una nueva versión, la URL cambia y tendrás que actualizarla en Configuración).

## Qué hace el script

- Crea automáticamente, dentro del mismo Sheet, las pestañas: `Checklist_SKU`,
  `Reportes_Generales`, `Reportes_Cajas`, `Reportes_Anomalias`, `Reportes_Medidas`
  y `Reportes_Fotos` — no necesitas crearlas tú.
- Cada foto se guarda en una carpeta de Google Drive llamada
  **"Inspecciones Verde Innova - Fotos"**, organizada por inspección, y el Sheet
  guarda el enlace para verla.
- Con estas pestañas puedes armar tablas dinámicas o gráficos directamente en el
  Sheet (por ejemplo: ítems marcados "NO" por estilo, para detectar defectos
  recurrentes de un proveedor).
- El checklist por SKU y el informe general comparten el mismo campo
  **Referencia / PO**: úsalo igual en ambos formularios del mismo embarque para
  poder cruzar la información entre pestañas.
- Cada envío incluye un "ID envío" único: si un envío se reintenta por mala
  señal, el script no lo duplica en el Sheet.
- El script rechaza envíos sin el token correcto, limita cuántas fotos y cuánto
  texto acepta por envío, y solo guarda archivos que sean imágenes reales.
- Las fotos y firmas quedan compartidas como "cualquiera con el enlace puede
  ver" dentro de tu Drive — es una decisión consciente para que el Sheet las
  muestre sin pedirle login a quien lo revise, pero significa que cualquiera
  que consiga ese enlace específico podrá verlas. Si necesitas restringirlo a
  tu dominio de Google Workspace, cambia `DriveApp.Access.ANYONE_WITH_LINK` por
  `DriveApp.Access.DOMAIN_WITH_LINK` en `guardarFoto()` (requiere que tu cuenta
  y las del cliente compartan el mismo Workspace).
