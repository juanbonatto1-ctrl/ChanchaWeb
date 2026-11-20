-- ==========================================================
-- La Chancha · Usuarios
-- Correlo DESPUÉS de asistencia_admin.sql (usa la tabla de socios).
-- Pegalo entero en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez sin romper nada.
--
-- Cada socio tiene su usuario (lo crea el archivo privado cuentas.sql).
-- Solo los socios con usuario pueden votar, cargar y modificar cosas.
-- El usuario con admin = true hace lo que antes se hacía con el PIN.
-- Sin usuario se puede ver todo, pero no tocar nada.
-- ==========================================================

create table if not exists public.usuarios (
  nombre     text primary key references public.socios (nombre) on update cascade on delete cascade,
  user_id    uuid not null unique references auth.users (id) on delete cascade,
  admin      boolean not null default false,
  created_at timestamptz not null default now()
);

-- Nadie lee ni escribe la tabla directo: se usa con las funciones de abajo.
alter table public.usuarios enable row level security;
revoke all on public.usuarios from anon, authenticated;

-- Nombre del socio que tiene la sesión abierta (null si no es un usuario del club)
create or replace function public.mi_nombre()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select u.nombre from public.usuarios u where u.user_id = (select auth.uid());
$$;

create or replace function public.soy_socio()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.usuarios u where u.user_id = (select auth.uid()));
$$;

create or replace function public.soy_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select u.admin from public.usuarios u where u.user_id = (select auth.uid())), false);
$$;

-- Lo usa la web al entrar: quién sos y si sos admin
create or replace function public.yo()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select jsonb_build_object('nombre', u.nombre, 'admin', u.admin) from public.usuarios u where u.user_id = (select auth.uid())),
    jsonb_build_object('nombre', null, 'admin', false)
  );
$$;

revoke all on function public.mi_nombre() from public;
revoke all on function public.soy_socio() from public;
revoke all on function public.soy_admin() from public;
revoke all on function public.yo()        from public;
grant execute on function public.mi_nombre() to anon, authenticated;
grant execute on function public.soy_socio() to anon, authenticated;
grant execute on function public.soy_admin() to anon, authenticated;
grant execute on function public.yo()        to anon, authenticated;
