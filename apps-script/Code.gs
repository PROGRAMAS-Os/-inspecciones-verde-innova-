/**
 * Backend de Inspecciones Verde Innova.
 * Recibe los envíos de la app web (checklist por SKU e informes generales),
 * guarda las fotos en Drive y agrega una fila por registro en el Google Sheet
 * al que está vinculado este script.
 *
 * Instalación: ver apps-script/INSTRUCCIONES.md
 */

const NOMBRE_CARPETA_FOTOS = 'Inspecciones Verde Innova - Fotos';

function doGet(e) {
  return responderJSON({ ok: true, mensaje: 'Backend de inspecciones Verde Innova activo.' });
}

function doPost(e) {
  try {
    const datos = JSON.parse(e.postData.contents);

    if (datos.tipo === 'ping') {
      return responderJSON({ ok: true, mensaje: 'pong' });
    }
    if (datos.tipo === 'checklist_sku') {
      guardarChecklistSku(datos);
      return responderJSON({ ok: true });
    }
    if (datos.tipo === 'reporte_general') {
      guardarReporteGeneral(datos);
      return responderJSON({ ok: true });
    }
    return responderJSON({ ok: false, error: 'Tipo de envío no reconocido: ' + datos.tipo });
  } catch (err) {
    return responderJSON({ ok: false, error: String(err) });
  }
}

function responderJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
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
  if (!foto || !foto.base64) return '';
  const bytes = Utilities.base64Decode(foto.base64);
  const blob = Utilities.newBlob(bytes, foto.mime || 'image/jpeg', nombreArchivo + '.jpg');
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
  if (!fotos || !fotos.length) return '';
  return fotos.map((f, i) => guardarFoto(f, subcarpeta, prefijo + '_' + (i + 1))).filter(Boolean).join(', ');
}

// --- Checklist por SKU ---

function guardarChecklistSku(datos) {
  const sh = hoja('Checklist_SKU', [
    'Fecha envío', 'Cliente', 'Referencia', 'Fecha inspección', 'Inspector',
    'Estilo', 'Descripción', 'Color', 'País origen', 'Cantidad',
    'Sección', 'Ítem', 'Estado', 'Comentario', 'Fotos',
  ]);
  const idInspeccion = `${datos.sku.estilo || 'sku'}_${new Date(datos.enviado).getTime()}`;
  const subcarpeta = subcarpetaPara(idInspeccion);

  (datos.respuestas || []).forEach((r, i) => {
    const enlacesFotos = guardarFotos(r.fotos, subcarpeta, 'item' + i);
    sh.appendRow([
      new Date(datos.enviado), datos.embarque.cliente, datos.embarque.referencia, datos.embarque.fecha, datos.embarque.inspector,
      datos.sku.estilo, datos.sku.descripcion, datos.sku.color, datos.sku.paisOrigen, datos.sku.cantidad,
      r.seccion, r.item, r.estado, r.comentario, enlacesFotos,
    ]);
  });
}

// --- Informe general ---

function guardarReporteGeneral(datos) {
  const g = datos.general || {}, mu = datos.muestreo || {}, ha = datos.hallazgos || {}, co = datos.conclusion || {}, ap = datos.aprobacion || {};
  const idInforme = `${g.cliente || 'informe'}_${new Date(datos.enviado).getTime()}`;
  const subcarpeta = subcarpetaPara(idInforme);

  const shPrincipal = hoja('Reportes_Generales', [
    'ID informe', 'Fecha envío', 'Inspector', 'Fecha inspección', 'Ubicación', 'Cliente', 'Consignatario',
    'Tipo producto', 'Cantidad total', 'Cajas seleccionadas', 'Contenedor/Sello',
    'Muestreo base', 'Muestreo %', 'Estándar', 'Método selección', 'Notas muestreo',
    'Integridad embalaje', 'Daño/defecto', 'Consistencia cantidad', 'Manipulación/contaminación', 'Evidencia fotográfica',
    'Resumen hallazgos', 'Recomendación', 'Decisión', 'Medidas adicionales',
    'Inspector nombre', 'Inspector firma', 'Inspector fecha', 'Cliente rep. nombre', 'Cliente rep. firma', 'Cliente rep. fecha',
  ]);

  const firmaInspectorUrl = guardarFoto(dataUrlAFoto(ap.inspectorFirma), subcarpeta, 'firma_inspector');
  const firmaClienteUrl = guardarFoto(dataUrlAFoto(ap.clienteFirma), subcarpeta, 'firma_cliente');

  shPrincipal.appendRow([
    idInforme, new Date(datos.enviado), g.inspector, g.fecha, g.ubicacion, g.cliente, g.consignatario,
    g.tipoProducto, g.cantidadTotal, g.cajasSeleccionadas, g.contenedorSello,
    mu.base, mu.porcentaje, mu.estandar, mu.metodo, mu.notas,
    ha.integridad, ha.dano, ha.cantidad, ha.manipulacion, ha.evidenciaFoto,
    co.resumen, co.recomendacion, co.decision, co.medidasAdicionales,
    ap.inspectorNombre, firmaInspectorUrl, ap.inspectorFecha, ap.clienteNombre, firmaClienteUrl, ap.clienteFecha,
  ]);

  const shCajas = hoja('Reportes_Cajas', ['ID informe', 'Caja No.', 'Condición externa', 'Etiquetado', 'Sellado', 'Calidad caja', 'Condición unidad', 'Observaciones']);
  (datos.cajas || []).forEach((c) => {
    shCajas.appendRow([idInforme, c.numero, c.condicionExterna, c.etiquetado, c.sellado, c.calidadCaja, c.condicionUnidad, c.observaciones]);
  });

  const shAnomalias = hoja('Reportes_Anomalias', ['ID informe', 'Descripción', 'Fotos']);
  (datos.anomalias || []).forEach((a, i) => {
    const enlaces = guardarFotos(a.fotos, subcarpeta, 'anomalia' + i);
    shAnomalias.appendRow([idInforme, a.descripcion, enlaces]);
  });

  const shMedidas = hoja('Reportes_Medidas', ['ID informe', 'Medida del bulto', 'Talla/referencia', 'Medida']);
  const filasMedidas = (datos.medidas && datos.medidas.filas) || [];
  if (filasMedidas.length === 0) {
    shMedidas.appendRow([idInforme, (datos.medidas || {}).bulto, '', '']);
  } else {
    filasMedidas.forEach((m) => shMedidas.appendRow([idInforme, (datos.medidas || {}).bulto, m.etiqueta, m.medida]));
  }

  const shFotos = hoja('Reportes_Fotos', ['ID informe', 'Categoría', 'URL foto']);
  Object.keys(datos.fotos || {}).forEach((categoria) => {
    (datos.fotos[categoria] || []).forEach((f, i) => {
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
