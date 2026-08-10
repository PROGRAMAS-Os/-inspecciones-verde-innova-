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

// --- Configuración (Supabase, nombre del inspector por defecto) ---

// Proyecto de Supabase ya conectado — así la app funciona en cualquier
// dispositivo sin configurar nada primero. La anon key es segura para usar en
// el navegador (no es secreta): los permisos reales los controlan las
// políticas de RLS y las funciones RPC del lado de Supabase, no esta clave.
const SUPABASE_URL = 'https://nqchzkhzmmnqcgcvgbvz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_8AQTJnknkxhnH5KZpZF8uQ__7KA8tf6';
const BUCKET_FOTOS = 'fotos-inspecciones';

const supabaseCliente = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function obtenerConfig() {
  return leerJSON(CLAVES.CONFIG, { inspectorDefault: '', clienteDefault: '' });
}

function guardarConfig(config) {
  guardarJSON(CLAVES.CONFIG, config);
}

// --- Cola de envío: todo lo que no se ha podido mandar a Supabase ---

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

// Convierte un data URL "data:image/png;base64,...." (de la firma dibujada
// en el canvas) al formato {base64, mime} que espera subirABucket.
function dataUrlAFoto(dataUrl) {
  if (!dataUrl || dataUrl.indexOf('base64,') === -1) return null;
  const [cabecera, base64] = dataUrl.split('base64,');
  const mime = (cabecera.match(/data:(.*);/) || [, 'image/png'])[1];
  return { base64, mime };
}

// Sube una foto {base64, mime} (o que ya viene como {url}, subida antes) al
// bucket de Supabase Storage y devuelve su URL pública — el bucket es
// público de solo-lectura, igual que "cualquiera con el enlace" en Drive.
async function subirABucket(foto, carpeta, etiqueta) {
  if (!foto) return '';
  if (foto.url) return foto.url;
  if (!foto.base64) return '';
  const bytes = Uint8Array.from(atob(foto.base64), (c) => c.charCodeAt(0));
  const extension = foto.mime === 'image/png' ? 'png' : 'jpg';
  const ruta = `${carpeta}/${etiqueta}_${Date.now()}.${extension}`;
  const { error } = await supabaseCliente.storage.from(BUCKET_FOTOS).upload(ruta, bytes, {
    contentType: foto.mime || 'image/jpeg',
  });
  if (error) throw error;
  return supabaseCliente.storage.from(BUCKET_FOTOS).getPublicUrl(ruta).data.publicUrl;
}

// Sube una lista de fotos y devuelve solo las URLs que lograron subirse
// (las que fallan se omiten sin perder el resto del envío).
async function subirListaABucket(fotos, carpeta, prefijo) {
  const lista = Array.isArray(fotos) ? fotos : [];
  const urls = [];
  for (let i = 0; i < lista.length; i++) {
    try {
      const url = await subirABucket(lista[i], carpeta, `${prefijo}_${i + 1}`);
      if (url) urls.push(url);
    } catch (e) {
      // se omite esta foto puntual
    }
  }
  return urls;
}

async function enviarAlBackend(payload) {
  if (payload.tipo === 'ping') {
    const { error } = await supabaseCliente.rpc('ping');
    if (error) throw new Error(error.message);
    return { ok: true, mensaje: 'pong' };
  }

  if (payload.tipo === 'foto') {
    const url = await subirABucket(payload.foto, payload.carpeta || 'sin_carpeta', `${payload.etiqueta || 'foto'}_${Date.now()}`);
    if (!url) throw new Error('No se pudo guardar la foto (formato inválido).');
    return { ok: true, url };
  }

  if (payload.tipo === 'checklist_sku') {
    const carpeta = payload.idEnvio || 'sin_id';
    const respuestas = await Promise.all((payload.respuestas || []).map(async (r, i) => {
      const urls = await subirListaABucket(r.fotos, carpeta, 'item' + i);
      return { ...r, fotos: urls.join(', ') };
    }));
    const { error } = await supabaseCliente.rpc('crear_checklist_sku', { datos: { ...payload, respuestas } });
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  if (payload.tipo === 'reporte_general') {
    const carpeta = payload.idEnvio || 'sin_id';
    const ap = payload.aprobacion || {};
    const firmaInspectorUrl = await subirABucket(dataUrlAFoto(ap.inspectorFirma), carpeta, 'firma_inspector');
    const firmaClienteUrl = await subirABucket(dataUrlAFoto(ap.clienteFirma), carpeta, 'firma_cliente');

    const anomalias = await Promise.all((payload.anomalias || []).map(async (a, i) => {
      const urls = await subirListaABucket(a.fotos, carpeta, 'anomalia' + i);
      return { ...a, fotos: urls.join(', ') };
    }));

    const fotos = {};
    for (const categoria of Object.keys(payload.fotos || {})) {
      fotos[categoria] = await subirListaABucket(payload.fotos[categoria], carpeta, categoria);
    }

    const datos = {
      ...payload,
      aprobacion: { ...ap, inspectorFirma: firmaInspectorUrl, clienteFirma: firmaClienteUrl },
      anomalias,
      fotos,
    };
    const { error } = await supabaseCliente.rpc('crear_informe', { datos });
    if (error) throw new Error(error.message);
    return { ok: true };
  }

  throw new Error('Tipo de envío no reconocido: ' + payload.tipo);
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

// Sube una sola foto ya comprimida (via comprimirImagen) a una "carpeta"
// lógica en Storage (normalmente el idEnvio de la inspección) y devuelve la
// URL. Se usa para mandar cada foto por separado ANTES del envío principal
// de datos, así el payload de datos queda liviano y cada foto puede
// reintentarse por su cuenta con mala señal.
async function subirFoto(foto, carpeta, etiqueta) {
  const url = await subirABucket(foto, carpeta, etiqueta);
  if (!url) throw new Error('SIN_URL');
  return url;
}

// Intenta subir cada foto de una lista de forma individual (con un par de
// reintentos rápidos). Las que lo logran quedan como {url}; las que no,
// se dejan tal cual (con su base64) para que viajen dentro del envío
// principal como respaldo, sin perder la foto.
async function subirFotosIndividualmente(fotos, carpeta, etiquetaBase, onProgreso) {
  const resultado = [];
  for (let i = 0; i < fotos.length; i++) {
    const foto = fotos[i];
    if (foto.url) { resultado.push(foto); continue; }
    let subida = null;
    for (let intento = 0; intento < 2 && !subida; intento++) {
      try {
        const url = await subirFoto(foto, carpeta, `${etiquetaBase}_${i + 1}`);
        subida = { url };
      } catch (e) {
        subida = null;
      }
    }
    resultado.push(subida || foto);
    if (onProgreso) onProgreso(i + 1, fotos.length);
  }
  return resultado;
}

// Intenta enviar un payload; si falla, lo deja en cola para reintentar después.
// Devuelve tambien el idEnvio usado, para que quien llama pueda guardarlo junto
// al registro local y así saber más tarde si ya se confirmó el envío.
async function enviarOEncolar(payload) {
  const idEnvio = payload.idEnvio || generarId('env');
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
