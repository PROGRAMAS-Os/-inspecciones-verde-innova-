// Informe general de inspección — basado en "Formulario de Inspeccion de Productos VI RINCON HOOKA.xlsx"

const CLAVE_REPORTE_ACTUAL = 'vi_reporte_actual';

const CATEGORIAS_FOTO = [
  { clave: 'estibaBultos', etiqueta: 'Estiba en bultos para su revisión' },
  { clave: 'numeracionBultos', etiqueta: 'Numeración de bultos' },
  { clave: 'estibaCajas', etiqueta: 'Estiba en cajas' },
  { clave: 'calidadZapatilla', etiqueta: 'Calidad de la zapatilla' },
  { clave: 'calidadEtiquetaCaja', etiqueta: 'Calidad de la etiqueta exterior de la caja' },
];

function informeVacio() {
  const cfg = obtenerConfig();
  return {
    id: generarId('rep'),
    idEnvio: null,
    general: {
      inspector: cfg.inspectorDefault || '', fecha: new Date().toISOString().slice(0, 10), ubicacion: '',
      cliente: cfg.clienteDefault || '', referencia: '', consignatario: '', tipoProducto: '', cantidadTotal: '', cajasSeleccionadas: '', contenedorSello: '',
    },
    cajas: [],
    muestreo: { base: '', porcentaje: '', estandar: '', metodo: '', notas: '' },
    hallazgos: { integridad: '', dano: '', cantidad: '', manipulacion: '', evidenciaFoto: '' },
    conclusion: { resumen: '', recomendacion: '', decision: '', medidasAdicionales: '' },
    fotos: Object.fromEntries(CATEGORIAS_FOTO.map((c) => [c.clave, []])),
    anomalias: [],
    medidas: { bulto: '', filas: [] },
    aprobacion: { inspectorNombre: '', inspectorFirma: '', inspectorFecha: '', clienteNombre: '', clienteFirma: '', clienteFecha: '' },
    estado: 'borrador',
  };
}

function obtenerInforme() { return leerJSON(CLAVE_REPORTE_ACTUAL, informeVacio()); }
function guardarInforme(inf) {
  guardarJSON(CLAVE_REPORTE_ACTUAL, inf);
  const el = document.getElementById('infoGuardado');
  if (el) el.textContent = 'Guardado localmente · ' + new Date().toLocaleTimeString('es-PA');
  actualizarChipEstado();
}

function actualizarChipEstado() {
  const chip = document.getElementById('chipEstadoInforme');
  if (!chip) return;
  if (informe.estado === 'enviado') { chip.textContent = 'Enviado'; chip.className = 'chip chip-enviado'; return; }
  if (informe.estado === 'pendiente') { chip.textContent = 'Pendiente de enviar'; chip.className = 'chip chip-pendiente'; return; }
  chip.textContent = 'Borrador'; chip.className = 'chip chip-borrador';
}

let informe = obtenerInforme();
const $ = (id) => document.getElementById(id);

// --- Tabs ---

document.querySelectorAll('#pestanas button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#pestanas button').forEach((b) => b.classList.remove('activa'));
    btn.classList.add('activa');
    document.querySelectorAll('[data-panel]').forEach((p) => p.classList.add('oculto'));
    document.querySelector(`[data-panel="${btn.dataset.tab}"]`).classList.remove('oculto');
  });
});

// --- Ligar campos simples input/textarea <-> objeto ---

function ligarCampo(elId, obtenerContenedor, campo) {
  const el = $(elId);
  if (!el) return;
  el.addEventListener('input', () => {
    obtenerContenedor()[campo] = el.value;
    guardarInforme(informe);
  });
}

function cargarCamposSimples() {
  const mapa = [
    ['g_inspector', () => informe.general, 'inspector'],
    ['g_fecha', () => informe.general, 'fecha'],
    ['g_ubicacion', () => informe.general, 'ubicacion'],
    ['g_cliente', () => informe.general, 'cliente'],
    ['g_referencia', () => informe.general, 'referencia'],
    ['g_consignatario', () => informe.general, 'consignatario'],
    ['g_tipoProducto', () => informe.general, 'tipoProducto'],
    ['g_cantidadTotal', () => informe.general, 'cantidadTotal'],
    ['g_cajasSeleccionadas', () => informe.general, 'cajasSeleccionadas'],
    ['g_contenedorSello', () => informe.general, 'contenedorSello'],
    ['m_base', () => informe.muestreo, 'base'],
    ['m_porcentaje', () => informe.muestreo, 'porcentaje'],
    ['m_estandar', () => informe.muestreo, 'estandar'],
    ['m_metodo', () => informe.muestreo, 'metodo'],
    ['m_notas', () => informe.muestreo, 'notas'],
    ['h_integridad', () => informe.hallazgos, 'integridad'],
    ['h_dano', () => informe.hallazgos, 'dano'],
    ['h_cantidad', () => informe.hallazgos, 'cantidad'],
    ['h_manipulacion', () => informe.hallazgos, 'manipulacion'],
    ['c_resumen', () => informe.conclusion, 'resumen'],
    ['c_recomendacion', () => informe.conclusion, 'recomendacion'],
    ['c_medidasAdicionales', () => informe.conclusion, 'medidasAdicionales'],
    ['med_bulto', () => informe.medidas, 'bulto'],
    ['a_inspectorNombre', () => informe.aprobacion, 'inspectorNombre'],
    ['a_inspectorFecha', () => informe.aprobacion, 'inspectorFecha'],
    ['a_clienteNombre', () => informe.aprobacion, 'clienteNombre'],
    ['a_clienteFecha', () => informe.aprobacion, 'clienteFecha'],
  ];
  mapa.forEach(([elId, obtenerContenedor, campo]) => {
    const el = $(elId);
    if (!el) return;
    el.value = obtenerContenedor()[campo] || '';
    ligarCampo(elId, obtenerContenedor, campo);
  });

  // Selectores de estado simples (evidencia fotográfica, decisión)
  configurarSelectorEstado($('h_evidenciaFoto'), informe.hallazgos.evidenciaFoto, (v) => { informe.hallazgos.evidenciaFoto = v; guardarInforme(informe); });
  configurarSelectorEstado($('c_decision'), informe.conclusion.decision, (v) => { informe.conclusion.decision = v; guardarInforme(informe); });
}

function configurarSelectorEstado(contenedor, valorActual, onCambio) {
  if (!contenedor) return;
  contenedor.querySelectorAll('button').forEach((b) => b.classList.toggle('activo', b.dataset.valor === valorActual));
  contenedor.querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      contenedor.querySelectorAll('button').forEach((b) => b.classList.remove('activo'));
      btn.classList.add('activo');
      onCambio(btn.dataset.valor);
    });
  });
}

// --- Cajas (Sección 2) ---

function renderCajas() {
  const cont = $('listaCajas');
  cont.innerHTML = informe.cajas.map((c, idx) => `
    <div class="fila-dinamica" data-idx="${idx}">
      <button class="quitar-fila" data-idx="${idx}" data-tipo="caja">✕</button>
      <div class="rejilla-2">
        <div class="campo"><label>Caja / bulto No.</label><input type="text" class="cCampo" data-campo="numero" value="${escapeHtml(c.numero)}"></div>
        <div class="campo"><label>Condición externa</label><input type="text" class="cCampo" data-campo="condicionExterna" value="${escapeHtml(c.condicionExterna)}" placeholder="Bien / Regular / Dañada"></div>
        <div class="campo"><label>Etiquetado (Sí/No)</label><input type="text" class="cCampo" data-campo="etiquetado" value="${escapeHtml(c.etiquetado)}"></div>
        <div class="campo"><label>Sellado</label><input type="text" class="cCampo" data-campo="sellado" value="${escapeHtml(c.sellado)}" placeholder="Intacto / Dañado"></div>
        <div class="campo"><label>Calidad de la caja</label><input type="text" class="cCampo" data-campo="calidadCaja" value="${escapeHtml(c.calidadCaja)}" placeholder="Buena / Anomalía"></div>
        <div class="campo"><label>Condición de la unidad</label><input type="text" class="cCampo" data-campo="condicionUnidad" value="${escapeHtml(c.condicionUnidad)}"></div>
      </div>
      <div class="campo"><label>Observaciones</label><input type="text" class="cCampo" data-campo="observaciones" value="${escapeHtml(c.observaciones)}"></div>
    </div>
  `).join('') || '<p class="mensaje-vacio">Sin cajas agregadas.</p>';

  cont.querySelectorAll('.cCampo').forEach((el) => {
    el.addEventListener('input', () => {
      const idx = Number(el.closest('.fila-dinamica').dataset.idx);
      informe.cajas[idx][el.dataset.campo] = el.value;
      guardarInforme(informe);
    });
  });
  cont.querySelectorAll('.quitar-fila[data-tipo="caja"]').forEach((el) => {
    el.addEventListener('click', () => { informe.cajas.splice(Number(el.dataset.idx), 1); guardarInforme(informe); renderCajas(); });
  });
}

$('btnAgregarCaja').addEventListener('click', () => {
  informe.cajas.push({ numero: '', condicionExterna: '', etiquetado: '', sellado: '', calidadCaja: '', condicionUnidad: '', observaciones: '' });
  guardarInforme(informe);
  renderCajas();
});

// --- Fotos por categoría ---

function renderFotos() {
  const cont = $('categoriasFotos');
  cont.innerHTML = CATEGORIAS_FOTO.map((cat) => `
    <div class="grupo-seccion">
      <div class="titulo-seccion">${cat.etiqueta}</div>
      <div class="fotos-lista" data-cat="${cat.clave}">
        ${(informe.fotos[cat.clave] || []).map((f, i) => `
          <div class="foto-mini">
            <img src="data:${escapeHtml(f.mime)};base64,${f.base64}">
            <button class="quitar-foto" data-cat="${cat.clave}" data-idx="${i}">✕</button>
          </div>
        `).join('')}
        <label class="boton-agregar-foto" style="display:flex; align-items:center; justify-content:center;">
          +
          <input type="file" accept="image/*" capture="environment" multiple class="inputFotoCat" data-cat="${cat.clave}" style="display:none;">
        </label>
      </div>
    </div>
  `).join('');

  cont.querySelectorAll('.inputFotoCat').forEach((el) => {
    el.addEventListener('change', async (ev) => {
      const cat = el.dataset.cat;
      const archivos = Array.from(ev.target.files || []);
      for (const archivo of archivos) {
        const foto = await comprimirImagen(archivo);
        informe.fotos[cat].push(foto);
      }
      guardarInforme(informe);
      renderFotos();
    });
  });
  cont.querySelectorAll('.quitar-foto').forEach((el) => {
    el.addEventListener('click', () => {
      informe.fotos[el.dataset.cat].splice(Number(el.dataset.idx), 1);
      guardarInforme(informe);
      renderFotos();
    });
  });
}

// --- Anomalías ---

function renderAnomalias() {
  const cont = $('listaAnomalias');
  cont.innerHTML = informe.anomalias.map((a, idx) => `
    <div class="fila-dinamica" data-idx="${idx}">
      <button class="quitar-fila" data-idx="${idx}" data-tipo="anomalia">✕</button>
      <div class="campo"><label>Descripción</label><textarea class="aCampo" data-campo="descripcion">${escapeHtml(a.descripcion || '')}</textarea></div>
      <div class="fotos-lista" data-idx-fotos="${idx}">
        ${(a.fotos || []).map((f, i) => `
          <div class="foto-mini">
            <img src="data:${escapeHtml(f.mime)};base64,${f.base64}">
            <button class="quitar-foto-anomalia" data-idx="${idx}" data-fidx="${i}">✕</button>
          </div>
        `).join('')}
        <label class="boton-agregar-foto" style="display:flex; align-items:center; justify-content:center;">
          +
          <input type="file" accept="image/*" capture="environment" multiple class="inputFotoAnomalia" data-idx="${idx}" style="display:none;">
        </label>
      </div>
    </div>
  `).join('') || '<p class="mensaje-vacio">Sin anomalías registradas.</p>';

  cont.querySelectorAll('.aCampo').forEach((el) => {
    el.addEventListener('input', () => {
      const idx = Number(el.closest('.fila-dinamica').dataset.idx);
      informe.anomalias[idx][el.dataset.campo] = el.value;
      guardarInforme(informe);
    });
  });
  cont.querySelectorAll('.quitar-fila[data-tipo="anomalia"]').forEach((el) => {
    el.addEventListener('click', () => { informe.anomalias.splice(Number(el.dataset.idx), 1); guardarInforme(informe); renderAnomalias(); });
  });
  cont.querySelectorAll('.inputFotoAnomalia').forEach((el) => {
    el.addEventListener('change', async (ev) => {
      const idx = Number(el.dataset.idx);
      const archivos = Array.from(ev.target.files || []);
      for (const archivo of archivos) {
        const foto = await comprimirImagen(archivo);
        if (!informe.anomalias[idx].fotos) informe.anomalias[idx].fotos = [];
        informe.anomalias[idx].fotos.push(foto);
      }
      guardarInforme(informe);
      renderAnomalias();
    });
  });
  cont.querySelectorAll('.quitar-foto-anomalia').forEach((el) => {
    el.addEventListener('click', () => {
      informe.anomalias[Number(el.dataset.idx)].fotos.splice(Number(el.dataset.fidx), 1);
      guardarInforme(informe);
      renderAnomalias();
    });
  });
}

$('btnAgregarAnomalia').addEventListener('click', () => {
  informe.anomalias.push({ descripcion: '', fotos: [] });
  guardarInforme(informe);
  renderAnomalias();
});

// --- Medidas ---

function renderMedidas() {
  const cont = $('listaMedidas');
  cont.innerHTML = informe.medidas.filas.map((m, idx) => `
    <div class="fila-dinamica" data-idx="${idx}">
      <button class="quitar-fila" data-idx="${idx}" data-tipo="medida">✕</button>
      <div class="rejilla-2">
        <div class="campo"><label>Talla / referencia</label><input type="text" class="mCampo" data-campo="etiqueta" value="${escapeHtml(m.etiqueta)}" placeholder="Ej. Talla 13D"></div>
        <div class="campo"><label>Medida</label><input type="text" class="mCampo" data-campo="medida" value="${escapeHtml(m.medida)}" placeholder='Ej. 10.5" x 14" x 5.5"'></div>
      </div>
    </div>
  `).join('') || '<p class="mensaje-vacio">Sin medidas agregadas.</p>';

  cont.querySelectorAll('.mCampo').forEach((el) => {
    el.addEventListener('input', () => {
      const idx = Number(el.closest('.fila-dinamica').dataset.idx);
      informe.medidas.filas[idx][el.dataset.campo] = el.value;
      guardarInforme(informe);
    });
  });
  cont.querySelectorAll('.quitar-fila[data-tipo="medida"]').forEach((el) => {
    el.addEventListener('click', () => { informe.medidas.filas.splice(Number(el.dataset.idx), 1); guardarInforme(informe); renderMedidas(); });
  });
}

$('btnAgregarMedida').addEventListener('click', () => {
  informe.medidas.filas.push({ etiqueta: '', medida: '' });
  guardarInforme(informe);
  renderMedidas();
});

// --- Firmas (canvas) ---

function configurarFirma(canvasId, pistaId, campo) {
  const canvas = $(canvasId);
  const ctx = canvas.getContext('2d');
  let dibujando = false;

  function ajustarTamano() {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // el panel está oculto (otra pestaña); se reintenta al mostrarla
    const ratio = window.devicePixelRatio || 1;
    canvas.width = rect.width * ratio;
    canvas.height = rect.height * ratio;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#1a1f1c';
    if (informe.aprobacion[campo]) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
      img.src = informe.aprobacion[campo];
      $(pistaId).style.display = 'none';
    }
  }
  ajustarTamano();

  function posDesdeEvento(e) {
    const rect = canvas.getBoundingClientRect();
    const punto = e.touches ? e.touches[0] : e;
    return { x: punto.clientX - rect.left, y: punto.clientY - rect.top };
  }

  function empezar(e) {
    e.preventDefault();
    dibujando = true;
    $(pistaId).style.display = 'none';
    const p = posDesdeEvento(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  }
  function mover(e) {
    if (!dibujando) return;
    e.preventDefault();
    const p = posDesdeEvento(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  function terminar() {
    if (!dibujando) return;
    dibujando = false;
    informe.aprobacion[campo] = canvas.toDataURL('image/png');
    guardarInforme(informe);
  }

  canvas.addEventListener('mousedown', empezar);
  canvas.addEventListener('mousemove', mover);
  window.addEventListener('mouseup', terminar);
  canvas.addEventListener('touchstart', empezar, { passive: false });
  canvas.addEventListener('touchmove', mover, { passive: false });
  canvas.addEventListener('touchend', terminar);

  return {
    ajustarTamano,
    limpiar() {
      const rect = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, rect.width, rect.height);
      informe.aprobacion[campo] = '';
      guardarInforme(informe);
      $(pistaId).style.display = 'block';
    },
  };
}

// --- Envío ---

function construirPayload() {
  return {
    tipo: 'reporte_general',
    general: informe.general,
    cajas: informe.cajas,
    muestreo: informe.muestreo,
    hallazgos: informe.hallazgos,
    conclusion: informe.conclusion,
    fotos: informe.fotos,
    anomalias: informe.anomalias,
    medidas: informe.medidas,
    aprobacion: informe.aprobacion,
    enviado: new Date().toISOString(),
  };
}

$('btnEnviarInforme').addEventListener('click', async () => {
  if (!informe.general.inspector) {
    alert('Falta el nombre del inspector (Sección 1).');
    document.querySelector('[data-tab="general"]').click();
    return;
  }
  if (informe.estado === 'enviado') {
    if (!confirm('Este informe ya se envió antes. ¿Enviarlo de nuevo de todas formas?')) return;
  }
  const boton = $('btnEnviarInforme');
  boton.disabled = true;
  boton.textContent = 'Enviando…';
  const payload = construirPayload();
  const resultado = await enviarOEncolar(payload);
  boton.disabled = false;
  boton.textContent = 'Enviar informe';

  informe.idEnvio = resultado.idEnvio;
  informe.estado = resultado.ok ? 'enviado' : 'pendiente';
  guardarInforme(informe);

  if (resultado.ok) {
    alert('Informe enviado correctamente.');
  } else {
    alert('No hay conexión (o falta configurar el Google Sheet). Se guardó en el dispositivo y se enviará solo más tarde, o puedes reintentar desde Configuración.');
  }
});

$('btnNuevoInforme').addEventListener('click', () => {
  if (!confirm('¿Empezar un informe nuevo? El actual seguirá guardado hasta que lo sobrescribas enviando otro nuevo desde cero.')) return;
  informe = informeVacio();
  guardarInforme(informe);
  location.reload();
});

// --- Arranque ---

document.addEventListener('DOMContentLoaded', () => {
  cargarCamposSimples();
  actualizarChipEstado();
  renderCajas();
  renderFotos();
  renderAnomalias();
  renderMedidas();
  const firmaInsp = configurarFirma('firmaInspector', 'pistaFirmaInspector', 'inspectorFirma');
  const firmaCli = configurarFirma('firmaCliente', 'pistaFirmaCliente', 'clienteFirma');
  $('btnLimpiarFirmaInspector').addEventListener('click', () => firmaInsp.limpiar());
  $('btnLimpiarFirmaCliente').addEventListener('click', () => firmaCli.limpiar());
  document.querySelector('[data-tab="aprobacion"]').addEventListener('click', () => {
    setTimeout(() => { firmaInsp.ajustarTamano(); firmaCli.ajustarTamano(); }, 0);
  });
  actualizarIndicadorConexion($('indicadorConexion'));
  setInterval(() => actualizarIndicadorConexion($('indicadorConexion')), 4000);
});
