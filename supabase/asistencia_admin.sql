-- ==========================================================
-- La Chancha · Asistencia a juntadas (solo el admin carga)
-- Pegalo entero en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez: no duplica socios ni borra juntadas.
--
-- Todos pueden VER la asistencia.
-- Solo el admin (con PIN) puede registrar juntadas, quitarlas o agregar socios.
-- El PIN se verifica en la base (no en la página) y se guarda cifrado.
-- Después de 10 intentos fallidos se bloquea 15 minutos.
-- ==========================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------- Tablas públicas (solo lectura para todos) ----------
create table if not exists public.asistencia_config (
  id             smallint primary key default 1 check (id = 1),
  juntadas_base  integer not null check (juntadas_base >= 0),
  umbral         numeric(4, 3) not null default 0.7 check (umbral > 0 and umbral <= 1),
  fuente         text not null default 'Chancha2026'
);

create table if not exists public.socios (
  nombre           text primary key check (char_length(nombre) between 1 and 30),
  orden            integer not null unique,          -- define el N.º de socio
  asistencias_base integer not null default 0 check (asistencias_base >= 0),
  created_at       timestamptz not null default now()
);

create table if not exists public.juntadas (
  id         uuid primary key default gen_random_uuid(),
  fecha      date not null,
  nombre     text check (nombre is null or char_length(nombre) <= 50),
  created_at timestamptz not null default now()
);
create index if not exists juntadas_fecha_idx on public.juntadas (fecha);

create table if not exists public.juntada_presentes (
  juntada_id uuid not null references public.juntadas (id) on delete cascade,
  socio      text not null references public.socios (nombre) on update cascade on delete cascade,
  primary key (juntada_id, socio)
);
create index if not exists juntada_presentes_socio_idx on public.juntada_presentes (socio);

alter table public.asistencia_config  enable row level security;
alter table public.socios             enable row level security;
alter table public.juntadas           enable row level security;
alter table public.juntada_presentes  enable row level security;

drop policy if exists "asistencia_config: leer" on public.asistencia_config;
drop policy if exists "socios: leer"            on public.socios;
drop policy if exists "juntadas: leer"          on public.juntadas;
drop policy if exists "juntada_presentes: leer" on public.juntada_presentes;
create policy "asistencia_config: leer" on public.asistencia_config for select to anon, authenticated using (true);
create policy "socios: leer"            on public.socios            for select to anon, authenticated using (true);
create policy "juntadas: leer"          on public.juntadas          for select to anon, authenticated using (true);
create policy "juntada_presentes: leer" on public.juntada_presentes for select to anon, authenticated using (true);
-- Sin políticas de insert/update/delete: nadie escribe directo.
-- Solo se escribe con las funciones admin_* de abajo, que piden el PIN.

-- ---------- Esquema privado: admin e intentos (no se expone) ----------
create schema if not exists privado;
revoke all on schema privado from public, anon, authenticated;

create table if not exists privado.admin (
  id       smallint primary key default 1 check (id = 1),
  usuario  text not null,
  pin_hash text not null
);

create table if not exists privado.intentos (
  id  bigint generated always as identity primary key,
  at  timestamptz not null default now(),
  ok  boolean not null
);

-- Devuelve true (PIN bien), false (PIN mal) o null (bloqueado por intentos)
create or replace function privado.verificar_pin(p_pin text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fallos integer;
  v_ok     boolean;
begin
  delete from privado.intentos where at < now() - interval '1 day';
  select count(*) into v_fallos
    from privado.intentos
   where not ok and at > now() - interval '15 minutes';
  if v_fallos >= 10 then
    return null;
  end if;
  select exists (
    select 1 from privado.admin a
     where a.pin_hash = extensions.crypt(coalesce(p_pin, ''), a.pin_hash)
  ) into v_ok;
  insert into privado.intentos (ok) values (v_ok);
  return v_ok;
end;
$$;
revoke all on function privado.verificar_pin(text) from public, anon, authenticated;

create or replace function privado.error_pin(p_ok boolean)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case
    when p_ok is null then jsonb_build_object('ok', false, 'error', 'Demasiados intentos fallidos. Esperá 15 minutos.')
    else jsonb_build_object('ok', false, 'error', 'PIN incorrecto.')
  end;
$$;
revoke all on function privado.error_pin(boolean) from public, anon, authenticated;

-- ---------- Funciones del admin (las llama la web) ----------
create or replace function public.admin_entrar(p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v boolean;
begin
  v := privado.verificar_pin(p_pin);
  if v is not true then return privado.error_pin(v); end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_registrar_juntada(p_pin text, p_fecha date, p_nombre text, p_presentes text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v   boolean;
  nid uuid;
begin
  v := privado.verificar_pin(p_pin);
  if v is not true then return privado.error_pin(v); end if;
  if p_fecha is null then
    return jsonb_build_object('ok', false, 'error', 'Falta la fecha.');
  end if;
  if coalesce(array_length(p_presentes, 1), 0) = 0 then
    return jsonb_build_object('ok', false, 'error', 'Marcá al menos a uno que haya venido.');
  end if;
  if exists (
    select 1 from unnest(p_presentes) as u (s)
     where not exists (select 1 from public.socios so where so.nombre = u.s)
  ) then
    return jsonb_build_object('ok', false, 'error', 'Hay presentes que no están en el padrón.');
  end if;
  insert into public.juntadas (fecha, nombre)
  values (p_fecha, nullif(btrim(coalesce(p_nombre, '')), ''))
  returning id into nid;
  insert into public.juntada_presentes (juntada_id, socio)
  select distinct nid, u.s from unnest(p_presentes) as u (s);
  return jsonb_build_object('ok', true, 'id', nid);
end;
$$;

create or replace function public.admin_quitar_juntada(p_pin text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v boolean;
begin
  v := privado.verificar_pin(p_pin);
  if v is not true then return privado.error_pin(v); end if;
  delete from public.juntadas where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_agregar_socio(p_pin text, p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v boolean;
  n text := btrim(coalesce(p_nombre, ''));
begin
  v := privado.verificar_pin(p_pin);
  if v is not true then return privado.error_pin(v); end if;
  if n = '' or char_length(n) > 30 then
    return jsonb_build_object('ok', false, 'error', 'El nombre tiene que tener entre 1 y 30 letras.');
  end if;
  if exists (select 1 from public.socios where lower(nombre) = lower(n)) then
    return jsonb_build_object('ok', false, 'error', n || ' ya es socio.');
  end if;
  insert into public.socios (nombre, orden, asistencias_base)
  values (n, coalesce((select max(orden) from public.socios), 0) + 1, 0);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.admin_entrar(text)                                from public;
revoke all on function public.admin_registrar_juntada(text, date, text, text[]) from public;
revoke all on function public.admin_quitar_juntada(text, uuid)                  from public;
revoke all on function public.admin_agregar_socio(text, text)                   from public;
grant execute on function public.admin_entrar(text)                                to anon, authenticated;
grant execute on function public.admin_registrar_juntada(text, date, text, text[]) to anon, authenticated;
grant execute on function public.admin_quitar_juntada(text, uuid)                  to anon, authenticated;
grant execute on function public.admin_agregar_socio(text, text)                   to anon, authenticated;

-- ---------- Datos iniciales ----------
-- Totales de la planilla Chancha2026 (68 juntadas)
insert into public.asistencia_config (id, juntadas_base, umbral, fuente)
values (1, 68, 0.7, 'Chancha2026')
on conflict (id) do nothing;

insert into public.socios (nombre, orden, asistencias_base) values
  ('Mateo', 1, 61), ('Sexo7', 2, 59), ('Nahuel', 3, 53), ('Paty', 4, 53),
  ('Ama', 5, 45), ('Puebla', 6, 43), ('Moyano', 7, 40), ('Utri', 8, 28),
  ('Santi', 9, 25), ('Gordo', 10, 24), ('Luquinho', 11, 17), ('ChancaD10s', 12, 15),
  ('Agus', 13, 8)
on conflict (nombre) do nothing;

-- Admin único. PIN: 6767 (queda guardado cifrado).
-- Para cambiarlo, cambiá el número acá y volvé a correr el archivo.
insert into privado.admin (id, usuario, pin_hash)
values (1, 'admin', extensions.crypt('6767', extensions.gen_salt('bf')))
on conflict (id) do update set pin_hash = excluded.pin_hash, usuario = excluded.usuario;
