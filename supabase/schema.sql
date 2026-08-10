-- ============================================================
-- Inspecciones Verde Innova — esquema Supabase
-- Reemplaza las 6 pestañas del Google Sheet. Corre esto una sola
-- vez en el SQL Editor del proyecto de Supabase.
-- ============================================================

-- 1. Tablas ----------------------------------------------------

create table if not exists checklist_sku (
  id bigint generated always as identity primary key,
  id_envio text not null,
  creado_en timestamptz not null default now(),
  cliente text,
  referencia text,
  fecha_inspeccion date,
  inspector text,
  estilo text,
  descripcion text,
  color text,
  pais_origen text,
  cantidad text,
  seccion text,
  item text,
  estado text,
  comentario text,
  fotos text
);
create index if not exists idx_checklist_sku_id_envio on checklist_sku (id_envio);

create table if not exists reportes_generales (
  id bigint generated always as identity primary key,
  id_informe text not null unique,
  id_envio text,
  creado_en timestamptz not null default now(),
  inspector text,
  fecha_inspeccion date,
  ubicacion text,
  cliente text,
  referencia text,
  consignatario text,
  tipo_producto text,
  cantidad_total text,
  cajas_seleccionadas text,
  contenedor_sello text,
  muestreo_base text,
  muestreo_porcentaje text,
  estandar text,
  metodo_seleccion text,
  notas_muestreo text,
  integridad_embalaje text,
  dano_defecto text,
  consistencia_cantidad text,
  manipulacion_contaminacion text,
  evidencia_fotografica text,
  resumen_hallazgos text,
  recomendacion text,
  decision text,
  medidas_adicionales text,
  inspector_nombre text,
  inspector_firma text,
  inspector_fecha date,
  cliente_rep_nombre text,
  cliente_rep_firma text,
  cliente_rep_fecha date,
  informe_doc text,
  informe_pdf text,
  idioma text not null default 'es',
  categorias_fotos_etiquetas jsonb
);

create table if not exists reportes_cajas (
  id bigint generated always as identity primary key,
  id_informe text not null references reportes_generales (id_informe) on delete cascade,
  numero text,
  condicion_externa text,
  etiquetado text,
  sellado text,
  calidad_caja text,
  condicion_unidad text,
  observaciones text
);

create table if not exists reportes_anomalias (
  id bigint generated always as identity primary key,
  id_informe text not null references reportes_generales (id_informe) on delete cascade,
  descripcion text,
  fotos text
);

create table if not exists reportes_medidas (
  id bigint generated always as identity primary key,
  id_informe text not null references reportes_generales (id_informe) on delete cascade,
  medida_bulto text,
  talla_referencia text,
  medida text
);

create table if not exists reportes_fotos (
  id bigint generated always as identity primary key,
  id_informe text not null references reportes_generales (id_informe) on delete cascade,
  categoria text,
  url_foto text
);

-- 2. RLS: solo el equipo interno (autenticado) puede leer --------

alter table checklist_sku enable row level security;
alter table reportes_generales enable row level security;
alter table reportes_cajas enable row level security;
alter table reportes_anomalias enable row level security;
alter table reportes_medidas enable row level security;
alter table reportes_fotos enable row level security;

create policy "lectura_equipo_interno" on checklist_sku for select using (auth.role() = 'authenticated');
create policy "lectura_equipo_interno" on reportes_generales for select using (auth.role() = 'authenticated');
create policy "lectura_equipo_interno" on reportes_cajas for select using (auth.role() = 'authenticated');
create policy "lectura_equipo_interno" on reportes_anomalias for select using (auth.role() = 'authenticated');
create policy "lectura_equipo_interno" on reportes_medidas for select using (auth.role() = 'authenticated');
create policy "lectura_equipo_interno" on reportes_fotos for select using (auth.role() = 'authenticated');

-- Sin policies de insert/update/delete a nivel de tabla: toda
-- escritura entra por las funciones RPC de abajo (security definer),
-- así el rol "anon" (la app en el navegador) no tiene ningún
-- privilegio directo sobre las tablas, solo puede ejecutar estas
-- 3 funciones.

-- 3. Funciones RPC (llamadas por la app con la anon key) ---------

create or replace function ping()
returns boolean
language sql
security definer
as $$ select true; $$;
grant execute on function ping () to anon, authenticated;

-- datos.respuestas[i].fotos ya llega como texto (URLs separadas por
-- coma), igual que la columna "Fotos" de la pestaña Checklist_SKU de
-- antes — el navegador sube las fotos a Storage y las une antes de
-- llamar esta función (ver js/app.js).
create or replace function crear_checklist_sku(datos jsonb)
returns void
language plpgsql
security definer
as $$
declare
  item jsonb;
begin
  if datos->>'idEnvio' is null or exists (select 1 from checklist_sku where id_envio = datos->>'idEnvio') then
    return; -- ya procesado (idempotencia, reemplaza el caché de 6h de Apps Script)
  end if;

  for item in select * from jsonb_array_elements(coalesce(datos->'respuestas', '[]'::jsonb))
  loop
    insert into checklist_sku (
      id_envio, cliente, referencia, fecha_inspeccion, inspector,
      estilo, descripcion, color, pais_origen, cantidad,
      seccion, item, estado, comentario, fotos
    ) values (
      datos->>'idEnvio',
      datos->'embarque'->>'cliente', datos->'embarque'->>'referencia',
      nullif(datos->'embarque'->>'fecha', '')::date, datos->'embarque'->>'inspector',
      datos->'sku'->>'estilo', datos->'sku'->>'descripcion', datos->'sku'->>'color',
      datos->'sku'->>'paisOrigen', datos->'sku'->>'cantidad',
      item->>'seccion', item->>'item', item->>'estado', item->>'comentario', item->>'fotos'
    );
  end loop;
end;
$$;
grant execute on function crear_checklist_sku (jsonb) to anon, authenticated;

-- Igual que arriba: fotos/firmas ya llegan como URLs de Storage
-- (el navegador las sube antes de llamar esta función).
create or replace function crear_informe(datos jsonb)
returns void
language plpgsql
security definer
as $$
declare
  id_inf text := datos->>'idInforme';
  g jsonb := coalesce(datos->'general', '{}'::jsonb);
  mu jsonb := coalesce(datos->'muestreo', '{}'::jsonb);
  ha jsonb := coalesce(datos->'hallazgos', '{}'::jsonb);
  co jsonb := coalesce(datos->'conclusion', '{}'::jsonb);
  ap jsonb := coalesce(datos->'aprobacion', '{}'::jsonb);
  caja jsonb;
  anomalia jsonb;
  medida jsonb;
  categoria text;
  url_foto text;
begin
  if id_inf is null or exists (select 1 from reportes_generales where id_informe = id_inf) then
    return; -- ya procesado (idempotencia)
  end if;

  insert into reportes_generales (
    id_informe, id_envio, inspector, fecha_inspeccion, ubicacion, cliente, referencia, consignatario,
    tipo_producto, cantidad_total, cajas_seleccionadas, contenedor_sello,
    muestreo_base, muestreo_porcentaje, estandar, metodo_seleccion, notas_muestreo,
    integridad_embalaje, dano_defecto, consistencia_cantidad, manipulacion_contaminacion, evidencia_fotografica,
    resumen_hallazgos, recomendacion, decision, medidas_adicionales,
    inspector_nombre, inspector_firma, inspector_fecha, cliente_rep_nombre, cliente_rep_firma, cliente_rep_fecha
  ) values (
    id_inf, datos->>'idEnvio', g->>'inspector', nullif(g->>'fecha', '')::date, g->>'ubicacion', g->>'cliente', g->>'referencia', g->>'consignatario',
    g->>'tipoProducto', g->>'cantidadTotal', g->>'cajasSeleccionadas', g->>'contenedorSello',
    mu->>'base', mu->>'porcentaje', mu->>'estandar', mu->>'metodo', mu->>'notas',
    ha->>'integridad', ha->>'dano', ha->>'cantidad', ha->>'manipulacion', ha->>'evidenciaFoto',
    co->>'resumen', co->>'recomendacion', co->>'decision', co->>'medidasAdicionales',
    ap->>'inspectorNombre', ap->>'inspectorFirma', nullif(ap->>'inspectorFecha', '')::date,
    ap->>'clienteNombre', ap->>'clienteFirma', nullif(ap->>'clienteFecha', '')::date
  );

  for caja in select * from jsonb_array_elements(coalesce(datos->'cajas', '[]'::jsonb))
  loop
    insert into reportes_cajas (id_informe, numero, condicion_externa, etiquetado, sellado, calidad_caja, condicion_unidad, observaciones)
    values (id_inf, caja->>'numero', caja->>'condicionExterna', caja->>'etiquetado', caja->>'sellado', caja->>'calidadCaja', caja->>'condicionUnidad', caja->>'observaciones');
  end loop;

  for anomalia in select * from jsonb_array_elements(coalesce(datos->'anomalias', '[]'::jsonb))
  loop
    insert into reportes_anomalias (id_informe, descripcion, fotos)
    values (id_inf, anomalia->>'descripcion', anomalia->>'fotos');
  end loop;

  if jsonb_array_length(coalesce(datos->'medidas'->'filas', '[]'::jsonb)) = 0 then
    insert into reportes_medidas (id_informe, medida_bulto, talla_referencia, medida)
    values (id_inf, datos->'medidas'->>'bulto', '', '');
  else
    for medida in select * from jsonb_array_elements(datos->'medidas'->'filas')
    loop
      insert into reportes_medidas (id_informe, medida_bulto, talla_referencia, medida)
      values (id_inf, datos->'medidas'->>'bulto', medida->>'etiqueta', medida->>'medida');
    end loop;
  end if;

  for categoria in select jsonb_object_keys(coalesce(datos->'fotos', '{}'::jsonb))
  loop
    for url_foto in select jsonb_array_elements_text(datos->'fotos'->categoria)
    loop
      insert into reportes_fotos (id_informe, categoria, url_foto) values (id_inf, categoria, url_foto);
    end loop;
  end loop;
end;
$$;
grant execute on function crear_informe (jsonb) to anon, authenticated;

-- 4. Storage: bucket público para fotos ---------------------------
-- Lectura pública por URL (igual que "cualquiera con el enlace" en
-- Drive hoy); solo puede subir quien tenga la anon key, no listar.

insert into storage.buckets (id, name, public)
values ('fotos-inspecciones', 'fotos-inspecciones', true)
on conflict (id) do nothing;

create policy "subida_fotos_inspecciones" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'fotos-inspecciones');

-- Sin policy de "select": el bucket ya es público (arriba), así que las
-- URLs de las fotos siempre son visibles por su enlace directo. Sin esta
-- policy, nadie puede además LISTAR todos los archivos del bucket vía la
-- API — el Advisor de seguridad de Supabase marca esa policy adicional
-- como un riesgo innecesario, por eso se quitó.

-- ============================================================
-- 5. Aviso a Apps Script cuando entra un informe nuevo -----------
-- El wizard de Database → Webhooks de Studio depende del esquema
-- "supabase_functions", que no existe en todos los proyectos (no
-- existía en este). Por eso el trigger se crea acá directamente con
-- pg_net (ya habilitado arriba), sin pasar por ese wizard.
--
-- Reemplaza la URL/token si alguna vez rotas TOKEN_WEBHOOK.

create extension if not exists pg_net schema extensions;

create or replace function trg_generar_doc_informe()
returns trigger
language plpgsql
as $$
begin
  perform net.http_post(
    '<URL del Apps Script>/exec?token=<TOKEN_WEBHOOK>',
    jsonb_build_object('table', 'reportes_generales', 'record', to_jsonb(new)),
    '{}'::jsonb,
    '{"Content-Type": "application/json"}'::jsonb,
    5000
  );
  return new;
end;
$$;

create trigger generar_doc_informe
  after insert on reportes_generales
  for each row execute function trg_generar_doc_informe();

-- ============================================================
-- 6. RPC para que Apps Script lea/actualice un informe sin la
-- service_role key ----------------------------------------------
-- Ambas funciones exigen el mismo TOKEN_WEBHOOK como parámetro
-- (no como header, Apps Script no puede fijarlo aquí tampoco) —
-- así Code.gs solo necesita la clave publicable (segura de tener
-- en código) más este token, nunca una credencial de cuenta.
-- Si rotas TOKEN_WEBHOOK, actualiza el literal en las dos funciones
-- de abajo Y en la función trg_generar_doc_informe() de la sección 5.

create or replace function webhook_leer_informe(p_id_informe text, p_token text)
returns jsonb
language plpgsql
security definer
as $$
declare
  r reportes_generales;
begin
  if p_token is null or p_token <> '<TOKEN_WEBHOOK>' then
    raise exception 'No autorizado';
  end if;
  select * into r from reportes_generales where id_informe = p_id_informe;
  if r is null then
    return null;
  end if;
  return jsonb_build_object(
    'record', to_jsonb(r),
    'cajas', coalesce((select jsonb_agg(to_jsonb(c)) from reportes_cajas c where c.id_informe = p_id_informe), '[]'::jsonb),
    'anomalias', coalesce((select jsonb_agg(to_jsonb(a)) from reportes_anomalias a where a.id_informe = p_id_informe), '[]'::jsonb),
    'medidas', coalesce((select jsonb_agg(to_jsonb(m)) from reportes_medidas m where m.id_informe = p_id_informe), '[]'::jsonb),
    'fotos', coalesce((select jsonb_agg(to_jsonb(f)) from reportes_fotos f where f.id_informe = p_id_informe), '[]'::jsonb)
  );
end;
$$;
grant execute on function webhook_leer_informe (text, text) to anon, authenticated;

create or replace function webhook_marcar_documento(p_id_informe text, p_token text, p_doc text, p_pdf text)
returns void
language plpgsql
security definer
as $$
begin
  if p_token is null or p_token <> '<TOKEN_WEBHOOK>' then
    raise exception 'No autorizado';
  end if;
  update reportes_generales set informe_doc = p_doc, informe_pdf = p_pdf where id_informe = p_id_informe;
end;
$$;
grant execute on function webhook_marcar_documento (text, text, text, text) to anon, authenticated;
