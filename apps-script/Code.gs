/**
 * Backend de Inspecciones Verde Innova.
 * Recibe los envíos de la app web (checklist por SKU e informes generales),
 * guarda las fotos en Drive y agrega una fila por registro en el Google Sheet
 * al que está vinculado este script.
 *
 * Instalación: ver apps-script/INSTRUCCIONES.md
 *
 * Seguridad: este Web App se despliega con acceso "Cualquier usuario" (es la
 * única forma de que la app pueda enviar datos sin pedirle login de Google al
 * inspector). Por eso doPost() exige un token compartido — no es un secreto
 * real (la app de navegador necesita incluirlo, así que cualquiera que revise
 * su código puede verlo), pero filtra el scaneo automatizado/bots que
 * encuentren esta URL al azar, y permite rotarlo sin volver a publicar el
 * Apps Script: solo hay que cambiar el valor en "Configuración del proyecto →
 * Propiedades del script" (clave TOKEN_APP) y en js/app.js (constante
 * TOKEN_APP) de la app.
 */

const NOMBRE_CARPETA_FOTOS = 'Inspecciones Verde Innova - Fotos';
const MAX_FOTOS_POR_ENVIO = 40;
const MAX_BASE64_POR_FOTO = 9000000; // ~6.5 MB decodificados
const MAX_LARGO_TEXTO = 4000;
const MAX_SOLICITUDES_POR_MINUTO = 60;

function doGet(e) {
  return responderJSON({ ok: true, mensaje: 'Backend de inspecciones Verde Innova activo.' });
}

function doPost(e) {
  try {
    if (!respetaLimiteDeUso()) {
      return responderJSON({ ok: false, error: 'Demasiadas solicitudes en poco tiempo, intenta de nuevo en un minuto.' });
    }

    const datos = JSON.parse(e.postData.contents);

    if (!tokenValido(datos.token)) {
      return responderJSON({ ok: false, error: 'No autorizado.' });
    }

    if (datos.tipo === 'ping') {
      return responderJSON({ ok: true, mensaje: 'pong' });
    }

    if (datos.idEnvio && yaSeProceso(datos.idEnvio)) {
      return responderJSON({ ok: true, duplicado: true });
    }

    if (datos.tipo === 'checklist_sku') {
      validarChecklistSku(datos);
      guardarChecklistSku(datos);
    } else if (datos.tipo === 'reporte_general') {
      validarReporteGeneral(datos);
      guardarReporteGeneral(datos);
    } else {
      return responderJSON({ ok: false, error: 'Tipo de envío no reconocido: ' + datos.tipo });
    }

    if (datos.idEnvio) marcarComoProcesado(datos.idEnvio);
    return responderJSON({ ok: true });
  } catch (err) {
    return responderJSON({ ok: false, error: String(err) });
  }
}

function responderJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// --- Seguridad: token, límite de uso y de-duplicado de envíos ---

function tokenValido(tokenRecibido) {
  const esperado = PropertiesService.getScriptProperties().getProperty('TOKEN_APP');
  return !!esperado && tokenRecibido === esperado;
}

function respetaLimiteDeUso() {
  const cache = CacheService.getScriptCache();
  const clave = 'rl_' + Math.floor(Date.now() / 60000);
  const actual = Number(cache.get(clave) || '0') + 1;
  cache.put(clave, String(actual), 90);
  return actual <= MAX_SOLICITUDES_POR_MINUTO;
}

function yaSeProceso(idEnvio) {
  return !!CacheService.getScriptCache().get('env_' + idEnvio);
}

function marcarComoProcesado(idEnvio) {
  CacheService.getScriptCache().put('env_' + idEnvio, '1', 21600); // 6 horas
}

// --- Validación básica de forma/tamaño (defensa adicional a la del token) ---

function truncar(texto, maximo) {
  if (texto == null) return '';
  const s = String(texto);
  return s.length > maximo ? s.slice(0, maximo) + '…' : s;
}

function limpiarFoto(foto) {
  if (!foto || typeof foto.base64 !== 'string' || !foto.base64) return null;
  if (foto.base64.length > MAX_BASE64_POR_FOTO) return null;
  if (!foto.mime || String(foto.mime).indexOf('image/') !== 0) return null;
  return foto;
}

function limpiarListaFotos(fotos) {
  return (Array.isArray(fotos) ? fotos : []).map(limpiarFoto).filter(Boolean).slice(0, MAX_FOTOS_POR_ENVIO);
}

function validarChecklistSku(datos) {
  if (!datos.embarque || !datos.sku || !Array.isArray(datos.respuestas)) {
    throw new Error('Estructura de checklist inválida.');
  }
}

function validarReporteGeneral(datos) {
  if (!datos.general) throw new Error('Estructura de informe inválida.');
}

// --- Hoja de cálculo y carpeta de Drive ---

function hoja(nombre, encabezados) {
  const libro = SpreadsheetApp.getActiveSpreadsheet();
  let sh = libro.getSheetByName(nombre);
  if (!sh) {
    sh = libro.insertSheet(nombre);
    sh.appendRow(encabezados);
    sh.setFrozenRows(1);
  }
  return sh;
}

function carpetaFotos() {
  const carpetas = DriveApp.getFoldersByName(NOMBRE_CARPETA_FOTOS);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(NOMBRE_CARPETA_FOTOS);
}

// Guarda una foto {base64, mime} en Drive y devuelve la URL para verla.
function guardarFoto(foto, subcarpeta, nombreArchivo) {
  const limpia = limpiarFoto(foto);
  if (!limpia) return '';
  const bytes = Utilities.base64Decode(limpia.base64);
  const blob = Utilities.newBlob(bytes, limpia.mime, nombreArchivo + '.jpg');
  const archivo = subcarpeta.createFile(blob);
  archivo.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return archivo.getUrl();
}

function subcarpetaPara(nombre) {
  const raiz = carpetaFotos();
  const existentes = raiz.getFoldersByName(nombre);
  return existentes.hasNext() ? existentes.next() : raiz.createFolder(nombre);
}

function guardarFotos(fotos, subcarpeta, prefijo) {
  const limpias = limpiarListaFotos(fotos);
  if (!limpias.length) return '';
  return limpias.map((f, i) => guardarFoto(f, subcarpeta, prefijo + '_' + (i + 1))).filter(Boolean).join(', ');
}

// --- Checklist por SKU ---

function guardarChecklistSku(datos) {
  const sh = hoja('Checklist_SKU', [
    'ID envío', 'Fecha envío', 'Cliente', 'Referencia', 'Fecha inspección', 'Inspector',
    'Estilo', 'Descripción', 'Color', 'País origen', 'Cantidad',
    'Sección', 'Ítem', 'Estado', 'Comentario', 'Fotos',
  ]);
  const idInspeccion = `${truncar(datos.sku.estilo, 60) || 'sku'}_${new Date(datos.enviado).getTime()}`;
  const subcarpeta = subcarpetaPara(idInspeccion);

  (datos.respuestas || []).forEach((r, i) => {
    const enlacesFotos = guardarFotos(r.fotos, subcarpeta, 'item' + i);
    sh.appendRow([
      datos.idEnvio || '', new Date(datos.enviado), truncar(datos.embarque.cliente, 200), truncar(datos.embarque.referencia, 200), datos.embarque.fecha, truncar(datos.embarque.inspector, 200),
      truncar(datos.sku.estilo, 200), truncar(datos.sku.descripcion, MAX_LARGO_TEXTO), truncar(datos.sku.color, 200), truncar(datos.sku.paisOrigen, 200), truncar(datos.sku.cantidad, 100),
      truncar(r.seccion, 200), truncar(r.item, 500), truncar(r.estado, 20), truncar(r.comentario, MAX_LARGO_TEXTO), enlacesFotos,
    ]);
  });
}

// --- Informe general ---

function guardarReporteGeneral(datos) {
  const g = datos.general || {}, mu = datos.muestreo || {}, ha = datos.hallazgos || {}, co = datos.conclusion || {}, ap = datos.aprobacion || {};
  const idInforme = `${truncar(g.cliente, 60) || 'informe'}_${new Date(datos.enviado).getTime()}`;
  const subcarpeta = subcarpetaPara(idInforme);

  const shPrincipal = hoja('Reportes_Generales', [
    'ID informe', 'ID envío', 'Fecha envío', 'Inspector', 'Fecha inspección', 'Ubicación', 'Cliente', 'Referencia', 'Consignatario',
    'Tipo producto', 'Cantidad total', 'Cajas seleccionadas', 'Contenedor/Sello',
    'Muestreo base', 'Muestreo %', 'Estándar', 'Método selección', 'Notas muestreo',
    'Integridad embalaje', 'Daño/defecto', 'Consistencia cantidad', 'Manipulación/contaminación', 'Evidencia fotográfica',
    'Resumen hallazgos', 'Recomendación', 'Decisión', 'Medidas adicionales',
    'Inspector nombre', 'Inspector firma', 'Inspector fecha', 'Cliente rep. nombre', 'Cliente rep. firma', 'Cliente rep. fecha',
  ]);

  const firmaInspectorUrl = guardarFoto(dataUrlAFoto(ap.inspectorFirma), subcarpeta, 'firma_inspector');
  const firmaClienteUrl = guardarFoto(dataUrlAFoto(ap.clienteFirma), subcarpeta, 'firma_cliente');

  shPrincipal.appendRow([
    idInforme, datos.idEnvio || '', new Date(datos.enviado), truncar(g.inspector, 200), g.fecha, truncar(g.ubicacion, 300), truncar(g.cliente, 200), truncar(g.referencia, 200), truncar(g.consignatario, 200),
    truncar(g.tipoProducto, 200), truncar(g.cantidadTotal, 100), truncar(g.cajasSeleccionadas, 300), truncar(g.contenedorSello, 200),
    truncar(mu.base, 200), truncar(mu.porcentaje, 50), truncar(mu.estandar, 300), truncar(mu.metodo, 300), truncar(mu.notas, MAX_LARGO_TEXTO),
    truncar(ha.integridad, MAX_LARGO_TEXTO), truncar(ha.dano, MAX_LARGO_TEXTO), truncar(ha.cantidad, 500), truncar(ha.manipulacion, 500), truncar(ha.evidenciaFoto, 20),
    truncar(co.resumen, MAX_LARGO_TEXTO), truncar(co.recomendacion, MAX_LARGO_TEXTO), truncar(co.decision, 50), truncar(co.medidasAdicionales, MAX_LARGO_TEXTO),
    truncar(ap.inspectorNombre, 200), firmaInspectorUrl, ap.inspectorFecha, truncar(ap.clienteNombre, 200), firmaClienteUrl, ap.clienteFecha,
  ]);

  const shCajas = hoja('Reportes_Cajas', ['ID informe', 'Caja No.', 'Condición externa', 'Etiquetado', 'Sellado', 'Calidad caja', 'Condición unidad', 'Observaciones']);
  (datos.cajas || []).forEach((c) => {
    shCajas.appendRow([idInforme, truncar(c.numero, 100), truncar(c.condicionExterna, 200), truncar(c.etiquetado, 50), truncar(c.sellado, 100), truncar(c.calidadCaja, 200), truncar(c.condicionUnidad, 200), truncar(c.observaciones, MAX_LARGO_TEXTO)]);
  });

  const shAnomalias = hoja('Reportes_Anomalias', ['ID informe', 'Descripción', 'Fotos']);
  (datos.anomalias || []).forEach((a, i) => {
    const enlaces = guardarFotos(a.fotos, subcarpeta, 'anomalia' + i);
    shAnomalias.appendRow([idInforme, truncar(a.descripcion, MAX_LARGO_TEXTO), enlaces]);
  });

  const shMedidas = hoja('Reportes_Medidas', ['ID informe', 'Medida del bulto', 'Talla/referencia', 'Medida']);
  const filasMedidas = (datos.medidas && datos.medidas.filas) || [];
  if (filasMedidas.length === 0) {
    shMedidas.appendRow([idInforme, truncar((datos.medidas || {}).bulto, 200), '', '']);
  } else {
    filasMedidas.forEach((m) => shMedidas.appendRow([idInforme, truncar((datos.medidas || {}).bulto, 200), truncar(m.etiqueta, 200), truncar(m.medida, 200)]));
  }

  const shFotos = hoja('Reportes_Fotos', ['ID informe', 'Categoría', 'URL foto']);
  Object.keys(datos.fotos || {}).forEach((categoria) => {
    limpiarListaFotos(datos.fotos[categoria]).forEach((f, i) => {
      const url = guardarFoto(f, subcarpeta, categoria + '_' + (i + 1));
      if (url) shFotos.appendRow([idInforme, categoria, url]);
    });
  });
}

// Convierte un data URL "data:image/png;base64,...." (de la firma) al formato {base64, mime}.
function dataUrlAFoto(dataUrl) {
  if (!dataUrl || dataUrl.indexOf('base64,') === -1) return null;
  const [cabecera, base64] = dataUrl.split('base64,');
  const mime = (cabecera.match(/data:(.*);/) || [, 'image/png'])[1];
  return { base64, mime };
}
