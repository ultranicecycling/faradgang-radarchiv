// Faradgang Rad-Archiv: Cloudflare Worker
// - schützt alles hinter einem Passwort (Cookie, signiert mit dem Passwort selbst)
// - API für Räder (D1) und Fotos (R2)
// - liefert die App aus public/ (über env.ASSETS) erst nach dem Login aus

const COOKIE = "ra_session";
const SESSION_DAYS = 90;
// reparatur = im Lager, noch kaputt · lager = fertig, bereit zur Ausgabe · ausgegeben
// "Reserviert" ist kein Status, sondern ein eigenes Feld (reserved), das als Störer auf dem Foto erscheint.
const STATUS = ["reparatur", "lager", "ausgegeben"];
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const MAX_PHOTOS = 4;
// Startliste für "Wer schraubt?" (wird nur beim allerersten Mal angelegt, danach in der App erweiterbar)
const START_NAMES = ["Alex", "Amin L", "Chris (Max)", "Daniel Winter", "Georg B.", "H", "Hami", "Hans", "Johanna", "Kristjan P", "Lars Attacks", "Levin", "Lina", "Malte Kisd", "Marie", "Marieke", "Moritz", "Norman", "Paul", "Paulette", "Resa", "Rupert Turbo"];

// Ohne Login erreichbar: Login-Seite, Schriften, Logo, Icons, Manifest
const PUBLIC_PATHS = [/^\/login$/, /^\/pub\//, /^\/manifest\.webmanifest$/, /^\/robots\.txt$/, /^\/api\/login$/];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    try {
      if (!env.ARCHIV_PASSWORT) {
        return text("Noch nicht eingerichtet: Secret ARCHIV_PASSWORT fehlt (siehe README).", 503);
      }
      if (path === "/api/login" && request.method === "POST") return login(request, env);
      if (path === "/login") return loginPage(env);
      if (path === "/logout") return logout();
      if (PUBLIC_PATHS.some((r) => r.test(path))) return withSecurity(await env.ASSETS.fetch(request));

      const role = await session(request, env);
      if (!role) {
        if (path.startsWith("/api/") || path.startsWith("/foto/")) return json({ error: "Bitte neu anmelden." }, 401);
        return Response.redirect(new URL("/login", url).toString(), 302);
      }

      if (path.startsWith("/api/")) {
        await ensureSchema(env);
        return withSecurity(await api(request, env, url, role));
      }
      if (path.startsWith("/foto/")) return photo(env, decodeURIComponent(path.slice(6)));
      const res = await env.ASSETS.fetch(request);
      return withSecurity(res, true);
    } catch (err) {
      console.error(err);
      return json({ error: "Serverfehler: " + (err && err.message ? err.message : String(err)) }, 500);
    }
  },
};

/* ---------- Antworten ---------- */

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}
function text(t, status = 200) {
  return new Response(t, { status, headers: { "content-type": "text/plain; charset=utf-8" } });
}
function withSecurity(res, privateCache) {
  const r = new Response(res.body, res);
  r.headers.set("x-robots-tag", "noindex, nofollow");
  r.headers.set("x-content-type-options", "nosniff");
  r.headers.set("referrer-policy", "same-origin");
  r.headers.set("x-frame-options", "DENY");
  if (privateCache) r.headers.set("cache-control", "private, no-cache");
  return r;
}

/* ---------- Login ---------- */

const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

async function hmac(secret, data) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(data)));
}
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// Der Schlüssel hängt am Passwort: wird es geändert, sind alle alten Anmeldungen ungültig.
const secretFor = (env, role) =>
  "radarchiv:" + (role === "admin" && env.ADMIN_PASSWORT ? env.ADMIN_PASSWORT : env.ARCHIV_PASSWORT);

async function login(request, env) {
  let pw = "";
  try {
    const body = await request.json();
    pw = String(body.passwort || "");
  } catch (_) {}
  let role = null;
  if (env.ADMIN_PASSWORT && safeEqual(pw, env.ADMIN_PASSWORT)) role = "admin";
  else if (safeEqual(pw, env.ARCHIV_PASSWORT)) role = "werkstatt";
  if (!role) {
    await new Promise((r) => setTimeout(r, 800)); // bremst Durchprobieren
    return json({ error: "Passwort stimmt nicht." }, 401);
  }
  const payload = b64url(enc.encode(JSON.stringify({ r: role, e: Date.now() + SESSION_DAYS * 864e5 })));
  const token = payload + "." + (await hmac(secretFor(env, role), payload));
  return json({ ok: true, role }, 200, {
    "set-cookie": `${COOKIE}=${token}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; Secure; SameSite=Lax`,
  });
}

function logout() {
  return new Response(null, {
    status: 302,
    headers: { location: "/login", "set-cookie": `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` },
  });
}

async function session(request, env) {
  const cookie = request.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!m) return null;
  const [payload, sig] = m[1].split(".");
  if (!payload || !sig) return null;
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
  } catch (_) {
    return null;
  }
  if (!data || !data.e || data.e < Date.now()) return null;
  if (data.r !== "admin" && data.r !== "werkstatt") return null;
  if (data.r === "admin" && !env.ADMIN_PASSWORT) return null;
  const expect = await hmac(secretFor(env, data.r), payload);
  return safeEqual(sig, expect) ? data.r : null;
}

async function loginPage(env) {
  const res = await env.ASSETS.fetch(new Request("https://assets/pub/login.html"));
  return withSecurity(new Response(res.body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }), true);
}

/* ---------- Datenbank ---------- */

let schemaReady = false;
async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS bikes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nr TEXT UNIQUE NOT NULL,
      year INTEGER NOT NULL,
      seq INTEGER NOT NULL,
      maker TEXT, color TEXT, size_lo INTEGER, size_hi INTEGER, frame TEXT,
      extras TEXT NOT NULL DEFAULT '[]',
      descr TEXT, note TEXT,
      status TEXT NOT NULL DEFAULT 'lager',
      photos TEXT NOT NULL DEFAULT '[]',
      done_at TEXT, out_at TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS bikes_status ON bikes(status)`),
  ]);
  // Spalte "reserved" nachrüsten; alter Status "reserviert" wird zu "bereit + reserviert"
  const { results } = await env.DB.prepare("PRAGMA table_info(bikes)").all();
  if (!results.some((c) => c.name === "reserved")) {
    await env.DB.batch([
      env.DB.prepare("ALTER TABLE bikes ADD COLUMN reserved INTEGER NOT NULL DEFAULT 0"),
      env.DB.prepare("UPDATE bikes SET status = 'lager', reserved = 1 WHERE status = 'reserviert'"),
    ]);
  }
  if (!results.some((c) => c.name === "worker")) {
    await env.DB.prepare("ALTER TABLE bikes ADD COLUMN worker TEXT").run();
  }
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS people (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE COLLATE NOCASE)").run();
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM people").first();
  if (!n.n) {
    await env.DB.batch(START_NAMES.map((name) => env.DB.prepare("INSERT OR IGNORE INTO people (name) VALUES (?)").bind(name)));
  }
  schemaReady = true;
}

const today = () => new Date(Date.now() + 3600e3).toISOString().slice(0, 10); // ungefähr Berliner Datum
const isDate = (s) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
const clip = (s, n) => (s == null ? null : String(s).trim().slice(0, n) || null);
const intOrNull = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n >= 50 && n <= 230 ? n : null;
};

// Nimmt nur bekannte Felder an und prüft sie.
function clean(input, partial) {
  const out = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(input, k);
  if (!partial || has("maker")) out.maker = clip(input.maker, 60);
  if (!partial || has("color")) out.color = clip(input.color, 30);
  if (!partial || has("frame")) out.frame = clip(input.frame, 30);
  if (!partial || has("worker")) out.worker = clip(input.worker, 60);
  if (!partial || has("descr")) out.descr = clip(input.descr, 2000);
  if (!partial || has("note")) out.note = clip(input.note, 300);
  if (!partial || has("size_lo") || has("size_hi")) {
    let lo = intOrNull(input.size_lo), hi = intOrNull(input.size_hi);
    if (lo && hi && lo > hi) [lo, hi] = [hi, lo];
    out.size_lo = lo;
    out.size_hi = hi;
  }
  if (!partial || has("extras")) {
    const ex = Array.isArray(input.extras) ? input.extras : [];
    out.extras = JSON.stringify([...new Set(ex.map((e) => clip(e, 40)).filter(Boolean))].slice(0, 30));
  }
  if (has("status")) {
    if (!STATUS.includes(input.status)) throw new HttpError(400, "Unbekannter Status.");
    out.status = input.status;
  }
  if (has("reserved")) out.reserved = input.reserved ? 1 : 0;
  if (has("done_at")) out.done_at = isDate(input.done_at) ? input.done_at : null;
  if (has("out_at")) out.out_at = isDate(input.out_at) ? input.out_at : null;
  return out;
}

class HttpError extends Error {
  constructor(status, msg) {
    super(msg);
    this.status = status;
  }
}

function row(b) {
  if (!b) return b;
  return { ...b, reserved: !!b.reserved, extras: JSON.parse(b.extras || "[]"), photos: JSON.parse(b.photos || "[]") };
}

async function api(request, env, url, role) {
  const m = request.method;
  const p = url.pathname;
  let mmPeople;
  try {
    if (p === "/api/me" && m === "GET") return json({ role });

    if (p === "/api/people" && m === "GET") {
      const { results } = await env.DB.prepare("SELECT name FROM people ORDER BY name COLLATE NOCASE").all();
      return json({ people: results.map((r) => r.name) });
    }
    if (p === "/api/people" && m === "POST") {
      const body = await request.json();
      const name = clip(body.name, 60);
      if (!name) throw new HttpError(400, "Bitte einen Namen eingeben.");
      await env.DB.prepare("INSERT OR IGNORE INTO people (name) VALUES (?)").bind(name).run();
      const { results } = await env.DB.prepare("SELECT name FROM people ORDER BY name COLLATE NOCASE").all();
      return json({ people: results.map((r) => r.name) }, 201);
    }
    mmPeople = p.match(/^\/api\/people\/(.+)$/);
    if (mmPeople && m === "DELETE") {
      if (role !== "admin") throw new HttpError(403, "Namen entfernen dürfen nur Admins.");
      await env.DB.prepare("DELETE FROM people WHERE name = ?").bind(decodeURIComponent(mmPeople[1])).run();
      return json({ ok: true });
    }

    if (p === "/api/bikes" && m === "GET") {
      const { results } = await env.DB.prepare(
        "SELECT * FROM bikes ORDER BY COALESCE(out_at, done_at, created_at) DESC, id DESC"
      ).all();
      return json({ bikes: results.map(row) });
    }

    if (p === "/api/bikes" && m === "POST") {
      const body = await request.json();
      const b = clean(body, false);
      const status = STATUS.includes(body.status) ? body.status : "lager";
      const done = isDate(body.done_at) ? body.done_at : status === "reparatur" ? null : today();
      const reserved = body.reserved && status !== "ausgegeben" ? 1 : 0;
      const out = status === "ausgegeben" ? (isDate(body.out_at) ? body.out_at : today()) : null;
      const year = parseInt((done || today()).slice(0, 4), 10);
      const now = new Date().toISOString();
      // Nummer = Jahr + laufende Nummer, in einer Anweisung vergeben (kein Doppelvergeben)
      const created = await env.DB.prepare(
        `INSERT INTO bikes (year, seq, nr, maker, color, size_lo, size_hi, frame, extras, descr, note, status, done_at, out_at, created_at, updated_at, reserved, worker)
         SELECT ?1, COALESCE(MAX(seq), 0) + 1, printf('%02d-%03d', ?1 % 100, COALESCE(MAX(seq), 0) + 1),
                ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14, ?15
         FROM bikes WHERE year = ?1
         RETURNING *`
      )
        .bind(year, b.maker, b.color, b.size_lo, b.size_hi, b.frame, b.extras, b.descr, b.note, status, done, out, now, reserved, b.worker)
        .first();
      return json({ bike: row(created) }, 201);
    }

    let mm = p.match(/^\/api\/bikes\/(\d+)$/);
    if (mm) {
      const id = +mm[1];
      const cur = await env.DB.prepare("SELECT * FROM bikes WHERE id = ?").bind(id).first();
      if (!cur) throw new HttpError(404, "Rad nicht gefunden.");
      if (m === "GET") return json({ bike: row(cur) });
      if (m === "PATCH") {
        const body = await request.json();
        const ch = clean(body, true);
        // Statuswechsel setzt oder löscht das Ausgabedatum automatisch
        if (ch.status && ch.status !== cur.status) {
          if (ch.status === "ausgegeben" && !ch.out_at) ch.out_at = today();
          if (ch.status !== "ausgegeben") ch.out_at = null;
          if (ch.status === "ausgegeben") ch.reserved = 0; // ausgegeben = Reservierung erledigt
          if (ch.status === "lager" && !cur.done_at && !ch.done_at) ch.done_at = today(); // gerade fertig geworden
          if (ch.status === "reparatur" && !Object.prototype.hasOwnProperty.call(body, "done_at")) ch.done_at = null;
        }
        const keys = Object.keys(ch);
        if (!keys.length) return json({ bike: row(cur) });
        const sets = keys.map((k, i) => `${k} = ?${i + 1}`).join(", ");
        const upd = await env.DB.prepare(
          `UPDATE bikes SET ${sets}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2} RETURNING *`
        )
          .bind(...keys.map((k) => ch[k]), new Date().toISOString(), id)
          .first();
        return json({ bike: row(upd) });
      }
      if (m === "DELETE") {
        if (role !== "admin") throw new HttpError(403, "Löschen dürfen nur Admins.");
        const photos = JSON.parse(cur.photos || "[]");
        if (photos.length) await env.FOTOS.delete(photos);
        await env.DB.prepare("DELETE FROM bikes WHERE id = ?").bind(id).run();
        return json({ ok: true });
      }
    }

    mm = p.match(/^\/api\/bikes\/(\d+)\/fotos$/);
    if (mm && m === "POST") {
      const id = +mm[1];
      const cur = await env.DB.prepare("SELECT id, nr, photos FROM bikes WHERE id = ?").bind(id).first();
      if (!cur) throw new HttpError(404, "Rad nicht gefunden.");
      const photos = JSON.parse(cur.photos || "[]");
      if (photos.length >= MAX_PHOTOS) throw new HttpError(400, `Höchstens ${MAX_PHOTOS} Fotos pro Rad.`);
      const type = request.headers.get("content-type") || "";
      if (!/^image\/(jpeg|png|webp)$/.test(type)) throw new HttpError(415, "Nur JPEG, PNG oder WebP.");
      const buf = await request.arrayBuffer();
      if (!buf.byteLength || buf.byteLength > MAX_PHOTO_BYTES) throw new HttpError(413, "Foto ist zu groß.");
      const ext = type.split("/")[1].replace("jpeg", "jpg");
      const key = `${cur.nr}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      await env.FOTOS.put(key, buf, { httpMetadata: { contentType: type } });
      photos.push(key);
      const upd = await env.DB.prepare("UPDATE bikes SET photos = ?1, updated_at = ?2 WHERE id = ?3 RETURNING *")
        .bind(JSON.stringify(photos), new Date().toISOString(), id)
        .first();
      return json({ bike: row(upd) }, 201);
    }

    mm = p.match(/^\/api\/bikes\/(\d+)\/fotos\/(.+)$/);
    if (mm && m === "DELETE") {
      const id = +mm[1];
      const key = decodeURIComponent(mm[2]);
      const cur = await env.DB.prepare("SELECT photos FROM bikes WHERE id = ?").bind(id).first();
      if (!cur) throw new HttpError(404, "Rad nicht gefunden.");
      const photos = JSON.parse(cur.photos || "[]");
      if (!photos.includes(key)) throw new HttpError(404, "Foto nicht gefunden.");
      await env.FOTOS.delete(key);
      const upd = await env.DB.prepare("UPDATE bikes SET photos = ?1, updated_at = ?2 WHERE id = ?3 RETURNING *")
        .bind(JSON.stringify(photos.filter((k) => k !== key)), new Date().toISOString(), id)
        .first();
      return json({ bike: row(upd) });
    }

    if (p === "/api/export.csv" && m === "GET") {
      const { results } = await env.DB.prepare("SELECT * FROM bikes ORDER BY year, seq").all();
      const cols = ["nr", "status", "reserved", "worker", "maker", "color", "size_lo", "size_hi", "frame", "extras", "descr", "note", "done_at", "out_at"];
      const esc = (v) => {
        const s = v == null ? "" : String(v);
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const lines = [cols.join(";")].concat(
        results.map((r) =>
          cols.map((c) => esc(c === "extras" ? JSON.parse(r.extras || "[]").join(", ") : r[c])).join(";")
        )
      );
      return new Response("﻿" + lines.join("\n"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="rad-archiv-${today()}.csv"`,
          "cache-control": "no-store",
        },
      });
    }

    throw new HttpError(404, "Unbekannte Adresse.");
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    if (err instanceof SyntaxError) return json({ error: "Ungültige Daten." }, 400);
    throw err;
  }
}

async function photo(env, key) {
  if (!key || key.includes("..")) return text("Nicht gefunden", 404);
  const obj = await env.FOTOS.get(key);
  if (!obj) return text("Nicht gefunden", 404);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "image/jpeg",
      "cache-control": "private, max-age=31536000, immutable",
      "x-robots-tag": "noindex",
    },
  });
}
