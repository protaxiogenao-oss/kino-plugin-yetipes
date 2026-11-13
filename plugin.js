/// <reference path="./kino.d.ts" />
/**
 * YetiPelis plugin for Kino — v1.0.1
 * Hecho por Hotaru Yume. Películas y series en latino / castellano / sub (yetipelis.com)
 * Resolve: player-pass → embed PM_UI → /servers → HLS directo en api-encrypted.moviemaster.lat
 * v1.0.1: posters matched to title (.yc cards); Home uses real 16:9 og:image; no more 404 -1280
 */

const BASE = "https://yetipelis.com";
const API = "https://api-encrypted.moviemaster.lat";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const LANG_ORDER = { LAT: 0, ESP: 1, SUB: 2, ENG: 3 };
const LANG_LABEL = { LAT: "Latino", ESP: "Castellano", SUB: "Subtitulado", ENG: "English" };

function hdr(extra) {
  var h = {
    "User-Agent": UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "es-ES,es;q=0.9,en;q=0.5",
    Referer: BASE + "/",
  };
  if (extra) for (var k in extra) h[k] = extra[k];
  return h;
}

function cfg(key, def) {
  try {
    var v = kino.config && kino.config[key];
    return v == null || v === "" ? def : v;
  } catch (e) {
    return def;
  }
}

function strip(s) {
  return String(s || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function abs(u) {
  if (!u) return "";
  if (u.indexOf("//") === 0) return "https:" + u;
  if (u.indexOf("http") === 0) return u;
  if (u.charAt(0) === "/") return BASE + u;
  return BASE + "/" + u;
}

function makeId(s) {
  return String(s || "x")
    .replace(/[^A-Za-z0-9._~-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
}

/**
 * Prefer a working, higher-res variant of a content/uploads URL without inventing
 * sizes that 404. Portrait hashes only have 185/342/500(/780); backdrop hashes
 * only have 480/960/1280. Never convert a portrait hash into -1280.
 */
function preferImageSize(url, wantLandscape) {
  if (!url) return "";
  var u = String(url).split("?")[0];
  // already a known landscape size
  if (/-(480|960|1280)\.(jpg|jpeg|png|webp)$/i.test(u)) {
    return u.replace(/-(480|960)\.(jpg|jpeg|png|webp)$/i, "-1280.$2");
  }
  if (wantLandscape) {
    // cannot safely invent landscape from a portrait hash — leave as-is
    return u.replace(/-(185|342)\.(jpg|jpeg|png|webp)$/i, "-500.$2");
  }
  // portrait: prefer 500 then 342 (both exist for list posters)
  if (/-\d+\.(jpg|jpeg|png|webp)$/i.test(u)) {
    return u.replace(/-\d+\.(jpg|jpeg|png|webp)$/i, "-500.$1");
  }
  return u;
}

function isLandscapeUrl(url) {
  return /-(480|960|1280)\.(jpg|jpeg|png|webp)$/i.test(String(url || ""));
}

/** Extract og:image (almost always 16:9 1280) from a title page. */
async function fetchOgImage(path) {
  try {
    var html = await getText(BASE + path, 7000);
    var m = html.match(
      /property=["']og:image["']\s+content=["']([^"']+)["']/i
    );
    if (!m) {
      m = html.match(
        /content=["']([^"']+)["']\s+property=["']og:image["']/i
      );
    }
    if (m && m[1] && /content\/uploads\//i.test(m[1])) {
      return abs(m[1]);
    }
  } catch (e) {}
  return "";
}

async function getText(url, timeoutMs) {
  var r = await kino.fetch(url, {
    headers: hdr(),
    timeoutMs: timeoutMs || 12000,
  });
  if (!r.ok) {
    throw kino.error("unavailable", "http " + r.status, {
      userMessage: "No se pudo cargar la página (" + r.status + ").",
    });
  }
  return await r.text();
}

async function getJson(url, referer, timeoutMs) {
  var r = await kino.fetch(url, {
    headers: hdr({
      Accept: "application/json",
      Referer: referer || BASE + "/",
    }),
    timeoutMs: timeoutMs || 12000,
  });
  if (!r.ok) {
    throw kino.error("unavailable", "http " + r.status, {
      userMessage: "No se pudo cargar datos (" + r.status + ").",
    });
  }
  var t = await r.text();
  try {
    return JSON.parse(t);
  } catch (e) {
    throw kino.error("unavailable", "bad_json", {
      userMessage: "Respuesta inválida del servidor.",
    });
  }
}

function kindFromPath(path) {
  if (/^\/movie\//i.test(path)) return "movie";
  if (/^\/series\//i.test(path)) return "series";
  return "series";
}

function pathFromUrl(u) {
  try {
    var m = String(u).match(/yetipelis\.com(\/[^?#]*)/i);
    if (m) return m[1].replace(/\/$/, "") || "/";
    if (u.charAt(0) === "/") return u.split("?")[0].replace(/\/$/, "");
  } catch (e) {}
  return u;
}

function itemFromSuggest(t) {
  if (!t || !t.url) return null;
  var path = pathFromUrl(t.url);
  if (!/^\/(movie|series)\//i.test(path)) return null;
  // skip season/episode deep links in search
  if (/\/season\/|\/episode\//i.test(path)) {
    path = path.replace(/\/season\/.*$/i, "");
  }
  var kind = kindFromPath(path);
  var title = strip(t.title || "");
  if (!title) return null;
  var poster = preferImageSize(abs(t.poster || ""), false);
  return {
    id: makeId(kind + "-" + path.replace(/^\//, "").replace(/\//g, "-")),
    ref: path,
    title: title,
    kind: kind,
    year: t.year ? String(t.year) : undefined,
    poster: poster || undefined,
    rating: typeof t.rating === "number" ? t.rating : undefined,
  };
}

/**
 * Parse YetiPelis cards. Primary structure:
 *   <a class="yc" href="/movie/..."> ... <img src="...-342.jpg"> ... <span class="yc-t">Title</span>
 * Image is always inside the same <a>, so title and poster stay matched.
 */
function parseListingItems(html, max) {
  max = max || 48;
  var items = [];
  var seen = {};
  var re =
    /<a\s+class="yc"\s+href="(\/(?:movie|series)\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(html)) !== null && items.length < max) {
    var path = pathFromUrl(m[1]);
    if (/\/season\/|\/episode\//i.test(path)) continue;
    if (seen[path]) continue;
    seen[path] = true;
    var body = m[2];
    var kind = kindFromPath(path);
    var imgM = body.match(
      /<img[^>]+src="(https?:\/\/[^"]+content\/uploads\/[^"]+\.(?:jpg|jpeg|png|webp))"/i
    );
    if (!imgM) {
      imgM = body.match(
        /srcset="(https?:\/\/[^"\s]+content\/uploads\/[^"\s]+\.(?:jpg|jpeg|png|webp))/i
      );
    }
    var poster = imgM ? preferImageSize(abs(imgM[1]), false) : "";
    var title = "";
    var tM = body.match(/class="yc-t"[^>]*>([\s\S]*?)<\//i);
    if (tM) title = strip(tM[1]);
    if (!title) {
      var altM = body.match(/alt="([^"]+)"/i);
      if (altM) title = strip(altM[1]);
    }
    if (!title) {
      var slug = path.split("/").pop() || "";
      title = slug.replace(/-\d{4}$/, "").replace(/-/g, " ");
      title = title.charAt(0).toUpperCase() + title.slice(1);
    }
    var year;
    var yM = body.match(/\b(19|20)\d{2}\b/);
    if (yM) year = yM[0];
    if (!year) year = parseYearFromPath(path);
    var rating;
    var rM = body.match(/class="yc-r"[^>]*>([\d.]+)/i);
    if (rM) rating = parseFloat(rM[1]);
    items.push({
      id: makeId(kind + "-" + path.replace(/^\//, "").replace(/\//g, "-")),
      ref: path,
      title: title,
      kind: kind,
      year: year || undefined,
      poster: poster || undefined,
      rating: rating,
    });
  }
  // fallback: any tight <a href="/movie|series/..."> with an img inside
  if (items.length < 6) {
    var re2 =
      /<a[^>]+href="(\/(?:movie|series)\/[^"#?]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = re2.exec(html)) !== null && items.length < max) {
      var p = pathFromUrl(m[1]);
      if (/\/season\/|\/episode\//i.test(p)) continue;
      if (seen[p]) continue;
      var body2 = m[2];
      if (body2.length > 2500) continue;
      var img2 = body2.match(
        /src="(https?:\/\/[^"]+content\/uploads\/[^"]+\.(?:jpg|jpeg|png|webp))"/i
      );
      if (!img2) continue;
      seen[p] = true;
      var k = kindFromPath(p);
      var title2 = "";
      var t2 = body2.match(/class="yc-t"[^>]*>([\s\S]*?)<\//i);
      if (t2) title2 = strip(t2[1]);
      if (!title2) {
        var slug2 = p.split("/").pop() || "";
        title2 = slug2.replace(/-\d{4}$/, "").replace(/-/g, " ");
        title2 = title2.charAt(0).toUpperCase() + title2.slice(1);
      }
      items.push({
        id: makeId(k + "-" + p.replace(/^\//, "").replace(/\//g, "-")),
        ref: p,
        title: title2,
        kind: k,
        year: parseYearFromPath(p),
        poster: preferImageSize(abs(img2[1]), false) || undefined,
      });
    }
  }
  return items;
}

/**
 * Apply real 16:9 og:image as poster+backdrop for Home cards.
 * Only fetches unique refs, short timeout, capped to keep Home responsive.
 */
async function applyLandscapePosters(items, limit) {
  limit = limit || 24;
  if (!items || !items.length) return items;
  var cache = {};
  var n = 0;
  for (var i = 0; i < items.length && n < limit; i++) {
    var it = items[i];
    if (!it || !it.ref) continue;
    if (it.poster && isLandscapeUrl(it.poster)) continue;
    if (cache[it.ref] === undefined) {
      cache[it.ref] = await fetchOgImage(it.ref);
      n++;
    }
    var land = cache[it.ref];
    if (land) {
      it.poster = land;
      it.backdrop = land;
    }
  }
  return items;
}

function parseYearFromPath(path) {
  var m = String(path).match(/-(\d{4})(?:\/|$)/);
  return m ? m[1] : undefined;
}

function enrichItem(it) {
  if (it && !it.year) {
    var y = parseYearFromPath(it.ref);
    if (y) it.year = y;
  }
  return it;
}

/** Search: suggest API first (fast), HTML search as fallback. Max results. */
export async function search(query) {
  var q = (query && query.q) || "";
  q = String(q).trim();
  if (!q) return [];

  var items = [];
  var seen = {};

  try {
    var data = await getJson(
      BASE + "/api/suggest?q=" + encodeURIComponent(q),
      BASE + "/search?q=" + encodeURIComponent(q),
      10000
    );
    var titles = (data && data.titles) || [];
    for (var i = 0; i < titles.length && items.length < 48; i++) {
      var it = itemFromSuggest(titles[i]);
      if (!it || seen[it.ref]) continue;
      seen[it.ref] = true;
      items.push(enrichItem(it));
    }
  } catch (e) {
    // fall through
  }

  if (items.length < 12) {
    try {
      var html = await getText(
        BASE + "/search?q=" + encodeURIComponent(q),
        12000
      );
      var more = parseListingItems(html, 48);
      for (var j = 0; j < more.length && items.length < 48; j++) {
        if (seen[more[j].ref]) continue;
        seen[more[j].ref] = true;
        items.push(enrichItem(more[j]));
      }
    } catch (e2) {}
  }

  // prefer requested type first
  var want = query && query.type;
  if (want === "movie" || want === "series") {
    items.sort(function (a, b) {
      var as = a.kind === want ? 0 : 1;
      var bs = b.kind === want ? 0 : 1;
      return as - bs;
    });
  }

  return items.slice(0, 48);
}

async function rowFromPath(id, title, path, genre, max) {
  max = max || 48;
  var html = await getText(BASE + path, 12000);
  var items = parseListingItems(html, max).map(enrichItem);
  if (!items.length) return null;
  return {
    id: id,
    title: title,
    items: items,
    ref: "list:" + path,
    genre: genre,
  };
}

/**
 * Home: rows with correct poster↔title pairing and 16:9 miniatures.
 * og:image from each title page is 1280×720 (16:9) and becomes poster+backdrop.
 */
export async function home() {
  var rows = [];
  var ogCache = {};
  var ogBudget = 28; // max detail fetches for landscape posters

  async function landscapeRow(row, perRow) {
    if (!row || !row.items) return row;
    var limit = perRow || 12;
    var n = 0;
    for (var i = 0; i < row.items.length && n < limit && ogBudget > 0; i++) {
      var it = row.items[i];
      if (!it || !it.ref) continue;
      if (it.poster && isLandscapeUrl(it.poster)) continue;
      if (ogCache[it.ref] === undefined) {
        ogCache[it.ref] = await fetchOgImage(it.ref);
        ogBudget--;
        n++;
      }
      var land = ogCache[it.ref];
      if (land) {
        it.poster = land;
        it.backdrop = land;
      }
    }
    return row;
  }

  // Top from homepage .yc cards (image matched to title)
  try {
    var homeHtml = await getText(BASE + "/", 12000);
    var top = parseListingItems(homeHtml, 24).map(enrichItem);
    if (top.length) {
      var topRow = {
        id: "top",
        title: "Top y tendencia",
        items: top.slice(0, 24),
        ref: "list:/movies?sort=trending",
        genre: "peliculas",
      };
      rows.push(await landscapeRow(topRow, 16));
    }
  } catch (e) {}

  var sections = [
    {
      id: "movies-new",
      title: "Películas nuevas",
      path: "/movies",
      genre: "peliculas",
    },
    {
      id: "series-new",
      title: "Series nuevas",
      path: "/series",
      genre: "series",
    },
    {
      id: "trending",
      title: "Tendencia esta semana",
      path: "/movies?sort=trending",
      genre: "peliculas",
    },
    {
      id: "drama",
      title: "Drama",
      path: "/genre/drama",
      genre: "series",
    },
    {
      id: "comedia",
      title: "Comedia",
      path: "/genre/comedia",
      genre: "peliculas",
    },
    {
      id: "accion",
      title: "Acción",
      path: "/genre/accion",
      genre: "peliculas",
    },
    {
      id: "terror",
      title: "Terror",
      path: "/genre/terror",
      genre: "peliculas",
    },
    {
      id: "animacion",
      title: "Animación",
      path: "/genre/animacion",
      genre: "peliculas",
    },
  ];

  for (var i = 0; i < sections.length; i++) {
    var s = sections[i];
    try {
      var row = await rowFromPath(s.id, s.title, s.path, s.genre, 48);
      if (row && row.items && row.items.length) {
        // 16:9 for the first cards of each row (shared og cache)
        rows.push(await landscapeRow(row, 8));
      }
    } catch (e) {}
  }

  return rows;
}

export async function browse(ref, cursor) {
  var path = String(ref || "");
  if (path.indexOf("list:") === 0) path = path.slice(5);
  if (path.charAt(0) !== "/") path = "/" + path;

  var page = 1;
  if (cursor) {
    var n = parseInt(String(cursor), 10);
    if (n > 1) page = n;
  }

  var url = BASE + path;
  if (page > 1) {
    if (url.indexOf("?") >= 0) url += "&page=" + page;
    else url += (path.indexOf("/page/") >= 0 ? "" : "/page/" + page);
    // site uses /page/N or ?page=
    if (path.indexOf("?") < 0 && path.indexOf("/page/") < 0) {
      url = BASE + path.replace(/\/$/, "") + "/page/" + page;
    }
  }

  var html = await getText(url, 12000);
  var items = parseListingItems(html, 48).map(enrichItem);

  var next = null;
  if (items.length >= 20) {
    next = String(page + 1);
  }
  // also detect explicit next link
  if (/rel="next"|\/page\/\d+|page=\d+/i.test(html) && items.length >= 12) {
    next = String(page + 1);
  }

  return { items: items, next: next };
}

function extractPlayerToken(html) {
  // movie:ID:TOKEN or tv:ID:TOKEN
  var m = html.match(/player-pass\?t=((?:movie|tv):\d+:[A-Za-z0-9_-]+)/);
  if (m) return m[1];
  m = html.match(/((?:movie|tv):\d+:[A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function extractTmdbAndKind(html, path) {
  var token = extractPlayerToken(html);
  if (token) {
    var p = token.split(":");
    return { kind: p[0], tmdb: p[1], token: token };
  }
  var m = html.match(/\/embed\/(movie|tv)\/(\d+)/);
  if (m) return { kind: m[1], tmdb: m[2], token: null };
  return null;
}

/** Episodes: seasons from series page, list from season pages. */
export async function episodes(ref) {
  var path = String(ref || "");
  if (path.charAt(0) !== "/") path = "/" + path;
  // normalize to series root
  path = path.replace(/\/season\/.*$/i, "").replace(/\/$/, "");

  var html = await getText(BASE + path, 15000);
  var seriesTitle = "";
  var tm = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (tm) seriesTitle = strip(tm[1]);

  var seasons = [];
  var seenS = {};
  var reS = /href="(\/series\/[^"]+\/season\/(\d+))"/gi;
  var m;
  while ((m = reS.exec(html)) !== null) {
    var sn = parseInt(m[2], 10);
    if (!sn || seenS[sn]) continue;
    seenS[sn] = true;
    seasons.push({
      id: "s" + sn,
      ref: m[1],
      title: "Temporada " + sn,
      number: sn,
    });
  }
  seasons.sort(function (a, b) {
    return (a.number || 0) - (b.number || 0);
  });
  if (seasons.length) seasons[seasons.length - 1].current = true;

  var allEps = [];
  // Prefer current season episodes listed on main page, then fill
  var reE =
    /href="(\/series\/[^"]+\/season\/(\d+)\/episode\/(\d+))"[^>]*>[\s\S]{0,400}?/gi;
  var seenE = {};
  while ((m = reE.exec(html)) !== null) {
    var sN = parseInt(m[2], 10);
    var eN = parseInt(m[3], 10);
    var key = sN + "x" + eN;
    if (seenE[key]) continue;
    seenE[key] = true;
    allEps.push({
      season: sN,
      number: eN,
      ref: m[1],
      title: "Episodio " + eN,
    });
  }

  // If few episodes, fetch last seasons
  if (allEps.length < 8 && seasons.length) {
    var toFetch = seasons.slice(-3);
    for (var i = 0; i < toFetch.length; i++) {
      try {
        var sHtml = await getText(BASE + toFetch[i].ref, 12000);
        var reE2 =
          /href="(\/series\/[^"]+\/season\/(\d+)\/episode\/(\d+))"/gi;
        var m2;
        while ((m2 = reE2.exec(sHtml)) !== null) {
          var s2 = parseInt(m2[2], 10);
          var e2 = parseInt(m2[3], 10);
          var k2 = s2 + "x" + e2;
          if (seenE[k2]) continue;
          seenE[k2] = true;
          allEps.push({
            season: s2,
            number: e2,
            ref: m2[1],
            title: "Episodio " + e2,
          });
        }
      } catch (e) {}
    }
  }

  allEps.sort(function (a, b) {
    if (a.season !== b.season) return a.season - b.season;
    return a.number - b.number;
  });

  var out = {
    series: {
      title: seriesTitle || undefined,
    },
    episodes: allEps,
  };
  if (seasons.length > 1) out.seasons = seasons;
  return out;
}

function scoreServer(s, preferLang, preferMode) {
  var score = 0;
  var lang = String(s.lang || "SUB").toUpperCase();
  var mode = String(s.mode || "").toLowerCase();

  // language
  if (preferLang && preferLang !== "auto") {
    if (lang === preferLang) score += 1000;
    else if (LANG_ORDER[lang] != null) score += 200 - LANG_ORDER[lang] * 40;
  } else {
    score += 200 - (LANG_ORDER[lang] != null ? LANG_ORDER[lang] : 5) * 40;
  }

  // mode: directo better than proxy; skip weird
  if (preferMode === "directo") {
    if (mode === "directo") score += 500;
    else if (mode === "proxy") score += 50;
  } else if (preferMode === "proxy") {
    if (mode === "proxy") score += 500;
    else if (mode === "directo") score += 200;
  } else {
    if (mode === "directo") score += 400;
    else if (mode === "proxy") score += 100;
  }

  // prefer hls
  if (String(s.type || "").toLowerCase() === "hls") score += 50;

  // avoid "detras" lower priority sources slightly
  if (s.detras) score -= 30;

  // has video url
  if (s.video) score += 20;

  return score;
}

async function resolveStreamFromPage(pagePath, season, episode) {
  var html = await getText(BASE + pagePath, 15000);
  var meta = extractTmdbAndKind(html, pagePath);
  if (!meta || !meta.tmdb) {
    throw kino.error("unavailable", "no_player", {
      userMessage: "No se encontró el reproductor de este título.",
    });
  }

  var passToken = meta.token;
  if (!passToken) {
    // build from kind
    passToken = meta.kind + ":" + meta.tmdb + ":x";
  }

  // 1) player-pass
  var passData;
  try {
    passData = await getJson(
      BASE + "/api/player-pass?t=" + encodeURIComponent(passToken),
      BASE + pagePath,
      10000
    );
  } catch (e) {
    throw kino.error("unavailable", "pass_failed", {
      userMessage: "No se pudo obtener acceso al reproductor.",
    });
  }
  if (!passData || !passData.pass) {
    throw kino.error("unavailable", "pass_empty", {
      userMessage: "El sitio no entregó el pase del reproductor.",
    });
  }

  // 2) embed HTML to get PM_UI
  var embedPath =
    meta.kind === "tv"
      ? "/embed/tv/" +
        meta.tmdb +
        "/" +
        (season || 1) +
        "/" +
        (episode || 1) +
        "?lang=LAT&pass=" +
        encodeURIComponent(passData.pass)
      : "/embed/movie/" +
        meta.tmdb +
        "?lang=LAT&pass=" +
        encodeURIComponent(passData.pass);

  var embedHtml = await getText(API + embedPath, 15000);
  var uiM = embedHtml.match(/PM_UI\s*=\s*"([^"]+)"/);
  if (!uiM) {
    // try without forcing LAT
    embedHtml = await getText(
      API +
        (meta.kind === "tv"
          ? "/embed/tv/" +
            meta.tmdb +
            "/" +
            (season || 1) +
            "/" +
            (episode || 1) +
            "?pass=" +
            encodeURIComponent(passData.pass)
          : "/embed/movie/" +
            meta.tmdb +
            "?pass=" +
            encodeURIComponent(passData.pass)),
      15000
    );
    uiM = embedHtml.match(/PM_UI\s*=\s*"([^"]+)"/);
  }
  if (!uiM) {
    throw kino.error("unavailable", "no_ui", {
      userMessage: "No se pudo inicializar el reproductor.",
    });
  }
  var ui = uiM[1];

  // 3) servers list
  var params =
    "tmdb=" +
    encodeURIComponent(meta.tmdb) +
    "&type=" +
    (meta.kind === "tv" ? "tv" : "movie");
  if (meta.kind === "tv") {
    params +=
      "&season=" +
      encodeURIComponent(String(season || 1)) +
      "&episode=" +
      encodeURIComponent(String(episode || 1));
  }
  params += "&ui=" + encodeURIComponent(ui);

  var serversData = await getJson(
    API + "/servers?" + params,
    API + "/",
    15000
  );
  var servers = (serversData && serversData.servers) || [];
  if (!servers.length) {
    throw kino.error("unavailable", "no_servers", {
      userMessage: "No hay servidores disponibles para este título.",
    });
  }

  var preferLang = String(cfg("preferLang", "LAT")).toUpperCase();
  var preferMode = String(cfg("preferMode", "directo")).toLowerCase();

  var ranked = servers.slice().map(function (s, idx) {
    return { s: s, score: scoreServer(s, preferLang, preferMode), idx: idx };
  });
  ranked.sort(function (a, b) {
    if (b.score !== a.score) return b.score - a.score;
    return a.idx - b.idx;
  });

  var alternatives = [];
  var best = null;

  for (var i = 0; i < ranked.length; i++) {
    var s = ranked[i].s;
    if (!s.video) continue;
    // skip pure ad/empty markers if any
    if (s.mode === "ad" || s.type === "ad") continue;

    var videoUrl = s.video;
    if (videoUrl.indexOf("ui=") < 0) {
      videoUrl +=
        (videoUrl.indexOf("?") >= 0 ? "&" : "?") +
        "ui=" +
        encodeURIComponent(ui);
    }

    var label =
      (LANG_LABEL[String(s.lang || "").toUpperCase()] || s.lang || "Audio") +
      " · " +
      (s.name || "Servidor") +
      (s.mode === "directo" ? " · Directo" : s.mode === "proxy" ? " · Proxy" : "");

    var stream = {
      url: videoUrl,
      mime: "application/x-mpegURL",
      headers: {
        "User-Agent": UA,
        Referer: API + "/",
        Origin: API,
      },
      label: label,
      expiresInSeconds: 600,
    };

    if (!best) best = stream;
    else alternatives.push({ url: stream.url, mime: stream.mime, headers: stream.headers, label: stream.label });
  }

  if (!best) {
    throw kino.error("unavailable", "no_playable", {
      userMessage: "Ningún servidor devolvió un vídeo reproducible.",
    });
  }

  // keep a reasonable number of alternatives
  if (alternatives.length) {
    best.alternatives = alternatives.slice(0, 8);
  }
  return best;
}

export async function resolve(ref) {
  var path = String(ref || "");
  if (path.charAt(0) !== "/") path = "/" + path;

  // episode?
  var em = path.match(/\/series\/[^/]+\/season\/(\d+)\/episode\/(\d+)/i);
  if (em) {
    return await resolveStreamFromPage(path, parseInt(em[1], 10), parseInt(em[2], 10));
  }

  // movie
  if (/^\/movie\//i.test(path)) {
    return await resolveStreamFromPage(path, null, null);
  }

  // series root without episode → error
  if (/^\/series\//i.test(path)) {
    throw kino.error("unavailable", "need_episode", {
      userMessage: "Elige un episodio para reproducir.",
    });
  }

  throw kino.error("unavailable", "bad_ref", {
    userMessage: "Enlace no reconocido.",
  });
}
