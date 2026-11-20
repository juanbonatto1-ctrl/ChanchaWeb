-- ==========================================================
-- La Chancha · Votación de los Chancha Awards
-- Correlo DESPUÉS de asistencia_admin.sql y usuarios.sql.
-- Pegalo entero en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez sin romper nada.
--
-- Cómo funciona:
-- · El usuario admin abre UNA votación con todas las categorías de premios
--   que todavía no tienen ganador (las de "Agregar premio").
-- · Cada socio entra con su usuario y completa la boleta: vota en todas las
--   categorías de una vez. Puede cambiar su boleta mientras esté abierta.
--   Vota siempre con su nombre: no se puede votar por otro.
-- · Cada categoría es "individual" (se vota a una persona) o "dupla" (una pareja).
-- · Nadie se vota a sí mismo (ni puede estar en la dupla que vota).
-- · Los votos son secretos y no se pueden leer hasta que la votación se cierra.
-- · Si hay empate, ganan todos los empatados (lo calcula la web).
-- ==========================================================

-- Si quedó la versión anterior (una votación por premio, sin categorías), se reemplaza.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'votaciones_votos')
     and not exists (select 1 from information_schema.columns
                      where table_schema = 'public' and table_name = 'votaciones_votos' and column_name = 'categoria') then
    drop table public.votaciones_votos;
    drop table if exists public.votaciones;
  end if;
end $$;
-- Versiones viejas (con nombre elegido a mano o con PIN)
drop function if exists public.votar(uuid, text, text, text);
drop function if exists public.votar(uuid, text, jsonb);
drop function if exists public.admin_crear_votacion(text, text, text, text);
drop function if exists public.admin_crear_votacion(text, text, text, jsonb);
drop function if exists public.admin_cerrar_votacion(text, uuid);
drop function if exists public.admin_borrar_votacion(text, uuid);

create table if not exists public.votaciones (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  titulo     text not null check (char_length(titulo) between 1 and 60),
  detalle    text check (detalle is null or char_length(detalle) <= 140),
  -- Foto de las categorías al abrirla: [{ "id": "...", "titulo": "...", "tipo": "individual" | "dupla" }]
  categorias jsonb not null default '[]'::jsonb check (jsonb_typeof(categorias) = 'array'),
  estado     text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  cerrada_at timestamptz
);

create table if not exists public.votaciones_votos (
  votacion_id uuid not null references public.votaciones (id) on delete cascade,
  categoria   text not null,
  votante     text not null references public.socios (nombre) on update cascade on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  elegido1    text not null references public.socios (nombre) on update cascade on delete cascade,
  elegido2    text references public.socios (nombre) on update cascade on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (votacion_id, categoria, votante),
  constraint votos_no_a_si_mismo check (votante <> elegido1 and (elegido2 is null or votante <> elegido2)),
  constraint votos_dupla_ordenada check (elegido2 is null or elegido1 < elegido2)
);
create index if not exists votaciones_votos_user_idx on public.votaciones_votos (votacion_id, user_id);

alter table public.votaciones       enable row level security;
alter table public.votaciones_votos enable row level security;

drop policy if exists "votaciones: leer"            on public.votaciones;
drop policy if exists "votos: leer si esta cerrada" on public.votaciones_votos;
create policy "votaciones: leer" on public.votaciones for select to anon, authenticated using (true);
-- Los votos solo se pueden leer cuando la votación está cerrada
create policy "votos: leer si esta cerrada" on public.votaciones_votos for select to anon, authenticated
  using (exists (select 1 from public.votaciones v where v.id = votacion_id and v.estado = 'cerrada'));
-- Sin políticas de insert/update/delete: se vota con public.votar() y el admin usa admin_*.

grant select on public.votaciones, public.votaciones_votos to anon, authenticated;

-- Quién ya votó (sin decir a quién), para mostrar "faltan votar"
create or replace function public.votaciones_participacion()
returns table (votacion_id uuid, votante text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct vv.votacion_id, vv.votante from public.votaciones_votos vv;
$$;
revoke all on function public.votaciones_participacion() from public;
grant execute on function public.votaciones_participacion() to anon, authenticated;

-- Votar: manda la boleta entera y reemplaza la anterior. Se vota con el nombre del usuario.
-- p_votos: [{ "categoria": "...", "e1": "Nombre", "e2": "Nombre o null" }]
create or replace function public.votar(p_votacion uuid, p_votos jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  p_votante text := public.mi_nombre();
  v_estado  text;
  v_cats   jsonb;
  item     jsonb;
  v_cat    jsonb;
  v_titulo text;
  e1       text;
  e2       text;
  vistos   text[] := '{}';
begin
  if v_uid is null or p_votante is null then
    return jsonb_build_object('ok', false, 'error', 'Entrá con tu usuario para votar.');
  end if;
  select estado, categorias into v_estado, v_cats from public.votaciones where id = p_votacion;
  if v_estado is null then
    return jsonb_build_object('ok', false, 'error', 'La votación no existe.');
  end if;
  if v_estado <> 'abierta' then
    return jsonb_build_object('ok', false, 'error', 'La votación ya está cerrada.');
  end if;
  if p_votos is null or jsonb_typeof(p_votos) <> 'array' or jsonb_array_length(p_votos) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Votá en al menos una categoría.');
  end if;

  -- Validar toda la boleta antes de guardar
  for item in select * from jsonb_array_elements(p_votos) loop
    select c into v_cat from jsonb_array_elements(v_cats) c where c->>'id' = item->>'categoria';
    if v_cat is null then
      return jsonb_build_object('ok', false, 'error', 'Hay una categoría que no está en esta votación.');
    end if;
    v_titulo := v_cat->>'titulo';
    if (item->>'categoria') = any (vistos) then
      return jsonb_build_object('ok', false, 'error', 'Votaste dos veces en ' || v_titulo || '.');
    end if;
    vistos := vistos || (item->>'categoria');
    e1 := nullif(item->>'e1', '');
    e2 := nullif(item->>'e2', '');
    if v_cat->>'tipo' = 'dupla' then
      if e1 is null or e2 is null or e1 = e2 then
        return jsonb_build_object('ok', false, 'error', 'En ' || v_titulo || ' elegí dos personas distintas.');
      end if;
    else
      if e1 is null or e2 is not null then
        return jsonb_build_object('ok', false, 'error', 'En ' || v_titulo || ' elegí una sola persona.');
      end if;
    end if;
    if p_votante = e1 or p_votante = coalesce(e2, '') then
      return jsonb_build_object('ok', false, 'error', 'No podés votarte a vos mismo (' || v_titulo || ').');
    end if;
    if not exists (select 1 from public.socios where nombre = e1)
       or (e2 is not null and not exists (select 1 from public.socios where nombre = e2)) then
      return jsonb_build_object('ok', false, 'error', 'Hay un nombre que no está en el padrón.');
    end if;
    v_cat := null;
  end loop;

  -- Reemplaza la boleta anterior
  delete from public.votaciones_votos where votacion_id = p_votacion and votante = p_votante;
  insert into public.votaciones_votos (votacion_id, categoria, votante, user_id, elegido1, elegido2)
  select p_votacion, x->>'categoria', p_votante, v_uid,
         case when nullif(x->>'e2', '') is null then x->>'e1' else least(x->>'e1', x->>'e2') end,
         case when nullif(x->>'e2', '') is null then null else greatest(x->>'e1', x->>'e2') end
    from jsonb_array_elements(p_votos) x;

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.votar(uuid, jsonb) from public, anon;
grant execute on function public.votar(uuid, jsonb) to authenticated;

-- ---------- Admin (usuario con admin = true) ----------
-- p_categorias: [{ "id": "...", "titulo": "...", "tipo": "individual" | "dupla" }]
create or replace function public.admin_crear_votacion(p_titulo text, p_detalle text, p_categorias jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t    text := btrim(coalesce(p_titulo, ''));
  nid  uuid;
  c    jsonb;
  cats jsonb := '[]'::jsonb;
begin
  if not public.soy_admin() then
    return jsonb_build_object('ok', false, 'error', 'Solo el admin puede hacer esto.');
  end if;
  if t = '' or char_length(t) > 60 then
    return jsonb_build_object('ok', false, 'error', 'El nombre de la votación tiene que tener entre 1 y 60 letras.');
  end if;
  if p_categorias is null or jsonb_typeof(p_categorias) <> 'array' or jsonb_array_length(p_categorias) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Elegí al menos una categoría.');
  end if;
  if jsonb_array_length(p_categorias) > 40 then
    return jsonb_build_object('ok', false, 'error', 'Son demasiadas categorías.');
  end if;
  for c in select * from jsonb_array_elements(p_categorias) loop
    if coalesce(c->>'id', '') = '' or coalesce(btrim(c->>'titulo'), '') = ''
       or coalesce(c->>'tipo', '') not in ('individual', 'dupla') then
      return jsonb_build_object('ok', false, 'error', 'Hay una categoría inválida.');
    end if;
    cats := cats || jsonb_build_array(jsonb_build_object(
      'id', left(c->>'id', 60), 'titulo', left(btrim(c->>'titulo'), 50), 'tipo', c->>'tipo'));
  end loop;
  insert into public.votaciones (titulo, detalle, categorias)
  values (t, nullif(btrim(coalesce(p_detalle, '')), ''), cats)
  returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid);
end;
$$;

create or replace function public.admin_cerrar_votacion(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.soy_admin() then
    return jsonb_build_object('ok', false, 'error', 'Solo el admin puede hacer esto.');
  end if;
  update public.votaciones set estado = 'cerrada', cerrada_at = now() where id = p_id and estado = 'abierta';
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_borrar_votacion(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.soy_admin() then
    return jsonb_build_object('ok', false, 'error', 'Solo el admin puede hacer esto.');
  end if;
  delete from public.votaciones where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_crear_votacion(text, text, jsonb) from public, anon;
revoke all on function public.admin_cerrar_votacion(uuid)             from public, anon;
revoke all on function public.admin_borrar_votacion(uuid)             from public, anon;
grant execute on function public.admin_crear_votacion(text, text, jsonb) to authenticated;
grant execute on function public.admin_cerrar_votacion(uuid)             to authenticated;
grant execute on function public.admin_borrar_votacion(uuid)             to authenticated;
