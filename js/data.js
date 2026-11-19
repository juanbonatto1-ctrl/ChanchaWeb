/* ==========================================================
   Datos del club. Todo lo demás se calcula solo.
   Lo que se agrega desde la web (partidos, notas, dorsales,
   premios, clips) se guarda en el navegador de cada uno.
   ========================================================== */
window.CHANCHA = {
  club: {
    nombre: "Club Social y Deportivo La Chancha",
    fundacion: 2024,
    fechaFundacion: "2024-02-01", // 1 de febrero de 2024
    temporada: 2026
  },

  /* La ASISTENCIA A JUNTADAS está en js/asistencia.js (la maneja solo el admin). */

  /* ---------- FÚTBOL ----------
     Cada jugador elige su número (no se repiten) y su posición.
     dorsal: null = todavía no eligió. pos: ARQ · DEF · MED · DEL */
  jugadores: [
    { nombre: "Mateo",      dorsal: null, pos: null },
    { nombre: "Sexo7",      dorsal: null, pos: null },
    { nombre: "Nahuel",     dorsal: null, pos: null },
    { nombre: "Paty",       dorsal: null, pos: null },
    { nombre: "Ama",        dorsal: null, pos: null },
    { nombre: "Puebla",     dorsal: null, pos: null },
    { nombre: "Moyano",     dorsal: null, pos: null },
    { nombre: "Utri",       dorsal: null, pos: null },
    { nombre: "Santi",      dorsal: null, pos: null },
    { nombre: "Gordo",      dorsal: null, pos: null },
    { nombre: "Luquinho",   dorsal: null, pos: null },
    { nombre: "ChancaD10s", dorsal: null, pos: null },
    { nombre: "Agus",       dorsal: null, pos: null }
  ],

  /* Partidos. El más reciente es el "partido de la semana".
     titulares = los que juegan el partido del finde (con goles).
     votos = las notas que le ponen los DEMÁS (nadie se pone nota a sí mismo).
     La nota de cada jugador es el promedio de los votos.
     Para un partido que todavía no se jugó, dejá gf y gc en null.
     Los partidos se cargan desde la web con "Agregar partido". */
  partidos: [],

  /* Torneos ganados (se muestran al final de Fútbol) */
  torneos: [
    {
      nombre: "Torneo 2026",        // ← poné el nombre real del torneo
      anio: 2026,
      detalle: "La Chancha salió campeón.", // ← contá cómo fue (rival de la final, resultado…)
      fotos: [
        { src: "img/campeones-1.webp", alt: "El plantel de La Chancha festejando el campeonato frente a la cancha inflable" },
        { src: "img/campeones-2.webp", alt: "Tres jugadores de La Chancha festejando con champán después de la final" }
      ]
    }
  ],

  /* ---------- CHANCHA AWARDS ---------- */
  // Premios extra cargados para todos: { titulo: "Mejor asado", ganador: "Gordo", detalle: "…" }
  premios: [],

  // Clips cargados para todos. url: YouTube, Instagram, TikTok, Drive, etc.
  // Ej.: { titulo: "Golazo de chilena", autor: "Mateo", url: "https://youtu.be/XXXXXXXXXXX", fecha: "2026-11-08" }
  clips: [],

  historial: [
    { anio: 2024, nombre: "Chancha Awards", lugar: "Santa Rosa", ganadores: [] }
  ]
};
