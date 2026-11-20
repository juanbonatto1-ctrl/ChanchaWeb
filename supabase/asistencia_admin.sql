-- ==========================================================
-- La Chancha · Socios y asistencia a juntadas (solo el admin carga)
-- Pegalo entero en Supabase → SQL Editor → New query → Run.
-- Va PRIMERO. Se puede correr más de una vez: no duplica socios ni borra juntadas.
--
-- Todos pueden VER la asistencia.
-- Solo el usuario admin (ver usuarios.sql) puede registrar juntadas, quitarlas o agregar socios.
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
-- Solo se escribe con las funciones admin_* de abajo, que verifican que seas el admin.

-- ---------- Se saca el PIN viejo (ahora el admin es un usuario) ----------
drop function if exists public.admin_entrar(text);
drop function if exists public.admin_registrar_juntada(text, date, text, text[]);
drop function if exists public.admin_quitar_juntada(text, uuid);
drop function if exists public.admin_agregar_socio(text, text);
drop schema if exists privado cascade;

-- ---------- Funciones del admin (las llama la web) ----------
create or replace function public.admin_registrar_juntada(p_fecha date, p_nombre text, p_presentes text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare nid uuid;
begin
  if not public.soy_admin() then
    return jsonb_build_object('ok', false, 'error', 'Solo el admin puede hacer esto.');
  end if;
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

create or replace function public.admin_quitar_juntada(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.soy_admin() then
    return jsonb_build_object('ok', false, 'error', 'Solo el admin puede hacer esto.');
  end if;
  delete from public.juntadas where id = p_id;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_agregar_socio(p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare n text := btrim(coalesce(p_nombre, ''));
begin
  if not public.soy_admin() then
    return jsonb_build_object('ok', false, 'error', 'Solo el admin puede hacer esto.');
  end if;
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

revoke all on function public.admin_registrar_juntada(date, text, text[]) from public, anon;
revoke all on function public.admin_quitar_juntada(uuid)                  from public, anon;
revoke all on function public.admin_agregar_socio(text)                   from public, anon;
grant execute on function public.admin_registrar_juntada(date, text, text[]) to authenticated;
grant execute on function public.admin_quitar_juntada(uuid)                  to authenticated;
grant execute on function public.admin_agregar_socio(text)                   to authenticated;

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
