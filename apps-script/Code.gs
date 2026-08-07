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

    if (datos.tipo === 'foto') {
      const url = guardarFotoSuelta(datos);
      return responderJSON({ ok: true, url: url });
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
  if (!foto) return null;
  if (typeof foto.url === 'string' && foto.url) return foto; // ya se subió individualmente antes del envío
  if (typeof foto.base64 !== 'string' || !foto.base64) return null;
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
// Si la foto ya viene como {url} (se subió individualmente antes del envío
// principal), simplemente devuelve esa URL sin volver a subir nada.
function guardarFoto(foto, subcarpeta, nombreArchivo) {
  const limpia = limpiarFoto(foto);
  if (!limpia) return '';
  if (limpia.url) return limpia.url;
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

// --- Subida individual de una foto (antes del envío principal de datos) ---

function guardarFotoSuelta(datos) {
  const carpeta = subcarpetaPara(truncar(datos.carpeta, 80) || 'sin_carpeta');
  const nombre = (truncar(datos.etiqueta, 60) || 'foto') + '_' + Date.now();
  const url = guardarFoto(datos.foto, carpeta, nombre);
  if (!url) throw new Error('No se pudo guardar la foto (formato o tamaño inválido).');
  return url;
}

// --- Checklist por SKU ---

function guardarChecklistSku(datos) {
  const sh = hoja('Checklist_SKU', [
    'ID envío', 'Fecha envío', 'Cliente', 'Referencia', 'Fecha inspección', 'Inspector',
    'Estilo', 'Descripción', 'Color', 'País origen', 'Cantidad',
    'Sección', 'Ítem', 'Estado', 'Comentario', 'Fotos',
  ]);
  const idInspeccion = datos.idEnvio || `${truncar(datos.sku.estilo, 60) || 'sku'}_${new Date(datos.enviado).getTime()}`;
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
  const idInforme = datos.idEnvio || `${truncar(g.cliente, 60) || 'informe'}_${new Date(datos.enviado).getTime()}`;
  const subcarpeta = subcarpetaPara(idInforme);

  const firmaInspectorFoto = dataUrlAFoto(ap.inspectorFirma);
  const firmaClienteFoto = dataUrlAFoto(ap.clienteFirma);
  const firmaInspectorUrl = guardarFoto(firmaInspectorFoto, subcarpeta, 'firma_inspector');
  const firmaClienteUrl = guardarFoto(firmaClienteFoto, subcarpeta, 'firma_cliente');

  const shCajas = hoja('Reportes_Cajas', ['ID informe', 'Caja No.', 'Condición externa', 'Etiquetado', 'Sellado', 'Calidad caja', 'Condición unidad', 'Observaciones']);
  const cajasLimpias = (datos.cajas || []).map((c) => ({
    numero: truncar(c.numero, 100), condicionExterna: truncar(c.condicionExterna, 200), etiquetado: truncar(c.etiquetado, 50),
    sellado: truncar(c.sellado, 100), calidadCaja: truncar(c.calidadCaja, 200), condicionUnidad: truncar(c.condicionUnidad, 200), observaciones: truncar(c.observaciones, MAX_LARGO_TEXTO),
  }));
  cajasLimpias.forEach((c) => {
    shCajas.appendRow([idInforme, c.numero, c.condicionExterna, c.etiquetado, c.sellado, c.calidadCaja, c.condicionUnidad, c.observaciones]);
  });

  const shAnomalias = hoja('Reportes_Anomalias', ['ID informe', 'Descripción', 'Fotos']);
  const anomaliasConEnlaces = (datos.anomalias || []).map((a, i) => {
    const enlaces = guardarFotos(a.fotos, subcarpeta, 'anomalia' + i);
    return { descripcion: truncar(a.descripcion, MAX_LARGO_TEXTO), enlaces };
  });
  anomaliasConEnlaces.forEach((a) => shAnomalias.appendRow([idInforme, a.descripcion, a.enlaces]));

  const shMedidas = hoja('Reportes_Medidas', ['ID informe', 'Medida del bulto', 'Talla/referencia', 'Medida']);
  const filasMedidas = (datos.medidas && datos.medidas.filas) || [];
  if (filasMedidas.length === 0) {
    shMedidas.appendRow([idInforme, truncar((datos.medidas || {}).bulto, 200), '', '']);
  } else {
    filasMedidas.forEach((m) => shMedidas.appendRow([idInforme, truncar((datos.medidas || {}).bulto, 200), truncar(m.etiqueta, 200), truncar(m.medida, 200)]));
  }

  const shFotos = hoja('Reportes_Fotos', ['ID informe', 'Categoría', 'URL foto']);
  const fotosPorCategoria = {};
  Object.keys(datos.fotos || {}).forEach((categoria) => {
    const urls = limpiarListaFotos(datos.fotos[categoria]).map((f, i) => guardarFoto(f, subcarpeta, categoria + '_' + (i + 1))).filter(Boolean);
    fotosPorCategoria[categoria] = urls;
    urls.forEach((url) => shFotos.appendRow([idInforme, categoria, url]));
  });

  let docUrl = '', pdfUrl = '';
  try {
    const documento = generarDocumentoInforme({
      idInforme, g, mu, ha, co, ap, cajas: cajasLimpias, anomalias: anomaliasConEnlaces,
      bultoMedida: truncar((datos.medidas || {}).bulto, 200), filasMedidas,
      fotosPorCategoria, categoriasFotoEtiquetas: datos.categoriasFotoEtiquetas || {},
      firmaInspectorFoto, firmaClienteFoto, subcarpeta,
    });
    docUrl = documento.docUrl;
    pdfUrl = documento.pdfUrl;
  } catch (err) {
    // Si falla la generación del documento no se pierde el resto del informe
    // (los datos ya quedaron guardados en las hojas de cálculo de arriba).
    docUrl = 'ERROR: ' + String(err);
  }

  const shPrincipal = hoja('Reportes_Generales', [
    'ID informe', 'ID envío', 'Fecha envío', 'Inspector', 'Fecha inspección', 'Ubicación', 'Cliente', 'Referencia', 'Consignatario',
    'Tipo producto', 'Cantidad total', 'Cajas seleccionadas', 'Contenedor/Sello',
    'Muestreo base', 'Muestreo %', 'Estándar', 'Método selección', 'Notas muestreo',
    'Integridad embalaje', 'Daño/defecto', 'Consistencia cantidad', 'Manipulación/contaminación', 'Evidencia fotográfica',
    'Resumen hallazgos', 'Recomendación', 'Decisión', 'Medidas adicionales',
    'Inspector nombre', 'Inspector firma', 'Inspector fecha', 'Cliente rep. nombre', 'Cliente rep. firma', 'Cliente rep. fecha',
    'Informe (Doc)', 'Informe (PDF)',
  ]);

  shPrincipal.appendRow([
    idInforme, datos.idEnvio || '', new Date(datos.enviado), truncar(g.inspector, 200), g.fecha, truncar(g.ubicacion, 300), truncar(g.cliente, 200), truncar(g.referencia, 200), truncar(g.consignatario, 200),
    truncar(g.tipoProducto, 200), truncar(g.cantidadTotal, 100), truncar(g.cajasSeleccionadas, 300), truncar(g.contenedorSello, 200),
    truncar(mu.base, 200), truncar(mu.porcentaje, 50), truncar(mu.estandar, 300), truncar(mu.metodo, 300), truncar(mu.notas, MAX_LARGO_TEXTO),
    truncar(ha.integridad, MAX_LARGO_TEXTO), truncar(ha.dano, MAX_LARGO_TEXTO), truncar(ha.cantidad, 500), truncar(ha.manipulacion, 500), truncar(ha.evidenciaFoto, 20),
    truncar(co.resumen, MAX_LARGO_TEXTO), truncar(co.recomendacion, MAX_LARGO_TEXTO), truncar(co.decision, 50), truncar(co.medidasAdicionales, MAX_LARGO_TEXTO),
    truncar(ap.inspectorNombre, 200), firmaInspectorUrl, ap.inspectorFecha, truncar(ap.clienteNombre, 200), firmaClienteUrl, ap.clienteFecha,
    docUrl, pdfUrl,
  ]);
}

// --- Documento final del informe (Google Doc + PDF) ---

const ETIQUETAS_DECISION = { aceptado: 'Envío aceptado', parcial: 'Aceptación parcial', rechazado: 'Envío rechazado' };

function generarDocumentoInforme(d) {
  const doc = DocumentApp.create('Informe de Inspección - ' + d.idInforme);
  const body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36);

  body.appendParagraph('Informe de Inspección de Producto').setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`${d.g.cliente || ''}${d.g.referencia ? ' · ' + d.g.referencia : ''}`).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  agregarSeccion(body, 'Sección 1: Información general', [
    ['Inspector', d.g.inspector], ['Fecha de inspección', d.g.fecha], ['Ubicación', d.g.ubicacion],
    ['Cliente / Director', d.g.cliente], ['Referencia / PO', d.g.referencia], ['Consignatario / Comprador', d.g.consignatario],
    ['Tipo de producto', d.g.tipoProducto], ['Cantidad total del envío', d.g.cantidadTotal],
    ['Cajas seleccionadas para inspección', d.g.cajasSeleccionadas], ['Número de contenedor/sello', d.g.contenedorSello],
  ]);

  body.appendParagraph('Sección 2: Detalles de inspección de caja').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (d.cajas.length) {
    const encabezados = ['Caja No.', 'Cond. externa', 'Etiquetado', 'Sellado', 'Calidad caja', 'Cond. unidad', 'Observaciones'];
    const filas = d.cajas.map((c) => [c.numero, c.condicionExterna, c.etiquetado, c.sellado, c.calidadCaja, c.condicionUnidad, c.observaciones]);
    const tabla = body.appendTable([encabezados].concat(filas));
    formatearTabla(tabla);
  } else {
    body.appendParagraph('(Sin cajas registradas.)');
  }

  agregarSeccion(body, 'Sección 3: Método de muestreo', [
    ['Base de muestreo', d.mu.base], ['Porcentaje de muestreo', d.mu.porcentaje], ['Estándar seguido', d.mu.estandar],
    ['Método de selección', d.mu.metodo], ['Notas', d.mu.notas],
  ]);

  agregarSeccion(body, 'Sección 4: Hallazgos y observaciones', [
    ['Integridad general del embalaje', d.ha.integridad], ['Presencia de daño o defecto', d.ha.dano],
    ['Consistencia de cantidad', d.ha.cantidad], ['Señales de manipulación/contaminación', d.ha.manipulacion],
    ['¿Se tomó evidencia fotográfica?', d.ha.evidenciaFoto],
  ]);

  agregarSeccion(body, 'Sección 5: Conclusión y recomendaciones', [
    ['Resumen de hallazgos', d.co.resumen], ['Recomendación', d.co.recomendacion],
    ['Decisión', ETIQUETAS_DECISION[d.co.decision] || d.co.decision], ['Medidas adicionales recomendadas', d.co.medidasAdicionales],
  ]);

  body.appendParagraph('Evidencia fotográfica').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const categoriasConFotos = Object.keys(d.fotosPorCategoria).filter((c) => d.fotosPorCategoria[c].length);
  if (categoriasConFotos.length) {
    categoriasConFotos.forEach((cat) => {
      const etiqueta = (d.categoriasFotoEtiquetas && d.categoriasFotoEtiquetas[cat]) || cat;
      const p = body.appendParagraph(etiqueta + ':');
      p.editAsText().setBold(true);
      d.fotosPorCategoria[cat].forEach((url, i) => {
        const enlace = body.appendParagraph(`  Foto ${i + 1}`);
        enlace.editAsText().setLinkUrl(url);
      });
    });
  } else {
    body.appendParagraph('(Sin fotos adjuntas.)');
  }

  body.appendParagraph('Anomalías detectadas').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (d.anomalias.length) {
    d.anomalias.forEach((a, i) => {
      const p = body.appendParagraph(`${i + 1}. ${a.descripcion || '(sin descripción)'}`);
      if (a.enlaces) {
        const enlacePar = body.appendParagraph('   Fotos: ' + a.enlaces);
      }
    });
  } else {
    body.appendParagraph('(Sin anomalías registradas.)');
  }

  body.appendParagraph('Medidas').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (d.bultoMedida) body.appendParagraph('Medida del bulto: ' + d.bultoMedida);
  if (d.filasMedidas.length) {
    const tabla = body.appendTable([['Talla/referencia', 'Medida']].concat(d.filasMedidas.map((m) => [m.etiqueta || '', m.medida || ''])));
    formatearTabla(tabla);
  }

  body.appendParagraph('Sección 6: Aprobación').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  agregarFirma(body, 'Inspector', d.ap.inspectorNombre, d.ap.inspectorFecha, d.firmaInspectorFoto);
  agregarFirma(body, 'Representante del cliente', d.ap.clienteNombre, d.ap.clienteFecha, d.firmaClienteFoto);

  doc.saveAndClose();

  const archivoDoc = DriveApp.getFileById(doc.getId());
  d.subcarpeta.addFile(archivoDoc);
  DriveApp.getRootFolder().removeFile(archivoDoc);
  archivoDoc.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const pdfBlob = archivoDoc.getAs('application/pdf');
  const pdfFile = d.subcarpeta.createFile(pdfBlob).setName('Informe de Inspección - ' + d.idInforme + '.pdf');
  pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { docUrl: archivoDoc.getUrl(), pdfUrl: pdfFile.getUrl() };
}

function agregarSeccion(body, titulo, pares) {
  body.appendParagraph(titulo).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  pares.forEach(([etiqueta, valor]) => {
    const p = body.appendParagraph(etiqueta + ': ');
    p.editAsText().setBold(0, etiqueta.length - 1, true);
    p.appendText(valor || '—');
  });
}

function agregarFirma(body, rol, nombre, fecha, fotoFirma) {
  body.appendParagraph(rol).setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendParagraph('Nombre: ' + (nombre || '—'));
  body.appendParagraph('Fecha: ' + (fecha || '—'));
  if (fotoFirma && fotoFirma.base64) {
    try {
      const bytes = Utilities.base64Decode(fotoFirma.base64);
      const blob = Utilities.newBlob(bytes, fotoFirma.mime || 'image/png', 'firma.png');
      const img = body.appendImage(blob);
      img.setWidth(180).setHeight(80);
    } catch (e) {
      body.appendParagraph('(No se pudo insertar la firma.)');
    }
  } else {
    body.appendParagraph('(Sin firma.)');
  }
}

function formatearTabla(tabla) {
  const filas = tabla.getNumRows();
  if (filas === 0) return;
  const encabezado = tabla.getRow(0);
  for (let c = 0; c < encabezado.getNumCells(); c++) {
    encabezado.getCell(c).editAsText().setBold(true);
  }
}

// Convierte un data URL "data:image/png;base64,...." (de la firma) al formato {base64, mime}.
function dataUrlAFoto(dataUrl) {
  if (!dataUrl || dataUrl.indexOf('base64,') === -1) return null;
  const [cabecera, base64] = dataUrl.split('base64,');
  const mime = (cabecera.match(/data:(.*);/) || [, 'image/png'])[1];
  return { base64, mime };
}
