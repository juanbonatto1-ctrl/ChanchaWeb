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
2. **Tablas y permisos:** en SQL Editor → New query, corré estos dos archivos, cada uno entero → **Run**:
   - `supabase/clips.sql`: clips y votos del Clip del año.
   - `supabase/futbol_premios.sql`: partidos, notas, dorsales y premios.
3. **Login sin cuenta:** Authentication → Sign In / Providers → activá **Allow anonymous sign-ins**.
   Cada celular queda identificado solo, sin mail ni contraseña.
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
6. Volvé a publicar la web en Vercel. En Chancha Awards va a desaparecer el aviso de "Modo de prueba".

### Quién puede cambiar qué

- **Partidos y premios:** cualquiera los carga. Solo los puede quitar quien los cargó, desde su celular.
- **Notas:** cada uno elige su nombre y vota una vez por partido desde su celular. Puede cambiar su voto, pero nadie se pone nota a sí mismo.
- **Dorsales:** no se repiten. El número de cada jugador solo lo puede cambiar el celular que lo eligió.

### Cómo funciona la votación de clips

- Cada uno sube un clip con un link (YouTube, Instagram, TikTok, Drive) o el video directo (hasta 50 MB).
- ▲ suma un punto y ▼ resta uno. Tocar la misma flecha de nuevo saca el voto.
- Hay un voto por clip en cada celular, y nadie puede votar su propio clip.
- Los clips se ordenan por puntaje. El primero es el **Clip del año**.
- Cada uno puede quitar solo los clips que subió desde su celular.

> Es un sistema para un grupo de amigos. Alguien que borre los datos del navegador o use otro
> celular podría votar de nuevo.

## Asistencia (solo el admin)

Asistencia → **Entrar como admin** (la primera vez creás el PIN) → **Registrar juntada** → **Descargar asistencia.js**.
Reemplazá `js/asistencia.js` con el descargado y volvé a publicar.

## Archivos

- `js/data.js`: fútbol, torneos, premios y textos.
- `js/asistencia.js`: asistencia. Lo genera el admin desde la web.
- `js/config.js`: conexión a Supabase para los clips.
- `css/tokens.css`: colores, tipografías y espacios. Si querés cambiar el estilo, tocás solo este archivo.
