// Checklist de calzado por SKU — basado en "Apparel Inspection Sheet.xlsx"

const CLAVE_PLANTILLA = 'vi_plantilla_checklist';
const CLAVE_EMBARQUE_ACTUAL = 'vi_embarque_checklist_actual';

const PLANTILLA_POR_DEFECTO = {
  secciones: [
    {
      id: 'sec_etiquetas',
      titulo: 'Etiquetas colgantes / Empaque',
      items: [
        { id: 'it_bolsa', texto: 'En bolsa de polietileno' },
        { id: 'it_upc', texto: 'Coincidencia de UPC / código de barras' },
        { id: 'it_estilo', texto: 'Número de estilo coincidente' },
        { id: 'it_etiquetas', texto: 'Pegatinas / etiquetas coincidentes' },
        { id: 'it_precio', texto: 'Precio de venta sugerido correcto' },
      ],
    },
    {
      id: 'sec_zapato',
      titulo: 'Inspección del zapato',
      items: [
        { id: 'it_ortografia', texto: 'Verborrea / ortografía correcta' },
        { id: 'it_color', texto: 'Coincidencia de color' },
        { id: 'it_fuente', texto: 'Coincidencia de fuente' },
        { id: 'it_talla', texto: 'Coincidencia de tamaño' },
        { id: 'it_logo', texto: 'Logo, diseño e íconos correctos' },
        { id: 'it_cosida', texto: 'Etiqueta cosida / prensada en la prenda' },
        { id: 'it_costura', texto: 'Costura ordenada, limpia y uniforme' },
        { id: 'it_intacta', texto: 'Información de etiqueta intacta' },
        { id: 'it_legible', texto: 'Información de etiqueta legible' },
        { id: 'it_costura_etq', texto: 'Coincidencia de costura de etiquetas' },
      ],
    },
    {
      id: 'sec_cajeta',
      titulo: 'Cajeta (caja del zapato)',
      items: [
        { id: 'it_cuidado', texto: 'Instrucciones de cuidado presentes' },
        { id: 'it_qr', texto: 'Código QR presente y funcional' },
        { id: 'it_serie', texto: 'Número de serie presente' },
      ],
    },
  ],
};

function obtenerPlantilla() {
  return leerJSON(CLAVE_PLANTILLA, JSON.parse(JSON.stringify(PLANTILLA_POR_DEFECTO)));
}
function guardarPlantilla(p) { guardarJSON(CLAVE_PLANTILLA, p); }

function todosLosItems(plantilla) {
  return plantilla.secciones.flatMap((s) => s.items.map((i) => ({ ...i, seccion: s.titulo })));
}

function embarqueVacio() {
  return {
    id: generarId('emb'),
    cliente: '', referencia: '', fecha: new Date().toISOString().slice(0, 10), inspector: '',
    skus: [],
  };
}

function obtenerEmbarque() { return leerJSON(CLAVE_EMBARQUE_ACTUAL, embarqueVacio()); }
function guardarEmbarque(e) { guardarJSON(CLAVE_EMBARQUE_ACTUAL, e); }

let embarque = obtenerEmbarque();
let skuAbiertoId = null;

const $ = (id) => document.getElementById(id);

// --- Encabezado del embarque ---

function cargarCamposEmbarque() {
  const cfg = obtenerConfig();
  if (!embarque.inspector) embarque.inspector = cfg.inspectorDefault || '';
  if (!embarque.cliente) embarque.cliente = cfg.clienteDefault || '';
  $('cliente').value = embarque.cliente;
  $('referencia').value = embarque.referencia;
  $('fecha').value = embarque.fecha;
  $('inspector').value = embarque.inspector;
}

['cliente', 'referencia', 'fecha', 'inspector'].forEach((campo) => {
  document.addEventListener('DOMContentLoaded', () => {
    $(campo).addEventListener('input', () => {
      embarque[campo] = $(campo).value;
      guardarEmbarque(embarque);
    });
  });
});

// --- SKUs: alta manual ---

function nuevoSku(datos = {}) {
  return {
    id: generarId('sku'),
    estilo: datos.estilo || '', descripcion: datos.descripcion || '', color: datos.color || '',
    paisOrigen: datos.paisOrigen || '', cantidad: datos.cantidad || '',
    respuestas: {}, estado: 'borrador', enviadoEn: null,
  };
}

$('btnAgregarSku').addEventListener('click', () => {
  embarque.skus.push(nuevoSku());
  guardarEmbarque(embarque);
  renderListaSku();
  skuAbiertoId = embarque.skus[embarque.skus.length - 1].id;
  renderDetalleSku();
});

// --- Importar packing list pegado ---

$('btnImportar').addEventListener('click', () => $('panelImportar').classList.toggle('oculto'));

function parsearPegado(texto) {
  const lineas = texto.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
  return lineas.map((l) => l.split('\t').map((c) => c.trim()));
}

function pareceEncabezado(fila) {
  const claves = ['estilo', 'sku', 'descripcion', 'descripción', 'color', 'pais', 'país', 'origen', 'cantidad', 'talla', 'colorway', 'style'];
  return fila.some((c) => claves.includes(c.toLowerCase()));
}

const CAMPOS_DESTINO = [
  { clave: 'estilo', etiqueta: 'Estilo / SKU' },
  { clave: 'descripcion', etiqueta: 'Descripción' },
  { clave: 'color', etiqueta: 'Color' },
  { clave: 'paisOrigen', etiqueta: 'País de origen' },
  { clave: 'cantidad', etiqueta: 'Cantidad' },
  { clave: 'ignorar', etiqueta: '(ignorar columna)' },
];

function adivinarMapeo(encabezados) {
  return encabezados.map((h) => {
    const t = h.toLowerCase();
    if (/estilo|style|sku|referencia/.test(t)) return 'estilo';
    if (/desc/.test(t)) return 'descripcion';
    if (/color/.test(t)) return 'color';
    if (/pa[ií]s|origen|origin/.test(t)) return 'paisOrigen';
    if (/cant|qty|unidades/.test(t)) return 'cantidad';
    return 'ignorar';
  });
}

$('btnAnalizarImportar').addEventListener('click', () => {
  const filas = parsearPegado($('textoImportar').value);
  if (filas.length === 0) { alert('Pega primero los datos del packing list.'); return; }
  const tieneEncabezado = pareceEncabezado(filas[0]);
  const encabezados = tieneEncabezado ? filas[0] : filas[0].map((_, i) => `Columna ${i + 1}`);
  const datos = tieneEncabezado ? filas.slice(1) : filas;
  const mapeoInicial = adivinarMapeo(encabezados);

  const cont = $('previsualizacionImportar');
  cont.innerHTML = `
    <p class="ayuda" style="margin-top:10px;">Indica qué es cada columna y confirma para crear ${datos.length} estilo(s):</p>
    <div class="rejilla-2">
      ${encabezados.map((h, i) => `
        <div class="campo">
          <label>${h}</label>
          <select data-col="${i}" class="selMapeo">
            ${CAMPOS_DESTINO.map((c) => `<option value="${c.clave}" ${c.clave === mapeoInicial[i] ? 'selected' : ''}>${c.etiqueta}</option>`).join('')}
          </select>
        </div>
      `).join('')}
    </div>
    <div class="tabla-scroll">
      <table class="previsualizacion">
        <thead><tr>${encabezados.map((h) => `<th>${h}</th>`).join('')}</tr></thead>
        <tbody>${datos.slice(0, 6).map((f) => `<tr>${f.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
    </div>
    <div class="acciones" style="margin-top:10px;">
      <button class="boton boton-primario" id="btnConfirmarImportar">Crear ${datos.length} estilo(s)</button>
    </div>
  `;

  $('btnConfirmarImportar').addEventListener('click', () => {
    const selects = cont.querySelectorAll('.selMapeo');
    const mapeo = Array.from(selects).map((s) => s.value);
    datos.forEach((fila) => {
      const datosSku = {};
      mapeo.forEach((clave, i) => {
        if (clave !== 'ignorar') datosSku[clave] = fila[i] || '';
      });
      if (Object.values(datosSku).some((v) => v)) embarque.skus.push(nuevoSku(datosSku));
    });
    guardarEmbarque(embarque);
    $('panelImportar').classList.add('oculto');
    $('textoImportar').value = '';
    cont.innerHTML = '';
    renderListaSku();
  });
});

// --- Editor de plantilla de checklist ---

$('btnEditarPlantilla').addEventListener('click', () => {
  const panel = $('editorPlantilla');
  panel.classList.toggle('oculto');
  if (!panel.classList.contains('oculto')) renderEditorPlantilla();
});

function renderEditorPlantilla() {
  const plantilla = obtenerPlantilla();
  const panel = $('editorPlantilla');
  panel.innerHTML = `
    <p class="ayuda">Ajusta las secciones e ítems según el packing list / hoja de descripción de este embarque. Los cambios aplican a los nuevos estilos que agregues (los ya creados conservan sus respuestas).</p>
    ${plantilla.secciones.map((s, si) => `
      <div class="grupo-seccion" data-sec="${si}">
        <div class="titulo-seccion" style="display:flex; justify-content:space-between; align-items:center;">
          <input type="text" value="${s.titulo}" class="inpSeccion" data-sec="${si}" style="border:none; background:transparent; font:inherit; text-transform:uppercase; letter-spacing:0.04em; width:70%;">
          <button class="boton boton-chico boton-fantasma btnQuitarSeccion" data-sec="${si}">quitar sección</button>
        </div>
        ${s.items.map((it, ii) => `
          <div style="display:flex; gap:6px; align-items:center; margin:4px 0;">
            <input type="text" value="${it.texto}" class="inpItem" data-sec="${si}" data-item="${ii}" style="flex:1;">
            <button class="boton boton-chico boton-fantasma btnQuitarItem" data-sec="${si}" data-item="${ii}">✕</button>
          </div>
        `).join('')}
        <button class="boton boton-chico boton-secundario btnAgregarItem" data-sec="${si}" style="margin-top:6px;">+ ítem</button>
      </div>
    `).join('')}
    <div class="acciones" style="margin-top:10px;">
      <button class="boton boton-secundario boton-chico" id="btnAgregarSeccion">+ sección</button>
      <button class="boton boton-fantasma boton-chico" id="btnRestaurarPlantilla">Restaurar plantilla original</button>
    </div>
  `;

  const releer = () => obtenerPlantilla();
  const escribir = (p) => { guardarPlantilla(p); renderEditorPlantilla(); };

  panel.querySelectorAll('.inpSeccion').forEach((el) => el.addEventListener('change', () => {
    const p = releer(); p.secciones[el.dataset.sec].titulo = el.value; escribir(p);
  }));
  panel.querySelectorAll('.inpItem').forEach((el) => el.addEventListener('change', () => {
    const p = releer(); p.secciones[el.dataset.sec].items[el.dataset.item].texto = el.value; escribir(p);
  }));
  panel.querySelectorAll('.btnQuitarItem').forEach((el) => el.addEventListener('click', () => {
    const p = releer(); p.secciones[el.dataset.sec].items.splice(el.dataset.item, 1); escribir(p);
  }));
  panel.querySelectorAll('.btnQuitarSeccion').forEach((el) => el.addEventListener('click', () => {
    const p = releer(); p.secciones.splice(el.dataset.sec, 1); escribir(p);
  }));
  panel.querySelectorAll('.btnAgregarItem').forEach((el) => el.addEventListener('click', () => {
    const p = releer(); p.secciones[el.dataset.sec].items.push({ id: generarId('it'), texto: 'Nuevo ítem' }); escribir(p);
  }));
  $('btnAgregarSeccion').addEventListener('click', () => {
    const p = releer(); p.secciones.push({ id: generarId('sec'), titulo: 'Nueva sección', items: [] }); escribir(p);
  });
  $('btnRestaurarPlantilla').addEventListener('click', () => {
    if (confirm('¿Restaurar la plantilla original? Se perderán tus cambios a secciones/ítems.')) {
      escribir(JSON.parse(JSON.stringify(PLANTILLA_POR_DEFECTO)));
    }
  });
}

// --- Lista de SKUs ---

function progresoSku(sku) {
  const items = todosLosItems(obtenerPlantilla());
  const respondidos = items.filter((it) => sku.respuestas[it.id] && sku.respuestas[it.id].estado).length;
  return { respondidos, total: items.length };
}

function renderListaSku() {
  const cont = $('listaSku');
  $('mensajeVacioSku').classList.toggle('oculto', embarque.skus.length > 0);
  cont.innerHTML = embarque.skus.map((sku) => {
    const { respondidos, total } = progresoSku(sku);
    const chip = sku.estado === 'enviado'
      ? '<span class="chip chip-enviado">Enviado</span>'
      : '<span class="chip chip-borrador">Borrador local</span>';
    return `
      <div class="tarjeta-sku" data-sku="${sku.id}">
        <div class="fila-superior">
          <div>
            <div class="titulo">${sku.estilo || '(sin estilo)'} ${sku.color ? '· ' + sku.color : ''}</div>
            <div class="detalle-sku">${sku.descripcion || 'Sin descripción'}${sku.paisOrigen ? ' · ' + sku.paisOrigen : ''}</div>
            <div class="progreso">${respondidos}/${total} ítems respondidos</div>
          </div>
          ${chip}
        </div>
      </div>
    `;
  }).join('');
  cont.querySelectorAll('.tarjeta-sku').forEach((el) => el.addEventListener('click', () => {
    skuAbiertoId = el.dataset.sku;
    renderDetalleSku();
  }));
}

// --- Detalle / inspección de un SKU (overlay) ---

function buscarSku(id) { return embarque.skus.find((s) => s.id === id); }

function cerrarDetalle() {
  skuAbiertoId = null;
  $('detalleSku').innerHTML = '';
  document.body.style.overflow = '';
  renderListaSku();
}

function eliminarSku(id) {
  if (!confirm('¿Quitar este estilo del embarque? Se perderán sus respuestas locales.')) return;
  embarque.skus = embarque.skus.filter((s) => s.id !== id);
  guardarEmbarque(embarque);
  cerrarDetalle();
}

function actualizarRespuesta(sku, itemId, campo, valor) {
  if (!sku.respuestas[itemId]) sku.respuestas[itemId] = { estado: null, comentario: '', fotos: [] };
  sku.respuestas[itemId][campo] = valor;
  guardarEmbarque(embarque);
}

function renderDetalleSku() {
  const overlay = $('detalleSku');
  if (!skuAbiertoId) { overlay.innerHTML = ''; return; }
  const sku = buscarSku(skuAbiertoId);
  if (!sku) { cerrarDetalle(); return; }
  const plantilla = obtenerPlantilla();
  document.body.style.overflow = 'hidden';

  overlay.innerHTML = `
    <div style="position:fixed; inset:0; background:var(--fondo); z-index:50; overflow-y:auto;">
      <header class="encabezado">
        <div class="fila">
          <a class="volver" id="btnCerrarDetalle" href="#">←</a>
          <h1>${sku.estilo || 'Estilo'} ${sku.color ? '· ' + sku.color : ''}</h1>
        </div>
      </header>
      <main class="contenedor">
        <div class="tarjeta">
          <h2>Datos del estilo</h2>
          <div class="rejilla-2">
            <div class="campo"><label>Estilo / SKU</label><input type="text" id="campoEstilo" value="${sku.estilo}"></div>
            <div class="campo"><label>Color</label><input type="text" id="campoColor" value="${sku.color}"></div>
            <div class="campo"><label>País de origen</label><input type="text" id="campoPais" value="${sku.paisOrigen}"></div>
            <div class="campo"><label>Cantidad</label><input type="text" id="campoCantidad" value="${sku.cantidad}"></div>
          </div>
          <div class="campo"><label>Descripción del artículo</label><textarea id="campoDescripcion">${sku.descripcion}</textarea></div>
        </div>

        ${plantilla.secciones.map((sec) => `
          <div class="tarjeta">
            <div class="titulo-seccion" style="margin-top:0;">${sec.titulo}</div>
            ${sec.items.map((it) => renderItemChecklist(sku, it)).join('')}
          </div>
        `).join('')}

        <button class="boton boton-peligro boton-bloque" id="btnEliminarSku">Quitar este estilo del embarque</button>
        <div style="height:90px;"></div>
      </main>

      <div class="barra-inferior">
        <div class="fila">
          <div class="info" id="infoProgresoDetalle"></div>
          <button class="boton boton-primario" id="btnEnviarSku">Enviar inspección</button>
        </div>
      </div>
    </div>
  `;

  $('btnCerrarDetalle').addEventListener('click', (e) => { e.preventDefault(); cerrarDetalle(); });
  $('btnEliminarSku').addEventListener('click', () => eliminarSku(sku.id));

  ['campoEstilo:estilo', 'campoColor:color', 'campoPais:paisOrigen', 'campoCantidad:cantidad', 'campoDescripcion:descripcion'].forEach((par) => {
    const [elId, campo] = par.split(':');
    $(elId).addEventListener('input', () => { sku[campo] = $(elId).value; guardarEmbarque(embarque); });
  });

  overlay.querySelectorAll('.selector-estado button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const itemId = btn.closest('.item-checklist').dataset.item;
      actualizarRespuesta(sku, itemId, 'estado', btn.dataset.valor);
      const grupo = btn.closest('.selector-estado');
      grupo.querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b === btn));
      actualizarProgresoDetalle(sku);
    });
  });

  overlay.querySelectorAll('.detalle-toggle').forEach((btn) => {
    btn.addEventListener('click', () => {
      const det = btn.closest('.item-checklist').querySelector('.detalle');
      det.classList.toggle('abierto');
      btn.textContent = det.classList.contains('abierto') ? 'Ocultar comentario / foto' : 'Agregar comentario o foto';
    });
  });

  overlay.querySelectorAll('.txtComentario').forEach((el) => {
    el.addEventListener('input', () => {
      const itemId = el.closest('.item-checklist').dataset.item;
      actualizarRespuesta(sku, itemId, 'comentario', el.value);
    });
  });

  overlay.querySelectorAll('.inputFoto').forEach((el) => {
    el.addEventListener('change', async (ev) => {
      const itemId = el.closest('.item-checklist').dataset.item;
      const archivos = Array.from(ev.target.files || []);
      for (const archivo of archivos) {
        const foto = await comprimirImagen(archivo);
        if (!sku.respuestas[itemId]) sku.respuestas[itemId] = { estado: null, comentario: '', fotos: [] };
        if (!sku.respuestas[itemId].fotos) sku.respuestas[itemId].fotos = [];
        sku.respuestas[itemId].fotos.push(foto);
      }
      guardarEmbarque(embarque);
      renderDetalleSku();
    });
  });

  overlay.querySelectorAll('.quitar-foto').forEach((el) => {
    el.addEventListener('click', () => {
      const itemId = el.closest('.item-checklist').dataset.item;
      const idx = Number(el.dataset.idx);
      sku.respuestas[itemId].fotos.splice(idx, 1);
      guardarEmbarque(embarque);
      renderDetalleSku();
    });
  });

  $('btnEnviarSku').addEventListener('click', () => enviarSku(sku));
  actualizarProgresoDetalle(sku);
}

function renderItemChecklist(sku, item) {
  const r = sku.respuestas[item.id] || { estado: null, comentario: '', fotos: [] };
  const tieneDetalle = !!(r.comentario || (r.fotos && r.fotos.length));
  return `
    <div class="item-checklist" data-item="${item.id}">
      <div class="texto-item"><span>${item.texto}</span></div>
      <div class="selector-estado">
        <button data-valor="SI" class="${r.estado === 'SI' ? 'activo' : ''}">SÍ</button>
        <button data-valor="NO" class="${r.estado === 'NO' ? 'activo' : ''}">NO</button>
        <button data-valor="NA" class="${r.estado === 'NA' ? 'activo' : ''}">N/A</button>
      </div>
      <button class="detalle-toggle">${tieneDetalle ? 'Ocultar comentario / foto' : 'Agregar comentario o foto'}</button>
      <div class="detalle ${tieneDetalle ? 'abierto' : ''}">
        <div class="campo" style="margin-top:8px;">
          <textarea class="txtComentario" placeholder="Comentario (opcional)">${r.comentario || ''}</textarea>
        </div>
        <div class="fotos-lista">
          ${(r.fotos || []).map((f, i) => `
            <div class="foto-mini">
              <img src="data:${f.mime};base64,${f.base64}">
              <button class="quitar-foto" data-idx="${i}">✕</button>
            </div>
          `).join('')}
          <label class="boton-agregar-foto" style="display:flex; align-items:center; justify-content:center;">
            +
            <input type="file" accept="image/*" capture="environment" multiple class="inputFoto" style="display:none;">
          </label>
        </div>
      </div>
    </div>
  `;
}

function actualizarProgresoDetalle(sku) {
  const { respondidos, total } = progresoSku(sku);
  const el = $('infoProgresoDetalle');
  if (el) el.textContent = `${respondidos}/${total} ítems respondidos`;
}

async function enviarSku(sku) {
  const { respondidos, total } = progresoSku(sku);
  if (respondidos < total) {
    if (!confirm(`Faltan ${total - respondidos} ítem(s) sin marcar. ¿Enviar de todas formas?`)) return;
  }
  const boton = $('btnEnviarSku');
  boton.disabled = true;
  boton.textContent = 'Enviando…';

  const plantilla = obtenerPlantilla();
  const payload = {
    tipo: 'checklist_sku',
    embarque: { cliente: embarque.cliente, referencia: embarque.referencia, fecha: embarque.fecha, inspector: embarque.inspector },
    sku: { estilo: sku.estilo, descripcion: sku.descripcion, color: sku.color, paisOrigen: sku.paisOrigen, cantidad: sku.cantidad },
    respuestas: todosLosItems(plantilla).map((it) => {
      const r = sku.respuestas[it.id] || {};
      return { seccion: it.seccion, item: it.texto, estado: r.estado || '', comentario: r.comentario || '', fotos: r.fotos || [] };
    }),
    enviado: new Date().toISOString(),
  };

  const resultado = await enviarOEncolar(payload);
  sku.estado = 'enviado';
  sku.enviadoEn = payload.enviado;
  guardarEmbarque(embarque);

  boton.disabled = false;
  boton.textContent = 'Enviar inspección';

  if (resultado.ok) {
    alert('Inspección enviada correctamente.');
  } else {
    alert('No hay conexión (o falta configurar el Google Sheet). Se guardó en el dispositivo y se enviará solo más tarde, o puedes reintentar desde Configuración.');
  }
  cerrarDetalle();
}

// --- Arranque ---

document.addEventListener('DOMContentLoaded', () => {
  cargarCamposEmbarque();
  renderListaSku();
  actualizarIndicadorConexion($('indicadorConexion'));
  setInterval(() => actualizarIndicadorConexion($('indicadorConexion')), 4000);
});
