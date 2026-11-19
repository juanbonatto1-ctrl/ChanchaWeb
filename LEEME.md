# La Chancha — web

Sitio estático (HTML, CSS y JS). No necesita compilar nada.

## Ver la web en tu compu

```bash
node serve.js
```

Abrí http://localhost:5500

## Publicarla (Netlify)

1. Netlify → **Add new site → Deploy manually**.
2. Arrastrá la carpeta del sitio (o el zip descomprimido). No hay comando de build; la carpeta a publicar es la raíz.
3. Es un sitio aparte de Evas Deco.

## Clip del año: clips y votos compartidos (Supabase)

Sin este paso, los clips y los votos funcionan en **modo de prueba** (solo en tu navegador).

1. **Proyecto:** en supabase.com abrí el proyecto que quieras usar para La Chancha (o creá uno nuevo).
2. **Tablas y permisos:** SQL Editor → New query → pegá todo `supabase/clips.sql` → **Run**.
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
6. Volvé a subir la web a Netlify. En Chancha Awards va a desaparecer el aviso de "Modo de prueba".

### Cómo funciona la votación

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
