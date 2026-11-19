-- ==========================================================
-- La Chancha · Fútbol y premios compartidos
-- (partidos, notas entre jugadores, dorsales y premios extra)
-- Pegalo entero en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez sin romper nada.
-- Requiere: Authentication → "Allow anonymous sign-ins" activado
-- (lo mismo que pide clips.sql).
-- ==========================================================

-- Validación de notas: objeto { "Jugador": nota } con notas entre 1 y 10
create or replace function public.notas_validas(n jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select jsonb_typeof(n) = 'object'
     and n <> '{}'::jsonb
     and coalesce((
       select bool_and(jsonb_typeof(e.value) = 'number' and (e.value)::numeric between 1 and 10)
       from jsonb_each(n) as e
     ), false);
$$;

-- ---------- 1) Partidos ----------
-- titulares:       [{ "j": "Mateo", "pos": "MED", "goles": 2 }, ...]
-- suplentes:       ["Utri", "Gordo"]
-- goles_suplentes: { "Paty": 1 }
-- gf / gc en null = partido que todavía no se jugó
create table if not exists public.partidos (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  created_by      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  fecha           date not null,
  rival           text not null check (char_length(rival) between 1 and 40),
  torneo          text not null default 'Amistoso' check (char_length(torneo) between 1 and 40),
  gf              smallint check (gf >= 0),
  gc              smallint check (gc >= 0),
  titulares       jsonb not null default '[]'::jsonb check (case when jsonb_typeof(titulares) = 'array' then jsonb_array_length(titulares) between 1 and 11 else false end),
  suplentes       jsonb not null default '[]'::jsonb check (jsonb_typeof(suplentes) = 'array'),
  goles_suplentes jsonb not null default '{}'::jsonb check (jsonb_typeof(goles_suplentes) = 'object'),
  constraint partidos_resultado_completo check ((gf is null) = (gc is null))
);
create index if not exists partidos_fecha_idx on public.partidos (fecha desc);
create index if not exists partidos_created_by_idx on public.partidos (created_by);

-- ---------- 2) Notas que se ponen entre ellos ----------
-- Una fila por persona que vota en cada partido. Nadie se pone nota a sí mismo.
create table if not exists public.notas (
  partido_id uuid not null references public.partidos (id) on delete cascade,
  votante    text not null check (char_length(votante) between 1 and 40),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  notas      jsonb not null check (public.notas_validas(notas)),
  updated_at timestamptz not null default now(),
  primary key (partido_id, votante),
  constraint notas_un_voto_por_celular unique (partido_id, user_id),
  constraint notas_sin_autovoto check (not (notas ? votante))
);
create index if not exists notas_user_idx on public.notas (user_id);

-- ---------- 3) Dorsales (cada jugador elige su número, sin repetir) ----------
create table if not exists public.dorsales (
  nombre     text primary key check (char_length(nombre) between 1 and 40),
  dorsal     smallint not null check (dorsal between 1 and 99),
  pos        text check (pos in ('ARQ', 'DEF', 'MED', 'DEL')),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  updated_at timestamptz not null default now(),
  constraint dorsales_numero_unico unique (dorsal)
);
create index if not exists dorsales_user_idx on public.dorsales (user_id);

-- ---------- 4) Premios extra de los Chancha Awards ----------
create table if not exists public.premios (
  id         uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  titulo     text not null check (char_length(titulo) between 1 and 50),
  ganador    text not null check (char_length(ganador) between 1 and 40),
  detalle    text check (detalle is null or char_length(detalle) <= 120)
);
create index if not exists premios_created_by_idx on public.premios (created_by);

-- updated_at automático
create or replace function public.tocar_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists notas_updated_at on public.notas;
create trigger notas_updated_at before update on public.notas
  for each row execute function public.tocar_updated_at();
drop trigger if exists dorsales_updated_at on public.dorsales;
create trigger dorsales_updated_at before update on public.dorsales
  for each row execute function public.tocar_updated_at();

-- ---------- Seguridad (RLS) ----------
-- Todos leen. Cada celular (usuario anónimo) carga lo suyo
-- y solo puede cambiar o borrar lo que cargó.
alter table public.partidos enable row level security;
alter table public.notas    enable row level security;
alter table public.dorsales enable row level security;
alter table public.premios  enable row level security;

-- partidos
drop policy if exists "partidos: leer"          on public.partidos;
drop policy if exists "partidos: cargar"        on public.partidos;
drop policy if exists "partidos: borrar propio" on public.partidos;
create policy "partidos: leer"          on public.partidos for select to anon, authenticated using (true);
create policy "partidos: cargar"        on public.partidos for insert to authenticated with check (created_by = (select auth.uid()));
create policy "partidos: borrar propio" on public.partidos for delete to authenticated using (created_by = (select auth.uid()));

-- notas
drop policy if exists "notas: leer"           on public.notas;
drop policy if exists "notas: votar"          on public.notas;
drop policy if exists "notas: cambiar propio" on public.notas;
drop policy if exists "notas: borrar propio"  on public.notas;
create policy "notas: leer"           on public.notas for select to anon, authenticated using (true);
create policy "notas: votar"          on public.notas for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notas: cambiar propio" on public.notas for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "notas: borrar propio"  on public.notas for delete to authenticated using (user_id = (select auth.uid()));

-- dorsales
drop policy if exists "dorsales: leer"           on public.dorsales;
drop policy if exists "dorsales: elegir"         on public.dorsales;
drop policy if exists "dorsales: cambiar propio" on public.dorsales;
drop policy if exists "dorsales: borrar propio"  on public.dorsales;
create policy "dorsales: leer"           on public.dorsales for select to anon, authenticated using (true);
create policy "dorsales: elegir"         on public.dorsales for insert to authenticated with check (user_id = (select auth.uid()));
create policy "dorsales: cambiar propio" on public.dorsales for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "dorsales: borrar propio"  on public.dorsales for delete to authenticated using (user_id = (select auth.uid()));

-- premios
drop policy if exists "premios: leer"          on public.premios;
drop policy if exists "premios: cargar"        on public.premios;
drop policy if exists "premios: borrar propio" on public.premios;
create policy "premios: leer"          on public.premios for select to anon, authenticated using (true);
create policy "premios: cargar"        on public.premios for insert to authenticated with check (created_by = (select auth.uid()));
create policy "premios: borrar propio" on public.premios for delete to authenticated using (created_by = (select auth.uid()));
