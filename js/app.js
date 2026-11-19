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
  var A, TOTAL, UMBRAL, socios, ranking, titularesJuntadas, sumAsist, promedio, minTitular, NOMBRES, cambiosSinPublicar;

  function getA() {
    var loc = storeGet(K.asistencia, null);
    if (loc && loc.actualizado && loc.actualizado > (FILE_A.actualizado || "")) return loc;
    return FILE_A;
  }
  function cloneA() { return JSON.parse(JSON.stringify(getA())); }
  function saveA(obj) {
    obj.actualizado = new Date().toISOString();
    return storeSet(K.asistencia, obj);
  }
  function isAdmin() { try { return sessionStorage.getItem(K.admin) === "1"; } catch (e) { return false; } }
  function setAdmin(on) { try { if (on) sessionStorage.setItem(K.admin, "1"); else sessionStorage.removeItem(K.admin); } catch (e) {} }

  function refreshA() {
    A = getA();
    cambiosSinPublicar = A !== FILE_A;
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

  function sha256(text) {
    if (!window.crypto || !crypto.subtle) return Promise.reject(new Error("no-crypto"));
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode("la-chancha:" + text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
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

  function getPlantel() {
    var over = storeGet(K.dorsales, {});
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
    var locales = storeGet(K.partidos, []).map(function (p) { return Object.assign({}, p, { local: true }); });
    var votosLoc = storeGet(K.votos, {});
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

  function calcStats(partidos) {
    var s = { pj: 0, G: 0, E: 0, P: 0, gf: 0, gc: 0 }, by = {};
    partidos.filter(jugado).forEach(function (m) {
      s.pj++; s[res(m)]++; s.gf += m.gf; s.gc += m.gc;
      m.titulares.forEach(function (t) {
        var r = by[t.j] || (by[t.j] = { nombre: t.j, pj: 0, goles: 0, sum: 0, n: 0 });
        r.pj++; r.goles += t.goles || 0;
        if (t.nota != null) { r.sum += t.nota; r.n++; }
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
    F = { plantel: plantel, jug: jug, partidos: partidos, ST: calcStats(partidos), hayEjemplo: partidos.some(function (p) { return p.ejemplo; }) };
  }
  function dorsalOf(n) { var j = F.jug[n]; return j && j.dorsal != null ? j.dorsal : null; }
  function shirtLabel(n) { var d = dorsalOf(n); return d != null ? d : initials(n); }
  function findPartido(id) { return F.partidos.filter(function (p) { return p.id === id; })[0]; }

  /* ================= escudo, copa y camiseta ================= */
  var uid = 0;
  var SHIELD = "M12 8H108V66C108 100 86 121 60 132C34 121 12 100 12 66Z";
  var STAR = "M60 -15L62.12 -8.91L68.56 -8.78L63.42 -4.89L65.29 1.28L60 -2.4L54.71 1.28L56.58 -4.89L51.44 -8.78L57.88 -8.91Z";
  function crest(full) {
    var id = "crest-clip-" + (++uid);
    var pig =
      '<g stroke-width="3" stroke-linecap="round" stroke-linejoin="round">' +
        '<path class="crest-line" d="M42 92v8M50 93.5v8M64 93.5v8M72 91v8"/>' +
        '<path class="crest-line" fill="none" d="M32 75c-5-3-9 2-5 4c3 1.5 3.5-3 .5-3"/>' +
        '<ellipse class="crest-fill crest-line" cx="56" cy="78" rx="25" ry="16"/>' +
        '<path class="crest-fill crest-line" d="M72 64l3.5-10l8 8z"/>' +
        '<circle class="crest-fill crest-line" cx="80" cy="73" r="11"/>' +
        '<rect class="crest-fill crest-line" x="88" y="68" width="8" height="10" rx="3"/>' +
        '<circle class="crest-dot" cx="81" cy="70" r="1.7"/>' +
      "</g>";
    var body =
      '<path class="crest-star" stroke-width="1.5" stroke-linejoin="round" d="' + STAR + '"/>' +
      '<clipPath id="' + id + '"><path d="' + SHIELD + '"/></clipPath>' +
      '<path class="crest-bg" d="' + SHIELD + '"/>' +
      '<g clip-path="url(#' + id + ')"><path class="crest-sash" d="M-10 28L130 98V116L-10 46Z"/></g>' +
      pig +
      '<path class="crest-outline" fill="none" stroke-width="3.5" stroke-linejoin="round" d="' + SHIELD + '"/>';
    if (!full) return '<svg class="crest" viewBox="0 -18 120 152" aria-hidden="true" focusable="false">' + body + "</svg>";
    return (
      '<svg class="crest crest--full" viewBox="0 -18 120 196" role="img" aria-label="Escudo del ' + esc(D.club.nombre) + ", con una estrella, fundado en " + D.club.fundacion + '">' +
        body +
        '<text class="crest-fund" x="60" y="28" text-anchor="middle">FUND. ' + D.club.fundacion + "</text>" +
        '<text class="crest-name" x="60" y="157" text-anchor="middle">LA CHANCHA</text>' +
        '<text class="crest-legend" x="60" y="172" text-anchor="middle">CLUB SOCIAL Y DEPORTIVO</text>' +
      "</svg>"
    );
  }

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
    { id: "inicio", href: "index.html", label: "Inicio" },
    { id: "asistencia", href: "asistencia.html", label: "Asistencia" },
    { id: "futbol", href: "futbol.html", label: "Fútbol" },
    { id: "awards", href: "awards.html", label: '<span class="nav-long">Chancha </span>Awards' }
  ];

  function header() {
    var links = NAV.map(function (n) {
      return '<a href="' + n.href + '"' + (n.id === page ? ' aria-current="page"' : "") + ">" + n.label + "</a>";
    }).join("");
    return (
      '<header class="site-header">' +
        '<div class="wrap header-inner">' +
          '<a class="brand" href="index.html" aria-label="La Chancha — Inicio">' + crest() +
            '<span class="brand-text"><span class="brand-kicker">Club Social y Deportivo</span><span class="brand-name">La Chancha</span></span>' +
          "</a>" +
          '<nav class="nav" aria-label="Principal">' + links + "</nav>" +
        "</div>" +
        '<div class="band" aria-hidden="true"></div>' +
      "</header>"
    );
  }

  function footer() {
    return (
      '<footer class="site-footer">' +
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
  var LOCAL = '<span class="badge badge--local">Este dispositivo</span>';

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
          '<p class="lead">Secretaría del club. Padrón de socios, asistencia a las juntadas, el fútbol y los Chancha Awards.</p>' +
        "</div>" +
      "</div>" +
      '<div class="reveal">' + stats([
        { label: "Juntadas", value: TOTAL },
        { label: "Socios", value: socios.length },
        { label: "Titulares de juntadas", value: titularesJuntadas.length, note: "70% de asistencia o más" },
        { label: "Copas", value: (D.torneos || []).length }
      ]) + "</div>";

    var banner = t
      ? '<a class="champ-banner" href="futbol.html#campeones">' +
          '<div class="champ-banner-copa">' + copa() + "</div>" +
          '<div class="champ-banner-text"><p class="label">Campeones ' + t.anio + '</p><p class="champ-banner-title">' + esc(t.nombre) +
          '</p><p class="champ-banner-desc">' + esc(t.detalle) + '</p><span class="more ulink">Ver la copa →</span></div>' +
          (t.fotos && t.fotos[0] ? '<img class="champ-banner-img" src="' + esc(t.fotos[0].src) + '" alt="' + esc(t.fotos[0].alt) + '" loading="lazy">' : "") +
        "</a>"
      : "";

    var secciones = [
      { href: "asistencia.html", title: "Asistencia", desc: "Padrón de socios, juntadas y carnets" },
      { href: "futbol.html", title: "Fútbol", desc: "Partido de la semana, notas, estadísticas y plantel" },
      { href: "awards.html", title: "Chancha Awards", desc: "Categorías del año y Clip del año" }
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
      section(++n, "Cuadro de honor de juntadas", honor() + '<a class="more ulink" href="asistencia.html">Ver padrón completo →</a>', asideLabel("Asistencia " + D.club.temporada)) +
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
    if (!isAdmin()) {
      return '<p class="admin-entry"><button type="button" class="link-btn link-btn--muted" data-action="admin">' + LOCK + " Entrar como admin</button></p>";
    }
    return (
      '<div class="admin-bar reveal">' +
        '<div class="admin-bar-head"><p class="label">' + LOCK + ' Modo admin</p><button type="button" class="link-btn link-btn--muted" data-action="salir">Salir</button></div>' +
        '<div class="admin-actions">' +
          '<button type="button" class="btn" data-action="juntada">Registrar juntada</button>' +
          '<button type="button" class="btn btn--ghost" data-action="socio">Agregar socio</button>' +
          '<button type="button" class="btn btn--ghost" data-action="descargar">Descargar asistencia.js</button>' +
        "</div>" +
        (cambiosSinPublicar
          ? '<p class="notice"><strong>Tenés cambios sin publicar.</strong> Por ahora solo se ven en este navegador. Descargá <code>asistencia.js</code> y reemplazá el archivo <code>js/asistencia.js</code> del sitio para que lo vea todo el grupo.</p>'
          : '<p class="form-note">Todo publicado. Lo que cargues se guarda primero en este navegador.</p>') +
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

  function matchCard(m) {
    var ok = jugado(m);
    var goleadores = m.titulares.filter(function (t) { return t.goles; }).map(function (t) { return esc(t.j) + (t.goles > 1 ? " (" + t.goles + ")" : ""); });
    var best = figuraDe(m);
    var lista = m.titulares.slice().sort(function (a, b) { return ORDEN.indexOf(b.pos) - ORDEN.indexOf(a.pos); }).map(function (t) {
      var d = dorsalOf(t.j);
      return '<li><span class="ml-dorsal">' + (d != null ? d : "–") + '</span><span class="ml-name">' + esc(t.j) + '</span><span class="ml-pos">' + esc(t.pos || "") + "</span>" +
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
          (m.suplentes && m.suplentes.length ? "<div><dt>Suplentes</dt><dd>" + m.suplentes.map(esc).join(", ") + "</dd></div>" : "") +
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
          '<button type="button" class="link-btn" data-action="dorsal" data-nombre="' + esc(j.nombre) + '">' + (j.dorsal == null ? "Elegir número" : "Cambiar") + "</button>" +
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
                (m.local ? '<button type="button" class="link-btn link-btn--muted" data-action="quitar-partido" data-id="' + esc(m.id) + '">Quitar</button>' : "") +
              "</td>" +
            "</tr>"
          );
        }).join("") + "</tbody></table></div>"
      : '<div class="empty"><p class="empty-title">Todavía no hay partidos cargados</p></div>';

    return (
      pageHero("Temporada " + D.club.temporada, "Fútbol", "El partido de la semana, las notas que se ponen entre ustedes, las estadísticas, el plantel y la copa.") +
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
        addBtn("dorsal", "Agregar dorsal"), "plantel") +
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

  /* ----- Clips: almacenamiento -----
     Con js/config.js completo → Supabase (compartido con todo el grupo).
     Sin config → modo de prueba en este navegador. */
  var CFG = window.CHANCHA_SUPABASE || {};
  var ONLINE = !!(CFG.url && CFG.anonKey && window.supabase && window.supabase.createClient);
  var sb = ONLINE ? window.supabase.createClient(CFG.url, CFG.anonKey) : null;
  var MAX_VIDEO_MB = 50;
  var clipsState = { loading: true, list: [], error: null };

  function ensureSession() {
    return sb.auth.getSession().then(function (r) {
      if (r.data && r.data.session) return r.data.session.user;
      return sb.auth.signInAnonymously().then(function (r2) {
        if (r2.error) throw r2.error;
        return r2.data.user;
      });
    });
  }
  function check(r) { if (r && r.error) throw r.error; return r; }

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
          up: v > 0 ? 1 : 0, down: v < 0 ? 1 : 0, score: v, miVoto: v, esMio: !c.fijo
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
    var puedeVotar = !ONLINE || !c.esMio;
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
            (c.esMio ? '<p class="clip-local"><span class="badge badge--local">' + (ONLINE ? "Tu clip" : "Este dispositivo") + '</span><button type="button" class="link-btn link-btn--muted" data-action="quitar-clip" data-id="' + esc(c.id) + '">Quitar</button></p>' : "") +
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
    (D.premios || []).forEach(function (p) { cats.push({ title: esc(p.titulo), winner: esc(p.ganador), detail: esc(p.detalle || "") }); });
    storeGet(K.premios, []).forEach(function (p, i) { cats.push({ title: esc(p.titulo), winner: esc(p.ganador), detail: esc(p.detalle || ""), local: i }); });

    var cards = '<div class="premios">' + cats.map(function (c) {
      var isLocal = c.local != null;
      return (
        '<article class="premio' + (c.nueva ? " is-nueva" : "") + '">' +
          '<p class="label">' + (c.nueva ? "Nueva categoría" : "Categoría") + (c.ejemplo ? " " + EJ : "") + (isLocal ? " " + LOCAL : "") + "</p>" +
          '<h3 class="premio-title">' + c.title + "</h3>" +
          '<p class="premio-winner">' + c.winner + "</p>" +
          (c.detail ? '<p class="premio-detail">' + c.detail + "</p>" : "") +
          (c.href ? '<a class="more ulink" href="' + c.href + '">Ver y votar →</a>' : "") +
          (isLocal ? '<button type="button" class="link-btn link-btn--muted premio-quitar" data-action="quitar-premio" data-i="' + c.local + '">Quitar</button>' : "") +
        "</article>"
      );
    }).join("") + "</div>";

    var yo = storeGet("chancha.yo", "");
    var form =
      '<form id="clip-form" class="clip-form" novalidate>' +
        '<p class="label">Subir un clip</p>' +
        '<div class="field"><label for="f-titulo">Título</label><input id="f-titulo" name="titulo" maxlength="80" placeholder="Ej.: El caño de Paty" required></div>' +
        '<div class="field"><label for="f-autor">Quién lo sube</label><select id="f-autor" name="autor" required>' +
          options([{ v: "", l: "Elegí tu nombre" }].concat(NOMBRES), yo) + "</select></div>" +
        '<div class="field field--wide"><label for="f-url">Link del clip</label><input id="f-url" name="url" type="url" inputmode="url" placeholder="https://youtu.be/… · Instagram · TikTok · Drive"></div>' +
        '<div class="field field--wide"><label for="f-video">o subí el video <small>(MP4, MOV o WebM, hasta ' + MAX_VIDEO_MB + " MB)</small></label>" +
          '<input id="f-video" name="video" type="file" accept="video/mp4,video/quicktime,video/webm"' + (ONLINE ? "" : " disabled") + "></div>" +
        '<div class="form-actions"><button type="submit" class="btn">Subir clip</button><p id="clip-msg" class="form-msg" role="status"></p></div>' +
        (ONLINE
          ? '<p class="form-note">Los clips y los votos se comparten con todo el grupo. Un voto por clip en cada celular, y no podés votar tus propios clips.</p>'
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
      section(1, "Categorías " + D.club.temporada, cards, addBtn("premio", "Agregar premio"), "categorias") +
      section(2, "Clip del año", form + '<div id="clips-grid" class="clips clips--vote"></div>', '<span class="label" id="clips-count"></span>', "clip") +
      section(3, "Ediciones anteriores", historial, asideLabel("Historial")) +
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
    var filas = F.plantel.map(function (j, i) {
      return (
        '<tr><td class="pf-name">' + esc(j.nombre) + "</td>" +
        '<td><select name="estado-' + i + '" aria-label="' + esc(j.nombre) + ': participación">' + options([{ v: "", l: "No juega" }, { v: "T", l: "Titular" }, { v: "S", l: "Suplente" }], "") + "</select></td>" +
        '<td><select name="pos-' + i + '" aria-label="' + esc(j.nombre) + ': posición">' + options(POS, j.pos || "MED") + "</select></td>" +
        '<td><input name="goles-' + i + '" type="number" min="0" max="30" inputmode="numeric" placeholder="0" aria-label="' + esc(j.nombre) + ': goles"></td></tr>'
      );
    }).join("");
    var body =
      '<div class="dlg-grid">' +
        '<div class="field"><label for="p-fecha">Fecha</label><input id="p-fecha" name="fecha" type="date" value="' + hoy() + '" required></div>' +
        '<div class="field"><label for="p-rival">Rival</label><input id="p-rival" name="rival" maxlength="40" required></div>' +
        '<div class="field"><label for="p-torneo">Torneo</label><input id="p-torneo" name="torneo" maxlength="40" value="Amistoso"></div>' +
        '<div class="field field--score"><label>Resultado <small>(vacío si no se jugó)</small></label><div class="score-inputs">' +
          '<input name="gf" type="number" min="0" inputmode="numeric" aria-label="Goles de La Chancha" placeholder="Chancha">' +
          '<span>–</span><input name="gc" type="number" min="0" inputmode="numeric" aria-label="Goles del rival" placeholder="Rival"></div></div>' +
      "</div>" +
      '<p class="label dlg-sub">Quiénes jugaron</p>' +
      '<div class="table-wrap"><table class="pf-table"><thead><tr><th>Jugador</th><th>Juega</th><th>Pos.</th><th>Goles</th></tr></thead><tbody>' + filas + "</tbody></table></div>";

    openDialog("Agregar partido", body, "Guardar partido", function (f) {
      var rival = f.rival.value.trim(), fch = f.fecha.value;
      if (!fch) return "Poné la fecha.";
      if (!rival) return "Poné el rival.";
      var gf = numOrNull(f.gf.value), gc = numOrNull(f.gc.value);
      if ((gf === null) !== (gc === null)) return "Completá los dos goles o dejá los dos vacíos.";
      if ((gf !== null && (isNaN(gf) || gf < 0 || gf % 1)) || (gc !== null && (isNaN(gc) || gc < 0 || gc % 1))) return "Los goles tienen que ser números enteros.";
      var tit = [], sup = [], sumGoles = 0;
      F.plantel.forEach(function (j, i) {
        var est = f["estado-" + i].value;
        var g = numOrNull(f["goles-" + i].value) || 0;
        if (est === "T") { tit.push({ j: j.nombre, pos: f["pos-" + i].value, goles: g || undefined }); sumGoles += g; }
        else if (est === "S") sup.push(j.nombre);
      });
      if (!tit.length) return "Marcá al menos un titular.";
      if (tit.length > 11) return "Hay más de 11 titulares.";
      if (gf === null && sumGoles) return "Si el partido no se jugó, no puede haber goles.";
      if (gf !== null && sumGoles > gf) return "Los goles de los jugadores (" + sumGoles + ") superan el resultado (" + gf + ").";
      var list = storeGet(K.partidos, []);
      var id = "l" + Date.now();
      list.push({ id: id, fecha: fch, rival: rival, torneo: f.torneo.value.trim() || "Amistoso", gf: gf, gc: gc, titulares: tit, suplentes: sup });
      if (!storeSet(K.partidos, list)) return "No se pudo guardar en este navegador.";
      verId = id;
    });
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
      '<div class="field"><label for="n-votante">¿Quién sos?</label><select id="n-votante" name="votante" required>' +
        options([{ v: "", l: "Elegí tu nombre" }].concat(NOMBRES), "") + "</select></div>" +
      '<p class="label dlg-sub">Notas del 1 al 10</p>' +
      '<div class="nota-rows">' + filas + "</div>" +
      '<p class="form-note">No podés ponerte nota a vos mismo. Si ya votaste, tu voto se reemplaza.</p>';

    var form = openDialog("Agregar nota", body, "Guardar notas", function (f) {
      var votante = f.votante.value;
      if (!votante) return "Elegí tu nombre.";
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
      var all = storeGet(K.votos, {});
      var arr = (all[m.id] || []).filter(function (v) { return v.votante !== votante; });
      arr.push({ votante: votante, notas: notas });
      all[m.id] = arr;
      if (!storeSet(K.votos, all)) return "No se pudo guardar en este navegador.";
      verId = m.id;
    });

    var sel = form.votante;
    function sync() {
      var who = sel.value;
      var prev = m.votos.filter(function (v) { return v.votante === who; })[0];
      form.querySelectorAll(".nota-row").forEach(function (row, i) {
        var self = row.getAttribute("data-j") === who;
        var inp = row.querySelector("input");
        row.classList.toggle("is-self", self);
        inp.disabled = self;
        inp.value = !self && prev && prev.notas[m.titulares[i].j] != null ? prev.notas[m.titulares[i].j] : "";
      });
    }
    sel.addEventListener("change", sync);
    sync();
  }

  function dialogDorsal(nombre) {
    var body =
      '<div class="dlg-grid dlg-grid--dorsal">' +
        '<div class="dorsal-preview" id="dorsal-preview"></div>' +
        "<div>" +
          '<div class="field"><label for="d-jug">Jugador</label><select id="d-jug" name="jugador">' +
            options(F.plantel.map(function (j) { return { v: j.nombre, l: j.nombre + (j.dorsal != null ? " · " + j.dorsal : "") }; }), nombre || F.plantel[0].nombre) + "</select></div>" +
          '<div class="field"><label for="d-num">Número</label><input id="d-num" name="dorsal" type="number" min="1" max="99" inputmode="numeric" required></div>' +
          '<div class="field"><label for="d-pos">Posición</label><select id="d-pos" name="pos">' + options([{ v: "", l: "A definir" }].concat(POS.map(function (p) { return { v: p, l: POS_LABEL[p] }; })), "") + "</select></div>" +
          '<p class="form-note" id="d-ocupados"></p>' +
        "</div>" +
      "</div>";

    var form = openDialog("Agregar dorsal", body, "Guardar dorsal", function (f) {
      var who = f.jugador.value;
      var num = numOrNull(f.dorsal.value);
      if (num === null || isNaN(num) || num % 1 || num < 1 || num > 99) return "El número tiene que ser entero, del 1 al 99.";
      var duenio = F.plantel.filter(function (j) { return j.dorsal === num && j.nombre !== who; })[0];
      if (duenio) return "El " + num + " ya lo tiene " + duenio.nombre + ". Elegí otro.";
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
      '<div class="field"><label for="pr-ganador">Ganador</label><input id="pr-ganador" name="ganador" maxlength="40" list="dl-socios-dlg" required></div>' +
      '<div class="field"><label for="pr-detalle">Detalle <small>(opcional)</small></label><input id="pr-detalle" name="detalle" maxlength="120" placeholder="Por qué se lo ganó"></div>' +
      '<datalist id="dl-socios-dlg">' + options(NOMBRES) + "</datalist>";
    openDialog("Agregar premio", body, "Guardar premio", function (f) {
      var t = f.titulo.value.trim(), g = f.ganador.value.trim();
      if (!t) return "Poné el nombre de la categoría.";
      if (!g) return "Poné quién lo ganó.";
      var list = storeGet(K.premios, []);
      list.push({ titulo: t, ganador: g, detalle: f.detalle.value.trim() });
      if (!storeSet(K.premios, list)) return "No se pudo guardar en este navegador.";
    });
  }

  /* ----- admin de asistencia ----- */
  function dialogAdmin() {
    var crear = !A.adminPinHash;
    var body = crear
      ? '<p class="dlg-context">Creá tu PIN de admin</p>' +
        '<p class="form-note">Con este PIN solo vos vas a poder registrar juntadas. Queda guardado (cifrado) en <code>asistencia.js</code> cuando lo descargues.</p>' +
        '<div class="field"><label for="a-pin">PIN nuevo</label><input id="a-pin" name="pin" type="password" inputmode="numeric" autocomplete="new-password" minlength="4" required></div>' +
        '<div class="field"><label for="a-pin2">Repetí el PIN</label><input id="a-pin2" name="pin2" type="password" inputmode="numeric" autocomplete="new-password" required></div>'
      : '<div class="field"><label for="a-pin">PIN de admin</label><input id="a-pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required></div>';
    openDialog(crear ? "Activar modo admin" : "Entrar como admin", body, crear ? "Crear PIN y entrar" : "Entrar", function (f) {
      var pin = f.pin.value.trim();
      if (pin.length < 4) return "El PIN tiene que tener al menos 4 caracteres.";
      if (crear && pin !== f.pin2.value.trim()) return "Los PIN no coinciden.";
      return sha256(pin).then(function (h) {
        if (crear) {
          var obj = cloneA();
          obj.adminPinHash = h;
          if (!saveA(obj)) return "No se pudo guardar en este navegador.";
        } else if (h !== A.adminPinHash) {
          return "PIN incorrecto.";
        }
        setAdmin(true);
      }, function () { return "Este navegador no permite verificar el PIN (abrí la página por https o localhost)."; });
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
      var obj = cloneA();
      obj.juntadas = obj.juntadas || [];
      obj.juntadas.push({ id: "j" + Date.now(), fecha: f.fecha.value, nombre: f.nombre.value.trim(), presentes: presentes });
      if (!saveA(obj)) return "No se pudo guardar en este navegador.";
    }, "Después descargá <code>asistencia.js</code> para publicarlo.");
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
      var obj = cloneA();
      obj.socios.push(n);
      if (!saveA(obj)) return "No se pudo guardar en este navegador.";
    }, "Después descargá <code>asistencia.js</code> para publicarlo.");
  }

  function quitar(key, i) {
    var list = storeGet(key, []);
    list.splice(i, 1);
    storeSet(key, list);
    render();
  }

  /* ================= eventos ================= */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-action]");
    if (!b) return;
    var a = b.getAttribute("data-action"), id = b.getAttribute("data-id");
    if (a === "partido") dialogPartido();
    else if (a === "nota") dialogNota(id);
    else if (a === "dorsal") dialogDorsal(b.getAttribute("data-nombre"));
    else if (a === "premio") dialogPremio();
    else if (a === "admin") dialogAdmin();
    else if (a === "salir") { setAdmin(false); render(); }
    else if (a === "juntada" && isAdmin()) dialogJuntada();
    else if (a === "socio" && isAdmin()) dialogSocio();
    else if (a === "descargar" && isAdmin()) descargarAsistencia();
    else if (a === "quitar-juntada" && isAdmin()) {
      if (!confirm("¿Quitar esta juntada?")) return;
      var objA = cloneA();
      objA.juntadas = (objA.juntadas || []).filter(function (j) { return j.id !== id; });
      saveA(objA);
      render();
    }
    else if (a === "ver") {
      verId = id; render();
      document.getElementById("partido").scrollIntoView({ behavior: "smooth", block: "start" });
    } else if (a === "quitar-partido") {
      if (!confirm("¿Quitar este partido de este dispositivo?")) return;
      storeSet(K.partidos, storeGet(K.partidos, []).filter(function (p) { return p.id !== id; }));
      var votos = storeGet(K.votos, {}); delete votos[id]; storeSet(K.votos, votos);
      if (verId === id) verId = null;
      render();
    } else if (a === "quitar-premio") quitar(K.premios, +b.getAttribute("data-i"));
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
    var titulo = form.titulo.value.trim(), autor = form.autor.value, url = form.url.value.trim();
    var file = form.video && form.video.files && form.video.files[0];
    if (!titulo) return fail("Poné un título.");
    if (!autor) return fail("Elegí tu nombre.");
    if (url) {
      var ok = false;
      try { var u = new URL(url); ok = u.protocol === "https:" || u.protocol === "http:"; } catch (err) {}
      if (!ok) return fail("El link tiene que empezar con https://");
    }
    if (!url && !file) return fail("Pegá un link o elegí un video.");
    if (file && file.size > MAX_VIDEO_MB * 1024 * 1024) return fail("El video pesa más de " + MAX_VIDEO_MB + " MB. Subilo a YouTube o Drive y pegá el link.");
    storeSet("chancha.yo", autor);
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

  document.getElementById("header").outerHTML = header();
  main = document.getElementById("main");
  render(true);
  document.getElementById("footer").outerHTML = footer();

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
