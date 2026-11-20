-- ==========================================================
-- La Chancha · Permisos para que la web pueda leer y guardar
-- Correlo DESPUÉS de los otros 4 .sql.
-- Pegalo entero en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez sin romper nada.
--
-- Los proyectos nuevos de Supabase no dan acceso a las tablas por defecto.
-- Esto lo da, pero cada fila sigue protegida por las reglas (RLS) de cada
-- tabla: solo los socios con usuario cargan, nadie borra lo de otro y la
-- asistencia la toca solo el admin.
-- ==========================================================

-- Leer: todos (con o sin sesión)
grant select on
  public.asistencia_config, public.socios, public.juntadas, public.juntada_presentes,
  public.votaciones, public.votaciones_votos,
  public.clips, public.clip_votos,
  public.partidos, public.notas, public.dorsales, public.premios
to anon, authenticated;

-- Guardar: solo con sesión. Las reglas RLS deciden quién y qué filas.
grant insert, update, delete on
  public.clips, public.clip_votos,
  public.partidos, public.notas, public.dorsales, public.premios
to authenticated;

-- Funciones que usan las reglas
grant execute on function public.notas_validas(jsonb) to anon, authenticated;
grant execute on function public.es_clip_ajeno(uuid)  to authenticated;
