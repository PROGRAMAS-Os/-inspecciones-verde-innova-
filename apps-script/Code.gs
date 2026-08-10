/**
 * Backend de Inspecciones Verde Innova — pieza de generación de Doc/PDF.
 *
 * Desde que los datos y las fotos viven en Supabase, este Apps Script ya NO
 * recibe tráfico del navegador. Su único trabajo es: cuando Supabase inserta
 * una fila nueva en "reportes_generales", generar el Doc/PDF del informe
 * (igual que siempre, con Google Docs) y devolverle a Supabase las URLs.
 *
 * Cómo llega el aviso: un trigger de Supabase (pg_net, ver schema.sql sección
 * 5) hace POST a la URL de este Web App con "?token=<TOKEN_WEBHOOK>" — Apps
 * Script no puede leer headers personalizados en doPost, por eso el token va
 * en la URL en vez de un header.
 *
 * Este script llama de vuelta a Supabase solo a través de dos funciones RPC
 * (webhook_leer_informe / webhook_marcar_documento, ver schema.sql sección 6)
 * que exigen el mismo TOKEN_WEBHOOK como parámetro — así nunca hace falta la
 * service_role key de Supabase acá, solo la clave publicable (segura de
 * incluir en código, igual que en js/app.js).
 *
 * Instalación: ver apps-script/INSTRUCCIONES.md. Hace falta configurar 2
 * Propiedades del script (Configuración del proyecto → Propiedades del
 * script): SUPABASE_URL y TOKEN_WEBHOOK.
 */

const NOMBRE_CARPETA_INFORMES = 'Inspecciones Verde Innova - Fotos';
const MAX_SOLICITUDES_POR_MINUTO = 30;
const SUPABASE_ANON_KEY = 'sb_publishable_8AQTJnknkxhnH5KZpZF8uQ__7KA8tf6';

function doGet(e) {
  return responderJSON({ ok: true, mensaje: 'Backend de inspecciones Verde Innova activo.' });
}

function doPost(e) {
  try {
    if (!respetaLimiteDeUso()) {
      return responderJSON({ ok: false, error: 'Demasiadas solicitudes en poco tiempo, intenta de nuevo en un minuto.' });
    }

    const tokenEsperado = propiedad('TOKEN_WEBHOOK');
    if (!tokenEsperado || (e.parameter && e.parameter.token) !== tokenEsperado) {
      return responderJSON({ ok: false, error: 'No autorizado.' });
    }

    const evento = JSON.parse(e.postData.contents);
    if (evento.table !== 'reportes_generales' || !evento.record || !evento.record.id_informe) {
      return responderJSON({ ok: true, ignorado: true });
    }

    procesarNuevoInforme(evento.record);
    return responderJSON({ ok: true });
  } catch (err) {
    return responderJSON({ ok: false, error: String(err) });
  }
}

function responderJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function propiedad(nombre) {
  return PropertiesService.getScriptProperties().getProperty(nombre);
}

// --- Límite de uso (defensa adicional al token — sigue siendo una URL pública) ---

function respetaLimiteDeUso() {
  const cache = CacheService.getScriptCache();
  const clave = 'rl_' + Math.floor(Date.now() / 60000);
  const actual = Number(cache.get(clave) || '0') + 1;
  cache.put(clave, String(actual), 90);
  return actual <= MAX_SOLICITUDES_POR_MINUTO;
}

// --- Cliente RPC hacia Supabase (con la clave publicable + TOKEN_WEBHOOK como
// autorización propia de estas dos funciones — ver schema.sql sección 6) ---

function supabaseRpc(nombreFuncion, parametros) {
  const respuesta = UrlFetchApp.fetch(propiedad('SUPABASE_URL') + '/rest/v1/rpc/' + nombreFuncion, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(parametros),
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: 'Bearer ' + SUPABASE_ANON_KEY },
    muteHttpExceptions: true,
  });
  const codigo = respuesta.getResponseCode();
  if (codigo >= 300) throw new Error('Supabase RPC ' + nombreFuncion + ' ' + codigo + ': ' + respuesta.getContentText());
  const texto = respuesta.getContentText();
  return texto ? JSON.parse(texto) : null;
}

// Descarga una foto/firma ya subida a Supabase Storage (URL pública) y la
// vuelve a convertir a {base64, mime} para poder insertarla como imagen en
// el Doc — Storage solo guarda la URL, el Doc necesita los bytes.
function descargarComoFoto(url) {
  if (!url) return null;
  try {
    const blob = UrlFetchApp.fetch(url).getBlob();
    return { base64: Utilities.base64Encode(blob.getBytes()), mime: blob.getContentType() };
  } catch (e) {
    return null;
  }
}

// --- Carpeta de Drive donde queda el Doc/PDF final de cada informe ---

function carpetaInformes() {
  const carpetas = DriveApp.getFoldersByName(NOMBRE_CARPETA_INFORMES);
  return carpetas.hasNext() ? carpetas.next() : DriveApp.createFolder(NOMBRE_CARPETA_INFORMES);
}

function subcarpetaPara(nombre) {
  const raiz = carpetaInformes();
  const existentes = raiz.getFoldersByName(nombre);
  return existentes.hasNext() ? existentes.next() : raiz.createFolder(nombre);
}

// --- Trae de Supabase todo lo relacionado a un informe y genera su Doc/PDF ---

function procesarNuevoInforme(registroWebhook) {
  const idInforme = registroWebhook.id_informe;
  const token = propiedad('TOKEN_WEBHOOK');
  const datos = supabaseRpc('webhook_leer_informe', { p_id_informe: idInforme, p_token: token });
  if (!datos) return; // ya no existe o el token no coincide

  const record = datos.record;
  const cajas = datos.cajas || [];
  const anomaliasFilas = datos.anomalias || [];
  const medidasFilas = datos.medidas || [];
  const fotosFilas = datos.fotos || [];

  const g = {
    inspector: record.inspector, fecha: record.fecha_inspeccion, ubicacion: record.ubicacion, cliente: record.cliente,
    referencia: record.referencia, consignatario: record.consignatario, tipoProducto: record.tipo_producto,
    cantidadTotal: record.cantidad_total, cajasSeleccionadas: record.cajas_seleccionadas, contenedorSello: record.contenedor_sello,
  };
  const mu = { base: record.muestreo_base, porcentaje: record.muestreo_porcentaje, estandar: record.estandar, metodo: record.metodo_seleccion, notas: record.notas_muestreo };
  const ha = { integridad: record.integridad_embalaje, dano: record.dano_defecto, cantidad: record.consistencia_cantidad, manipulacion: record.manipulacion_contaminacion, evidenciaFoto: record.evidencia_fotografica };
  const co = { resumen: record.resumen_hallazgos, recomendacion: record.recomendacion, decision: record.decision, medidasAdicionales: record.medidas_adicionales };
  const ap = { inspectorNombre: record.inspector_nombre, inspectorFecha: record.inspector_fecha, clienteNombre: record.cliente_rep_nombre, clienteFecha: record.cliente_rep_fecha };

  const cajasMapeadas = cajas.map((c) => ({
    numero: c.numero, condicionExterna: c.condicion_externa, etiquetado: c.etiquetado, sellado: c.sellado,
    calidadCaja: c.calidad_caja, condicionUnidad: c.condicion_unidad, observaciones: c.observaciones,
  }));
  const anomaliasMapeadas = anomaliasFilas.map((a) => ({ descripcion: a.descripcion, enlaces: a.fotos }));
  const filasMedidas = medidasFilas
    .filter((m) => m.talla_referencia || m.medida)
    .map((m) => ({ etiqueta: m.talla_referencia, medida: m.medida }));
  const bultoMedida = (medidasFilas[0] && medidasFilas[0].medida_bulto) || '';

  const fotosPorCategoria = {};
  fotosFilas.forEach((f) => {
    if (!fotosPorCategoria[f.categoria]) fotosPorCategoria[f.categoria] = [];
    fotosPorCategoria[f.categoria].push(f.url_foto);
  });

  const documento = generarDocumentoInforme({
    idInforme, g, mu, ha, co, ap,
    cajas: cajasMapeadas, anomalias: anomaliasMapeadas,
    bultoMedida, filasMedidas, fotosPorCategoria,
    categoriasFotoEtiquetas: record.categorias_fotos_etiquetas || {},
    firmaInspectorFoto: descargarComoFoto(record.inspector_firma),
    firmaClienteFoto: descargarComoFoto(record.cliente_rep_firma),
    subcarpeta: subcarpetaPara(idInforme),
    idioma: record.idioma === 'en' ? 'en' : 'es',
  });

  supabaseRpc('webhook_marcar_documento', {
    p_id_informe: idInforme, p_token: token, p_doc: documento.docUrl, p_pdf: documento.pdfUrl,
  });
}

// --- Documento final del informe (Google Doc + PDF) ---
// El idioma del documento (d.idioma: 'es' | 'en') solo traduce las
// etiquetas/encabezados fijos; el texto libre que escribió el inspector
// (resúmenes, observaciones, etc.) viaja tal cual lo redactó.

const TEXTOS_INFORME = {
  es: {
    tituloDoc: 'Informe de Inspección de Producto', tituloArchivo: 'Informe de Inspección - ',
    seccion1: 'Sección 1: Información general',
    campoInspector: 'Inspector', campoFechaInspeccion: 'Fecha de inspección', campoUbicacion: 'Ubicación',
    campoCliente: 'Cliente / Director', campoReferencia: 'Referencia / PO', campoConsignatario: 'Consignatario / Comprador',
    campoTipoProducto: 'Tipo de producto', campoCantidadTotal: 'Cantidad total del envío',
    campoCajasSeleccionadas: 'Cajas seleccionadas para inspección', campoContenedorSello: 'Número de contenedor/sello',
    seccion2: 'Sección 2: Detalles de inspección de caja',
    colCajaNo: 'Caja No.', colCondExterna: 'Cond. externa', colEtiquetado: 'Etiquetado', colSellado: 'Sellado',
    colCalidadCaja: 'Calidad caja', colCondUnidad: 'Cond. unidad', colObservaciones: 'Observaciones',
    sinCajas: '(Sin cajas registradas.)',
    seccion3: 'Sección 3: Método de muestreo',
    campoBaseMuestreo: 'Base de muestreo', campoPorcentajeMuestreo: 'Porcentaje de muestreo', campoEstandar: 'Estándar seguido',
    campoMetodo: 'Método de selección', campoNotas: 'Notas',
    seccion4: 'Sección 4: Hallazgos y observaciones',
    campoIntegridad: 'Integridad general del embalaje', campoDano: 'Presencia de daño o defecto',
    campoConsistenciaCantidad: 'Consistencia de cantidad', campoManipulacion: 'Señales de manipulación/contaminación',
    campoEvidenciaFoto: '¿Se tomó evidencia fotográfica?',
    seccion5: 'Sección 5: Conclusión y recomendaciones',
    campoResumen: 'Resumen de hallazgos', campoRecomendacion: 'Recomendación', campoDecision: 'Decisión',
    campoMedidasAdicionales: 'Medidas adicionales recomendadas',
    decision: { aceptado: 'Envío aceptado', parcial: 'Aceptación parcial', rechazado: 'Envío rechazado' },
    evidenciaFotografica: 'Evidencia fotográfica', sinFotos: '(Sin fotos adjuntas.)', foto: 'Foto',
    anomaliasDetectadas: 'Anomalías detectadas', sinDescripcion: '(sin descripción)', fotosPrefijo: '   Fotos: ', sinAnomalias: '(Sin anomalías registradas.)',
    medidas: 'Medidas', medidaDelBulto: 'Medida del bulto: ', colTallaReferencia: 'Talla/referencia', colMedida: 'Medida',
    seccion6: 'Sección 6: Aprobación', inspector: 'Inspector', representanteCliente: 'Representante del cliente',
    nombre: 'Nombre: ', fecha: 'Fecha: ', sinFirma: '(Sin firma.)', errorFirma: '(No se pudo insertar la firma.)',
  },
  en: {
    tituloDoc: 'Product Inspection Report', tituloArchivo: 'Inspection Report - ',
    seccion1: 'Section 1: General Information',
    campoInspector: 'Inspector', campoFechaInspeccion: 'Inspection date', campoUbicacion: 'Location',
    campoCliente: 'Client / Director', campoReferencia: 'Reference / PO', campoConsignatario: 'Consignee / Buyer',
    campoTipoProducto: 'Product type', campoCantidadTotal: 'Total shipment quantity',
    campoCajasSeleccionadas: 'Boxes selected for inspection', campoContenedorSello: 'Container/seal number',
    seccion2: 'Section 2: Box Inspection Details',
    colCajaNo: 'Box No.', colCondExterna: 'Ext. condition', colEtiquetado: 'Labeling', colSellado: 'Sealing',
    colCalidadCaja: 'Box quality', colCondUnidad: 'Unit condition', colObservaciones: 'Observations',
    sinCajas: '(No boxes recorded.)',
    seccion3: 'Section 3: Sampling Method',
    campoBaseMuestreo: 'Sampling base', campoPorcentajeMuestreo: 'Sampling percentage', campoEstandar: 'Standard followed',
    campoMetodo: 'Selection method', campoNotas: 'Notes',
    seccion4: 'Section 4: Findings and Observations',
    campoIntegridad: 'Overall packaging integrity', campoDano: 'Presence of damage or defect',
    campoConsistenciaCantidad: 'Quantity consistency', campoManipulacion: 'Signs of tampering/contamination',
    campoEvidenciaFoto: 'Was photo evidence taken?',
    seccion5: 'Section 5: Conclusion and Recommendations',
    campoResumen: 'Summary of findings', campoRecomendacion: 'Recommendation', campoDecision: 'Decision',
    campoMedidasAdicionales: 'Additional recommended measures',
    decision: { aceptado: 'Shipment accepted', parcial: 'Partial acceptance', rechazado: 'Shipment rejected' },
    evidenciaFotografica: 'Photo evidence', sinFotos: '(No photos attached.)', foto: 'Photo',
    anomaliasDetectadas: 'Anomalies detected', sinDescripcion: '(no description)', fotosPrefijo: '   Photos: ', sinAnomalias: '(No anomalies recorded.)',
    medidas: 'Measurements', medidaDelBulto: 'Package measurement: ', colTallaReferencia: 'Size/reference', colMedida: 'Measurement',
    seccion6: 'Section 6: Approval', inspector: 'Inspector', representanteCliente: 'Client representative',
    nombre: 'Name: ', fecha: 'Date: ', sinFirma: '(No signature.)', errorFirma: '(Could not insert the signature.)',
  },
};

function generarDocumentoInforme(d) {
  const t = TEXTOS_INFORME[d.idioma === 'en' ? 'en' : 'es'];
  const doc = DocumentApp.create(t.tituloArchivo + d.idInforme);
  const body = doc.getBody();
  body.setMarginTop(36).setMarginBottom(36);

  body.appendParagraph(t.tituloDoc).setHeading(DocumentApp.ParagraphHeading.TITLE);
  body.appendParagraph(`${d.g.cliente || ''}${d.g.referencia ? ' · ' + d.g.referencia : ''}`).setHeading(DocumentApp.ParagraphHeading.SUBTITLE);

  agregarSeccion(body, t.seccion1, [
    [t.campoInspector, d.g.inspector], [t.campoFechaInspeccion, d.g.fecha], [t.campoUbicacion, d.g.ubicacion],
    [t.campoCliente, d.g.cliente], [t.campoReferencia, d.g.referencia], [t.campoConsignatario, d.g.consignatario],
    [t.campoTipoProducto, d.g.tipoProducto], [t.campoCantidadTotal, d.g.cantidadTotal],
    [t.campoCajasSeleccionadas, d.g.cajasSeleccionadas], [t.campoContenedorSello, d.g.contenedorSello],
  ]);

  body.appendParagraph(t.seccion2).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (d.cajas.length) {
    const encabezados = [t.colCajaNo, t.colCondExterna, t.colEtiquetado, t.colSellado, t.colCalidadCaja, t.colCondUnidad, t.colObservaciones];
    const filas = d.cajas.map((c) => [c.numero, c.condicionExterna, c.etiquetado, c.sellado, c.calidadCaja, c.condicionUnidad, c.observaciones]);
    const tabla = body.appendTable([encabezados].concat(filas));
    formatearTabla(tabla);
  } else {
    body.appendParagraph(t.sinCajas);
  }

  agregarSeccion(body, t.seccion3, [
    [t.campoBaseMuestreo, d.mu.base], [t.campoPorcentajeMuestreo, d.mu.porcentaje], [t.campoEstandar, d.mu.estandar],
    [t.campoMetodo, d.mu.metodo], [t.campoNotas, d.mu.notas],
  ]);

  agregarSeccion(body, t.seccion4, [
    [t.campoIntegridad, d.ha.integridad], [t.campoDano, d.ha.dano],
    [t.campoConsistenciaCantidad, d.ha.cantidad], [t.campoManipulacion, d.ha.manipulacion],
    [t.campoEvidenciaFoto, d.ha.evidenciaFoto],
  ]);

  agregarSeccion(body, t.seccion5, [
    [t.campoResumen, d.co.resumen], [t.campoRecomendacion, d.co.recomendacion],
    [t.campoDecision, t.decision[d.co.decision] || d.co.decision], [t.campoMedidasAdicionales, d.co.medidasAdicionales],
  ]);

  body.appendParagraph(t.evidenciaFotografica).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  const categoriasConFotos = Object.keys(d.fotosPorCategoria).filter((c) => d.fotosPorCategoria[c].length);
  if (categoriasConFotos.length) {
    categoriasConFotos.forEach((cat) => {
      const etiqueta = (d.categoriasFotoEtiquetas && d.categoriasFotoEtiquetas[cat]) || cat;
      const p = body.appendParagraph(etiqueta + ':');
      p.editAsText().setBold(true);
      d.fotosPorCategoria[cat].forEach((url, i) => {
        const enlace = body.appendParagraph(`  ${t.foto} ${i + 1}`);
        enlace.editAsText().setLinkUrl(url);
      });
    });
  } else {
    body.appendParagraph(t.sinFotos);
  }

  body.appendParagraph(t.anomaliasDetectadas).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (d.anomalias.length) {
    d.anomalias.forEach((a, i) => {
      const p = body.appendParagraph(`${i + 1}. ${a.descripcion || t.sinDescripcion}`);
      if (a.enlaces) {
        const enlacePar = body.appendParagraph(t.fotosPrefijo + a.enlaces);
      }
    });
  } else {
    body.appendParagraph(t.sinAnomalias);
  }

  body.appendParagraph(t.medidas).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  if (d.bultoMedida) body.appendParagraph(t.medidaDelBulto + d.bultoMedida);
  if (d.filasMedidas.length) {
    const tabla = body.appendTable([[t.colTallaReferencia, t.colMedida]].concat(d.filasMedidas.map((m) => [m.etiqueta || '', m.medida || ''])));
    formatearTabla(tabla);
  }

  body.appendParagraph(t.seccion6).setHeading(DocumentApp.ParagraphHeading.HEADING2);
  agregarFirma(body, t.inspector, d.ap.inspectorNombre, d.ap.inspectorFecha, d.firmaInspectorFoto, t);
  agregarFirma(body, t.representanteCliente, d.ap.clienteNombre, d.ap.clienteFecha, d.firmaClienteFoto, t);

  doc.saveAndClose();

  const archivoDoc = DriveApp.getFileById(doc.getId());
  d.subcarpeta.addFile(archivoDoc);
  DriveApp.getRootFolder().removeFile(archivoDoc);
  archivoDoc.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  const pdfBlob = archivoDoc.getAs('application/pdf');
  const pdfFile = d.subcarpeta.createFile(pdfBlob).setName(t.tituloArchivo + d.idInforme + '.pdf');
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

function agregarFirma(body, rol, nombre, fecha, fotoFirma, t) {
  body.appendParagraph(rol).setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendParagraph(t.nombre + (nombre || '—'));
  body.appendParagraph(t.fecha + (fecha || '—'));
  if (fotoFirma && fotoFirma.base64) {
    try {
      const bytes = Utilities.base64Decode(fotoFirma.base64);
      const blob = Utilities.newBlob(bytes, fotoFirma.mime || 'image/png', 'firma.png');
      const img = body.appendImage(blob);
      img.setWidth(180).setHeight(80);
    } catch (e) {
      body.appendParagraph(t.errorFirma);
    }
  } else {
    body.appendParagraph(t.sinFirma);
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
