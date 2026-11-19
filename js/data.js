/* ==========================================================
   Datos del club. Todo lo demás se calcula solo.
   Lo que se agrega desde la web (partidos, notas, dorsales,
   premios, clips) se guarda en el navegador de cada uno.
   ========================================================== */
window.CHANCHA = {
  club: {
    nombre: "Club Social y Deportivo La Chancha",
    fundacion: 2019, // año ficticio
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
     ejemplo: true → se muestra con la marca "Ejemplo". Borrá estos y cargá los reales. */
  partidos: [
    {
      id: "p3", fecha: "2026-11-08", rival: "Los Halcones", torneo: "Amistoso", gf: 4, gc: 2, ejemplo: true,
      titulares: [
        { j: "Puebla", pos: "ARQ" },
        { j: "Nahuel", pos: "DEF" },
        { j: "Moyano", pos: "DEF" },
        { j: "Ama",    pos: "MED", goles: 1 },
        { j: "Mateo",  pos: "MED", goles: 2 },
        { j: "Paty",   pos: "MED" },
        { j: "Sexo7",  pos: "DEL", goles: 1 }
      ],
      suplentes: ["Utri", "Gordo"],
      votos: [
        { votante: "Gordo", notas: { Puebla: 7, Nahuel: 7.5, Moyano: 6.5, Ama: 7.5, Mateo: 8.5, Paty: 7, Sexo7: 8 } },
        { votante: "Utri",  notas: { Puebla: 7, Nahuel: 8, Moyano: 6, Ama: 7, Mateo: 9, Paty: 7, Sexo7: 8 } },
        { votante: "Mateo", notas: { Puebla: 7.5, Nahuel: 7, Moyano: 7, Ama: 8, Paty: 7.5, Sexo7: 8.5 } }
      ]
    },
    {
      id: "p2", fecha: "2026-11-01", rival: "Deportivo Barrio", torneo: "Amistoso", gf: 2, gc: 2, ejemplo: true,
      titulares: [
        { j: "Puebla", pos: "ARQ" },
        { j: "Nahuel", pos: "DEF" },
        { j: "Utri",   pos: "DEF" },
        { j: "Mateo",  pos: "MED", goles: 1 },
        { j: "Santi",  pos: "MED" },
        { j: "Paty",   pos: "MED" },
        { j: "Gordo",  pos: "DEL", goles: 1 }
      ],
      suplentes: ["Ama"],
      votos: [
        { votante: "Ama",   notas: { Puebla: 6.5, Nahuel: 7, Utri: 6, Mateo: 7.5, Santi: 6.5, Paty: 7, Gordo: 7 } },
        { votante: "Sexo7", notas: { Puebla: 6, Nahuel: 7, Utri: 6.5, Mateo: 8, Santi: 6, Paty: 7.5, Gordo: 7.5 } }
      ]
    },
    {
      id: "p1", fecha: "2026-10-25", rival: "Atlético Esquina", torneo: "Amistoso", gf: 3, gc: 1, ejemplo: true,
      titulares: [
        { j: "Agus",   pos: "ARQ" },
        { j: "Moyano", pos: "DEF" },
        { j: "Nahuel", pos: "DEF" },
        { j: "Ama",    pos: "MED" },
        { j: "Mateo",  pos: "MED", goles: 1 },
        { j: "Paty",   pos: "MED", goles: 1 },
        { j: "Sexo7",  pos: "DEL", goles: 1 }
      ],
      suplentes: ["Luquinho", "ChancaD10s"],
      votos: [
        { votante: "Luquinho", notas: { Agus: 7, Moyano: 7, Nahuel: 7.5, Ama: 7, Mateo: 8, Paty: 7.5, Sexo7: 8.5 } }
      ]
    }
  ],

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
