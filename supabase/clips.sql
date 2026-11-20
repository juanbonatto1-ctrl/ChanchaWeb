-- ==========================================================
-- La Chancha · Clip del año (clips + votos tipo Reddit)
-- Pegalo entero en Supabase → SQL Editor → New query → Run.
-- Correlo DESPUÉS de usuarios.sql. Se puede correr más de una vez sin romper nada.
-- Todos ven los clips; solo los socios con usuario suben y votan.
-- ==========================================================

-- 1) Clips subidos por los socios
create table if not exists public.clips (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  owner       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  autor       text not null check (char_length(autor) between 1 and 40),
  titulo      text not null check (char_length(titulo) between 1 and 80),
  url         text check (url is null or url ~* '^https?://'),
  video_path  text,
  constraint clips_link_o_video check (url is not null or video_path is not null)
);

-- 2) Votos: uno por persona por clip. +1 = flecha arriba, -1 = flecha abajo
create table if not exists public.clip_votos (
  clip_id    uuid not null references public.clips (id) on delete cascade,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  valor      smallint not null check (valor in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (clip_id, user_id)
);

create index if not exists clip_votos_clip_idx on public.clip_votos (clip_id);
create index if not exists clips_owner_idx on public.clips (owner);

-- 3) Seguridad (RLS): todos leen; cada socio sube con SU nombre, borra lo suyo (el admin, todo)
alter table public.clips      enable row level security;
alter table public.clip_votos enable row level security;

drop policy if exists "clips: leer"          on public.clips;
drop policy if exists "clips: subir propio"  on public.clips;
drop policy if exists "clips: borrar propio" on public.clips;
create policy "clips: leer"          on public.clips for select to anon, authenticated using (true);
create policy "clips: subir propio"  on public.clips for insert to authenticated
  with check (owner = (select auth.uid()) and autor = (select public.mi_nombre()));
create policy "clips: borrar propio" on public.clips for delete to authenticated
  using (owner = (select auth.uid()) or (select public.soy_admin()));

-- No se puede votar el clip propio
create or replace function public.es_clip_ajeno(p_clip uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.clips c
    where c.id = p_clip and c.owner <> (select auth.uid())
  );
$$;
revoke all on function public.es_clip_ajeno(uuid) from public, anon;
grant execute on function public.es_clip_ajeno(uuid) to authenticated;

drop policy if exists "votos: leer"   on public.clip_votos;
drop policy if exists "votos: votar"  on public.clip_votos;
drop policy if exists "votos: cambiar" on public.clip_votos;
drop policy if exists "votos: sacar"  on public.clip_votos;
create policy "votos: leer"    on public.clip_votos for select to anon, authenticated using (true);
create policy "votos: votar"   on public.clip_votos for insert to authenticated
  with check (user_id = (select auth.uid()) and (select public.soy_socio()) and public.es_clip_ajeno(clip_id));
create policy "votos: cambiar" on public.clip_votos for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and (select public.soy_socio()) and public.es_clip_ajeno(clip_id));
create policy "votos: sacar"   on public.clip_votos for delete to authenticated using (user_id = (select auth.uid()));

-- 4) Videos: bucket público "clips" (hasta 50 MB por video, solo MP4/MOV/WebM)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clips', 'clips', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Cada uno sube solo dentro de su carpeta (<su id>/archivo) y borra solo lo suyo
drop policy if exists "clips storage: subir"        on storage.objects;
drop policy if exists "clips storage: borrar propio" on storage.objects;
create policy "clips storage: subir" on storage.objects for insert to authenticated
  with check (bucket_id = 'clips' and (select public.soy_socio()) and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "clips storage: borrar propio" on storage.objects for delete to authenticated
  using (bucket_id = 'clips' and (owner_id = (select auth.uid())::text or (select public.soy_admin())));
