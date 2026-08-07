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

let avisoGuardadoMostrado = false;

function guardarJSON(clave, valor) {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
    return true;
  } catch (e) {
    console.error('No se pudo guardar en este dispositivo', clave, e);
    if (!avisoGuardadoMostrado) {
      avisoGuardadoMostrado = true;
      alert('El dispositivo no tiene espacio para guardar más información (posiblemente por muchas fotos acumuladas). Envía lo que tengas pendiente cuanto antes desde Configuración, o borra fotos/inspecciones ya enviadas.');
    }
    return false;
  }
}

function generarId(prefijo) {
  return `${prefijo}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// Escapa texto que puede venir de fuentes externas (packing list pegado, comentarios,
// nombres de estilo) antes de insertarlo en innerHTML — evita que un dato con
// comillas o etiquetas HTML rompa la página o ejecute código en el navegador.
function escapeHtml(valor) {
  return String(valor == null ? '' : valor)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Configuración (URL del Apps Script, nombre del inspector por defecto) ---

// URL del Google Apps Script ya desplegado — así la app funciona en cualquier
// dispositivo sin configurar nada primero. Se puede cambiar desde Configuración
// (por ejemplo si un día se conecta a otro Google Sheet).
const URL_ENVIO_POR_DEFECTO = 'https://script.google.com/macros/s/AKfycbxy_cCYEaB3IHVB46lumRD2KL93OXvJUtYNMTgSPJJJSUh-S2rxmpW14JCLSb19xBXS/exec';

// Token compartido para filtrar envíos automatizados/spam al backend. No es un
// secreto real: al ser una app 100% de navegador, cualquiera que revise este
// archivo puede verlo. Su función es evitar que bots que escanean URLs de Apps
// Script al azar puedan escribir en el Sheet, y permitir rotarlo sin tener que
// volver a publicar el Apps Script (solo se cambia aquí y en las propiedades
// del script). El backend rechaza cualquier envío que no lo incluya.
const TOKEN_APP = 'a5aeaf8b61cc94f8152460e6a3781cc49b2f6234ef450507';

function obtenerConfig() {
  return leerJSON(CLAVES.CONFIG, { urlEnvio: URL_ENVIO_POR_DEFECTO, inspectorDefault: '', clienteDefault: '' });
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
  const controlador = new AbortController();
  const tiempoFuera = setTimeout(() => controlador.abort(), 25000);
  let respuesta;
  try {
    respuesta = await fetch(urlEnvio, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ...payload, token: TOKEN_APP }),
      signal: controlador.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('TIEMPO_AGOTADO');
    throw e;
  } finally {
    clearTimeout(tiempoFuera);
  }
  if (!respuesta.ok) throw new Error('HTTP_' + respuesta.status);
  const datos = await respuesta.json().catch(() => ({ ok: true }));
  if (datos && datos.ok === false) throw new Error(datos.error || 'ERROR_BACKEND');
  return datos;
}

// Busca, en los borradores locales, el registro que generó este envío y
// actualiza su estado a "enviado" — así la lista deja de mostrarlo como
// pendiente en cuanto la cola logra mandarlo, sin que el usuario tenga que
// reabrirlo.
function actualizarEstadoLocalPorIdEnvio(idEnvio) {
  const embarque = leerJSON('vi_embarque_checklist_actual', null);
  if (embarque && Array.isArray(embarque.skus)) {
    const sku = embarque.skus.find((s) => s.idEnvio === idEnvio);
    if (sku) {
      sku.estado = 'enviado';
      guardarJSON('vi_embarque_checklist_actual', embarque);
    }
  }
  const informe = leerJSON('vi_reporte_actual', null);
  if (informe && informe.idEnvio === idEnvio) {
    informe.estado = 'enviado';
    guardarJSON('vi_reporte_actual', informe);
  }
}

// Intenta enviar un payload; si falla, lo deja en cola para reintentar después.
// Devuelve tambien el idEnvio usado, para que quien llama pueda guardarlo junto
// al registro local y así saber más tarde si ya se confirmó el envío.
async function enviarOEncolar(payload) {
  const idEnvio = generarId('env');
  const payloadConId = { ...payload, idEnvio };
  const item = { id: idEnvio, payload: payloadConId, intentos: 0, creado: new Date().toISOString() };
  try {
    await enviarAlBackend(payloadConId);
    return { ok: true, encolado: false, idEnvio };
  } catch (e) {
    item.intentos = 1;
    item.ultimoError = e.message;
    agregarACola(item);
    return { ok: false, encolado: true, error: e.message, idEnvio };
  }
}

async function reintentarCola(onProgreso) {
  const cola = obtenerCola();
  let enviados = 0;
  for (const item of cola) {
    try {
      await enviarAlBackend(item.payload);
      quitarDeCola(item.id);
      actualizarEstadoLocalPorIdEnvio(item.id);
      enviados++;
      if (onProgreso) onProgreso(enviados, cola.length);
    } catch (e) {
      // se queda en la cola, pero registramos el intento para que Configuración
      // muestre el motivo y el número de intentos actualizados.
      const colaActual = obtenerCola();
      const actual = colaActual.find((i) => i.id === item.id);
      if (actual) {
        actual.intentos = (actual.intentos || 0) + 1;
        actual.ultimoError = e.message;
        actual.ultimoIntento = new Date().toISOString();
        guardarJSON(CLAVES.COLA_ENVIO, colaActual);
      }
    }
  }
  return { enviados, restantes: obtenerCola().length };
}

// --- Fotos: comprimir a un tamaño manejable antes de convertir a base64 ---

function comprimirImagen(archivo, maxLado = 1280, calidad = 0.62) {
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

// Registra el service worker (app shell disponible sin conexión desde el
// primer uso posterior a la primera carga con internet).
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const base = location.pathname.replace(/[^/]*$/, '');
    navigator.serviceWorker.register(base + 'sw.js').catch(() => {});
  });
}
