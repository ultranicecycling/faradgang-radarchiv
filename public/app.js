// Faradgang Rad-Archiv: Oberfläche (eine Datei, ohne Build-Schritt)
(function () {
  "use strict";

  const COLORS = { "Schwarz": "#1b1b1b", "Weiß": "#f2f2f2", "Grau": "#8d8f92", "Silber": "#c5c8cc", "Rot": "#d33a2c", "Blau": "#2f5fd0", "Grün": "#2f8a4b", "Gelb": "#f3c623", "Orange": "#ee7a22", "Lila": "#7b4bc4", "Pink": "#ec6aa6", "Braun": "#7a5134", "Türkis": "#26a6a0", "Mint": "#9fdcc4" };
  // Grundreihenfolge = was in der Werkstatt vermutlich am häufigsten vorkommt.
  // Sobald Räder eingetragen sind, rückt nach vorn, was am meisten benutzt wird.
  const KINDS = ["Stadtrad", "Trekkingrad", "Hollandrad", "Kinderrad", "Jugendrad", "MTB", "Rennrad", "Fixie / Singlespeed", "Klapprad", "Lastenrad", "Gravel", "BMX", "E-Bike"];
  const FRAMES = ["Herren", "Damen", "Tiefeinstieg"];
  const EXTRAS = ["Gepäckträger", "Ständer", "Licht", "Schutzbleche", "Klingel", "Kettenschaltung", "Nabenschaltung", "Rücktritt", "Nabendynamo", "Korb", "Schloss", "Kindersitz", "Scheibenbremse"];
  const MAKERS = ["Batavus", "Bulls", "Cube", "Diamant", "Gazelle", "Giant", "Hercules", "Kalkhoff", "Kettler", "Pegasus", "Peugeot", "Puky", "Raleigh", "Trek", "Winora"];
  const SIZES = [{ k: "kids", t: "Kinder < 145", lo: 0, hi: 145 }, { k: "s", t: "145–165", lo: 145, hi: 165 }, { k: "m", t: "165–180", lo: 165, hi: 180 }, { k: "l", t: "180+", lo: 180, hi: 999 }];
  const ST = { reparatur: "In Reparatur", lager: "Bereit", ausgegeben: "Ausgegeben" };
  const ST_ORDER = ["reparatur", "lager", "ausgegeben"];
  const MAX_PHOTOS = 4;

  const S = { view: "list", status: "lager", q: "", size: null, frame: null, kind: null, cur: null, year: new Date().getFullYear(), confirmDel: false, draft: null, toast: "", toastErr: false, busy: false, role: "werkstatt", bikes: [], people: [] };
  const app = document.getElementById("app");

  /* ---------- Hilfen ---------- */
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmt = (d) => (d ? d.split("-").reverse().join(".") : "");
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
  const title = (b) => [b.maker, b.color && b.color.toLowerCase()].filter(Boolean).join(" · ") || "Ohne Angaben";
  const size = (b) => (b.size_lo && b.size_hi ? `${b.size_lo}–${b.size_hi} cm` : b.size_lo ? `ab ${b.size_lo} cm` : b.size_hi ? `bis ${b.size_hi} cm` : "");
  const fotoUrl = (k) => "/foto/" + k.split("/").map(encodeURIComponent).join("/");
  const byId = (id) => S.bikes.find((b) => b.id === id);
  const makers = () => [...new Set([...MAKERS, ...S.bikes.map((b) => b.maker).filter(Boolean)])].sort((a, b) => a.localeCompare(b, "de"));
  const byUse = (list, countOf) => {
    const n = {}; list.forEach((x) => (n[x] = 0)); S.bikes.forEach((b) => countOf(b).forEach((x) => { if (x in n) n[x]++; }));
    return list.map((x, i) => [x, i]).sort((a, b) => n[b[0]] - n[a[0]] || a[1] - b[1]).map((x) => x[0]);
  };
  const extrasAll = () => byUse([...new Set([...EXTRAS, ...S.bikes.flatMap((b) => b.extras)])], (b) => b.extras);
  const kindsSorted = () => byUse(KINDS, (b) => (b.kind ? [b.kind] : []));

  async function api(path, opts = {}) {
    const r = await fetch(path, { credentials: "same-origin", ...opts });
    if (r.status === 401) { location.replace("/login"); throw new Error("Bitte neu anmelden."); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `Fehler ${r.status}`);
    return d;
  }
  const sendJSON = (path, method, data) => api(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
  function upsert(b) { const i = S.bikes.findIndex((x) => x.id === b.id); if (i < 0) S.bikes.unshift(b); else S.bikes[i] = b; }

  // Foto auf max. 1600 px verkleinern und als JPEG (ca. 200–400 KB) speichern
  async function shrink(file) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: "from-image" }); }
    catch (_) {
      src = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Bild nicht lesbar.")); i.src = URL.createObjectURL(file); });
    }
    const w = src.width, h = src.height, k = Math.min(1, 1600 / Math.max(w, h));
    const c = document.createElement("canvas"); c.width = Math.round(w * k); c.height = Math.round(h * k);
    c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
    return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.8));
  }

  function bikeSvg(color) {
    const c = COLORS[color] || "#9a9a93";
    return `<svg viewBox="0 0 200 120" aria-hidden="true"><g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="48" cy="80" r="30" stroke="currentColor" stroke-width="4" opacity=".85"/><circle cx="152" cy="80" r="30" stroke="currentColor" stroke-width="4" opacity=".85"/>
    <path d="M48 80 L82 40 L136 40 L100 80 Z M100 80 L76 30 M136 40 L152 80 M136 40 L130 24 L142 22" stroke="${c}" stroke-width="7"/>
    <path d="M66 30 L88 30" stroke="currentColor" stroke-width="6"/><circle cx="100" cy="80" r="6" stroke="currentColor" stroke-width="3"/></g></svg>`;
  }
  const thumb = (b) => (b.photos.length ? `<img src="${fotoUrl(b.photos[0])}" alt="" loading="lazy">` : bikeSvg(b.color));
  // Störer: Rad ist reserviert
  const stoerer = (b, big) => (b.reserved && b.status !== "ausgegeben" ? `<span class="stoerer${big ? " big" : ""}" title="${esc(b.note || "Reserviert")}">Reser&shy;viert</span>` : "");

  /* ---------- Filter ---------- */
  function filtered() {
    const z = SIZES.find((x) => x.k === S.size);
    const words = S.q.toLowerCase().split(/\s+/).filter(Boolean);
    return S.bikes
      .filter((b) => S.status === "alle" || (S.status === "reserviert" ? b.reserved && b.status !== "ausgegeben" : b.status === S.status))
      .filter((b) => !z || ((b.size_lo || b.size_hi) && (b.size_hi || b.size_lo) > z.lo && (b.size_lo || b.size_hi) < z.hi))
      .filter((b) => !S.frame || b.frame === S.frame)
      .filter((b) => !S.kind || b.kind === S.kind)
      .filter((b) => {
        if (!words.length) return true;
        const t = [b.nr, b.worker, b.kind, b.maker, b.color, b.frame, b.descr, b.note, ...b.extras, size(b)].join(" ").toLowerCase();
        return words.every((w) => t.includes(w));
      });
  }
  const count = (st) => S.bikes.filter((b) => b.status === st).length;
  const countRes = () => S.bikes.filter((b) => b.reserved && b.status !== "ausgegeben").length;

  /* ---------- Ansichten ---------- */
  function nav(active) {
    return `<nav class="nav" aria-label="Hauptnavigation">
     <button data-go="list" ${active === "list" ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="6" cy="16" r="4"/><circle cx="18" cy="16" r="4"/><path d="M6 16l4-7h6l2 7M10 9l-1-3"/></svg>Räder</button>
     <button class="add" data-go="new"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Rad</button>
     <button data-go="stats" ${active === "stats" ? 'aria-current="page"' : ""}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>Statistik</button>
    </nav>`;
  }

  function vList() {
    const list = filtered();
    const segs = [["lager", "Bereit"], ["reparatur", "Reparatur"], ["reserviert", "Reserviert"], ["ausgegeben", "Ausgegeben"], ["alle", "Alle"]];
    const emptyText = S.bikes.length
      ? "Keine Räder für diese Auswahl.<br>Filter antippen, um sie zu lösen."
      : "Noch keine Räder im Archiv.<br>Mit <b>+ Rad</b> unten legst du das erste an.";
    return `<div class="screen"><div class="top">
      <h1>Räder <small>${count("lager")} bereit · ${count("reparatur")} in Reparatur<br>${countRes()} reserviert</small></h1>
      <div class="search"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
        <input id="q" type="search" placeholder="Suchen: Winora, Korb, 26-014 …" value="${esc(S.q)}" aria-label="Räder durchsuchen" autocomplete="off"></div>
      <div class="seg" role="group" aria-label="Status">${segs.map(([k, t]) => `<button data-status="${k}" aria-pressed="${S.status === k}">${t}</button>`).join("")}</div>
      <div class="chips" aria-label="Filter">
        ${SIZES.map((z) => `<button class="chip" data-size="${z.k}" aria-pressed="${S.size === z.k}">${z.t}</button>`).join("")}
        ${["Tiefeinstieg", "Damen", "Herren"].map((f) => `<button class="chip" data-frame="${f}" aria-pressed="${S.frame === f}">${f}</button>`).join("")}
        ${kindsSorted().map((k) => `<button class="chip" data-kind="${esc(k)}" aria-pressed="${S.kind === k}">${esc(k)}</button>`).join("")}
      </div></div>
     <div class="grid">${list.length ? list.slice(0, 200).map((b) => `
       <button class="card" data-open="${b.id}">
        <div class="thumb">${thumb(b)}<span class="nr">#${esc(b.nr)}</span>${stoerer(b)}</div>
        <h3>${esc(title(b))}</h3>
        <div class="meta"><span>${esc(size(b)) || "Größe ?"}</span><span class="pill st-${b.status}">${ST[b.status]}</span></div>
       </button>`).join("") : `<div class="empty">${emptyText}</div>`}</div>
    </div>${nav("list")}`;
  }

  function vDetail() {
    const b = byId(S.cur);
    if (!b) { S.view = "list"; return vList(); }
    const row = (k, v) => `<dt>${k}</dt>${v ? `<dd>${v}</dd>` : `<dd class="leer">leer</dd>`}`;
    const pics = b.photos.length ? b.photos.map((k, i) => `<div><img src="${fotoUrl(k)}" alt="Foto ${i + 1} von Rad ${esc(b.nr)}"></div>`).join("") : `<div>${bikeSvg(b.color)}</div>`;
    return `<div class="screen">
     <div class="top" style="padding-bottom:12px"><button class="back" data-go="list"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M15 18l-6-6 6-6"/></svg>Räder</button></div>
     <div class="hero-wrap"><div class="gallery">${pics}</div>${stoerer(b, true)}</div>
     ${b.photos.length > 1 ? `<div class="dots">${b.photos.map(() => "<span></span>").join("")}</div>` : ""}
     <div class="pad">
      <div class="eyebrow">#${esc(b.nr)} · ${b.status === "reparatur" ? "noch in Reparatur" : "fertig am " + (fmt(b.done_at) || "?")}</div>
      <h2 class="title-xl">${esc(title(b))}</h2>
      <dl class="kv">
       ${row("Schrauber:in", esc(b.worker))}
       ${row("Hersteller", esc(b.maker))}
       ${row("Farbe", b.color ? `<span style="display:inline-flex;align-items:center;gap:8px"><span style="width:14px;height:14px;border-radius:50%;background:${COLORS[b.color] || "transparent"};border:1px solid var(--line)"></span>${esc(b.color)}</span>` : "")}
       ${row("Größe", esc(size(b)))}
       ${row("Art", esc(b.kind))}
       ${row("Rahmen", esc(b.frame))}
       ${row("Extras", b.extras.length ? `<div class="tags">${b.extras.map((e) => `<span class="tag">${esc(e)}</span>`).join("")}</div>` : "")}
       ${row("Beschreibung", esc(b.descr))}
       ${b.note ? row("Notiz", esc(b.note)) : ""}
       ${b.status === "ausgegeben" ? row("Ausgegeben", fmt(b.out_at)) : ""}
      </dl>
      <div class="eyebrow" style="margin-bottom:8px">Status</div>
      <div class="statusbar" role="group" aria-label="Status ändern">
       ${ST_ORDER.map((k) => `<button class="s-${k}" data-setstatus="${k}" aria-pressed="${b.status === k}" ${S.busy ? "disabled" : ""}>${ST[k]}</button>`).join("")}
      </div>
      ${b.status !== "ausgegeben" ? `<div class="reserve">
       <button class="resbtn" data-reserve aria-pressed="${!!b.reserved}" ${S.busy ? "disabled" : ""}>${b.reserved ? "Reserviert ✓ (antippen zum Aufheben)" : "Reservieren"}</button>
       ${b.reserved ? `<label class="hint" for="resnote">Für wen oder wann?</label><input id="resnote" type="text" value="${esc(b.note)}" placeholder="z. B. reserviert für Montag" maxlength="300">` : ""}
      </div>` : ""}
      <div class="row" style="margin-top:16px"><button class="btn btn-ghost" data-edit="${b.id}">Bearbeiten</button>${S.role === "admin" ? `<button class="btn btn-danger" data-del>Löschen</button>` : ""}</div>
      ${S.confirmDel ? `<div class="confirm"><span>Rad #${esc(b.nr)} wirklich löschen? Nur bei Fehleinträgen, sonst fehlt es in der Jahreszählung.</span><div class="row"><button class="btn btn-ghost" data-delno>Abbrechen</button><button class="btn btn-ink" data-delyes>Löschen</button></div></div>` : ""}
      <div style="height:100px"></div>
     </div></div>${nav("list")}`;
  }

  function newDraft(b) {
    if (b) return { id: b.id, nr: b.nr, maker: b.maker || "", color: b.color || "", lo: b.size_lo, hi: b.size_hi, frame: b.frame || "", kind: b.kind || "", worker: b.worker || "", extras: [...b.extras], descr: b.descr || "", note: b.note || "", status: b.status, done_at: b.done_at || todayISO(), photos: [...b.photos], removed: [], files: [] };
    return { id: null, nr: "", maker: "", color: "", lo: null, hi: null, frame: "", kind: "", worker: "", extras: [], descr: "", note: "", status: "lager", done_at: todayISO(), photos: [], removed: [], files: [] };
  }

  function vForm() {
    const d = S.draft;
    const allEx = [...new Set([...extrasAll(), ...d.extras])];
    const nPhotos = d.photos.length + d.files.length;
    const canAdd = nPhotos < MAX_PHOTOS;
    return `<form class="screen" id="form" style="display:flex;flex-direction:column" novalidate>
     <div class="top"><h1>${d.id ? "Rad bearbeiten" : "Neues Rad"} <small>${d.nr ? "#" + esc(d.nr) : "Nummer kommt beim Speichern"}</small></h1></div>
     <div class="pad" style="padding-top:4px;flex:1">
      ${d.id ? "" : `<div class="field"><div class="lbl">Zustand</div>
       <div class="seg" style="margin-top:0" role="group" aria-label="Zustand">
        <button type="button" data-fstatus="reparatur" aria-pressed="${d.status === "reparatur"}">Needs Love</button>
        <button type="button" data-fstatus="lager" aria-pressed="${d.status === "lager"}">Fertig, bereit!</button>
       </div></div>`}
      <div class="field">
       <div class="lbl">Fotos <span>${nPhotos} von ${MAX_PHOTOS}</span></div>
       <div class="photos">
        ${d.photos.map((k) => `<div class="ph"><img src="${fotoUrl(k)}" alt=""><button type="button" data-rmphoto="${esc(k)}" aria-label="Foto entfernen">×</button></div>`).join("")}
        ${d.files.map((f, i) => `<div class="ph"><img src="${f.url}" alt=""><button type="button" data-rmfile="${i}" aria-label="Foto entfernen">×</button></div>`).join("")}
        ${canAdd ? `<div class="addphoto ${nPhotos ? "" : "solo"}"><div class="cam"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 7h3l2-3h6l2 3h3v12H4z"/><circle cx="12" cy="13" r="4"/></svg><b>${nPhotos ? "Noch ein Foto" : "Foto aufnehmen"}</b><span>oder aus der Galerie</span></div>
          <input id="photo" type="file" accept="image/*" ${nPhotos ? "" : 'capture="environment"'} aria-label="Foto hinzufügen"></div>` : ""}
       </div>
       <span class="hint">Fotos werden vor dem Hochladen verkleinert.</span>
      </div>
      <div class="field"><label for="worker">Schrauber:in <span>optional</span></label>
       <select id="worker">
        <option value="">– niemand eingetragen –</option>
        ${[...new Set([...S.people, ...(d.worker ? [d.worker] : [])])].sort((a, b) => a.localeCompare(b, "de")).map((n) => `<option ${d.worker === n ? "selected" : ""}>${esc(n)}</option>`).join("")}
        <option value="__neu">+ Neuen Namen hinzufügen …</option>
       </select>
       ${d.addingPerson ? `<div class="addown"><input id="newperson" type="text" placeholder="Name" maxlength="60" autocomplete="off"><button type="button" data-addperson>Hinzufügen</button></div>` : ""}
       <button type="button" class="linkbtn" data-editpeople>${d.editPeople ? "Fertig mit Namen" : "Namen bearbeiten"}</button>
       ${d.editPeople ? `<div class="people-edit">${S.people.length ? S.people.map((n) => `<span class="pchip">${esc(n)}<button type="button" data-rmperson="${esc(n)}" aria-label="${esc(n)} aus der Liste nehmen">✕</button></span>`).join("") : '<span class="hint">Keine Namen in der Liste.</span>'}</div>
       <span class="hint">✕ nimmt den Namen nur aus der Auswahl. Bei Rädern, die schon eingetragen sind, bleibt er stehen.</span>` : ""}
      </div>
      <div class="field"><label for="maker">Hersteller <span>optional</span></label>
       <input id="maker" type="text" list="makers" value="${esc(d.maker)}" placeholder="z. B. Winora" autocomplete="off" maxlength="60">
       <datalist id="makers">${makers().map((m) => `<option value="${esc(m)}">`).join("")}</datalist></div>
      <div class="field"><div class="lbl">Farbe <span>${esc(d.color) || "optional"}</span></div>
       <div class="swatches">${Object.entries(COLORS).map(([n, c]) => `<button type="button" class="sw" style="background:${c}" data-color="${n}" aria-pressed="${d.color === n}" aria-label="${n}" title="${n}"></button>`).join("")}</div></div>
      <div class="field"><div class="lbl">Größe (Körpergröße) <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="nosize" ${d.lo ? "" : "checked"}> unbekannt</label></div>
       <div class="range-wrap" ${d.lo ? "" : "hidden"} id="sizebox">
        <div class="range-val" id="sizeval">${d.lo || 165}–${d.hi || 175} cm</div>
        <label class="hint" for="lo">von</label><input id="lo" type="range" min="90" max="200" step="1" value="${d.lo || 165}">
        <label class="hint" for="hi">bis</label><input id="hi" type="range" min="90" max="210" step="1" value="${d.hi || 175}">
       </div></div>
      <div class="field"><div class="lbl">Art <span>optional</span></div>
       <div class="wrapchips">${kindsSorted().map((k) => `<button type="button" class="chip" data-fkind="${esc(k)}" aria-pressed="${d.kind === k}">${esc(k)}</button>`).join("")}</div></div>
      <div class="field"><div class="lbl">Rahmen <span>optional</span></div>
       <div class="wrapchips">${FRAMES.map((f) => `<button type="button" class="chip" data-fframe="${f}" aria-pressed="${d.frame === f}">${f}</button>`).join("")}</div></div>
      <div class="field"><div class="lbl">Extras <span>${d.extras.length || "keine"}</span></div>
       <div class="wrapchips">${allEx.map((e) => `<button type="button" class="chip" data-extra="${esc(e)}" aria-pressed="${d.extras.includes(e)}">${esc(e)}</button>`).join("")}</div>
       <div class="addown"><input id="ownextra" type="text" placeholder="Eigenes Extra, z. B. Federgabel" maxlength="40"><button type="button" data-addextra>Hinzufügen</button></div></div>
      <div class="field"><label for="descr">Beschreibung <span>optional</span></label>
       <textarea id="descr" placeholder="Was wurde gemacht, Besonderheiten …" maxlength="2000">${esc(d.descr)}</textarea></div>
      <div class="field"><label for="note">Notiz <span>z. B. „reserviert für Montag“</span></label>
       <input id="note" type="text" value="${esc(d.note)}" maxlength="300"></div>
      ${d.status === "reparatur" ? "" : `<div class="field" style="border-bottom:0"><label for="done_at">Fertig repariert am</label>
       <input id="done_at" type="date" value="${esc(d.done_at)}"></div>`}
     </div>
     <div class="formfoot"><button type="button" class="btn btn-ghost" data-cancel>Abbrechen</button><button type="submit" class="btn btn-lime" style="flex:2" ${S.busy ? "disabled" : ""}>${S.busy ? "Speichert …" : "Speichern"}</button></div>
    </form>`;
  }

  function vStats() {
    const y = S.year;
    const out = S.bikes.filter((b) => b.status === "ausgegeben" && b.out_at && b.out_at.startsWith(String(y)));
    const done = S.bikes.filter((b) => b.done_at && b.done_at.startsWith(String(y)));
    const per = Array.from({ length: 12 }, (_, m) => out.filter((b) => +b.out_at.slice(5, 7) === m + 1).length);
    const max = Math.max(...per, 1);
    const now = new Date();
    const curM = y === now.getFullYear() ? now.getMonth() + 1 : y < now.getFullYear() ? 12 : 0;
    const byFrame = KINDS.map((f) => [f, out.filter((b) => b.kind === f).length]).filter((x) => x[1]);
    const fmax = Math.max(...byFrame.map((x) => x[1]), 1);
    const years = [...new Set([now.getFullYear(), ...S.bikes.map((b) => +(b.out_at || b.done_at || "").slice(0, 4)).filter(Boolean)])].sort((a, b) => b - a);
    return `<div class="screen"><div class="top"><h1>Statistik</h1>
      <div class="yearsel">${years.map((v) => `<button class="chip" data-year="${v}" aria-pressed="${y === v}">${v}</button>`).join("")}</div></div>
     <div class="pad">
      <div class="big">
       <div class="bigbox hl"><div class="n">${out.length}</div><div class="l">Räder ausgegeben ${y}</div></div>
       <div class="bigbox"><div class="n">${done.length}</div><div class="l">Räder fertig repariert ${y}</div></div>
      </div>
      <div class="chart"><div class="eyebrow">Ausgegeben pro Monat</div>
       <div class="bars">${per.map((v, i) => `<div class="bar ${i + 1 > curM ? "future" : ""}" style="height:${Math.max(2, (v / max) * 100)}%">${i + 1 <= curM ? `<span>${v}</span>` : ""}</div>`).join("")}</div>
       <div class="months">${["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"].map((m) => `<span>${m}</span>`).join("")}</div></div>
      <div class="breakdown"><div class="eyebrow">Ausgegeben nach Art</div>${byFrame.length ? "" : `<p class="hint">Noch keine ausgegebenen Räder mit Art.</p>`}
       ${byFrame.map(([f, v]) => `<div class="bd"><span>${f}</span><div class="track"><div class="fill" style="width:${(v / fmax) * 100}%"></div></div><span class="v">${v}</span></div>`).join("")}</div>
      <p class="hint" style="margin-top:20px">Zählt nach „Ausgegeben am“. Das Datum wird beim Statuswechsel automatisch gesetzt.</p>
      <div class="links">
       <a class="btn btn-ghost" href="/api/export.csv">Liste als CSV herunterladen</a>
       <a class="btn btn-ghost" href="/logout">Abmelden</a>
      </div>
      <p class="hint" style="margin-top:12px">Angemeldet als ${S.role === "admin" ? "Admin" : "Werkstatt"}.</p>
      <div style="height:100px"></div>
     </div></div>${nav("stats")}`;
  }

  /* ---------- Zeichnen ---------- */
  function render(keepScroll) {
    const sc = app.querySelector(".screen"), top = keepScroll && sc ? sc.scrollTop : 0;
    app.innerHTML = ({ list: vList, detail: vDetail, new: vForm, stats: vStats })[S.view]() +
      (S.toast ? `<div class="toast ${S.toastErr ? "err" : ""}" role="status">${esc(S.toast)}</div>` : "");
    const n = app.querySelector(".screen"); if (n) n.scrollTop = top;
  }
  function toast(t, err) {
    S.toast = t; S.toastErr = !!err;
    const old = app.querySelector(".toast"); if (old) old.remove();
    app.insertAdjacentHTML("beforeend", `<div class="toast ${err ? "err" : ""}" role="status">${esc(t)}</div>`);
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { S.toast = ""; const el = app.querySelector(".toast"); if (el) el.remove(); }, err ? 4000 : 2400);
  }
  function readForm() {
    const d = S.draft; if (!d) return;
    ["maker", "descr", "note", "done_at"].forEach((k) => { const el = document.getElementById(k); if (el) d[k] = el.value.trim(); });
  }
  function go(view) { S.view = view; S.confirmDel = false; render(); }

  /* ---------- Aktionen ---------- */
  async function save() {
    readForm();
    const d = S.draft;
    const data = { worker: d.worker, maker: d.maker, color: d.color, size_lo: d.lo, size_hi: d.hi, frame: d.frame, kind: d.kind, extras: d.extras, descr: d.descr, note: d.note };
    if (d.status !== "reparatur") data.done_at = d.done_at || todayISO();
    if (!d.id) data.status = d.status;
    S.busy = true; render(true);
    try {
      let bike = d.id ? (await sendJSON(`/api/bikes/${d.id}`, "PATCH", data)).bike : (await sendJSON("/api/bikes", "POST", data)).bike;
      for (const k of d.removed) bike = (await api(`/api/bikes/${bike.id}/fotos/${encodeURIComponent(k)}`, { method: "DELETE" })).bike;
      for (const f of d.files) bike = (await api(`/api/bikes/${bike.id}/fotos`, { method: "POST", headers: { "content-type": "image/jpeg" }, body: f.blob })).bike;
      upsert(bike);
      S.busy = false; S.cur = bike.id; S.draft = null;
      if (!d.id) { S.status = d.status; S.q = ""; }
      go("detail");
      toast(d.id ? `#${bike.nr} gespeichert` : `Rad #${bike.nr} angelegt`);
    } catch (e) {
      S.busy = false; render(true); toast(e.message, true);
    }
  }

  async function setStatus(st) {
    const b = byId(S.cur); if (!b || b.status === st || S.busy) return;
    S.busy = true; render(true);
    try {
      const { bike } = await sendJSON(`/api/bikes/${b.id}`, "PATCH", { status: st });
      upsert(bike); S.busy = false; render(true);
      toast(st === "ausgegeben" ? `#${bike.nr} ausgegeben am ${fmt(bike.out_at)}` : `#${bike.nr}: ${ST[st]}`);
    } catch (e) { S.busy = false; render(true); toast(e.message, true); }
  }

  async function patch(data, msg) {
    const b = byId(S.cur); if (!b || S.busy) return;
    S.busy = true; render(true);
    try {
      const { bike } = await sendJSON(`/api/bikes/${b.id}`, "PATCH", data);
      upsert(bike); S.busy = false; render(true);
      if (msg) toast(msg(bike));
    } catch (e) { S.busy = false; render(true); toast(e.message, true); }
  }
  function toggleReserve() {
    const b = byId(S.cur); if (!b) return;
    patch({ reserved: !b.reserved }, (x) => (x.reserved ? `#${x.nr} reserviert` : `#${x.nr}: Reservierung aufgehoben`))
      .then(() => { const el = document.getElementById("resnote"); if (el) el.focus(); });
  }

  async function addPerson() {
    const el = document.getElementById("newperson"); const name = el ? el.value.trim() : "";
    if (!name) { toast("Bitte einen Namen eingeben.", true); return; }
    readForm();
    try {
      const d = await sendJSON("/api/people", "POST", { name });
      S.people = d.people;
      S.draft.worker = S.people.find((n) => n.toLowerCase() === name.toLowerCase()) || name;
      S.draft.addingPerson = false; render(true); toast(`${S.draft.worker} hinzugefügt`);
    } catch (e) { toast(e.message, true); }
  }

  async function removePerson(name) {
    readForm();
    try {
      await sendJSON("/api/people/" + encodeURIComponent(name), "DELETE");
      S.people = S.people.filter((n) => n !== name);
      render(true); toast(`${name} entfernt`);
    } catch (e) { toast(e.message, true); }
  }

  async function del() {
    const b = byId(S.cur); if (!b) return;
    try {
      await api(`/api/bikes/${b.id}`, { method: "DELETE" });
      S.bikes = S.bikes.filter((x) => x.id !== b.id);
      go("list"); toast(`Rad #${b.nr} gelöscht`);
    } catch (e) { toast(e.message, true); }
  }

  app.addEventListener("submit", (e) => { e.preventDefault(); if (e.target.id === "form" && !S.busy) save(); });
  app.addEventListener("input", (e) => {
    const t = e.target;
    if (t.id === "q") { S.q = t.value; const pos = t.selectionStart; render(true); const q = document.getElementById("q"); q.focus(); try { q.setSelectionRange(pos, pos); } catch (_) {} }
    if (t.id === "lo" || t.id === "hi") {
      const lo = document.getElementById("lo"), hi = document.getElementById("hi");
      if (+lo.value > +hi.value) { if (t.id === "lo") hi.value = lo.value; else lo.value = hi.value; }
      S.draft.lo = +lo.value; S.draft.hi = +hi.value;
      document.getElementById("sizeval").textContent = `${lo.value}–${hi.value} cm`;
    }
  });
  app.addEventListener("change", async (e) => {
    const t = e.target;
    if (t.id === "photo" && t.files && t.files[0]) {
      readForm();
      try {
        const blob = await shrink(t.files[0]);
        S.draft.files.push({ blob, url: URL.createObjectURL(blob) });
        render(true);
      } catch (err) { toast("Foto konnte nicht gelesen werden.", true); }
    }
    if (t.id === "resnote") { const b = byId(S.cur); if (b && t.value.trim() !== (b.note || "")) patch({ note: t.value.trim() }, (x) => `#${x.nr}: Notiz gespeichert`); }
    if (t.id === "worker") {
      readForm();
      if (t.value === "__neu") { S.draft.addingPerson = true; render(true); const el = document.getElementById("newperson"); if (el) el.focus(); }
      else { S.draft.worker = t.value; S.draft.addingPerson = false; }
    }
    if (t.id === "nosize") {
      document.getElementById("sizebox").hidden = t.checked;
      if (t.checked) { S.draft.lo = null; S.draft.hi = null; }
      else { S.draft.lo = +document.getElementById("lo").value; S.draft.hi = +document.getElementById("hi").value; }
    }
  });
  app.addEventListener("keydown", (e) => {
    if (e.target.id === "newperson" && e.key === "Enter") { e.preventDefault(); app.querySelector("[data-addperson]").click(); }
    if (e.target.id === "ownextra" && e.key === "Enter") { e.preventDefault(); app.querySelector("[data-addextra]").click(); }
  });
  app.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    const ds = b.dataset;
    if (ds.go) { if (ds.go === "new") S.draft = newDraft(); go(ds.go); return; }
    if (ds.status) { S.status = ds.status; render(true); }
    if (ds.size) { S.size = S.size === ds.size ? null : ds.size; render(true); }
    if (ds.frame) { S.frame = S.frame === ds.frame ? null : ds.frame; render(true); }
    if (ds.open) { S.cur = +ds.open; go("detail"); }
    if (ds.setstatus) setStatus(ds.setstatus);
    if ("reserve" in ds) toggleReserve();
    if (ds.fstatus) { readForm(); S.draft.status = ds.fstatus; render(true); }
    if (ds.edit) { S.draft = newDraft(byId(+ds.edit)); go("new"); }
    if ("del" in ds) { S.confirmDel = true; render(true); }
    if ("delno" in ds) { S.confirmDel = false; render(true); }
    if ("delyes" in ds) del();
    if (ds.color) { readForm(); S.draft.color = S.draft.color === ds.color ? "" : ds.color; render(true); }
    if (ds.kind) { S.kind = S.kind === ds.kind ? null : ds.kind; render(true); }
    if (ds.fkind) { readForm(); S.draft.kind = S.draft.kind === ds.fkind ? "" : ds.fkind; render(true); }
    if (ds.fframe) { readForm(); S.draft.frame = S.draft.frame === ds.fframe ? "" : ds.fframe; render(true); }
    if (ds.extra) { readForm(); const x = S.draft.extras, i = x.indexOf(ds.extra); i < 0 ? x.push(ds.extra) : x.splice(i, 1); render(true); }
    if ("addperson" in ds) addPerson();
    if ("editpeople" in ds) { readForm(); S.draft.editPeople = !S.draft.editPeople; render(true); }
    if (ds.rmperson) removePerson(ds.rmperson);
    if ("addextra" in ds) { const v = document.getElementById("ownextra").value.trim(); readForm(); if (v && !S.draft.extras.includes(v)) S.draft.extras.push(v); render(true); }
    if (ds.rmphoto) { readForm(); S.draft.photos = S.draft.photos.filter((k) => k !== ds.rmphoto); S.draft.removed.push(ds.rmphoto); render(true); }
    if (ds.rmfile) { readForm(); S.draft.files.splice(+ds.rmfile, 1); render(true); }
    if ("cancel" in ds) { const id = S.draft && S.draft.id; S.draft = null; go(id ? "detail" : "list"); }
    if (ds.year) { S.year = +ds.year; render(true); }
  });

  /* ---------- Start ---------- */
  (async function start() {
    try {
      const [me, data, ppl] = await Promise.all([api("/api/me"), api("/api/bikes"), api("/api/people")]);
      S.role = me.role; S.bikes = data.bikes; S.people = ppl.people;
      render();
    } catch (e) {
      app.innerHTML = `<div class="loading">${esc(e.message)}</div>`;
    }
  })();
})();
