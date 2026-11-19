-- ==========================================================
-- La Chancha · Votaciones de los Chancha Awards
-- Correlo DESPUÉS de asistencia_admin.sql (usa los socios y el PIN de admin).
-- Pegalo entero en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez sin romper nada.
--
-- Reglas:
-- · Solo el admin (PIN) crea, cierra y borra votaciones.
-- · Cada socio vota una vez por votación (puede cambiar su voto mientras esté abierta).
-- · Nadie se vota a sí mismo (ni puede estar en la dupla que vota).
-- · Tipo "individual": se vota a una persona. Tipo "dupla": se vota a una pareja.
-- · Los votos son secretos y no se pueden leer hasta que la votación se cierra.
-- · Si hay empate, ganan todos los empatados (lo calcula la web).
-- Requiere "Allow anonymous sign-ins" activado (un voto por celular).
-- ==========================================================

create table if not exists public.votaciones (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  titulo     text not null check (char_length(titulo) between 1 and 60),
  detalle    text check (detalle is null or char_length(detalle) <= 140),
  tipo       text not null default 'individual' check (tipo in ('individual', 'dupla')),
  estado     text not null default 'abierta' check (estado in ('abierta', 'cerrada')),
  cerrada_at timestamptz
);

create table if not exists public.votaciones_votos (
  votacion_id uuid not null references public.votaciones (id) on delete cascade,
  votante     text not null references public.socios (nombre) on update cascade on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  elegido1    text not null references public.socios (nombre) on update cascade on delete cascade,
  elegido2    text references public.socios (nombre) on update cascade on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (votacion_id, votante),
  constraint votos_un_voto_por_celular unique (votacion_id, user_id),
  constraint votos_no_a_si_mismo check (votante <> elegido1 and (elegido2 is null or votante <> elegido2)),
  constraint votos_dupla_ordenada check (elegido2 is null or elegido1 < elegido2)
);
create index if not exists votaciones_votos_user_idx on public.votaciones_votos (user_id);

alter table public.votaciones       enable row level security;
alter table public.votaciones_votos enable row level security;

drop policy if exists "votaciones: leer"            on public.votaciones;
drop policy if exists "votos: leer si esta cerrada" on public.votaciones_votos;
create policy "votaciones: leer" on public.votaciones for select to anon, authenticated using (true);
-- Los votos solo se pueden leer cuando la votación está cerrada
create policy "votos: leer si esta cerrada" on public.votaciones_votos for select to anon, authenticated
  using (exists (select 1 from public.votaciones v where v.id = votacion_id and v.estado = 'cerrada'));
-- Sin políticas de insert/update/delete: se vota con public.votar() y el admin usa admin_*.

-- Quién ya votó (sin decir a quién), para mostrar "faltan votar"
create or replace function public.votaciones_participacion()
returns table (votacion_id uuid, votante text)
language sql
stable
security definer
set search_path = ''
as $$
  select vv.votacion_id, vv.votante from public.votaciones_votos vv;
$$;
revoke all on function public.votaciones_participacion() from public;
grant execute on function public.votaciones_participacion() to anon, authenticated;

-- Votar (o cambiar el voto mientras está abierta)
create or replace function public.votar(p_votacion uuid, p_votante text, p_elegido1 text, p_elegido2 text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_tipo   text;
  v_estado text;
  v_dueno  uuid;
  e1       text;
  e2       text;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'No hay sesión. Recargá la página.');
  end if;
  select tipo, estado into v_tipo, v_estado from public.votaciones where id = p_votacion;
  if v_tipo is null then
    return jsonb_build_object('ok', false, 'error', 'La votación no existe.');
  end if;
  if v_estado <> 'abierta' then
    return jsonb_build_object('ok', false, 'error', 'La votación ya está cerrada.');
  end if;
  if not exists (select 1 from public.socios where nombre = p_votante) then
    return jsonb_build_object('ok', false, 'error', 'Elegí tu nombre del padrón.');
  end if;

  if v_tipo = 'dupla' then
    if p_elegido1 is null or p_elegido2 is null or p_elegido1 = p_elegido2 then
      return jsonb_build_object('ok', false, 'error', 'Elegí dos personas distintas para la dupla.');
    end if;
    e1 := least(p_elegido1, p_elegido2);
    e2 := greatest(p_elegido1, p_elegido2);
  else
    if p_elegido1 is null then
      return jsonb_build_object('ok', false, 'error', 'Elegí a quién votás.');
    end if;
    e1 := p_elegido1;
    e2 := null;
  end if;

  if p_votante = e1 or p_votante = coalesce(e2, '') then
    return jsonb_build_object('ok', false, 'error', 'No podés votarte a vos mismo.');
  end if;
  if not exists (select 1 from public.socios where nombre = e1)
     or (e2 is not null and not exists (select 1 from public.socios where nombre = e2)) then
    return jsonb_build_object('ok', false, 'error', 'Hay un nombre que no está en el padrón.');
  end if;

  select user_id into v_dueno from public.votaciones_votos
   where votacion_id = p_votacion and votante = p_votante;
  if v_dueno is not null and v_dueno <> v_uid then
    return jsonb_build_object('ok', false, 'error', p_votante || ' ya votó desde otro celular.');
  end if;
  if exists (select 1 from public.votaciones_votos
              where votacion_id = p_votacion and user_id = v_uid and votante <> p_votante) then
    return jsonb_build_object('ok', false, 'error', 'Desde este celular ya votó otra persona en esta votación.');
  end if;

  insert into public.votaciones_votos (votacion_id, votante, user_id, elegido1, elegido2)
  values (p_votacion, p_votante, v_uid, e1, e2)
  on conflict (votacion_id, votante)
  do update set elegido1 = excluded.elegido1, elegido2 = excluded.elegido2, created_at = now();

  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.votar(uuid, text, text, text) from public, anon;
grant execute on function public.votar(uuid, text, text, text) to authenticated;

-- ---------- Admin (con PIN) ----------
create or replace function public.admin_crear_votacion(p_pin text, p_titulo text, p_detalle text, p_tipo text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v   boolean;
  t   text := btrim(coalesce(p_titulo, ''));
  nid uuid;
begin
  v := privado.verificar_pin(p_pin);
  if v is not true then return privado.error_pin(v); end if;
  if t = '' or char_length(t) > 60 then
    return jsonb_build_object('ok', false, 'error', 'El nombre del premio tiene que tener entre 1 y 60 letras.');
  end if;
  if coalesce(p_tipo, '') not in ('individual', 'dupla') then
    return jsonb_build_object('ok', false, 'error', 'Tipo de votación inválido.');
  end if;
  insert into public.votaciones (titulo, detalle, tipo)
  values (t, nullif(btrim(coalesce(p_detalle, '')), ''), p_tipo)
  returning id into nid;
  return jsonb_build_object('ok', true, 'id', nid);
end;
$$;

create or replace function public.admin_cerrar_votacion(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v boolean;
begin
  v := privado.verificar_pin(p_pin);
  if v is not true then return privado.error_pin(v); end if;
  update public.votaciones set estado = 'cerrada', cerrada_at = now() where id = p_id and estado = 'abierta';
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_borrar_votacion(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v boolean;
begin
  v := privado.verificar_pin(p_pin);
  if v is not true then return privado.error_pin(v); end if;
  delete from public.votaciones where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_crear_votacion(text, text, text, text) from public;
revoke all on function public.admin_cerrar_votacion(text, uuid)             from public;
revoke all on function public.admin_borrar_votacion(text, uuid)             from public;
grant execute on function public.admin_crear_votacion(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_cerrar_votacion(text, uuid)             to anon, authenticated;
grant execute on function public.admin_borrar_votacion(text, uuid)             to anon, authenticated;
