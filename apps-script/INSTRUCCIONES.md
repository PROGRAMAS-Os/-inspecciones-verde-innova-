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

## 5. Pégala en la app de inspecciones

1. Abre la app publicada (o `config.html` en local) → **Configuración**.
2. Pega la URL en "URL del Web App" y presiona **Guardar**.
3. Presiona **Probar conexión** — debe decir "Conectado correctamente".

## 6. Cada vez que edites el código

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
