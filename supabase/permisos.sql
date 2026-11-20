-- ==========================================================
-- La Chancha · Permisos para que la web pueda leer y guardar
-- Correlo DESPUÉS de los otros 4 .sql.
-- Pegalo entero en Supabase → SQL Editor → New query → Run.
-- Se puede correr más de una vez sin romper nada.
--
-- Los proyectos nuevos de Supabase no dan acceso a las tablas por defecto.
-- Esto lo da, pero cada fila sigue protegida por las reglas (RLS) de cada
-- tabla: nadie puede borrar lo de otro ni tocar la asistencia sin el PIN.
-- ==========================================================

-- Leer: todos (con o sin sesión)
grant select on
  public.asistencia_config, public.socios, public.juntadas, public.juntada_presentes,
  public.votaciones, public.votaciones_votos,
  public.clips, public.clip_votos,
  public.partidos, public.notas, public.dorsales, public.premios
to anon, authenticated;

-- Guardar: solo con sesión (cada celular). Las reglas RLS deciden qué filas.
grant insert, update, delete on
  public.clips, public.clip_votos,
  public.partidos, public.notas, public.dorsales, public.premios
to authenticated;

-- Funciones que usan las reglas
grant execute on function public.notas_validas(jsonb) to anon, authenticated;
grant execute on function public.es_clip_ajeno(uuid)  to authenticated;
