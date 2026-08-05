// Utilidades compartidas: configuración, borradores, cola de envío y fotos.
// Todo vive en localStorage — la app funciona sin conexión y sincroniza cuando puede.

const CLAVES = {
  CONFIG: 'vi_config',
  BORRADORES_SKU: 'vi_borradores_sku',
  BORRADORES_REPORTE: 'vi_borradores_reporte',
  COLA_ENVIO: 'vi_cola_envio',
};

function leerJSON(clave, porDefecto) {
  try {
    const crudo = localStorage.getItem(clave);
    return crudo ? JSON.parse(crudo) : porDefecto;
  } catch (e) {
    console.error('Error leyendo', clave, e);
    return porDefecto;
  }
}

function guardarJSON(clave, valor) {
  localStorage.setItem(clave, JSON.stringify(valor));
}

function generarId(prefijo) {
  return `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// --- Configuración (URL del Apps Script, nombre del inspector por defecto) ---

function obtenerConfig() {
  return leerJSON(CLAVES.CONFIG, { urlEnvio: '', inspectorDefault: '', clienteDefault: '' });
}

function guardarConfig(config) {
  guardarJSON(CLAVES.CONFIG, config);
}

// --- Cola de envío: todo lo que no se ha podido mandar al Google Sheet ---

function obtenerCola() {
  return leerJSON(CLAVES.COLA_ENVIO, []);
}

function agregarACola(item) {
  const cola = obtenerCola();
  cola.push(item);
  guardarJSON(CLAVES.COLA_ENVIO, cola);
}

function quitarDeCola(id) {
  const cola = obtenerCola().filter((i) => i.id !== id);
  guardarJSON(CLAVES.COLA_ENVIO, cola);
}

async function enviarAlBackend(payload) {
  const { urlEnvio } = obtenerConfig();
  if (!urlEnvio) {
    throw new Error('SIN_CONFIGURAR');
  }
  const respuesta = await fetch(urlEnvio, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
  });
  if (!respuesta.ok) throw new Error('HTTP_' + respuesta.status);
  const datos = await respuesta.json().catch(() => ({ ok: true }));
  if (datos && datos.ok === false) throw new Error(datos.error || 'ERROR_BACKEND');
  return datos;
}

// Intenta enviar un payload; si falla, lo deja en cola para reintentar después.
async function enviarOEncolar(payload) {
  const item = { id: generarId('env'), payload, intentos: 0, creado: new Date().toISOString() };
  try {
    await enviarAlBackend(payload);
    return { ok: true, encolado: false };
  } catch (e) {
    item.intentos = 1;
    item.ultimoError = e.message;
    agregarACola(item);
    return { ok: false, encolado: true, error: e.message };
  }
}

async function reintentarCola(onProgreso) {
  const cola = obtenerCola();
  let enviados = 0;
  for (const item of cola) {
    try {
      await enviarAlBackend(item.payload);
      quitarDeCola(item.id);
      enviados++;
      if (onProgreso) onProgreso(enviados, cola.length);
    } catch (e) {
      // se queda en la cola, seguimos con el resto
    }
  }
  return { enviados, restantes: obtenerCola().length };
}

// --- Fotos: comprimir a un tamaño manejable antes de convertir a base64 ---

function comprimirImagen(archivo, maxLado = 1600, calidad = 0.72) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onerror = () => reject(lector.error);
    lector.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxLado || height > maxLado) {
          if (width > height) {
            height = Math.round((height * maxLado) / width);
            width = maxLado;
          } else {
            width = Math.round((width * maxLado) / height);
            height = maxLado;
          }
        }
        const lienzo = document.createElement('canvas');
        lienzo.width = width;
        lienzo.height = height;
        const ctx = lienzo.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = lienzo.toDataURL('image/jpeg', calidad);
        resolve({ base64: dataUrl.split(',')[1], mime: 'image/jpeg', ancho: width, alto: height });
      };
      img.src = lector.result;
    };
    lector.readAsDataURL(archivo);
  });
}

// --- Indicador de conexión / pendientes, usado en el encabezado de cada página ---

function actualizarIndicadorConexion(elemento) {
  if (!elemento) return;
  const pendientes = obtenerCola().length;
  if (pendientes > 0) {
    elemento.textContent = `⏳ ${pendientes} sin enviar`;
    elemento.className = 'estado-conexion pendiente';
  } else {
    elemento.textContent = navigator.onLine ? '● en línea' : '○ sin conexión';
    elemento.className = 'estado-conexion ok';
  }
}

function formatoFechaHora(iso) {
  try {
    return new Date(iso).toLocaleString('es-PA', { dateStyle: 'short', timeStyle: 'short' });
  } catch (e) {
    return iso;
  }
}

// Reintenta la cola automáticamente al cargar cualquier página y cuando vuelve la conexión.
window.addEventListener('online', () => { reintentarCola().catch(() => {}); });
document.addEventListener('DOMContentLoaded', () => { reintentarCola().catch(() => {}); });
