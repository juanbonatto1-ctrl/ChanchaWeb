# La Chancha — web

Sitio estático (HTML, CSS y JS). No necesita compilar nada.

## Ver la web en tu compu

```bash
node serve.js
```

Abrí http://localhost:5500

## Publicarla (Vercel)

1. Vercel → **Add New → Project** e importá esta carpeta (desde GitHub o con `vercel` desde la terminal).
2. Framework: **Other**. No hay comando de build y el directorio de salida es la raíz (`.`).
3. Es un proyecto aparte de Evas Deco.

## Datos compartidos (Supabase)

Partidos, notas, dorsales, premios, clips y votos se guardan en Supabase y los ve todo el grupo.
Sin este paso funcionan en **modo de prueba** (cada uno ve solo lo que cargó en su navegador).

1. **Proyecto:** en supabase.com abrí el proyecto que quieras usar para La Chancha (o creá uno nuevo).
2. **Tablas y permisos:** en SQL Editor → New query, corré estos archivos en este orden, cada uno entero → **Run**:
   1. `supabase/asistencia_admin.sql`: socios y asistencia a juntadas. **Va primero.**
   2. `supabase/usuarios.sql`: usuarios del club y quién es admin.
   3. `supabase/votaciones.sql`: votación de los Chancha Awards.
   4. `supabase/clips.sql`: clips y votos del Clip del año.
   5. `supabase/futbol_premios.sql`: partidos, notas, dorsales y categorías de premios.
   6. `supabase/permisos.sql`: deja que la web lea y guarde.
   7. `cuentas.sql` de la carpeta privada **ChanchaWeb-privado** (fuera de esta carpeta): crea los 13 usuarios. **Va último.**
3. **Login:** Authentication → Sign In / Providers:
   - Dejá activado **Email** (los usuarios entran con nombre y contraseña; no se manda ningún mail).
   - Desactivá **Allow new users to sign up**, así nadie se crea una cuenta por su cuenta.
   - Desactivá **Allow anonymous sign-ins**: ya no hace falta.
4. **Claves:** Project Settings → API (o "API Keys"). Copiá:
   - **Project URL**
   - la clave **anon** / **publishable** (la pública)
5. Pegalas en `js/config.js`:

   ```js
   window.CHANCHA_SUPABASE = {
     url: "https://TU-PROYECTO.supabase.co",
     anonKey: "TU-CLAVE-ANON"
   };
   ```

   ⚠️ Nunca pongas la clave **service_role / secret**.
6. Volvé a publicar la web en Vercel.

## Usuarios

- Cada socio tiene su usuario. Las contraseñas están en `ChanchaWeb-privado/usuarios.txt`: pasáselas a cada uno por privado. **Esa carpeta no se sube a GitHub ni a Vercel.**
- Para entrar: **Entrar** (arriba a la derecha), elegís tu nombre y ponés tu contraseña. La primera vez te pide elegir la remera (número y posición).
- En **Mi cuenta** (tu nombre arriba a la derecha) podés cambiar la contraseña, cambiar la remera y salir.
- Sin usuario se puede ver todo, pero no votar ni cargar nada.
- **Sexo7 es el admin:** registra juntadas, agrega socios, abre y cierra votaciones, edita y borra categorías, y puede quitar partidos, clips y dorsales de cualquiera.
- Si alguien se olvida la contraseña: en Supabase → Authentication → Users buscá su usuario (`nombre@lachancha.club`) y cambiale la contraseña desde ahí. El mail de recuperación no sirve porque esos mails no existen.

### Quién puede cambiar qué

- **Partidos y categorías:** cualquier socio los carga. Los quita quien los cargó o el admin. Las categorías las edita solo el admin.
- **Notas:** cada uno vota con su usuario, una vez por partido (puede cambiar su voto). Nadie se pone nota a sí mismo ni vota por otro.
- **Dorsales:** no se repiten. Cada uno elige el suyo; el admin puede cambiar el de cualquiera.

### Votaciones de los Chancha Awards

- Las categorías se cargan con **Agregar premio**: cada una dice si se vota **a una persona** o **a una dupla**. Si le ponés ganador, no se vota.
- El admin toca **Abrir votación**. Entran todas las categorías sin ganador (puede destildar alguna).
- Cada uno toca **Votar** y completa la boleta con todas las categorías de una vez, siempre con su nombre. Puede dejar alguna vacía. Nunca puede votarse a sí mismo ni estar en la dupla que vota. Puede cambiar su boleta mientras siga abierta.
- Mientras está abierta solo se ve cuántos votaron y quiénes faltan. Los votos son secretos.
- Cuando el admin la cierra (**Cerrar y ver resultados**) aparecen los ganadores y las **Estadísticas**. Si hay empate, ganan todos los empatados.

### Cómo funciona la votación de clips

- Cada socio sube clips con un link (YouTube, Instagram, TikTok, Drive) o el video directo (hasta 50 MB).
- ▲ suma un punto y ▼ resta uno. Tocar la misma flecha de nuevo saca el voto.
- Un voto por clip por usuario, y nadie puede votar su propio clip.
- Los clips se ordenan por puntaje. El primero es el **Clip del año**.
- Cada uno quita sus clips; el admin puede quitar cualquiera.

## Asistencia (solo el admin)

Entrá con el usuario admin → Asistencia → **Registrar juntada** o **Agregar socio**. Se guarda al instante y lo ve todo el grupo.
Un socio nuevo no tiene usuario: hay que agregarlo en `cuentas.sql` y volver a correrlo.

**Modo de prueba** (sin `js/config.js`): todo queda en tu navegador y para entrar sirve cualquier contraseña (Sexo7 es el admin).
## Archivos

- `js/data.js`: fútbol, torneos, premios y textos.
- `js/asistencia.js`: asistencia de respaldo (la web usa la de Supabase).
- `js/config.js`: conexión a Supabase (asistencia, fútbol, premios, votaciones y clips).
- `css/tokens.css`: colores, tipografías y espacios. Si querés cambiar el estilo, tocás solo este archivo.
