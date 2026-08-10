// Panel interno: login del equipo + feed en tiempo real de inspecciones.
// Reusa el cliente `supabaseCliente` ya creado en js/app.js.

const $ = (id) => document.getElementById(id);

const ETIQUETAS_DECISION = { aceptado: 'Envío aceptado', parcial: 'Aceptación parcial', rechazado: 'Envío rechazado' };

function mostrarPanel(mostrar) {
  $('tarjetaLogin').classList.toggle('oculto', mostrar);
  $('panel').classList.toggle('oculto', !mostrar);
  $('puntoEnVivo').classList.toggle('oculto', !mostrar);
}

async function cargarInformes() {
  const { data, error } = await supabaseCliente
    .from('reportes_generales')
    .select('id_informe, creado_en, cliente, referencia, inspector, decision, informe_pdf')
    .order('creado_en', { ascending: false })
    .limit(30);
  const cont = $('listaInformes');
  if (error) { cont.innerHTML = `<p class="mensaje-vacio">No se pudo cargar: ${escapeHtml(error.message)}</p>`; return; }
  if (!data.length) { cont.innerHTML = '<p class="mensaje-vacio">Todavía no hay informes.</p>'; return; }
  cont.innerHTML = data.map((r) => `
    <div class="fila-dinamica">
      <strong>${escapeHtml(r.cliente || '(sin cliente)')} — ${escapeHtml(r.referencia || '')}</strong>
      <div class="pista">Inspector: ${escapeHtml(r.inspector || '—')} · ${formatoFechaHora(r.creado_en)} · ${escapeHtml(ETIQUETAS_DECISION[r.decision] || r.decision || 'Sin decisión')}</div>
      ${r.informe_pdf ? `<a href="${escapeHtml(r.informe_pdf)}" target="_blank" rel="noopener">Ver PDF</a>` : '<span class="pista">Generando Doc/PDF…</span>'}
    </div>
  `).join('');
}

async function cargarChecklists() {
  const { data, error } = await supabaseCliente
    .from('checklist_sku')
    .select('id_envio, creado_en, cliente, referencia, estilo, inspector, estado')
    .order('creado_en', { ascending: false })
    .limit(300);
  const cont = $('listaChecklists');
  if (error) { cont.innerHTML = `<p class="mensaje-vacio">No se pudo cargar: ${escapeHtml(error.message)}</p>`; return; }
  if (!data.length) { cont.innerHTML = '<p class="mensaje-vacio">Todavía no hay checklists.</p>'; return; }

  const grupos = new Map();
  for (const fila of data) {
    if (!grupos.has(fila.id_envio)) {
      grupos.set(fila.id_envio, { ...fila, total: 0, noes: 0 });
    }
    const g = grupos.get(fila.id_envio);
    g.total++;
    if (fila.estado === 'NO') g.noes++;
  }
  const lista = Array.from(grupos.values()).sort((a, b) => new Date(b.creado_en) - new Date(a.creado_en)).slice(0, 30);

  cont.innerHTML = lista.map((g) => `
    <div class="fila-dinamica">
      <strong>${escapeHtml(g.estilo || '(sin estilo)')} — ${escapeHtml(g.cliente || '')}</strong>
      <div class="pista">Ref: ${escapeHtml(g.referencia || '—')} · Inspector: ${escapeHtml(g.inspector || '—')} · ${formatoFechaHora(g.creado_en)}</div>
      <div class="pista">${g.total} ítems revisados${g.noes ? ` · <strong style="color:var(--rojo);">${g.noes} marcados NO</strong>` : ''}</div>
    </div>
  `).join('');
}

function cargarFeed() {
  cargarInformes();
  cargarChecklists();
}

let canalRealtime = null;

function suscribirseAEnVivo() {
  if (canalRealtime) return;
  canalRealtime = supabaseCliente.channel('feed-inspecciones')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reportes_generales' }, cargarInformes)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'checklist_sku' }, cargarChecklists)
    .subscribe();
}

function desuscribirse() {
  if (canalRealtime) {
    supabaseCliente.removeChannel(canalRealtime);
    canalRealtime = null;
  }
}

$('btnIniciarSesion').addEventListener('click', async () => {
  $('loginError').textContent = '';
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const { error } = await supabaseCliente.auth.signInWithPassword({ email, password });
  if (error) $('loginError').textContent = 'No se pudo iniciar sesión: ' + error.message;
});

$('btnCerrarSesion').addEventListener('click', async () => {
  await supabaseCliente.auth.signOut();
});

supabaseCliente.auth.onAuthStateChange((_evento, sesion) => {
  if (sesion) {
    mostrarPanel(true);
    $('sesionComo').textContent = 'Sesión: ' + sesion.user.email;
    cargarFeed();
    suscribirseAEnVivo();
  } else {
    mostrarPanel(false);
    desuscribirse();
  }
});
