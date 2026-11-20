/* La Chancha — render de páginas a partir de data.js + lo cargado en este navegador */
(function () {
  "use strict";

  var D = window.CHANCHA;
  var FILE_A = window.CHANCHA_ASISTENCIA;
  var page = document.body.getAttribute("data-page");
  var K = { partidos: "chancha.partidos", votos: "chancha.votos", dorsales: "chancha.dorsales", premios: "chancha.premios", clips: "chancha.clips", clipVotos: "chancha.clipVotos", asistencia: "chancha.asistencia", admin: "chancha.admin" };

  /* ================= utilidades ================= */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function pad(n, l) { return String(n).padStart(l || 3, "0"); }
  function pctNum(p, d) {
    d = d === undefined ? 1 : d;
    return (p * 100).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function pct(p, d) { return pctNum(p, d) + "%"; }
  function nota1(n) { return n.toLocaleString("es-AR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }); }
  function names(list) { return list.map(function (s) { return esc(s.nombre); }).join(" &amp; "); }
  function plural(n, s, p) { return n + " " + (n === 1 ? s : p); }
  function fecha(iso, opts) {
    var d = new Date(iso + "T12:00:00");
    if (isNaN(d)) return esc(iso);
    return d.toLocaleDateString("es-AR", opts || { day: "numeric", month: "short", year: "numeric" });
  }
  function hoy() {
    var d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 10);
  }
  function storeGet(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function storeSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function initials(n) { return String(n).replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/g, "").slice(0, 2).toUpperCase(); }
  function options(list, sel) {
    return list.map(function (o) {
      var v = typeof o === "string" ? o : o.v, l = typeof o === "string" ? o : o.l;
      return '<option value="' + esc(v) + '"' + (v === sel ? " selected" : "") + ">" + esc(l) + "</option>";
    }).join("");
  }

  /* ================= asistencia (juntadas) ================= */
  // El archivo js/asistencia.js es lo publicado. Si el admin cargó cambios en este
  // navegador más nuevos que el archivo, se usan esos (hasta que publique el archivo nuevo).
  // Con Supabase (js/config.js completo) la asistencia se lee y se guarda en la base
  // y la ve todo el grupo al instante; el archivo queda solo como respaldo.
  var A, TOTAL, UMBRAL, socios, ranking, titularesJuntadas, sumAsist, promedio, minTitular, NOMBRES, cambiosSinPublicar;
  var REMOTE_A = null, REMOTE_A_ERROR = null;

  function getA() {
    if (ONLINE) return REMOTE_A || FILE_A;
    var loc = storeGet(K.asistencia, null);
    if (loc && loc.actualizado && loc.actualizado > (FILE_A.actualizado || "")) return loc;
    return FILE_A;
  }
  function cloneA() { return JSON.parse(JSON.stringify(getA())); }
  function saveA(obj) {
    obj.actualizado = new Date().toISOString();
    return storeSet(K.asistencia, obj);
  }
  /* ================= usuarios =================
     Cada socio entra con su usuario (nombre + contraseña). Solo con usuario se vota y se carga.
     ME = { nombre, admin } del que tiene la sesión abierta, o null. */
  var ME = null;
  var KU = "chancha.usuario";      // modo de prueba (sin Supabase): usuario simulado
  var ADMIN_PRUEBA = "Sexo7";      // admin en el modo de prueba
  function isAdmin() { return !!(ME && ME.admin); }
  function emailDe(nombre) {
    return String(nombre).toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "") + "@lachancha.club";
  }
  function loadMe() {
    if (!ONLINE) {
      var n = storeGet(KU, "");
      ME = n ? { nombre: n, admin: n === ADMIN_PRUEBA } : null;
      return Promise.resolve();
    }
    return sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s || s.user.is_anonymous) { ME = null; return; }
      return sb.rpc("yo").then(function (r2) {
        var d = r2.data;
        ME = d && d.nombre ? { nombre: d.nombre, admin: !!d.admin } : null;
      });
    }).catch(function () { ME = null; });
  }

  function loadAsistRemote() {
    if (!ONLINE) return Promise.resolve();
    return Promise.all([
      sb.from("asistencia_config").select("juntadas_base,umbral,fuente").eq("id", 1).maybeSingle(),
      sb.from("socios").select("nombre,orden,asistencias_base").order("orden"),
      sb.from("juntadas").select("id,fecha,nombre,created_at,juntada_presentes(socio)").order("fecha")
    ]).then(function (r) {
      r.forEach(check);
      var cfg = r[0].data || { juntadas_base: 0, umbral: 0.7, fuente: "Supabase" };
      var base = {};
      r[1].data.forEach(function (s) { base[s.nombre] = s.asistencias_base; });
      REMOTE_A = {
        fuente: cfg.fuente,
        umbralTitular: Number(cfg.umbral),
        socios: r[1].data.map(function (s) { return s.nombre; }),
        base: { juntadas: cfg.juntadas_base, asistencias: base },
        juntadas: r[2].data.map(function (j) {
          return { id: j.id, fecha: j.fecha, nombre: j.nombre || "", creado: j.created_at, presentes: (j.juntada_presentes || []).map(function (p) { return p.socio; }) };
        })
      };
      REMOTE_A_ERROR = null;
    }).catch(function (e) { REMOTE_A_ERROR = friendly(e); });
  }

  // Llama a una función admin_* de Supabase (verifica en la base que seas el admin); devuelve un error o nada.
  function adminRpc(fn, args, recargar) {
    return sb.rpc(fn, args).then(function (r) {
      check(r);
      if (!r.data || !r.data.ok) return (r.data && r.data.error) || "No se pudo guardar.";
      return (recargar || loadAsistRemote)().then(function () { return null; });
    }).catch(function (e) { return friendly(e); });
  }

  function refreshA() {
    A = getA();
    cambiosSinPublicar = !ONLINE && A !== FILE_A;
    UMBRAL = A.umbralTitular;
    var js = A.juntadas || [];
    TOTAL = A.base.juntadas + js.length;
    socios = A.socios.map(function (n, i) {
      var a = (A.base.asistencias[n] || 0) + js.filter(function (j) { return j.presentes.indexOf(n) >= 0; }).length;
      var p = TOTAL ? a / TOTAL : 0;
      return { nombre: n, asistencias: a, nro: i + 1, pct: p, titular: p >= UMBRAL };
    });
    socios.forEach(function (s) {
      s.rank = 1 + socios.filter(function (o) { return o.asistencias > s.asistencias; }).length;
    });
    ranking = socios.slice().sort(function (a, b) { return b.asistencias - a.asistencias || a.nro - b.nro; });
    titularesJuntadas = ranking.filter(function (s) { return s.titular; });
    sumAsist = socios.reduce(function (a, s) { return a + s.asistencias; }, 0);
    promedio = socios.length && TOTAL ? sumAsist / (socios.length * TOTAL) : 0;
    minTitular = Math.ceil(UMBRAL * TOTAL - 1e-9);
    NOMBRES = socios.map(function (s) { return s.nombre; });
  }

  function descargarAsistencia() {
    var obj = JSON.parse(JSON.stringify(A));
    var txt =
      "/* Asistencia a juntadas.\n" +
      "   Generado desde la web el " + new Date().toLocaleString("es-AR") + ".\n" +
      "   Reemplazá con este archivo el js/asistencia.js del sitio publicado. */\n" +
      "window.CHANCHA_ASISTENCIA = " + JSON.stringify(obj, null, 2) + ";\n";
    var url = URL.createObjectURL(new Blob([txt], { type: "text/javascript;charset=utf-8" }));
    var a = document.createElement("a");
    a.href = url; a.download = "asistencia.js";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ================= fútbol: modelo ================= */
  var POS = ["ARQ", "DEF", "MED", "DEL"];
  var POS_LABEL = { ARQ: "Arquero", DEF: "Defensor", MED: "Mediocampista", DEL: "Delantero" };
  var RES = { G: "Ganado", E: "Empate", P: "Perdido" };
  function res(p) { return p.gf > p.gc ? "G" : p.gf < p.gc ? "P" : "E"; }
  function jugado(p) { return p.gf != null && p.gc != null; }

  /* ================= datos compartidos (Supabase) =================
     Con js/config.js completo → partidos, notas, dorsales, premios y clips se guardan
     en Supabase y los ve todo el grupo. Sin config → se guardan en este navegador. */
  var CFG = window.CHANCHA_SUPABASE || {};
  var ONLINE = !!(CFG.url && CFG.anonKey && window.supabase && window.supabase.createClient);
  var sb = ONLINE ? window.supabase.createClient(CFG.url, CFG.anonKey) : null;
  var REMOTE = { loaded: !ONLINE, error: null, uid: null, partidos: [], notas: {}, dorsales: {}, premios: [] };

  // Devuelve el usuario con sesión abierta; si no entró con su usuario, corta con un error.
  function ensureSession() {
    return sb.auth.getSession().then(function (r) {
      var s = r.data && r.data.session;
      if (!s || !ME) throw new Error("Entrá con tu usuario para hacer esto.");
      return s.user;
    });
  }
  function check(r) { if (r && r.error) throw r.error; return r; }
  function friendly(e, dup) {
    var m = (e && e.message) || String(e);
    if (e && e.code === "23505") return dup || "Eso ya está cargado.";
    if (/row-level security/i.test(m)) return "No tenés permiso para cambiar eso.";
    if (/Invalid login credentials/i.test(m)) return "Usuario o contraseña incorrectos.";
    if (/Failed to fetch|NetworkError/i.test(m)) return "Sin conexión. Probá de nuevo.";
    return m;
  }

  function loadRemote() {
    if (!ONLINE) return Promise.resolve();
    return Promise.all([
      sb.from("partidos").select("id,created_by,fecha,rival,torneo,gf,gc,titulares,suplentes,goles_suplentes"),
      sb.from("notas").select("partido_id,votante,user_id,notas"),
      sb.from("dorsales").select("nombre,dorsal,pos,user_id"),
      sb.from("premios").select("id,created_by,titulo,tipo,ganador,detalle,created_at").order("created_at"),
      sb.auth.getSession()
    ]).then(function (r) {
      for (var i = 0; i < 4; i++) check(r[i]);
      var uid = r[4].data && r[4].data.session ? r[4].data.session.user.id : null;
      REMOTE.uid = uid;
      REMOTE.partidos = r[0].data.map(function (p) {
        return {
          id: p.id, fecha: p.fecha, rival: p.rival, torneo: p.torneo, gf: p.gf, gc: p.gc,
          titulares: p.titulares || [], suplentes: p.suplentes || [], golesSuplentes: p.goles_suplentes || {},
          local: !!uid && p.created_by === uid
        };
      });
      REMOTE.notas = {};
      r[1].data.forEach(function (n) {
        (REMOTE.notas[n.partido_id] = REMOTE.notas[n.partido_id] || []).push({ votante: n.votante, notas: n.notas, mio: n.user_id === uid });
      });
      REMOTE.dorsales = {};
      r[2].data.forEach(function (d) { REMOTE.dorsales[d.nombre] = { dorsal: d.dorsal, pos: d.pos, mio: d.user_id === uid }; });
      REMOTE.premios = r[3].data.map(function (p) { return { id: p.id, titulo: p.titulo, tipo: p.tipo || "individual", ganador: p.ganador || "", detalle: p.detalle, mio: p.created_by === uid }; });
      REMOTE.error = null;
    }).catch(function (e) {
      REMOTE.error = friendly(e);
    }).then(function () { REMOTE.loaded = true; });
  }

  // Ejecuta una escritura en Supabase y recarga; devuelve un mensaje de error o nada.
  function remoteWrite(fn, dup) {
    return ensureSession().then(fn).then(check).then(function (r) {
      return loadRemote().then(function () { return r; });
    }).then(function () { return null; }, function (e) { return friendly(e, dup); });
  }

  function remoteNotice() {
    if (!ONLINE) return "";
    if (!REMOTE.loaded) return '<p class="notice">Cargando datos del grupo…</p>';
    if (REMOTE.error) return '<p class="notice"><strong>No se pudieron cargar los datos del grupo.</strong> ' + esc(REMOTE.error) + "</p>";
    return "";
  }

  function getPlantel() {
    var over = ONLINE ? REMOTE.dorsales : storeGet(K.dorsales, {});
    var base = (D.jugadores || []).slice();
    NOMBRES.forEach(function (n) {
      if (!base.some(function (j) { return j.nombre === n; })) base.push({ nombre: n, dorsal: null, pos: null });
    });
    return base.map(function (j) {
      var o = over[j.nombre] || {};
      return { nombre: j.nombre, dorsal: o.dorsal != null ? o.dorsal : j.dorsal, pos: o.pos || j.pos };
    });
  }

  function getPartidos() {
    var locales = ONLINE ? REMOTE.partidos : storeGet(K.partidos, []).map(function (p) { return Object.assign({}, p, { local: true }); });
    var votosLoc = ONLINE ? REMOTE.notas : storeGet(K.votos, {});
    return (D.partidos || []).concat(locales).map(function (p) {
      var byVoter = {};
      (p.votos || []).forEach(function (v) { byVoter[v.votante] = v; });
      (votosLoc[p.id] || []).forEach(function (v) { byVoter[v.votante] = v; });
      var votos = Object.keys(byVoter).map(function (k) { return byVoter[k]; });
      var tit = (p.titulares || []).map(function (t) {
        var ns = votos.filter(function (v) { return v.votante !== t.j; })
          .map(function (v) { return v.notas[t.j]; })
          .filter(function (n) { return typeof n === "number"; });
        return Object.assign({}, t, { nota: ns.length ? ns.reduce(function (a, b) { return a + b; }, 0) / ns.length : null, nVotos: ns.length });
      });
      return Object.assign({}, p, { titulares: tit, votos: votos });
    }).sort(function (a, b) { return b.fecha.localeCompare(a.fecha) || String(b.id).localeCompare(String(a.id)); });
  }

  // Los extras (jugaron solo ese partido, no son del plantel) no entran en las estadísticas individuales
  function calcStats(partidos, jug) {
    var s = { pj: 0, G: 0, E: 0, P: 0, gf: 0, gc: 0 }, by = {};
    function delPlantel(n) { return !jug || !!jug[n]; }
    partidos.filter(jugado).forEach(function (m) {
      s.pj++; s[res(m)]++; s.gf += m.gf; s.gc += m.gc;
      m.titulares.forEach(function (t) {
        if (!delPlantel(t.j)) return;
        var r = by[t.j] || (by[t.j] = { nombre: t.j, pj: 0, goles: 0, sum: 0, n: 0 });
        r.pj++; r.goles += t.goles || 0;
        if (t.nota != null) { r.sum += t.nota; r.n++; }
      });
      Object.keys(m.golesSuplentes || {}).forEach(function (n) {
        if (!delPlantel(n)) return;
        var r = by[n] || (by[n] = { nombre: n, pj: 0, goles: 0, sum: 0, n: 0 });
        r.goles += m.golesSuplentes[n];
      });
    });
    var lista = Object.keys(by).map(function (k) { var r = by[k]; r.prom = r.n ? r.sum / r.n : null; return r; });
    s.goleadores = lista.filter(function (r) { return r.goles > 0; }).sort(function (a, b) { return b.goles - a.goles || (b.prom || 0) - (a.prom || 0); });
    s.figuras = lista.filter(function (r) { return r.prom != null; }).sort(function (a, b) { return b.prom - a.prom || b.pj - a.pj; });
    s.presencias = lista.slice().sort(function (a, b) { return b.pj - a.pj || (b.prom || 0) - (a.prom || 0); });
    return s;
  }

  var F; // modelo de fútbol vigente
  function refreshF() {
    var plantel = getPlantel(), jug = {};
    plantel.forEach(function (j) { jug[j.nombre] = j; });
    var partidos = getPartidos();
    F = { plantel: plantel, jug: jug, partidos: partidos, ST: calcStats(partidos, jug), hayEjemplo: partidos.some(function (p) { return p.ejemplo; }) };
  }
  function dorsalOf(n) { var j = F.jug[n]; return j && j.dorsal != null ? j.dorsal : null; }
  function shirtLabel(n) { var d = dorsalOf(n); return d != null ? d : initials(n); }
  function findPartido(id) { return F.partidos.filter(function (p) { return p.id === id; })[0]; }

  /* ================= escudo, copa y camiseta ================= */
  var uid = 0;
  // Escudo oficial: img/escudo.png (grande) e img/escudo-sm.png (chico, para header, carnets y footer)
  function crest(full) {
    if (!full) return '<img class="crest" src="img/escudo-sm.png" alt="" width="93" height="128" decoding="async">';
    return (
      '<figure class="crest crest--full">' +
        '<img src="img/escudo.png" alt="Escudo del ' + esc(D.club.nombre) + ", fundado en " + D.club.fundacion + '" width="408" height="560" decoding="async">' +
        '<figcaption><span class="crest-name">La Chancha</span><span class="crest-legend">Club Social y Deportivo</span></figcaption>' +
      "</figure>"
    );
  }
  var FUND_TXT = (function () {
    var d = new Date((D.club.fechaFundacion || D.club.fundacion + "-01-01") + "T12:00:00");
    return isNaN(d) ? String(D.club.fundacion) : d.toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
  })();

  var BOWL = "M28 12H72V38C72 57 62 68 50 68C38 68 28 57 28 38Z";
  function copa() {
    var id = "copa-clip-" + (++uid);
    return (
      '<svg class="copa" viewBox="0 0 100 110" role="img" aria-label="Copa de campeón">' +
        '<clipPath id="' + id + '"><path d="' + BOWL + '"/></clipPath>' +
        '<g stroke-width="3" stroke-linejoin="round" stroke-linecap="round">' +
          '<path class="copa-line" fill="none" d="M28 20H18c0 17 5 26 14 29M72 20h10c0 17-5 26-14 29"/>' +
          '<path class="copa-fill" d="' + BOWL + '"/>' +
          '<g clip-path="url(#' + id + ')"><rect class="copa-band" x="20" y="25" width="60" height="9"/></g>' +
          '<path class="copa-line" fill="none" d="' + BOWL + '"/>' +
          '<rect class="copa-line copa-fill" x="45" y="68" width="10" height="13"/>' +
          '<rect class="copa-line copa-fill" x="34" y="81" width="32" height="8" rx="1"/>' +
          '<rect class="copa-line copa-fill" x="26" y="89" width="48" height="16" rx="1.5"/>' +
        "</g>" +
        '<text class="copa-text" x="50" y="100" text-anchor="middle">CAMPEÓN</text>' +
      "</svg>"
    );
  }

  var SHIRT = "M38 8L20 14L4 34L18 48L28 40V122H92V40L102 48L116 34L100 14L82 8C78 16 70 20 60 20C50 20 42 16 38 8Z";
  function camiseta(j) {
    var id = "shirt-clip-" + (++uid);
    var nombre = esc(j.nombre.toUpperCase());
    var largo = j.nombre.length > 8;
    return (
      '<svg class="shirt" viewBox="0 0 120 130" role="img" aria-label="Camiseta de La Chancha de ' + esc(j.nombre) + (j.dorsal != null ? ", número " + j.dorsal : ", sin número") + '">' +
        '<clipPath id="' + id + '"><path d="' + SHIRT + '"/></clipPath>' +
        '<path class="shirt-body" d="' + SHIRT + '"/>' +
        '<g clip-path="url(#' + id + ')"><path class="shirt-rosa" d="M0 0H28V60H0ZM92 0H120V60H92Z"/><rect class="shirt-rosa" x="0" y="112" width="120" height="5"/></g>' +
        '<g class="shirt-line" fill="none" stroke-width="2.5" stroke-linejoin="round"><path d="' + SHIRT + '"/><path d="M38 8C42 16 50 20 60 20C70 20 78 16 82 8"/></g>' +
        '<text class="shirt-name" x="60" y="45" text-anchor="middle"' + (largo ? ' textLength="56" lengthAdjust="spacingAndGlyphs"' : "") + ">" + nombre + "</text>" +
        '<text class="shirt-num' + (j.dorsal == null ? " is-empty" : "") + '" x="60" y="98" text-anchor="middle">' + (j.dorsal != null ? j.dorsal : "?") + "</text>" +
      "</svg>"
    );
  }

  /* ================= piezas comunes ================= */
  var NAV = [
    { id: "inicio", href: "/", label: "Inicio" },
    { id: "asistencia", href: "/asistencia", label: "Asistencia" },
    { id: "futbol", href: "/futbol", label: "Fútbol" },
    { id: "awards", href: "/awards", label: '<span class="nav-long">Chancha </span>Awards' }
  ];

  function header() {
    var links = NAV.map(function (n) {
      return '<a href="' + n.href + '"' + (n.id === page ? ' aria-current="page"' : "") + ">" + n.label + "</a>";
    }).join("");
    var user = ME
      ? '<button type="button" class="user-btn is-in" data-action="cuenta" title="Mi cuenta">' +
          '<span class="user-avatar" aria-hidden="true">' + esc(initials(ME.nombre)) + "</span>" +
          '<span class="user-name">' + esc(ME.nombre) + (ME.admin ? ' <small class="user-admin">admin</small>' : "") + "</span></button>"
      : '<button type="button" class="user-btn" data-action="login">' + LOCK + " Entrar</button>";
    return (
      '<header class="site-header" id="header">' +
        '<div class="wrap header-inner">' +
          '<a class="brand" href="/" aria-label="La Chancha — Inicio">' + crest() +
            '<span class="brand-text"><span class="brand-kicker">Club Social y Deportivo</span><span class="brand-name">La Chancha</span></span>' +
          "</a>" +
          '<nav class="nav" aria-label="Principal">' + links + "</nav>" +
          user +
        "</div>" +
        '<div class="band" aria-hidden="true"></div>' +
      "</header>"
    );
  }

  function footer() {
    return (
      '<footer class="site-footer" id="footer">' +
        '<div class="band" aria-hidden="true"></div>' +
        '<div class="wrap footer-inner">' +
          '<div class="footer-brand">' + crest() +
            "<p><strong>" + esc(D.club.nombre) + "</strong><br>Fund. " + D.club.fundacion + " · Temporada " + D.club.temporada + "</p>" +
          "</div>" +
          '<p class="label">Asistencia: planilla ' + esc(A.fuente) + (A.juntadas && A.juntadas.length ? " + " + plural(A.juntadas.length, "juntada nueva", "juntadas nuevas") : "") + "</p>" +
        "</div>" +
      "</footer>"
    );
  }

  function section(n, title, inner, aside, id) {
    return (
      '<section class="section reveal"' + (id ? ' id="' + id + '"' : "") + ">" +
        '<header class="section-head"><span class="section-num">' + pad(n, 2) + " —</span><h2>" + title + "</h2>" +
        (aside ? '<div class="section-aside">' + aside + "</div>" : "") + "</header>" +
        inner +
      "</section>"
    );
  }
  function addBtn(action, label, extra) {
    return '<button type="button" class="btn-add" data-action="' + action + '"' + (extra || "") + '><span aria-hidden="true">+</span> ' + label + "</button>";
  }
  function asideLabel(t) { return '<span class="label">' + t + "</span>"; }
  function pageHero(kicker, title, lead) {
    return '<div class="page-hero reveal"><p class="label">' + kicker + "</p><h1>" + title + '</h1><p class="lead">' + lead + "</p></div>";
  }
  function stats(items) {
    return '<dl class="stats">' + items.map(function (i) {
      return (
        '<div class="stat"><dt class="label">' + i.label + '</dt><dd class="stat-num">' + i.value +
        (i.unit ? "<small>" + i.unit + "</small>" : "") + "</dd>" +
        (i.note ? '<dd class="stat-note">' + i.note + "</dd>" : "") + "</div>"
      );
    }).join("") + "</dl>";
  }
  var EJ = '<span class="badge badge--ejemplo">Ejemplo</span>';
  var LOCAL = '<span class="badge badge--local">' + (ONLINE ? "Lo cargaste vos" : "Este dispositivo") + "</span>";

  var MEDAL = { 1: "Oro", 2: "Plata", 3: "Bronce" };
  function honor() {
    var groups = [1, 2, 3].map(function (r) {
      return { rank: r, list: ranking.filter(function (s) { return s.rank === r; }) };
    }).filter(function (g) { return g.list.length; });
    return '<ol class="honor">' + groups.map(function (g) {
      var s = g.list[0];
      return (
        '<li class="honor-item rank-' + g.rank + '">' +
          '<p class="label">' + g.rank + ".º puesto · " + MEDAL[g.rank] + "</p>" +
          '<p class="honor-pct">' + pctNum(s.pct) + "<small>%</small></p>" +
          '<p class="honor-name">' + names(g.list) + "</p>" +
          '<p class="honor-meta">' + s.asistencias + " de " + TOTAL + " juntadas" + (g.list.length > 1 ? " cada uno" : "") + "</p>" +
        "</li>"
      );
    }).join("") + "</ol>";
  }

  /* ================= INICIO ================= */
  function pageInicio() {
    var t = (D.torneos || [])[0];
    var hero =
      '<div class="hero reveal">' +
        '<div class="hero-crest">' + crest(true) + "</div>" +
        "<div>" +
          '<p class="label">Fund. ' + D.club.fundacion + " · Temporada " + D.club.temporada + "</p>" +
          "<h1>Club Social y Deportivo <em>La Chancha</em></h1>" +
          '<p class="lead">Fundado el ' + FUND_TXT + ". Padrón de socios, asistencia a las juntadas, el fútbol y los Chancha Awards.</p>" +
        "</div>" +
      "</div>" +
      '<div class="reveal">' + stats([
        { label: "Juntadas", value: TOTAL },
        { label: "Socios", value: socios.length },
        { label: "Titulares de juntadas", value: titularesJuntadas.length, note: "70% de asistencia o más" },
        { label: "Copas", value: (D.torneos || []).length }
      ]) + "</div>";

    var banner = t
      ? '<a class="champ-banner" href="/futbol#campeones">' +
          '<div class="champ-banner-copa">' + copa() + "</div>" +
          '<div class="champ-banner-text"><p class="label">Campeones ' + t.anio + '</p><p class="champ-banner-title">' + esc(t.nombre) +
          '</p><p class="champ-banner-desc">' + esc(t.detalle) + '</p><span class="more ulink">Ver la copa →</span></div>' +
          (t.fotos && t.fotos[0] ? '<img class="champ-banner-img" src="' + esc(t.fotos[0].src) + '" alt="' + esc(t.fotos[0].alt) + '" loading="lazy">' : "") +
        "</a>"
      : "";

    var secciones = [
      { href: "/asistencia", title: "Asistencia", desc: "Padrón de socios, juntadas y carnets" },
      { href: "/futbol", title: "Fútbol", desc: "Partido de la semana, notas, estadísticas y plantel" },
      { href: "/awards", title: "Chancha Awards", desc: "Categorías del año y Clip del año" }
    ];
    var index = '<ul class="index-list">' + secciones.map(function (s, i) {
      return (
        '<li><a href="' + s.href + '"><span class="index-num">' + pad(i + 1, 2) + "</span>" +
        '<span><span class="index-title ulink">' + s.title + '</span><span class="index-desc">' + s.desc + "</span></span>" +
        '<span class="index-arrow" aria-hidden="true">→</span></a></li>'
      );
    }).join("") + "</ul>";

    var n = 0;
    return (
      hero +
      (banner ? section(++n, "Campeones", banner, asideLabel("Palmarés")) : "") +
      section(++n, "Cuadro de honor de juntadas", honor() + '<a class="more ulink" href="/asistencia">Ver padrón completo →</a>', asideLabel("Asistencia " + D.club.temporada)) +
      section(++n, "Secretaría", index)
    );
  }

  /* ================= ASISTENCIA ================= */
  function padron() {
    var rows = ranking.map(function (s) {
      return (
        '<tr class="' + (s.titular ? "is-titular" : "") + '">' +
          '<td class="nro">' + pad(s.nro) + "</td>" +
          '<td class="nombre">' + esc(s.nombre) + "</td>" +
          '<td class="num col-asist">' + s.asistencias + "</td>" +
          '<td class="num">' + pct(s.pct) + "</td>" +
          '<td class="col-bar"><div class="bar' + (s.titular ? " is-titular" : "") + '" style="--v:' + (s.pct * 100).toFixed(2) + "%;--u:" + UMBRAL * 100 + '%"><span></span></div></td>' +
          '<td><span class="badge' + (s.titular ? " badge--titular" : "") + '">' + (s.titular ? "Titular" : "Socio") + "</span></td>" +
        "</tr>"
      );
    }).join("");
    return (
      '<div class="table-wrap"><table class="padron">' +
        '<caption class="label table-caption">Línea vertical: corte de titularidad de juntadas (' + pct(UMBRAL, 0) + ")</caption>" +
        '<thead><tr><th scope="col">N.º</th><th scope="col">Socio</th><th scope="col" class="num col-asist">Asist.</th><th scope="col" class="num">%</th><th scope="col" class="col-bar"><span class="visually-hidden">Gráfico</span></th><th scope="col">Condición</th></tr></thead>' +
        "<tbody>" + rows + "</tbody>" +
      "</table></div>"
    );
  }

  function carnet(s) {
    return (
      '<article class="carnet' + (s.titular ? " is-titular" : "") + '">' +
        '<div class="carnet-band" aria-hidden="true"></div>' +
        '<div class="carnet-body">' +
          '<div class="carnet-top">' + crest() + '<div><p class="label">Carnet de socio</p><p class="carnet-season">Temporada ' + D.club.temporada + "</p></div></div>" +
          '<p class="carnet-num"><span>N.º</span>' + pad(s.nro) + "</p>" +
          '<h3 class="carnet-name">' + esc(s.nombre) + "</h3>" +
          '<dl class="carnet-meta">' +
            "<div><dt>Juntadas</dt><dd>" + s.asistencias + "<small>/" + TOTAL + "</small></dd></div>" +
            "<div><dt>Asistencia</dt><dd>" + pct(s.pct) + "</dd></div>" +
          "</dl>" +
          '<div class="carnet-foot"><span class="badge' + (s.titular ? " badge--titular" : "") + '">' + (s.titular ? "Titular" : "Socio") + "</span>" +
          '<span class="carnet-fund">Fund. ' + D.club.fundacion + "</span></div>" +
        "</div>" +
      "</article>"
    );
  }

  var LOCK = '<svg class="lock" viewBox="0 0 16 16" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none"/></svg>';

  function adminBar() {
    var estado = ONLINE
      ? (REMOTE_A_ERROR ? '<p class="notice"><strong>No se pudo conectar con la base.</strong> ' + esc(REMOTE_A_ERROR) + "</p>" : "")
      : "";
    if (!isAdmin()) return estado;
    var nota = ONLINE
      ? '<p class="form-note">Conectado a la base: lo que cargues lo ve todo el grupo al instante.</p>'
      : cambiosSinPublicar
        ? '<p class="notice"><strong>Esto todavía no lo ve el grupo.</strong> La web no está conectada a la base de datos, así que lo que cargás queda solo en este navegador. ' +
          'Para que se guarde para todos automáticamente, corré <code>supabase/asistencia_admin.sql</code> y completá <code>js/config.js</code> (ver LEEME). ' +
          'Mientras tanto podés descargar <code>asistencia.js</code> y subirlo al sitio a mano.</p>'
        : '<p class="form-note">La web no está conectada a la base de datos: lo que cargues queda en este navegador hasta que la conectes (ver LEEME).</p>';
    return (
      estado +
      '<div class="admin-bar reveal">' +
        '<div class="admin-bar-head"><p class="label">' + LOCK + " Admin · " + esc(ME.nombre) + "</p></div>" +
        '<div class="admin-actions">' +
          '<button type="button" class="btn" data-action="juntada">Registrar juntada</button>' +
          '<button type="button" class="btn btn--ghost" data-action="socio">Agregar socio</button>' +
          (ONLINE ? "" : '<button type="button" class="btn btn--ghost" data-action="descargar">Descargar asistencia.js</button>') +
        "</div>" +
        nota +
      "</div>"
    );
  }

  function juntadasList() {
    var js = (A.juntadas || []).slice().sort(function (a, b) { return b.fecha.localeCompare(a.fecha) || String(b.id).localeCompare(String(a.id)); });
    var admin = isAdmin();
    var rows = js.map(function (j) {
      return (
        '<li class="junt">' +
          '<span class="junt-fecha">' + fecha(j.fecha, { day: "numeric", month: "short" }) + "</span>" +
          '<span class="junt-info"><span class="junt-title">' + esc(j.nombre || "Juntada") + "</span>" +
          '<span class="junt-presentes">' + j.presentes.map(esc).join(", ") + "</span></span>" +
          '<span class="junt-count">' + j.presentes.length + "<small>/" + A.socios.length + "</small></span>" +
          (admin ? '<button type="button" class="link-btn link-btn--muted" data-action="quitar-juntada" data-id="' + esc(j.id) + '">Quitar</button>' : "") +
        "</li>"
      );
    }).join("");
    return (
      '<ul class="junts">' + rows +
        '<li class="junt junt--base"><span class="junt-fecha">Antes</span><span class="junt-info"><span class="junt-title">' + A.base.juntadas +
        ' juntadas anteriores</span><span class="junt-presentes">Totales de la planilla ' + esc(A.fuente) + "</span></span></li>" +
      "</ul>"
    );
  }

  function pageAsistencia() {
    var nuevas = (A.juntadas || []).length;
    return (
      pageHero("Juntadas · Temporada " + D.club.temporada, "Asistencia",
        "Sobre " + TOTAL + " juntadas registradas. Es titular de las juntadas quien llega al " + pct(UMBRAL, 0) + " de asistencia.") +
      adminBar() +
      section(1, "Resumen", stats([
        { label: "Juntadas", value: TOTAL, note: nuevas ? plural(nuevas, "cargada", "cargadas") + " desde la web" : "" },
        { label: "Asistencias", value: sumAsist, note: "suma de todos los socios" },
        { label: "Promedio", value: pctNum(promedio), unit: "%" },
        { label: "Para ser titular", value: minTitular, note: "juntadas como mínimo" }
      ])) +
      section(2, "Padrón de socios", padron(), asideLabel(socios.length + " socios")) +
      section(3, "Juntadas registradas", juntadasList(), asideLabel(plural(TOTAL, "juntada", "juntadas")), "juntadas") +
      section(4, "Carnets", '<div class="carnets">' + ranking.map(carnet).join("") + "</div>")
    );
  }

  /* ================= FÚTBOL ================= */
  var LINEA_Y = { ARQ: 89, DEF: 69, MED: 47, DEL: 25 };
  var ORDEN = ["DEL", "MED", "DEF", "ARQ"];
  var verId = null;

  function pitchSVG() {
    var stripes = "";
    for (var i = 0; i < 7; i++) stripes += '<rect class="' + (i % 2 ? "pitch-b" : "pitch-a") + '" x="0" y="' + i * 15 + '" width="68" height="15"/>';
    return (
      '<svg class="pitch-svg" viewBox="0 0 68 105" preserveAspectRatio="none" aria-hidden="true">' + stripes +
        '<g class="pitch-lines" fill="none" stroke-width=".45">' +
          '<rect x="2" y="2" width="64" height="101"/>' +
          '<line x1="2" y1="52.5" x2="66" y2="52.5"/>' +
          '<circle cx="34" cy="52.5" r="9.15"/>' +
          '<rect x="13.84" y="2" width="40.32" height="16.5"/><rect x="13.84" y="86.5" width="40.32" height="16.5"/>' +
          '<rect x="24.84" y="2" width="18.32" height="5.5"/><rect x="24.84" y="97.5" width="18.32" height="5.5"/>' +
          '<path d="M26.69 18.5A9.15 9.15 0 0 0 41.31 18.5"/><path d="M26.69 86.5A9.15 9.15 0 0 1 41.31 86.5"/>' +
        "</g>" +
        '<g class="pitch-dots"><circle cx="34" cy="52.5" r=".6"/><circle cx="34" cy="13" r=".5"/><circle cx="34" cy="92" r=".5"/></g>' +
      "</svg>"
    );
  }

  function figuraDe(m) {
    var best = null;
    m.titulares.forEach(function (t) { if (t.nota != null && (!best || t.nota > best.nota)) best = t; });
    return best;
  }

  function pitch(m) {
    var best = figuraDe(m);
    var markers = "";
    ORDEN.forEach(function (pos) {
      var line = m.titulares.filter(function (t) { return (t.pos || "MED") === pos; });
      line.forEach(function (t, i) {
        var x = 8 + 84 * (i + 1) / (line.length + 1);
        var hi = t.nota != null && t.nota >= 8;
        var lab = shirtLabel(t.j);
        markers +=
          '<div class="pl' + (best === t ? " is-figura" : "") + '" style="left:' + x.toFixed(1) + "%;top:" + LINEA_Y[pos] + '%">' +
            '<span class="pl-shirt' + (dorsalOf(t.j) == null ? " is-initials" : "") + '">' + esc(lab) +
              (t.nota != null ? '<span class="pl-nota' + (hi ? " is-high" : "") + '">' + nota1(t.nota) + "</span>" : "") +
            "</span>" +
            '<span class="pl-name">' + esc(t.j) + (t.goles ? ' <span class="pl-goles" aria-label="' + plural(t.goles, "gol", "goles") + '">' + "●".repeat(t.goles) + "</span>" : "") + "</span>" +
          "</div>";
      });
    });
    return '<div class="pitch" role="img" aria-label="Formación de La Chancha contra ' + esc(m.rival) + '">' + pitchSVG() + markers + "</div>";
  }

  function esExtra(n) { return !!(F && F.jug && !F.jug[n]); }
  function extraTag(n) { return esExtra(n) ? ' <small class="ml-extra">extra</small>' : ""; }

  function matchCard(m) {
    var ok = jugado(m);
    var goleadores = m.titulares.filter(function (t) { return t.goles; }).map(function (t) { return esc(t.j) + (t.goles > 1 ? " (" + t.goles + ")" : ""); })
      .concat(Object.keys(m.golesSuplentes || {}).map(function (n) { var g = m.golesSuplentes[n]; return esc(n) + (g > 1 ? " (" + g + ")" : "") + " · entró"; }));
    var best = figuraDe(m);
    var lista = m.titulares.slice().sort(function (a, b) { return ORDEN.indexOf(b.pos) - ORDEN.indexOf(a.pos); }).map(function (t) {
      var d = dorsalOf(t.j);
      return '<li><span class="ml-dorsal">' + (d != null ? d : "–") + '</span><span class="ml-name">' + esc(t.j) + extraTag(t.j) + '</span><span class="ml-pos">' + esc(t.pos || "") + "</span>" +
        '<span class="ml-nota' + (t.nota != null && t.nota >= 8 ? " is-high" : "") + '">' + (t.nota != null ? nota1(t.nota) : "–") + "</span>" +
        '<span class="ml-votos">' + (t.nVotos ? plural(t.nVotos, "voto", "votos") : "sin votos") + "</span></li>";
    }).join("");
    return (
      '<div class="match-card">' +
        '<p class="label">' + esc(m.torneo || "Partido") + " · " + fecha(m.fecha) + (m.ejemplo ? " " + EJ : "") + (m.local ? " " + LOCAL : "") + "</p>" +
        '<div class="score">' +
          '<div class="score-team"><span class="score-name">La Chancha</span><span class="score-num">' + (ok ? m.gf : "–") + "</span></div>" +
          '<span class="score-sep">' + (ok ? "–" : "vs") + "</span>" +
          '<div class="score-team"><span class="score-name">' + esc(m.rival) + '</span><span class="score-num">' + (ok ? m.gc : "–") + "</span></div>" +
        "</div>" +
        (ok ? '<p><span class="badge badge--res-' + res(m) + '">' + RES[res(m)] + "</span></p>" : '<p><span class="badge">Próximo partido</span></p>') +
        '<dl class="match-meta">' +
          (goleadores.length ? "<div><dt>Goles</dt><dd>" + goleadores.join(", ") + "</dd></div>" : "") +
          (best ? "<div><dt>Figura</dt><dd>" + esc(best.j) + " · " + nota1(best.nota) + "</dd></div>" : "") +
          (m.suplentes && m.suplentes.length ? "<div><dt>Suplentes</dt><dd>" + m.suplentes.map(function (n) { return esc(n) + extraTag(n); }).join(", ") + "</dd></div>" : "") +
        "</dl>" +
        '<div class="match-sub"><p class="label">Titulares y notas</p>' +
          (ok ? '<button type="button" class="btn btn--small" data-action="nota" data-id="' + esc(m.id) + '">Agregar nota</button>' : "") +
        "</div>" +
        '<ol class="match-list">' + lista + "</ol>" +
        '<p class="form-note">La nota de cada jugador es el promedio de lo que le pusieron los demás (' + plural(m.votos.length, "persona votó", "personas votaron") + "). Nadie se pone nota a sí mismo.</p>" +
      "</div>"
    );
  }

  function partidoBlock(m) {
    return (
      '<div class="match"><div class="match-pitch">' + pitch(m) +
      '<p class="pitch-legend">Nota promedio del 1 al 10 · <span class="dot-rosa"></span> figura · ● gol</p></div>' + matchCard(m) + "</div>"
    );
  }

  function rankList(title, list, value) {
    if (!list.length) return "";
    return (
      '<div class="rank"><p class="label rank-title">' + title + "</p><ol>" +
      list.slice(0, 5).map(function (r, i) {
        var d = dorsalOf(r.nombre);
        return '<li><span class="rank-pos">' + (i + 1) + '</span><span class="rank-dorsal">' + (d != null ? d : "–") + '</span><span class="rank-name">' + esc(r.nombre) + '</span><span class="rank-val">' + value(r) + "</span></li>";
      }).join("") + "</ol></div>"
    );
  }

  function campeones() {
    return (D.torneos || []).map(function (t) {
      var fotos = (t.fotos || []).map(function (f, i) {
        return '<figure class="champ-photo' + (i === 0 ? " is-main" : "") + '"><img src="' + esc(f.src) + '" alt="' + esc(f.alt) + '" loading="lazy"></figure>';
      }).join("");
      return (
        '<div class="champ">' +
          '<div class="champ-info">' + copa() +
            '<p class="label">Campeones · ' + t.anio + "</p>" +
            '<h3 class="champ-title">' + esc(t.nombre) + "</h3>" +
            '<p class="champ-desc">' + esc(t.detalle) + "</p>" +
          "</div>" +
          '<div class="champ-photos">' + fotos + "</div>" +
        "</div>"
      );
    }).join("");
  }

  function kits() {
    var lista = F.plantel.slice().sort(function (a, b) {
      if (a.dorsal == null && b.dorsal == null) return a.nombre.localeCompare(b.nombre);
      if (a.dorsal == null) return 1;
      if (b.dorsal == null) return -1;
      return a.dorsal - b.dorsal;
    });
    return '<ul class="kits">' + lista.map(function (j) {
      return (
        '<li class="kit' + (j.dorsal == null ? " is-empty" : "") + '">' + camiseta(j) +
          '<p class="kit-name">' + esc(j.nombre) + "</p>" +
          '<p class="kit-pos">' + (j.pos ? POS_LABEL[j.pos] : "Posición a definir") + "</p>" +
          (ME && (isAdmin() || ME.nombre === j.nombre)
            ? '<button type="button" class="link-btn" data-action="dorsal" data-nombre="' + esc(j.nombre) + '">' + (j.dorsal == null ? "Elegir número" : "Cambiar") + "</button>"
            : "") +
        "</li>"
      );
    }).join("") + "</ul>";
  }

  function pageFutbol() {
    var P = F.partidos;
    var actual = (verId && findPartido(verId)) || P[0];
    var dif = F.ST.gf - F.ST.gc;
    var notice = F.hayEjemplo
      ? '<p class="notice"><strong>Datos de ejemplo.</strong> Los partidos marcados como “Ejemplo” son de muestra para ver el diseño. Cargá los reales con “Agregar partido”.</p>'
      : "";

    var hist = P.length
      ? '<div class="table-wrap"><table class="padron historial-tabla"><thead><tr><th scope="col">Fecha</th><th scope="col">Rival</th><th scope="col" class="col-torneo">Torneo</th><th scope="col" class="num">Resultado</th><th scope="col"><span class="visually-hidden">Estado</span></th><th scope="col" class="num">Acciones</th></tr></thead><tbody>' +
        P.map(function (m) {
          var ok = jugado(m);
          return (
            "<tr>" +
              '<td class="fecha">' + fecha(m.fecha, { day: "numeric", month: "short" }) + "</td>" +
              '<td class="nombre">' + esc(m.rival) + (m.ejemplo ? " " + EJ : "") + (m.local ? " " + LOCAL : "") + "</td>" +
              '<td class="col-torneo">' + esc(m.torneo || "") + "</td>" +
              '<td class="num">' + (ok ? m.gf + " – " + m.gc : "—") + "</td>" +
              "<td>" + (ok ? '<span class="badge badge--res-' + res(m) + '" title="' + RES[res(m)] + '">' + res(m) + "</span>" : '<span class="badge">Próx.</span>') + "</td>" +
              '<td class="num acciones">' +
                '<button type="button" class="link-btn" data-action="ver" data-id="' + esc(m.id) + '">Ver</button>' +
                (ok ? '<button type="button" class="link-btn" data-action="nota" data-id="' + esc(m.id) + '">Nota</button>' : "") +
                ((m.local || isAdmin()) && !m.ejemplo ? '<button type="button" class="link-btn link-btn--muted" data-action="quitar-partido" data-id="' + esc(m.id) + '">Quitar</button>' : "") +
              "</td>" +
            "</tr>"
          );
        }).join("") + "</tbody></table></div>"
      : '<div class="empty"><p class="empty-title">Todavía no hay partidos cargados</p></div>';

    return (
      pageHero("Temporada " + D.club.temporada, "Fútbol", "El partido de la semana, las notas que se ponen entre ustedes, las estadísticas, el plantel y la copa.") +
      remoteNotice() +
      section(1, "Partido de la semana",
        notice + (actual ? partidoBlock(actual)
          : '<div class="empty"><p class="empty-title">Sin partido cargado</p><p>Agregá el partido del finde con el botón de arriba.</p></div>'),
        addBtn("partido", "Agregar partido"), "partido") +
      section(2, "Estadísticas",
        stats([
          { label: "Partidos", value: F.ST.pj },
          { label: "Ganados", value: F.ST.G, note: plural(F.ST.E, "empate", "empates") + " · " + plural(F.ST.P, "perdido", "perdidos") },
          { label: "Goles a favor", value: F.ST.gf, note: F.ST.gc + " en contra" },
          { label: "Diferencia", value: (dif > 0 ? "+" : "") + dif }
        ]) +
        '<div class="ranks">' +
          rankList("Goleadores", F.ST.goleadores, function (r) { return plural(r.goles, "gol", "goles"); }) +
          rankList("Mejor promedio de nota", F.ST.figuras, function (r) { return nota1(r.prom); }) +
          rankList("Más partidos de titular", F.ST.presencias, function (r) { return r.pj + " PJ"; }) +
        "</div>",
        F.hayEjemplo ? asideLabel("Incluye ejemplos") : "") +
      section(3, "Historial de partidos", hist, asideLabel(plural(P.length, "partido", "partidos"))) +
      section(4, "Plantel",
        '<p class="section-intro">Cada jugador elige su número y no se puede repetir.</p>' + kits(),
        addBtn("dorsal", isAdmin() ? "Cambiar dorsal" : "Mi remera"), "plantel") +
      ((D.torneos || []).length ? section(5, "Campeones", campeones(), asideLabel("Palmarés"), "campeones") : "")
    );
  }

  /* ================= CHANCHA AWARDS ================= */
  function clipEmbed(url) {
    var yt = url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    if (yt) {
      return '<div class="clip-media"><iframe src="https://www.youtube-nocookie.com/embed/' + yt[1] + '" title="Clip" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>';
    }
    var host = "";
    try { host = new URL(url).hostname.replace(/^www\./, ""); } catch (e) {}
    var plat = /instagram/.test(host) ? "Instagram" : /tiktok/.test(host) ? "TikTok" : /drive\.google/.test(host) ? "Google Drive" : /twitch/.test(host) ? "Twitch" : /twitter|x\.com/.test(host) ? "X" : host || "Link";
    return (
      '<a class="clip-media clip-link" href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' +
        '<span class="clip-play" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>' +
        '<span class="label">Ver en ' + esc(plat) + "</span>" +
      "</a>"
    );
  }

  /* ----- Clips: almacenamiento (la conexión a Supabase está arriba, en "datos compartidos") ----- */
  var MAX_VIDEO_MB = 50;
  var clipsState = { loading: true, list: [], error: null };

  var ClipStore = ONLINE ? {
    list: function () {
      return Promise.all([
        sb.from("clips").select("id,created_at,owner,autor,titulo,url,video_path"),
        sb.from("clip_votos").select("clip_id,user_id,valor"),
        sb.auth.getSession()
      ]).then(function (r) {
        check(r[0]); check(r[1]);
        var uid = r[2].data && r[2].data.session ? r[2].data.session.user.id : null;
        return r[0].data.map(function (c) {
          var vs = r[1].data.filter(function (v) { return v.clip_id === c.id; });
          var mine = vs.filter(function (v) { return v.user_id === uid; })[0];
          var up = vs.filter(function (v) { return v.valor > 0; }).length, down = vs.length - up;
          return {
            id: c.id, titulo: c.titulo, autor: c.autor, url: c.url, videoPath: c.video_path,
            video: c.video_path ? sb.storage.from("clips").getPublicUrl(c.video_path).data.publicUrl : null,
            creado: c.created_at, up: up, down: down, score: up - down,
            miVoto: mine ? mine.valor : 0, esMio: !!uid && c.owner === uid
          };
        });
      });
    },
    add: function (c) {
      return ensureSession().then(function (user) {
        var subida = Promise.resolve(null);
        if (c.file) {
          var path = user.id + "/" + Date.now() + "-" + c.file.name.replace(/[^\w.-]+/g, "_").slice(-60);
          subida = sb.storage.from("clips").upload(path, c.file, { contentType: c.file.type, upsert: false })
            .then(function (r) { check(r); return path; });
        }
        return subida.then(function (path) {
          return sb.from("clips").insert({ titulo: c.titulo, autor: c.autor, url: c.url || null, video_path: path }).then(check);
        });
      });
    },
    vote: function (id, valor, actual) {
      return ensureSession().then(function (user) {
        var q = valor === actual
          ? sb.from("clip_votos").delete().eq("clip_id", id).eq("user_id", user.id)
          : sb.from("clip_votos").upsert({ clip_id: id, user_id: user.id, valor: valor }, { onConflict: "clip_id,user_id" });
        return q.then(check);
      });
    },
    remove: function (c) {
      return sb.from("clips").delete().eq("id", c.id).then(check).then(function () {
        if (c.videoPath) return sb.storage.from("clips").remove([c.videoPath]);
      });
    }
  } : {
    list: function () {
      var votos = storeGet(K.clipVotos, {});
      var fijos = (D.clips || []).map(function (c, i) { return Object.assign({}, c, { id: "d" + i, fijo: true }); });
      var locales = storeGet(K.clips, []).map(function (c, i) { return Object.assign({}, c, { id: c.id || "l" + i }); });
      return Promise.resolve(fijos.concat(locales).map(function (c) {
        var v = votos[c.id] || 0;
        return {
          id: c.id, titulo: c.titulo, autor: c.autor, url: c.url, video: null, creado: c.creado || c.fecha || "",
          up: v > 0 ? 1 : 0, down: v < 0 ? 1 : 0, score: v, miVoto: v, fijo: !!c.fijo, esMio: !c.fijo && !!ME && c.autor === ME.nombre
        };
      }));
    },
    add: function (c) {
      if (c.file) return Promise.reject(new Error("Subir videos funciona cuando se conecta Supabase. Por ahora pegá el link."));
      var list = storeGet(K.clips, []);
      list.push({ id: "l" + Date.now(), titulo: c.titulo, autor: c.autor, url: c.url, creado: new Date().toISOString() });
      return storeSet(K.clips, list) ? Promise.resolve() : Promise.reject(new Error("No se pudo guardar en este navegador."));
    },
    vote: function (id, valor, actual) {
      var votos = storeGet(K.clipVotos, {});
      votos[id] = valor === actual ? 0 : valor;
      storeSet(K.clipVotos, votos);
      return Promise.resolve();
    },
    remove: function (c) {
      storeSet(K.clips, storeGet(K.clips, []).filter(function (x) { return x.id !== c.id; }));
      var votos = storeGet(K.clipVotos, {}); delete votos[c.id]; storeSet(K.clipVotos, votos);
      return Promise.resolve();
    }
  };

  function sortClips(list) {
    return list.sort(function (a, b) {
      return b.score - a.score || b.up - a.up || String(b.creado).localeCompare(String(a.creado));
    });
  }

  function loadClips() {
    return ClipStore.list().then(function (list) {
      clipsState = { loading: false, list: sortClips(list), error: null };
      renderClips();
    }).catch(function (err) {
      clipsState = { loading: false, list: clipsState.list, error: (err && err.message) || "Error al cargar los clips." };
      renderClips();
    });
  }

  var ARROW = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4l6 8h-4v4H8v-4H4z"/></svg>';

  function clipCard(c, i) {
    var puedeVotar = !c.esMio;
    var top = i === 0 && c.score > 0;
    function voteBtn(v) {
      var on = c.miVoto === v;
      return (
        '<button type="button" class="vote-btn ' + (v > 0 ? "vote-up" : "vote-down") + (on ? " is-on" : "") + '" data-action="votar" data-id="' + esc(c.id) + '" data-v="' + v + '"' +
        ' aria-pressed="' + on + '" aria-label="' + (v > 0 ? "Me gustó" : "No me gustó") + '"' +
        (puedeVotar ? "" : ' disabled title="No podés votar tu propio clip"') + ">" + ARROW + "</button>"
      );
    }
    var media = c.video
      ? '<div class="clip-media"><video src="' + esc(c.video) + '" controls preload="metadata" playsinline></video></div>'
      : clipEmbed(c.url || "");
    return (
      '<article class="clip' + (top ? " is-top" : "") + '">' +
        '<div class="vote" aria-label="Votos">' + voteBtn(1) +
          '<span class="vote-score' + (c.score > 0 ? " is-pos" : c.score < 0 ? " is-neg" : "") + '" title="' + c.up + " a favor · " + c.down + ' en contra">' + c.score + "</span>" +
          voteBtn(-1) +
        "</div>" +
        '<div class="clip-main">' + media +
          '<div class="clip-body">' +
            '<p class="label clip-rank">' + (top ? "Va ganando" : "#" + (i + 1)) + "</p>" +
            '<h3 class="clip-title">' + esc(c.titulo) + "</h3>" +
            '<p class="clip-meta">' + (c.autor ? "Subido por " + esc(c.autor) : "") + (c.creado ? " · " + fecha(String(c.creado).slice(0, 10)) : "") +
              " · " + plural(c.up, "a favor", "a favor") + ", " + c.down + " en contra</p>" +
            (c.esMio || (isAdmin() && !c.fijo)
              ? '<p class="clip-local">' + (c.esMio ? '<span class="badge badge--local">Tu clip</span>' : "") +
                '<button type="button" class="link-btn link-btn--muted" data-action="quitar-clip" data-id="' + esc(c.id) + '">Quitar</button></p>'
              : "") +
          "</div>" +
        "</div>" +
      "</article>"
    );
  }

  function renderClips() {
    var grid = document.getElementById("clips-grid");
    if (!grid) return;
    var s = clipsState, html;
    if (s.loading) html = '<p class="clips-loading label">Cargando clips…</p>';
    else if (s.error && !s.list.length) html = '<div class="empty clips-empty"><p class="empty-title">No se pudieron cargar los clips</p><p>' + esc(s.error) + "</p></div>";
    else if (!s.list.length) html = '<div class="empty clips-empty"><p class="empty-title">Todavía no hay clips nominados</p><p>Subí el primero con el formulario.</p></div>';
    else html = s.list.map(clipCard).join("");
    grid.innerHTML = html;
    var n = s.list.length;
    var count = document.getElementById("clips-count");
    if (count) count.textContent = s.loading ? "" : plural(n, "nominado", "nominados");
    var w = document.getElementById("clip-winner");
    var top = s.list[0];
    if (w) w.textContent = s.loading ? "Cargando…" : top && top.score > 0 ? top.titulo : "Todavía sin votos";
    var wd = document.getElementById("clip-winner-detail");
    if (wd) wd.textContent = s.loading ? "" : top && top.score > 0
      ? "Va ganando con " + plural(top.score, "punto", "puntos") + (top.autor ? " · subido por " + top.autor : "") + ". Gana el clip más votado."
      : "Gana el clip más votado. " + plural(n, "clip nominado", "clips nominados") + ".";
  }

  function votar(id, valor) {
    var c = clipsState.list.filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    var actual = c.miVoto, nuevo = valor === actual ? 0 : valor;
    // optimista
    if (actual > 0) c.up--; else if (actual < 0) c.down--;
    if (nuevo > 0) c.up++; else if (nuevo < 0) c.down++;
    c.miVoto = nuevo; c.score = c.up - c.down;
    sortClips(clipsState.list);
    renderClips();
    ClipStore.vote(id, valor, actual).then(function () { if (ONLINE) loadClips(); }).catch(function (err) {
      alert("No se pudo guardar el voto: " + ((err && err.message) || err));
      loadClips();
    });
  }

  /* ================= VOTACIONES (Chancha Awards) =================
     El admin (PIN) abre UNA votación con todas las categorías sin ganador ("Agregar premio").
     Cada socio completa la boleta (todas las categorías de una vez) y nunca se vota a sí mismo.
     Categoría "individual" = se vota a una persona · "dupla" = se vota a una pareja.
     Votos secretos hasta que se cierra. Empate = ganan todos los empatados. */
  var KV = { lista: "chancha.votaciones2", votos: "chancha.votacionesVotos2" };
  var VOT = { loaded: !ONLINE, error: null, lista: [], participacion: {}, votos: {} };

  // Categorías cargadas con "Agregar premio" (las que no tienen ganador se votan)
  function getPremios() {
    var out = [];
    (D.premios || []).forEach(function (p, i) {
      out.push({ id: "d" + i, titulo: p.titulo, tipo: p.tipo || "individual", ganador: p.ganador || "", detalle: p.detalle || "" });
    });
    if (ONLINE) {
      REMOTE.premios.forEach(function (p) {
        out.push({ id: p.id, titulo: p.titulo, tipo: p.tipo || "individual", ganador: p.ganador || "", detalle: p.detalle || "", local: p.mio ? 0 : null, pid: p.id });
      });
    } else {
      storeGet(K.premios, []).forEach(function (p, i) {
        out.push({ id: p.id || "l" + i, titulo: p.titulo, tipo: p.tipo || "individual", ganador: p.ganador || "", detalle: p.detalle || "", local: i });
      });
    }
    return out;
  }
  function aVotar() { return getPremios().filter(function (p) { return !p.ganador; }); }

  function loadVotaciones() {
    if (!ONLINE) return Promise.resolve();
    return Promise.all([
      sb.from("votaciones").select("id,created_at,titulo,detalle,categorias,estado,cerrada_at").order("created_at"),
      sb.rpc("votaciones_participacion"),
      sb.from("votaciones_votos").select("votacion_id,categoria,votante,elegido1,elegido2")
    ]).then(function (r) {
      r.forEach(check);
      VOT.lista = r[0].data.map(function (v) {
        return { id: v.id, titulo: v.titulo, detalle: v.detalle || "", categorias: v.categorias || [], estado: v.estado, creado: v.created_at, cerrada: v.cerrada_at };
      });
      VOT.participacion = {};
      (r[1].data || []).forEach(function (p) {
        var a = VOT.participacion[p.votacion_id] = VOT.participacion[p.votacion_id] || [];
        if (a.indexOf(p.votante) < 0) a.push(p.votante);
      });
      VOT.votos = {};
      r[2].data.forEach(function (x) {
        (VOT.votos[x.votacion_id] = VOT.votos[x.votacion_id] || []).push({ votante: x.votante, cat: x.categoria, e1: x.elegido1, e2: x.elegido2 });
      });
      VOT.error = null;
    }).catch(function (e) { VOT.error = friendly(e); }).then(function () { VOT.loaded = true; });
  }

  function getVotaciones() {
    if (ONLINE) return VOT;
    var lista = storeGet(KV.lista, []), todos = storeGet(KV.votos, {});
    var part = {}, votos = {};
    lista.forEach(function (v) {
      var vs = todos[v.id] || [];
      part[v.id] = vs.map(function (x) { return x.votante; }).filter(function (n, i, a) { return a.indexOf(n) === i; });
      if (v.estado === "cerrada") votos[v.id] = vs; // secretos hasta cerrar, igual que en la base
    });
    return { loaded: true, error: null, lista: lista, participacion: part, votos: votos };
  }

  function votosDe(V, v, catId) {
    return (V.votos[v.id] || []).filter(function (x) { return String(x.cat) === String(catId); });
  }

  function resultados(vs) {
    var cuenta = {};
    vs.forEach(function (x) {
      var key = x.e2 ? [x.e1, x.e2].sort().join(" & ") : x.e1;
      cuenta[key] = (cuenta[key] || 0) + 1;
    });
    var filas = Object.keys(cuenta).map(function (k) { return { nombre: k, n: cuenta[k] }; })
      .sort(function (a, b) { return b.n - a.n || a.nombre.localeCompare(b.nombre); });
    var max = filas.length ? filas[0].n : 0;
    return { filas: filas, ganadores: filas.filter(function (f) { return max > 0 && f.n === max; }), total: vs.length, max: max };
  }

  function tipoTxt(t) { return t === "dupla" ? "dupla" : "persona"; }

  function votacionesAbiertas(V) {
    var abiertas = V.lista.filter(function (v) { return v.estado === "abierta"; });
    if (!abiertas.length) {
      var n = aVotar().length;
      return '<div class="empty"><p class="empty-title">No hay votación abierta</p><p>' +
        (isAdmin()
          ? (n ? "Tocá “Abrir votación” para votar " + (n === 1 ? "la categoría" : "las " + n + " categorías") + " sin ganador."
               : "Primero agregá categorías con “Agregar premio”, sin ganador.")
          : "Cuando el admin la abra, vas a poder votar todas las categorías acá.") + "</p></div>";
    }
    return '<div class="votaciones">' + abiertas.map(function (v) {
      var cats = v.categorias || [];
      var ya = V.participacion[v.id] || [];
      var faltan = NOMBRES.filter(function (n) { return ya.indexOf(n) < 0; });
      return (
        '<article class="votacion">' +
          '<p class="label"><span class="dot-live" aria-hidden="true"></span> Abierta · ' + plural(cats.length, "categoría", "categorías") + "</p>" +
          '<h3 class="premio-title">' + esc(v.titulo) + "</h3>" +
          (v.detalle ? '<p class="premio-detail">' + esc(v.detalle) + "</p>" : "") +
          '<ol class="vot-cats">' + cats.map(function (c) {
            return "<li><span>" + esc(c.titulo) + "</span><small>" + tipoTxt(c.tipo) + "</small></li>";
          }).join("") + "</ol>" +
          '<div class="vot-progress"><span style="--v:' + (NOMBRES.length ? (ya.length / NOMBRES.length * 100).toFixed(1) : 0) + '%"></span></div>' +
          '<p class="premio-detail">' + ya.length + " de " + NOMBRES.length + " ya votaron" +
            (faltan.length && faltan.length <= 6 ? " · faltan: " + faltan.map(esc).join(", ") : "") + "</p>" +
          '<div class="vot-actions">' +
            '<button type="button" class="btn" data-action="votar-premio" data-id="' + esc(v.id) + '">Votar</button>' +
            (isAdmin()
              ? '<button type="button" class="btn btn--ghost" data-action="cerrar-votacion" data-id="' + esc(v.id) + '">Cerrar y ver resultados</button>' +
                '<button type="button" class="link-btn link-btn--muted" data-action="borrar-votacion" data-id="' + esc(v.id) + '">Borrar</button>'
              : "") +
          "</div>" +
          '<p class="form-note">Votás todas las categorías de una vez. El voto es secreto hasta que se cierra. Nadie se vota a sí mismo ni puede estar en la dupla que vota.</p>' +
        "</article>"
      );
    }).join("") + "</div>";
  }

  function ganadoresTxt(r) {
    if (!r.ganadores.length) return "Sin votos";
    return r.ganadores.map(function (g) { return esc(g.nombre); }).join(" · ");
  }

  function estadisticasVotaciones(V) {
    var cerradas = V.lista.filter(function (v) { return v.estado === "cerrada"; })
      .sort(function (a, b) { return String(b.cerrada || b.creado).localeCompare(String(a.cerrada || a.creado)); });
    if (!cerradas.length) {
      return '<div class="empty"><p class="empty-title">Todavía no hay resultados</p><p>Las estadísticas aparecen cuando se cierra la votación.</p></div>';
    }
    var boletas = 0, sumPart = 0, nCats = 0, porPersona = {};
    var bloques = cerradas.map(function (v) {
      var vs = V.votos[v.id] || [];
      var votantes = vs.map(function (x) { return x.votante; }).filter(function (n, i, a) { return a.indexOf(n) === i; }).length;
      boletas += votantes;
      sumPart += NOMBRES.length ? votantes / NOMBRES.length : 0;
      vs.forEach(function (x) { [x.e1, x.e2].forEach(function (n) { if (n) porPersona[n] = (porPersona[n] || 0) + 1; }); });
      var cats = (v.categorias || []).map(function (c) {
        nCats++;
        var r = resultados(votosDe(V, v, c.id));
        var empate = r.ganadores.length > 1;
        return (
          '<article class="vot-stat">' +
            '<p class="label">' + (c.tipo === "dupla" ? "Mejor dupla" : "A una persona") + "</p>" +
            '<h3 class="premio-title">' + esc(c.titulo) + "</h3>" +
            '<p class="vot-winner"><span class="label">' + (empate ? "Ganadores (empate)" : "Ganador") + "</span>" + ganadoresTxt(r) + "</p>" +
            '<p class="premio-detail">' + plural(r.total, "voto", "votos") + "</p>" +
            (r.filas.length
              ? '<ol class="vot-bars">' + r.filas.map(function (f) {
                  var gana = r.ganadores.indexOf(f) >= 0;
                  return (
                    '<li class="' + (gana ? "is-win" : "") + '"><span class="vot-bar-name">' + esc(f.nombre) + "</span>" +
                    '<span class="vot-bar"><span style="--v:' + (f.n / r.max * 100).toFixed(1) + '%"></span></span>' +
                    '<span class="vot-bar-n">' + f.n + ' <small>(' + Math.round(f.n / r.total * 100) + "%)</small></span></li>"
                  );
                }).join("") + "</ol>"
              : "") +
          "</article>"
        );
      });
      return (
        '<div class="vot-edicion">' +
          '<div class="vot-stat-head">' +
            '<div><p class="label">Cerrada' + (v.cerrada ? " el " + fecha(String(v.cerrada).slice(0, 10)) : "") + "</p>" +
            '<h3 class="vot-edicion-title">' + esc(v.titulo) + "</h3>" +
            '<p class="premio-detail">' + plural(votantes, "socio votó", "socios votaron") + " · " +
              (NOMBRES.length ? Math.round(votantes / NOMBRES.length * 100) : 0) + "% del padrón</p></div>" +
            (isAdmin() ? '<button type="button" class="link-btn link-btn--muted" data-action="borrar-votacion" data-id="' + esc(v.id) + '">Borrar</button>' : "") +
          "</div>" +
          '<div class="vot-stats">' + cats.join("") + "</div>" +
        "</div>"
      );
    });
    var masVotado = Object.keys(porPersona).sort(function (a, b) { return porPersona[b] - porPersona[a] || a.localeCompare(b); });
    var topN = masVotado.length ? porPersona[masVotado[0]] : 0;
    var tops = masVotado.filter(function (n) { return porPersona[n] === topN; });
    return (
      stats([
        { label: "Categorías votadas", value: nCats },
        { label: "Boletas", value: boletas },
        { label: "Participación", value: Math.round(sumPart / cerradas.length * 100), unit: "%" },
        { label: "Más votado", value: '<span class="stat-name">' + (tops.length ? tops.map(esc).join(" · ") : "—") + "</span>", note: topN ? plural(topN, "voto", "votos") + " en total" : "" }
      ]) +
      bloques.join("")
    );
  }

  function dialogVotacion() {
    var V = getVotaciones();
    if (V.lista.some(function (v) { return v.estado === "abierta"; })) {
      alert("Ya hay una votación abierta. Cerrala antes de abrir otra.");
      return;
    }
    var cats = aVotar();
    if (!cats.length) {
      alert("No hay categorías para votar. Agregá premios sin ganador con “Agregar premio”.");
      return;
    }
    var body =
      '<div class="field"><label for="v-titulo">Nombre</label><input id="v-titulo" name="titulo" maxlength="60" value="' + esc("Chancha Awards " + D.club.temporada) + '" required></div>' +
      '<div class="field"><label for="v-detalle">Detalle <small>(opcional)</small></label><input id="v-detalle" name="detalle" maxlength="140" placeholder="Ej.: Se cierra el sábado en el asado"></div>' +
      '<div class="dlg-sub-row"><p class="label">Categorías de la boleta</p><span class="form-note" id="v-count"></span></div>' +
      '<div class="check-grid check-grid--list" id="v-cats">' + cats.map(function (c) {
        return '<label class="check"><input type="checkbox" name="cat" value="' + esc(c.id) + '" checked><span>' + esc(c.titulo) +
          ' <small>· ' + tipoTxt(c.tipo) + "</small></span></label>";
      }).join("") + "</div>" +
      '<p class="form-note">Se abre apenas la creás. Cada uno vota todas las categorías de una vez, nunca a sí mismo. Si hay empate, ganan todos los empatados.</p>';
    var form = openDialog("Abrir votación", body, "Abrir votación", function (f) {
      var t = f.titulo.value.trim();
      if (!t) return "Poné un nombre.";
      var ids = Array.prototype.filter.call(f.querySelectorAll('input[name="cat"]'), function (c) { return c.checked; }).map(function (c) { return c.value; });
      var sel = cats.filter(function (c) { return ids.indexOf(String(c.id)) >= 0; })
        .map(function (c) { return { id: String(c.id), titulo: c.titulo, tipo: c.tipo }; });
      if (!sel.length) return "Elegí al menos una categoría.";
      if (ONLINE) return adminRpc("admin_crear_votacion", { p_titulo: t, p_detalle: f.detalle.value.trim(), p_categorias: sel }, loadVotaciones);
      var lista = storeGet(KV.lista, []);
      lista.push({ id: "v" + Date.now(), titulo: t, detalle: f.detalle.value.trim(), categorias: sel, estado: "abierta", creado: new Date().toISOString() });
      if (!storeSet(KV.lista, lista)) return "No se pudo guardar en este navegador.";
    }, ONLINE ? "Se abre para todo el grupo." : "Sin base de datos conectada: queda en este navegador.");
    var box = document.getElementById("v-cats"), cnt = document.getElementById("v-count");
    function contar() {
      var n = Array.prototype.filter.call(form.querySelectorAll('input[name="cat"]'), function (c) { return c.checked; }).length;
      cnt.textContent = n + " de " + cats.length;
    }
    box.addEventListener("change", contar);
    contar();
  }

  function dialogVotar(id) {
    var V = getVotaciones();
    var v = V.lista.filter(function (x) { return x.id === id; })[0];
    if (!v || v.estado !== "abierta") return;
    var cats = v.categorias || [];
    var votante = ME.nombre;
    var body =
      '<p class="dlg-context">' + esc(v.titulo) + " · vota " + esc(votante) + "</p>" +
      '<div class="boleta" id="vt-boleta"></div>' +
      '<p class="form-note">Si no querés votar en alguna categoría, dejala vacía. Tu boleta es secreta hasta que se cierre la votación. Si ya votaste, se reemplaza.</p>';
    var form = openDialog("Votar", body, "Enviar boleta", function (f) {
      var votos = [], err = null;
      cats.forEach(function (c, i) {
        if (err) return;
        var el = Array.prototype.filter.call(f.querySelectorAll('input[name="op' + i + '"]'), function (x) { return x.checked; }).map(function (x) { return x.value; });
        if (!el.length) return;
        var dupla = c.tipo === "dupla";
        if (dupla && el.length !== 2) { err = "En “" + c.titulo + "” elegí dos personas, o ninguna."; return; }
        if (!dupla && el.length !== 1) { err = "En “" + c.titulo + "” elegí una sola persona."; return; }
        if (el.indexOf(votante) >= 0) { err = "No podés votarte a vos mismo."; return; }
        var par = el.slice().sort();
        votos.push({ categoria: String(c.id), e1: par[0], e2: dupla ? par[1] : null });
      });
      if (err) return err;
      if (!votos.length) return "Votá en al menos una categoría.";
      if (ONLINE) {
        return ensureSession().then(function () {
          return sb.rpc("votar", { p_votacion: v.id, p_votos: votos });
        }).then(function (r) {
          check(r);
          if (!r.data || !r.data.ok) return (r.data && r.data.error) || "No se pudo votar.";
          return loadVotaciones().then(function () { return null; });
        }).catch(function (e) { return friendly(e); });
      }
      var todos = storeGet(KV.votos, {});
      var arr = (todos[v.id] || []).filter(function (x) { return x.votante !== votante; });
      votos.forEach(function (x) { arr.push({ votante: votante, cat: x.categoria, e1: x.e1, e2: x.e2 }); });
      todos[v.id] = arr;
      if (!storeSet(KV.votos, todos)) return "No se pudo guardar en este navegador.";
    }, ONLINE ? "" : "Sin base de datos conectada: el voto queda en este navegador.");

    var cont = document.getElementById("vt-boleta");
    function pintar() {
      var me = votante, prev = {};
      Array.prototype.forEach.call(cont.querySelectorAll("input"), function (c) {
        if (c.checked) (prev[c.name] = prev[c.name] || []).push(c.value);
      });
      cont.innerHTML = cats.map(function (c, i) {
        var dupla = c.tipo === "dupla", marc = prev["op" + i] || [];
        return (
          '<fieldset class="boleta-cat">' +
            '<legend><span class="boleta-n">' + pad(i + 1, 2) + "</span>" + esc(c.titulo) + "</legend>" +
            '<p class="form-note boleta-hint" data-cnt="' + i + '">' + (dupla ? "Dupla · elegí 2" : "Elegí 1") + "</p>" +
            '<div class="check-grid">' + NOMBRES.filter(function (n) { return n !== me; }).map(function (n) {
              return '<label class="check"><input type="checkbox" name="op' + i + '" data-max="' + (dupla ? 2 : 1) + '" value="' + esc(n) + '"' +
                (marc.indexOf(n) >= 0 ? " checked" : "") + "><span>" + esc(n) + "</span></label>";
            }).join("") + "</div>" +
          "</fieldset>"
        );
      }).join("");
      cats.forEach(function (c, i) { limitar(i); });
    }
    function limitar(i) {
      var boxes = cont.querySelectorAll('input[name="op' + i + '"]');
      var max = cats[i].tipo === "dupla" ? 2 : 1;
      var n = Array.prototype.filter.call(boxes, function (c) { return c.checked; }).length;
      if (max === 2) {
        Array.prototype.forEach.call(boxes, function (c) { c.disabled = !c.checked && n >= 2; c.parentNode.classList.toggle("is-off", c.disabled); });
      }
      var hint = cont.querySelector('[data-cnt="' + i + '"]');
      if (hint) hint.textContent = max === 2 ? "Dupla · " + n + " de 2" : (n ? "Listo" : "Elegí 1");
    }
    cont.addEventListener("change", function (e) {
      var t = e.target;
      if (!t.name || t.name.indexOf("op") !== 0) return;
      var i = +t.name.slice(2);
      // A una persona: marcar una desmarca la otra (y se puede desmarcar para no votar)
      if (cats[i].tipo !== "dupla" && t.checked) {
        Array.prototype.forEach.call(cont.querySelectorAll('input[name="' + t.name + '"]'), function (c) { if (c !== t) c.checked = false; });
      }
      limitar(i);
    });
    pintar();
  }

  function cambiarVotacion(id, accion) {
    if (ONLINE) {
      return adminRpc(accion === "cerrar" ? "admin_cerrar_votacion" : "admin_borrar_votacion", { p_id: id }, loadVotaciones);
    }
    var lista = storeGet(KV.lista, []);
    if (accion === "cerrar") lista.forEach(function (v) { if (v.id === id) { v.estado = "cerrada"; v.cerrada = new Date().toISOString(); } });
    else {
      lista = lista.filter(function (v) { return v.id !== id; });
      var todos = storeGet(KV.votos, {}); delete todos[id]; storeSet(KV.votos, todos);
    }
    storeSet(KV.lista, lista);
    return Promise.resolve(null);
  }

  function pageAwards() {
    var top = ranking[0];
    var goleador = F.ST.goleadores[0];
    var figura = F.ST.figuras[0];
    var cats = [
      { title: "Clip del año", winner: '<span id="clip-winner">Cargando…</span>', detail: '<span id="clip-winner-detail"></span>', nueva: true, href: "#clip" },
      { title: "Socio de Honor", winner: esc(top.nombre), detail: "Mayor asistencia a las juntadas: " + top.asistencias + " de " + TOTAL + "." },
      goleador && { title: "Goleador del año", winner: esc(goleador.nombre), detail: plural(goleador.goles, "gol", "goles") + " en " + plural(goleador.pj, "partido", "partidos") + ".", ejemplo: F.hayEjemplo },
      figura && { title: "Figura del año", winner: esc(figura.nombre), detail: "Mejor promedio de nota puesta por los demás: " + nota1(figura.prom) + ".", ejemplo: F.hayEjemplo }
    ].filter(Boolean);

    // Resultado de cada categoría votada (la última votación cerrada que la incluyó)
    var V = getVotaciones();
    var resCat = {}, enVotacion = {};
    V.lista.filter(function (v) { return v.estado === "cerrada"; })
      .sort(function (a, b) { return String(a.cerrada || a.creado).localeCompare(String(b.cerrada || b.creado)); })
      .forEach(function (v) {
        (v.categorias || []).forEach(function (c) { resCat[c.id] = { c: c, r: resultados(votosDe(V, v, c.id)) }; });
      });
    V.lista.filter(function (v) { return v.estado === "abierta"; }).forEach(function (v) {
      (v.categorias || []).forEach(function (c) { enVotacion[c.id] = true; });
    });
    function votadaCard(c, res, extra) {
      var r = res.r;
      return Object.assign({
        title: esc(c.titulo), winner: ganadoresTxt(r), votado: true, tipo: c.tipo,
        detail: (r.ganadores.length > 1 ? "Empate: ganan " + r.ganadores.length + ". " : "") + "Votado por el grupo · " + plural(r.total, "voto", "votos") + ".",
        href2: "#estadisticas"
      }, extra || {});
    }
    var usadas = {};
    getPremios().forEach(function (p) {
      var res = resCat[p.id];
      var extra = { local: p.local, pid: p.pid, editable: p.local != null || !!p.pid };
      usadas[p.id] = true;
      if (p.ganador) {
        cats.push(Object.assign({ title: esc(p.titulo), winner: esc(p.ganador), detail: esc(p.detalle), tipo: p.tipo }, extra));
      } else if (res) {
        cats.push(votadaCard(p, res, extra));
      } else {
        cats.push(Object.assign({
          title: esc(p.titulo), tipo: p.tipo,
          winner: '<span class="premio-pend">' + (enVotacion[p.id] ? "En votación" : "A votar") + "</span>",
          detail: esc(p.detalle) || (p.tipo === "dupla" ? "Se vota una dupla." : "Se vota a una persona."),
          href2: enVotacion[p.id] ? "#votaciones" : null, href2Txt: "Votar →"
        }, extra));
      }
    });
    // Categorías votadas que después se quitaron de la lista: el resultado queda
    Object.keys(resCat).forEach(function (k) { if (!usadas[k]) cats.push(votadaCard(resCat[k].c, resCat[k])); });

    var cards = '<div class="premios">' + cats.map(function (c) {
      var isLocal = c.local != null;
      return (
        '<article class="premio' + (c.nueva ? " is-nueva" : "") + '">' +
          '<p class="label">' + (c.nueva ? "Nueva categoría" : c.votado ? "Votado" : "Categoría") + (c.tipo === "dupla" ? " · dupla" : "") + (c.ejemplo ? " " + EJ : "") + (isLocal ? " " + LOCAL : "") + "</p>" +
          '<h3 class="premio-title">' + c.title + "</h3>" +
          '<p class="premio-winner">' + c.winner + "</p>" +
          (c.detail ? '<p class="premio-detail">' + c.detail + "</p>" : "") +
          (c.href ? '<a class="more ulink" href="' + c.href + '">Ver y votar →</a>' : "") +
          (c.href2 ? '<a class="more ulink" href="' + c.href2 + '">' + (c.href2Txt || "Ver estadísticas →") + "</a>" : "") +
          (c.editable && (isLocal || isAdmin())
            ? '<p class="premio-acciones">' +
                (isAdmin() ? '<button type="button" class="link-btn" data-action="editar-premio" data-i="' + (c.local != null ? c.local : "") + '"' + (c.pid ? ' data-id="' + esc(c.pid) + '"' : "") + ">Editar</button>" : "") +
                '<button type="button" class="link-btn link-btn--muted" data-action="quitar-premio" data-i="' + (c.local != null ? c.local : "") + '"' + (c.pid ? ' data-id="' + esc(c.pid) + '"' : "") + ">Quitar</button>" +
              "</p>"
            : "") +
        "</article>"
      );
    }).join("") + "</div>";

    var form = !ME
      ? '<div class="clip-form clip-form--login"><p class="label">Subir un clip</p>' +
          '<p>Para subir clips y votar tenés que entrar con tu usuario.</p>' +
          '<button type="button" class="btn" data-action="login">Entrar</button></div>'
      : '<form id="clip-form" class="clip-form" novalidate>' +
        '<p class="label">Subir un clip · ' + esc(ME.nombre) + "</p>" +
        '<div class="field"><label for="f-titulo">Título</label><input id="f-titulo" name="titulo" maxlength="80" placeholder="Ej.: El caño de Paty" required></div>' +
        '<div class="field field--wide"><label for="f-url">Link del clip</label><input id="f-url" name="url" type="url" inputmode="url" placeholder="https://youtu.be/… · Instagram · TikTok · Drive"></div>' +
        '<div class="field field--wide"><label for="f-video">o subí el video <small>(MP4, MOV o WebM, hasta ' + MAX_VIDEO_MB + " MB)</small></label>" +
          '<input id="f-video" name="video" type="file" accept="video/mp4,video/quicktime,video/webm"' + (ONLINE ? "" : " disabled") + "></div>" +
        '<div class="form-actions"><button type="submit" class="btn">Subir clip</button><p id="clip-msg" class="form-msg" role="status"></p></div>' +
        (ONLINE
          ? '<p class="form-note">Los clips y los votos se comparten con todo el grupo. Un voto por clip, y no podés votar tus propios clips.</p>'
          : '<p class="form-note"><strong>Modo de prueba:</strong> los clips y los votos quedan solo en este navegador y no se pueden subir videos. Para que vote todo el grupo, completá <code>js/config.js</code> con los datos de Supabase (ver LEEME.md).</p>') +
      "</form>";

    var historial = '<ul class="historial">' + D.historial.map(function (h) {
      var g = h.ganadores && h.ganadores.length;
      return (
        '<li><span class="historial-year">' + h.anio + "</span>" +
        '<span><span class="historial-name">' + esc(h.nombre) + '</span><span class="historial-place">' + esc(h.lugar) + "</span></span>" +
        '<span class="badge">' + (g ? h.ganadores.length + " premiados" : "Ganadores por cargar") + "</span></li>"
      );
    }).join("") + "</ul>";

    return (
      pageHero("Edición " + D.club.temporada, "Chancha <em>Awards</em>", "Los premios de la temporada. Este año se estrena la categoría Clip del año.") +
      remoteNotice() +
      section(1, "Categorías " + D.club.temporada, cards, addBtn("premio", "Agregar premio"), "categorias") +
      section(2, "Votaciones",
        (ONLINE && V.error ? '<p class="notice"><strong>No se pudieron cargar las votaciones.</strong> ' + esc(V.error) + "</p>" : "") +
        (ONLINE && !V.loaded ? '<p class="notice">Cargando votaciones…</p>' : votacionesAbiertas(V)),
        isAdmin() ? addBtn("votacion", "Abrir votación") : asideLabel("Votan los socios con usuario"),
        "votaciones") +
      section(3, "Estadísticas de las votaciones", V.loaded ? estadisticasVotaciones(V) : "", asideLabel("Se ven al cerrar cada votación"), "estadisticas") +
      section(4, "Clip del año", form + '<div id="clips-grid" class="clips clips--vote"></div>', '<span class="label" id="clips-count"></span>', "clip") +
      section(5, "Ediciones anteriores", historial, asideLabel("Historial")) +
      '<datalist id="dl-socios">' + options(NOMBRES) + "</datalist>"
    );
  }

  /* ================= diálogos ================= */
  var dlg;
  function openDialog(title, body, submitLabel, onSubmit, note) {
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.className = "dlg";
      document.body.appendChild(dlg);
      dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    }
    dlg.className = "dlg";
    dlg.innerHTML =
      '<form class="dlg-form" novalidate>' +
        '<header class="dlg-head"><h2>' + title + '</h2><button type="button" class="dlg-close" data-close aria-label="Cerrar">×</button></header>' +
        '<div class="dlg-body">' + body + "</div>" +
        '<footer class="dlg-foot">' +
          '<p class="form-msg" role="status"></p>' +
          '<div class="dlg-actions"><button type="button" class="btn btn--ghost" data-close>Cancelar</button><button type="submit" class="btn">' + submitLabel + "</button></div>" +
          (note === "" ? "" : '<p class="form-note">' + (note || "Se guarda en este dispositivo.") + "</p>") +
        "</footer>" +
      "</form>";
    var form = dlg.querySelector("form");
    var msg = dlg.querySelector(".form-msg");
    dlg.querySelectorAll("[data-close]").forEach(function (b) { b.addEventListener("click", function () { dlg.close(); }); });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      Promise.resolve(onSubmit(form)).then(function (err) {
        if (err) { msg.textContent = err; msg.className = "form-msg is-error"; return; }
        dlg.close();
        render();
      });
    });
    if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", "");
    var first = form.querySelector("select, input");
    if (first) first.focus();
    return form;
  }

  function numOrNull(v) { v = String(v).trim().replace(",", "."); if (v === "") return null; var n = Number(v); return isFinite(n) ? n : NaN; }

  function dialogPartido() {
    var EST = [{ v: "", l: "No juega" }, { v: "T", l: "Titular" }, { v: "S", l: "Suplente" }];
    var nRow = 0;
    // Fila de un jugador. Si extra = true, el nombre se escribe (juega solo este partido).
    function fila(nombre, pos, extra) {
      var i = nRow++, who = extra ? "Extra" : esc(nombre);
      return (
        '<div class="pf-row' + (extra ? " is-extra" : "") + '" data-i="' + i + '"' + (extra ? "" : ' data-nombre="' + esc(nombre) + '"') + ">" +
          (extra
            ? '<div class="pf-name pf-name--extra"><input name="nombre-' + i + '" maxlength="40" placeholder="Nombre del extra" aria-label="Nombre del extra">' +
              '<button type="button" class="pf-quitar" data-quitar="' + i + '" aria-label="Quitar extra">×</button></div>'
            : '<span class="pf-name">' + esc(nombre) + "</span>") +
          '<select name="estado-' + i + '" aria-label="' + who + ': participación">' + options(EST, extra ? "T" : "") + "</select>" +
          '<select name="pos-' + i + '" aria-label="' + who + ': posición">' + options(POS, pos || "MED") + "</select>" +
          '<div class="pf-goles"><button type="button" data-step="-1" data-for="' + i + '" aria-label="' + who + ': un gol menos">−</button>' +
            '<input name="goles-' + i + '" type="number" min="0" max="30" step="1" inputmode="numeric" placeholder="0" disabled aria-label="' + who + ': goles">' +
            '<button type="button" data-step="1" data-for="' + i + '" aria-label="' + who + ': un gol más">+</button></div>' +
        "</div>"
      );
    }
    var filas = F.plantel.map(function (j) { return fila(j.nombre, j.pos, false); }).join("");
    var body =
      '<div class="dlg-grid">' +
        '<div class="field"><label for="p-fecha">Fecha</label><input id="p-fecha" name="fecha" type="date" value="' + hoy() + '" required></div>' +
        '<div class="field"><label for="p-rival">Rival</label><input id="p-rival" name="rival" maxlength="40" required></div>' +
        '<div class="field"><label for="p-torneo">Torneo</label><input id="p-torneo" name="torneo" maxlength="40" value="Amistoso"></div>' +
        '<div class="field"><label for="p-res">¿Cómo salió?</label><div class="res-inputs">' +
          '<select id="p-res" name="res">' + options([{ v: "", l: "No se jugó todavía" }, { v: "G", l: "Ganamos" }, { v: "E", l: "Empatamos" }, { v: "P", l: "Perdimos" }], "") + "</select>" +
          '<label class="res-por" for="p-por">por</label><input id="p-por" name="por" type="number" min="1" max="30" step="1" inputmode="numeric" placeholder="1" aria-label="Diferencia de goles" disabled></div></div>' +
      "</div>" +
      '<p class="label dlg-sub">Quiénes jugaron y quién hizo los goles</p>' +
      '<div class="pf-list" id="pf-list"><div class="pf-row pf-head" aria-hidden="true"><span>Jugador</span><span>Juega</span><span>Posición</span><span>Goles</span></div>' + filas + "</div>" +
      '<button type="button" class="btn btn--ghost btn--small pf-add" id="pf-add">+ Agregar extra</button>' +
      '<p class="form-note pf-add-note">Un extra es alguien que juega solo este partido: aparece en la formación y se le pueden poner notas, pero no entra en las estadísticas.</p>' +
      '<p class="res-preview" id="p-preview" aria-live="polite"></p>' +
      '<p class="form-note">Los goles de La Chancha son la suma de los goles de cada jugador. Con “ganamos / perdimos por” se calculan los del rival.</p>';

    function leer(f) {
      var tit = [], sup = [], golesSup = {}, sumGoles = 0, err = null, usados = {};
      F.plantel.forEach(function (j) { usados[j.nombre.toLowerCase()] = true; });
      Array.prototype.forEach.call(f.querySelectorAll(".pf-row[data-i]"), function (row) {
        var i = row.getAttribute("data-i");
        var est = f["estado-" + i].value;
        if (!est) return;
        var nombre = row.getAttribute("data-nombre");
        if (nombre == null) {
          nombre = f["nombre-" + i].value.trim().replace(/\s+/g, " ");
          if (!nombre) { err = err || "Poné el nombre del extra (o quitalo)."; return; }
          if (usados[nombre.toLowerCase()]) { err = err || "“" + nombre + "” ya está en la lista. Ponele otro nombre al extra."; return; }
          usados[nombre.toLowerCase()] = true;
        }
        var g = numOrNull(f["goles-" + i].value) || 0;
        if (isNaN(g) || g < 0 || g % 1) { err = err || "Los goles de " + nombre + " tienen que ser un número entero."; return; }
        if (est === "T") { tit.push({ j: nombre, pos: f["pos-" + i].value, goles: g || undefined }); sumGoles += g; }
        else if (est === "S") { sup.push(nombre); if (g) { golesSup[nombre] = g; sumGoles += g; } }
      });
      var res = f.res.value, por = numOrNull(f.por.value), gf = null, gc = null;
      if (res) {
        gf = sumGoles;
        if (res === "E") gc = gf;
        else if (por === null || isNaN(por) || por < 1 || por % 1) err = err || "Poné por cuántos goles " + (res === "G" ? "ganaron" : "perdieron") + ".";
        else if (res === "G") { gc = gf - por; if (gc < 0) { gc = null; err = err || "Para ganar por " + por + " hacen falta al menos " + por + " goles cargados a los jugadores (hay " + gf + ")."; } }
        else gc = gf + por;
      }
      return { tit: tit, sup: sup, golesSup: golesSup, sumGoles: sumGoles, res: res, gf: gf, gc: gc, err: err };
    }

    var form = openDialog("Agregar partido", body, "Guardar partido", function (f) {
      var rival = f.rival.value.trim(), fch = f.fecha.value;
      if (!fch) return "Poné la fecha.";
      if (!rival) return "Poné el rival.";
      var r = leer(f);
      if (r.err) return r.err;
      if (!r.tit.length) return "Marcá al menos un titular.";
      if (r.tit.length > 11) return "Hay más de 11 titulares.";
      if (!r.res && r.sumGoles) return "Si el partido no se jugó, no puede haber goles.";
      if (ONLINE) {
        var nuevoId = null;
        return remoteWrite(function () {
          return sb.from("partidos").insert({
            fecha: fch, rival: rival, torneo: f.torneo.value.trim() || "Amistoso", gf: r.gf, gc: r.gc,
            titulares: r.tit.map(function (t) { var o = { j: t.j, pos: t.pos }; if (t.goles) o.goles = t.goles; return o; }),
            suplentes: r.sup, goles_suplentes: r.golesSup
          }).select("id").single().then(function (res) { if (res.data) nuevoId = res.data.id; return res; });
        }).then(function (err) { if (!err) verId = nuevoId; return err; });
      }
      var list = storeGet(K.partidos, []);
      var id = "l" + Date.now();
      var p = { id: id, fecha: fch, rival: rival, torneo: f.torneo.value.trim() || "Amistoso", gf: r.gf, gc: r.gc, titulares: r.tit, suplentes: r.sup };
      if (Object.keys(r.golesSup).length) p.golesSuplentes = r.golesSup;
      list.push(p);
      if (!storeSet(K.partidos, list)) return "No se pudo guardar en este navegador.";
      verId = id;
    });

    dlg.classList.add("dlg--wide");
    var preview = document.getElementById("p-preview");
    function sync() {
      var res = form.res.value;
      form.por.disabled = !res || res === "E";
      if (form.por.disabled) form.por.value = "";
      Array.prototype.forEach.call(form.querySelectorAll(".pf-row[data-i]"), function (row) {
        var i = row.getAttribute("data-i"), inp = form["goles-" + i];
        var juega = !!form["estado-" + i].value;
        row.classList.toggle("is-on", juega);
        inp.disabled = !juega || !res;
        if (inp.disabled) inp.value = "";
        row.querySelectorAll("[data-step]").forEach(function (b) { b.disabled = inp.disabled; });
      });
      var r = leer(form), rival = form.rival.value.trim() || "Rival";
      if (!res) preview.innerHTML = '<span class="label">Próximo partido</span> La Chancha vs ' + esc(rival);
      else if (r.gc === null) preview.innerHTML = '<span class="label">Resultado</span> La Chancha ' + r.gf + " – ? " + esc(rival) +
        (r.err ? ' <span class="res-warn">' + esc(r.err) + "</span>" : "");
      else preview.innerHTML = '<span class="label">Resultado</span> La Chancha <strong>' + r.gf + " – " + r.gc + "</strong> " + esc(rival) +
        (r.err ? ' <span class="res-warn">' + esc(r.err) + "</span>" : "");
    }
    form.addEventListener("input", sync);
    form.addEventListener("change", sync);
    var list = document.getElementById("pf-list");
    document.getElementById("pf-add").addEventListener("click", function () {
      list.insertAdjacentHTML("beforeend", fila("", "MED", true));
      var nuevo = list.lastElementChild.querySelector("input");
      sync();
      nuevo.focus();
    });
    list.addEventListener("click", function (e) {
      var b = e.target.closest("[data-step], [data-quitar]");
      if (!b || b.disabled) return;
      if (b.hasAttribute("data-quitar")) {
        var row = list.querySelector('.pf-row[data-i="' + b.getAttribute("data-quitar") + '"]');
        if (row) row.remove();
      } else {
        var inp = form["goles-" + b.getAttribute("data-for")];
        inp.value = Math.max(0, Math.min(30, (numOrNull(inp.value) || 0) + +b.getAttribute("data-step"))) || "";
      }
      sync();
    });
    sync();
  }

  function dialogNota(id) {
    var m = findPartido(id);
    if (!m) return;
    var filas = m.titulares.map(function (t, i) {
      var d = dorsalOf(t.j);
      return (
        '<div class="nota-row" data-j="' + esc(t.j) + '">' +
          '<span class="nota-dorsal">' + (d != null ? d : "–") + "</span>" +
          '<label class="nota-name" for="n-' + i + '">' + esc(t.j) + ' <small class="nota-self">(vos)</small></label>' +
          '<input id="n-' + i + '" name="n-' + i + '" type="number" min="1" max="10" step="0.5" inputmode="decimal" placeholder="–">' +
        "</div>"
      );
    }).join("");
    var body =
      '<p class="dlg-context">' + esc(m.rival) + " · " + fecha(m.fecha) + (jugado(m) ? " · " + m.gf + " – " + m.gc : "") + "</p>" +
      '<p class="label dlg-sub">Notas de ' + esc(ME.nombre) + " · del 1 al 10</p>" +
      '<div class="nota-rows">' + filas + "</div>" +
      '<p class="form-note">No podés ponerte nota a vos mismo. Si ya votaste, tu voto se reemplaza.</p>';

    var votante = ME.nombre;
    var form = openDialog("Agregar nota", body, "Guardar notas", function (f) {
      var notas = {}, error = null, n = 0;
      m.titulares.forEach(function (t, i) {
        if (t.j === votante) return;
        var v = numOrNull(f["n-" + i].value);
        if (v === null) return;
        if (isNaN(v) || v < 1 || v > 10) { error = "Las notas van del 1 al 10 (" + t.j + ")."; return; }
        notas[t.j] = Math.round(v * 2) / 2; n++;
      });
      if (error) return error;
      if (!n) return "Poné al menos una nota.";
      if (ONLINE) {
        return remoteWrite(function () {
          return sb.from("notas").upsert({ partido_id: m.id, votante: votante, notas: notas }, { onConflict: "partido_id,votante" });
        }).then(function (err) {
          if (!err) verId = m.id;
          return err;
        });
      }
      var all = storeGet(K.votos, {});
      var arr = (all[m.id] || []).filter(function (v) { return v.votante !== votante; });
      arr.push({ votante: votante, notas: notas });
      all[m.id] = arr;
      if (!storeSet(K.votos, all)) return "No se pudo guardar en este navegador.";
      verId = m.id;
    });

    function sync() {
      var who = votante;
      var prev = m.votos.filter(function (v) { return v.votante === who; })[0];
      form.querySelectorAll(".nota-row").forEach(function (row, i) {
        var self = row.getAttribute("data-j") === who;
        var inp = row.querySelector("input");
        row.classList.toggle("is-self", self);
        inp.disabled = self;
        inp.value = !self && prev && prev.notas[m.titulares[i].j] != null ? prev.notas[m.titulares[i].j] : "";
      });
    }
    sync();
  }

  // Remera (número + posición). Cada uno elige la suya; el admin puede cambiar la de cualquiera.
  // primera = true: se abre sola la primera vez que alguien entra con su usuario.
  function dialogDorsal(nombre, primera) {
    var admin = isAdmin();
    if (!admin || !nombre) nombre = ME.nombre;
    var jugadores = admin ? F.plantel : F.plantel.filter(function (j) { return j.nombre === ME.nombre; });
    var body =
      (primera ? '<p class="dlg-context">Elegí tu número y la posición en la que jugás.</p>' : "") +
      '<div class="dlg-grid dlg-grid--dorsal">' +
        '<div class="dorsal-preview" id="dorsal-preview"></div>' +
        "<div>" +
          '<div class="field"><label for="d-jug">Jugador</label><select id="d-jug" name="jugador"' + (admin ? "" : " disabled") + ">" +
            options(jugadores.map(function (j) { return { v: j.nombre, l: j.nombre + (j.dorsal != null ? " · " + j.dorsal : "") }; }), nombre) + "</select></div>" +
          '<div class="field"><label for="d-num">Número</label><input id="d-num" name="dorsal" type="number" min="1" max="99" inputmode="numeric" required></div>' +
          '<div class="field"><label for="d-pos">Posición</label><select id="d-pos" name="pos">' + options([{ v: "", l: primera ? "Elegí tu posición" : "A definir" }].concat(POS.map(function (p) { return { v: p, l: POS_LABEL[p] }; })), "") + "</select></div>" +
          '<p class="form-note" id="d-ocupados"></p>' +
        "</div>" +
      "</div>";

    var form = openDialog(primera ? "Elegí tu remera" : "Remera", body, "Guardar remera", function (f) {
      var who = f.jugador.value;
      var num = numOrNull(f.dorsal.value);
      if (num === null || isNaN(num) || num % 1 || num < 1 || num > 99) return "El número tiene que ser entero, del 1 al 99.";
      if (primera && !f.pos.value) return "Elegí tu posición.";
      var duenio = F.plantel.filter(function (j) { return j.dorsal === num && j.nombre !== who; })[0];
      if (duenio) return "El " + num + " ya lo tiene " + duenio.nombre + ". Elegí otro.";
      if (ONLINE) {
        return remoteWrite(function () {
          return sb.from("dorsales").upsert({ nombre: who, dorsal: num, pos: f.pos.value || null }, { onConflict: "nombre" });
        }, "El " + num + " ya lo eligió otro jugador.");
      }
      var over = storeGet(K.dorsales, {});
      over[who] = { dorsal: num, pos: f.pos.value || null };
      if (!storeSet(K.dorsales, over)) return "No se pudo guardar en este navegador.";
    });

    var preview = document.getElementById("dorsal-preview");
    var ocupados = document.getElementById("d-ocupados");
    function sync(loadPlayer) {
      var who = form.jugador.value;
      var j = F.jug[who];
      if (loadPlayer) {
        form.dorsal.value = j.dorsal != null ? j.dorsal : "";
        form.pos.value = j.pos || "";
      }
      var n = numOrNull(form.dorsal.value);
      preview.innerHTML = camiseta({ nombre: who, dorsal: n !== null && !isNaN(n) ? n : null }) +
        '<p class="kit-pos">' + (form.pos.value ? POS_LABEL[form.pos.value] : "Posición a definir") + "</p>";
      var usados = F.plantel.filter(function (p) { return p.dorsal != null && p.nombre !== who; })
        .sort(function (a, b) { return a.dorsal - b.dorsal; })
        .map(function (p) { return p.dorsal + " (" + esc(p.nombre) + ")"; });
      ocupados.innerHTML = usados.length ? "Ocupados: " + usados.join(", ") : "Todavía no hay números ocupados.";
    }
    form.jugador.addEventListener("change", function () { sync(true); });
    form.dorsal.addEventListener("input", function () { sync(false); });
    form.pos.addEventListener("change", function () { sync(false); });
    sync(true);
  }

  function dialogPremio() {
    var body =
      '<div class="field"><label for="pr-titulo">Categoría</label><input id="pr-titulo" name="titulo" maxlength="50" placeholder="Ej.: Mejor asado" required></div>' +
      '<div class="field"><label for="pr-detalle">Detalle <small>(opcional)</small></label><input id="pr-detalle" name="detalle" maxlength="120" placeholder="De qué se trata"></div>' +
      '<p class="label dlg-sub">¿Cómo se vota?</p>' +
      '<div class="tipo-opts">' +
        '<label class="check tipo-opt"><input type="radio" name="tipo" value="individual" checked><span><strong>A una persona</strong><small>Cada uno elige a un socio.</small></span></label>' +
        '<label class="check tipo-opt"><input type="radio" name="tipo" value="dupla"><span><strong>A una dupla</strong><small>Cada uno elige una pareja. Gana una dupla.</small></span></label>' +
      "</div>" +
      '<div class="field"><label for="pr-ganador">Ganador <small>(dejalo vacío si se vota)</small></label><input id="pr-ganador" name="ganador" maxlength="40" list="dl-socios-dlg" placeholder="Solo si ya está decidido"></div>' +
      '<datalist id="dl-socios-dlg">' + options(NOMBRES) + "</datalist>" +
      '<p class="form-note">Las categorías sin ganador entran en la próxima votación de los Awards.</p>';
    openDialog("Agregar premio", body, "Guardar premio", function (f) {
      var t = f.titulo.value.trim(), g = f.ganador.value.trim(), tipo = f.querySelector('input[name="tipo"]:checked').value;
      if (!t) return "Poné el nombre de la categoría.";
      if (ONLINE) {
        return remoteWrite(function () {
          return sb.from("premios").insert({ titulo: t, tipo: tipo, ganador: g || null, detalle: f.detalle.value.trim() || null });
        });
      }
      var list = storeGet(K.premios, []);
      list.push({ id: "p" + Date.now(), titulo: t, tipo: tipo, ganador: g, detalle: f.detalle.value.trim() });
      if (!storeSet(K.premios, list)) return "No se pudo guardar en este navegador.";
    });
  }

  /* ----- usuarios: entrar, mi cuenta, salir ----- */
  function dialogLogin(despues) {
    var body =
      '<div class="field"><label for="l-nombre">Usuario</label><select id="l-nombre" name="nombre" autocomplete="username" required>' +
        options([{ v: "", l: "Elegí tu nombre" }].concat(NOMBRES), "") + "</select></div>" +
      '<div class="field"><label for="l-clave">Contraseña</label><input id="l-clave" name="clave" type="password" autocomplete="current-password" required></div>' +
      (ONLINE ? "" : '<p class="form-note"><strong>Modo de prueba:</strong> sin la base conectada cualquier contraseña sirve. ' + esc(ADMIN_PRUEBA) + " es el admin.</p>");
    openDialog("Entrar", body, "Entrar", function (f) {
      var n = f.nombre.value, clave = f.clave.value;
      if (!n) return "Elegí tu nombre.";
      if (!clave) return "Poné tu contraseña.";
      var entrar = ONLINE
        ? sb.auth.signInWithPassword({ email: emailDe(n), password: clave }).then(function (r) {
            check(r);
            return loadMe().then(function () {
              if (!ME) { sb.auth.signOut(); return "Ese usuario no está habilitado en La Chancha."; }
            });
          }).catch(function (e) { return friendly(e); })
        : Promise.resolve(storeSet(KU, n)).then(function () { return loadMe(); }).then(function () { return null; });
      return entrar.then(function (err) {
        if (err) return err;
        recargarTodo().then(function () {
          if (!miRemera()) dialogDorsal(ME.nombre, true);
          else if (typeof despues === "function") despues();
        });
      });
    }, ONLINE ? "Tu usuario y contraseña te los pasa el admin. Después podés cambiar la contraseña." : "");
  }

  function miRemera() {
    var j = ME && F.jug[ME.nombre];
    return !!(j && j.dorsal != null);
  }

  function dialogCuenta() {
    var j = F.jug[ME.nombre] || {};
    var body =
      '<div class="cuenta">' +
        '<span class="user-avatar user-avatar--lg" aria-hidden="true">' + esc(initials(ME.nombre)) + "</span>" +
        '<div><p class="dlg-context">' + esc(ME.nombre) + "</p>" +
        '<p class="form-note">' + (ME.admin ? "Admin del club · " : "Socio · ") +
          (j.dorsal != null ? "Remera " + j.dorsal + (j.pos ? " · " + POS_LABEL[j.pos] : "") : "Sin remera") +
          ' · <button type="button" class="link-btn" data-action="dorsal" data-nombre="' + esc(ME.nombre) + '">Cambiar remera</button></p></div>' +
      "</div>" +
      '<p class="label dlg-sub">Cambiar contraseña</p>' +
      '<div class="dlg-grid">' +
        '<div class="field"><label for="c-clave">Nueva contraseña</label><input id="c-clave" name="clave" type="password" autocomplete="new-password" minlength="8"></div>' +
        '<div class="field"><label for="c-clave2">Repetila</label><input id="c-clave2" name="clave2" type="password" autocomplete="new-password"></div>' +
      "</div>" +
      '<p class="form-note">Mínimo 8 caracteres. Si no querés cambiarla, dejalo vacío.</p>' +
      '<p><button type="button" class="btn btn--ghost" data-action="salir">Salir de la cuenta</button></p>';
    openDialog("Mi cuenta", body, "Guardar contraseña", function (f) {
      var c1 = f.clave.value, c2 = f.clave2.value;
      if (!c1) return "Poné la contraseña nueva.";
      if (c1.length < 8) return "La contraseña tiene que tener al menos 8 caracteres.";
      if (c1 !== c2) return "Las contraseñas no coinciden.";
      if (!ONLINE) return "En el modo de prueba no hay contraseñas.";
      return sb.auth.updateUser({ password: c1 }).then(function (r) {
        check(r);
        alert("Listo, contraseña cambiada.");
      }).catch(function (e) { return friendly(e); });
    }, "");
  }

  function salir() {
    var fin = ONLINE ? sb.auth.signOut().catch(function () {}) : Promise.resolve(storeSet(KU, ""));
    fin.then(function () { ME = null; return recargarTodo(); });
  }

  // Editar una categoría (solo el admin)
  function dialogEditarPremio(id, i) {
    var p = getPremios().filter(function (x) { return id ? String(x.pid) === String(id) : String(x.local) === String(i); })[0];
    if (!p) return;
    var body =
      '<div class="field"><label for="ep-titulo">Categoría</label><input id="ep-titulo" name="titulo" maxlength="50" value="' + esc(p.titulo) + '" required></div>' +
      '<div class="field"><label for="ep-detalle">Detalle <small>(opcional)</small></label><input id="ep-detalle" name="detalle" maxlength="120" value="' + esc(p.detalle) + '"></div>' +
      '<p class="label dlg-sub">¿Cómo se vota?</p>' +
      '<div class="tipo-opts">' +
        '<label class="check tipo-opt"><input type="radio" name="tipo" value="individual"' + (p.tipo !== "dupla" ? " checked" : "") + "><span><strong>A una persona</strong><small>Cada uno elige a un socio.</small></span></label>" +
        '<label class="check tipo-opt"><input type="radio" name="tipo" value="dupla"' + (p.tipo === "dupla" ? " checked" : "") + "><span><strong>A una dupla</strong><small>Cada uno elige una pareja. Gana una dupla.</small></span></label>" +
      "</div>" +
      '<div class="field"><label for="ep-ganador">Ganador <small>(dejalo vacío si se vota)</small></label><input id="ep-ganador" name="ganador" maxlength="40" list="dl-socios-ep" value="' + esc(p.ganador) + '"></div>' +
      '<datalist id="dl-socios-ep">' + options(NOMBRES) + "</datalist>" +
      '<p class="form-note">Si la categoría ya está en una votación abierta, los cambios se ven en la próxima.</p>';
    openDialog("Editar categoría", body, "Guardar cambios", function (f) {
      var t = f.titulo.value.trim(), g = f.ganador.value.trim(), tipo = f.querySelector('input[name="tipo"]:checked').value;
      if (!t) return "Poné el nombre de la categoría.";
      var cambios = { titulo: t, tipo: tipo, ganador: g || null, detalle: f.detalle.value.trim() || null };
      if (ONLINE) return remoteWrite(function () { return sb.from("premios").update(cambios).eq("id", p.pid); });
      var list = storeGet(K.premios, []);
      if (!list[p.local]) return "No se encontró la categoría.";
      Object.assign(list[p.local], { titulo: t, tipo: tipo, ganador: g, detalle: f.detalle.value.trim() });
      if (!storeSet(K.premios, list)) return "No se pudo guardar en este navegador.";
    }, "");
  }
  function dialogJuntada() {
    var checks = A.socios.map(function (n, i) {
      return '<label class="check"><input type="checkbox" name="p" value="' + esc(n) + '"><span>' + esc(n) + "</span></label>";
    }).join("");
    var body =
      '<div class="dlg-grid">' +
        '<div class="field"><label for="j-fecha">Fecha</label><input id="j-fecha" name="fecha" type="date" value="' + hoy() + '" required></div>' +
        '<div class="field"><label for="j-nombre">Qué fue <small>(opcional)</small></label><input id="j-nombre" name="nombre" maxlength="50" placeholder="Ej.: Asado en lo de Paty"></div>' +
      "</div>" +
      '<div class="dlg-sub-row"><p class="label">¿Quiénes vinieron?</p><button type="button" class="link-btn" id="j-todos">Marcar todos</button></div>' +
      '<div class="check-grid">' + checks + "</div>" +
      '<p class="form-note" id="j-count">0 presentes</p>';
    var form = openDialog("Registrar juntada", body, "Guardar juntada", function (f) {
      if (!f.fecha.value) return "Poné la fecha.";
      var presentes = Array.prototype.filter.call(f.querySelectorAll('input[name="p"]'), function (c) { return c.checked; }).map(function (c) { return c.value; });
      if (!presentes.length) return "Marcá al menos a uno que haya venido.";
      if (ONLINE) return adminRpc("admin_registrar_juntada", { p_fecha: f.fecha.value, p_nombre: f.nombre.value.trim(), p_presentes: presentes });
      var obj = cloneA();
      obj.juntadas = obj.juntadas || [];
      obj.juntadas.push({ id: "j" + Date.now(), fecha: f.fecha.value, nombre: f.nombre.value.trim(), presentes: presentes });
      if (!saveA(obj)) return "No se pudo guardar en este navegador.";
    }, ONLINE ? "Se guarda para todo el grupo." : "Sin base de datos conectada: queda en este navegador.");
    var boxes = form.querySelectorAll('input[name="p"]');
    var count = document.getElementById("j-count");
    function upd() { count.textContent = plural(Array.prototype.filter.call(boxes, function (c) { return c.checked; }).length, "presente", "presentes"); }
    form.addEventListener("change", upd);
    document.getElementById("j-todos").addEventListener("click", function () {
      var all = Array.prototype.every.call(boxes, function (c) { return c.checked; });
      boxes.forEach(function (c) { c.checked = !all; });
      this.textContent = all ? "Marcar todos" : "Desmarcar todos";
      upd();
    });
  }

  function dialogSocio() {
    var body =
      '<div class="field"><label for="s-nombre">Nombre o apodo</label><input id="s-nombre" name="nombre" maxlength="30" required></div>' +
      '<p class="form-note">Entra con 0 asistencias y el número de socio N.º ' + pad(A.socios.length + 1) + ".</p>";
    openDialog("Agregar socio", body, "Agregar socio", function (f) {
      var n = f.nombre.value.trim();
      if (!n) return "Poné el nombre.";
      if (A.socios.some(function (s) { return s.toLowerCase() === n.toLowerCase(); })) return n + " ya es socio.";
      if (ONLINE) return adminRpc("admin_agregar_socio", { p_nombre: n });
      var obj = cloneA();
      obj.socios.push(n);
      if (!saveA(obj)) return "No se pudo guardar en este navegador.";
    }, ONLINE ? "Se guarda para todo el grupo." : "Sin base de datos conectada: queda en este navegador.");
  }

  function quitar(key, i) {
    var list = storeGet(key, []);
    list.splice(i, 1);
    storeSet(key, list);
    render();
  }

  /* ================= eventos ================= */
  var NECESITA_USUARIO = ["partido", "nota", "dorsal", "premio", "votar-premio", "votar", "quitar-partido", "quitar-premio", "quitar-clip"];

  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-action]");
    if (!b) return;
    var a = b.getAttribute("data-action"), id = b.getAttribute("data-id");
    // Todo lo que carga o vota necesita usuario: sin sesión, primero se entra
    if (!ME && NECESITA_USUARIO.indexOf(a) >= 0) { dialogLogin(); return; }
    if (a === "login") dialogLogin();
    else if (a === "cuenta" && ME) dialogCuenta();
    else if (a === "salir") { if (dlg && dlg.open) dlg.close(); salir(); }
    else if (a === "partido") dialogPartido();
    else if (a === "nota") dialogNota(id);
    else if (a === "dorsal") dialogDorsal(b.getAttribute("data-nombre"));
    else if (a === "premio") dialogPremio();
    else if (a === "editar-premio" && isAdmin()) dialogEditarPremio(id, b.getAttribute("data-i"));
    else if (a === "votacion" && isAdmin()) dialogVotacion();
    else if (a === "votar-premio") dialogVotar(id);
    else if ((a === "cerrar-votacion" || a === "borrar-votacion") && isAdmin()) {
      var cerrar = a === "cerrar-votacion";
      if (!confirm(cerrar ? "¿Cerrar la votación? Ya no se va a poder votar y se muestran los resultados." : "¿Borrar esta votación y todos sus votos?")) return;
      cambiarVotacion(id, cerrar ? "cerrar" : "borrar").then(function (err) {
        if (err) alert(err);
        render();
        if (cerrar && !err) { var s = document.getElementById("estadisticas"); if (s) s.scrollIntoView({ behavior: "smooth", block: "start" }); }
      });
    }
    else if (a === "juntada" && isAdmin()) dialogJuntada();
    else if (a === "socio" && isAdmin()) dialogSocio();
    else if (a === "descargar" && isAdmin()) descargarAsistencia();
    else if (a === "quitar-juntada" && isAdmin()) {
      if (!confirm("¿Quitar esta juntada?")) return;
      if (ONLINE) {
        adminRpc("admin_quitar_juntada", { p_id: id }).then(function (err) { if (err) alert(err); render(); });
        return;
      }
      var objA = cloneA();
      objA.juntadas = (objA.juntadas || []).filter(function (j) { return j.id !== id; });
      saveA(objA);
      render();
    }
    else if (a === "ver") {
      verId = id; render();
      document.getElementById("partido").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (a === "quitar-partido") {
      if (!confirm("¿Quitar este partido? Se borran también sus notas.")) return;
      if (verId === id) verId = null;
      if (ONLINE) {
        remoteWrite(function () { return sb.from("partidos").delete().eq("id", id); }).then(function (err) { if (err) alert(err); render(); });
        return;
      }
      storeSet(K.partidos, storeGet(K.partidos, []).filter(function (p) { return p.id !== id; }));
      var votos = storeGet(K.votos, {}); delete votos[id]; storeSet(K.votos, votos);
      render();
    } else if (a === "quitar-premio") {
      if (!confirm("¿Quitar este premio?")) return;
      if (ONLINE) {
        remoteWrite(function () { return sb.from("premios").delete().eq("id", id); }).then(function (err) { if (err) alert(err); render(); });
        return;
      }
      quitar(K.premios, +b.getAttribute("data-i"));
    }
    else if (a === "votar") votar(id, +b.getAttribute("data-v"));
    else if (a === "quitar-clip") {
      var clip = clipsState.list.filter(function (x) { return x.id === id; })[0];
      if (!clip || !confirm("¿Quitar este clip?")) return;
      ClipStore.remove(clip).then(loadClips).catch(function (err) { alert("No se pudo quitar: " + ((err && err.message) || err)); });
    }
  });

  document.addEventListener("submit", function (e) {
    if (e.target.id !== "clip-form") return;
    e.preventDefault();
    var form = e.target, msg = document.getElementById("clip-msg"), btn = form.querySelector('[type="submit"]');
    function fail(t) { msg.textContent = t; msg.className = "form-msg is-error"; }
    if (!ME) return dialogLogin();
    var titulo = form.titulo.value.trim(), autor = ME.nombre, url = form.url.value.trim();
    var file = form.video && form.video.files && form.video.files[0];
    if (!titulo) return fail("Poné un título.");
    if (url) {
      var ok = false;
      try { var u = new URL(url); ok = u.protocol === "https:" || u.protocol === "http:"; } catch (err) {}
      if (!ok) return fail("El link tiene que empezar con https://");
    }
    if (!url && !file) return fail("Pegá un link o elegí un video.");
    if (file && file.size > MAX_VIDEO_MB * 1024 * 1024) return fail("El video pesa más de " + MAX_VIDEO_MB + " MB. Subilo a YouTube o Drive y pegá el link.");
    btn.disabled = true;
    msg.textContent = file ? "Subiendo video…" : "Guardando…"; msg.className = "form-msg";
    ClipStore.add({ titulo: titulo, autor: autor, url: url, file: file }).then(function () {
      form.titulo.value = ""; form.url.value = ""; if (form.video) form.video.value = "";
      msg.textContent = "¡Clip subido! Ya se puede votar."; msg.className = "form-msg is-ok";
      return loadClips();
    }).catch(function (err) {
      fail("No se pudo subir: " + ((err && err.message) || err));
    }).then(function () { btn.disabled = false; });
  });

  /* ================= montaje ================= */
  var PAGES = { inicio: pageInicio, asistencia: pageAsistencia, futbol: pageFutbol, awards: pageAwards };
  var main;
  function render(first) {
    refreshA();
    refreshF();
    main.innerHTML = (PAGES[page] || pageInicio)();
    if (!first) main.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("is-in"); });
    if (page === "awards") { renderClips(); if (first) loadClips(); }
  }

  function renderChrome() {
    document.getElementById("header").outerHTML = header();
    document.getElementById("footer").outerHTML = footer();
  }

  // Vuelve a leer quién sos y los datos del grupo, y redibuja todo (al entrar o salir)
  function recargarTodo() {
    return loadMe().then(function () {
      if (!ONLINE) return;
      return Promise.all([loadAsistRemote(), loadRemote(), page === "awards" ? loadVotaciones() : null]);
    }).then(function () {
      render();
      renderChrome();
      if (page === "awards") loadClips();
    });
  }

  document.getElementById("header").outerHTML = header();
  main = document.getElementById("main");
  render(true);
  document.getElementById("footer").outerHTML = footer();
  loadMe().then(function () {
    if (!ONLINE) return;
    return Promise.all([
      loadAsistRemote(),
      ME || page === "futbol" || page === "awards" ? loadRemote() : null,
      page === "awards" ? loadVotaciones() : null
    ]);
  }).then(function () {
    render();
    renderChrome();
    if (page === "awards" && ME) loadClips();
    // La primera vez que alguien entra con su usuario, elige su remera
    if (ME && REMOTE.loaded && !REMOTE.error && !miRemera()) dialogDorsal(ME.nombre, true);
  });

  /* fade al entrar */
  var els = main.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); }
      });
    }, { threshold: 0.05, rootMargin: "0px 0px -40px 0px" });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add("is-in"); });
  }
  if (location.hash) {
    var target = document.querySelector(location.hash);
    if (target) { target.classList.add("is-in"); setTimeout(function () { target.scrollIntoView(); }, 50); }
  }
})();
