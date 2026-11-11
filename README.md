# Faradgang Rad-Archiv

Internes Archiv der fertig reparierten Räder der Faradgang-Werkstatt. Nicht öffentlich, mit Passwort geschützt, fürs Handy gemacht.

- Räder mit Foto(s) anlegen: Hersteller, Farbe, Größe (Körpergröße von–bis), Art (Stadtrad, Trekking, Rennrad, MTB, …), Rahmen (Herren, Damen, Tiefeinstieg), Extras, Beschreibung, Notiz. Jedes Feld darf leer bleiben.
- Jedes Rad bekommt automatisch eine Nummer (`26-014` = 14. Rad aus 2026), die man auf einen Anhänger am Rad schreiben kann.
- Status mit einem Tipp: **In Reparatur** (im Lager, noch kaputt), **Bereit** (fertig für die Ausgabe), **Ausgegeben**. Das Fertig- und Ausgabedatum wird automatisch gesetzt.
- **Reserviert** ist ein eigener Knopf mit Notiz (z. B. „für Montag“) und erscheint als Störer auf dem Foto. Bei der Ausgabe verschwindet er automatisch.
- Liste mit Suche und Filtern (Status, Größe, Rahmen), Statistik pro Jahr und Monat, Export als CSV.
- „Wer schraubt?“: Auswahl aus der Namensliste der Werkstatt, neue Namen direkt im Formular hinzufügen.
- Zwei Passwörter: **Werkstatt** (anlegen, ändern, Status) und **Admin** (zusätzlich löschen).

## Aufbau

| Teil | Was |
|---|---|
| `src/worker.js` | Cloudflare Worker: Login, API, Fotos. Lässt ohne gültige Anmeldung nichts durch außer der Login-Seite. |
| `public/index.html`, `public/app.js` | Die App (eine Seite, kein Build-Schritt) |
| `public/pub/` | Ohne Login erreichbar: Login-Seite, CSS, Schriften (Rubik, IBM Plex Mono, lokal statt Google Fonts), Logo, Icons |
| D1-Datenbank `radarchiv` | Tabelle `bikes`, wird beim ersten Aufruf automatisch angelegt |
| R2-Bucket `radarchiv-fotos` | Fotos, vor dem Hochladen auf max. 1600 px verkleinert (ca. 200–400 KB) |

Die Anmeldung ist ein Cookie für 90 Tage, signiert mit dem Passwort selbst. **Wird ein Passwort geändert, sind alle damit angemeldeten Handys sofort abgemeldet.** So sperrt man jemanden aus, der nicht mehr in der Werkstatt ist.

## Einrichten auf Cloudflare (einmalig, ca. 15 Minuten)

Im Cloudflare-Dashboard, im selben Konto wie bikepacking.studio:

1. **Datenbank:** erledigt (D1 `radarchiv`, Standort EU, ID steht in `wrangler.jsonc`).
2. **Fotospeicher:** **R2** → Create bucket → Name `radarchiv-fotos`, Standort Europa (EU). R2 muss im Konto einmal aktiviert sein; bis 10 GB ist es kostenlos.
3. **Worker:** Workers & Pages → Create → **Import a repository** → `faradgang-radarchiv`.
   - Build command: leer lassen
   - Deploy command: `npx wrangler deploy`
   Danach geht jeder Push auf `main` automatisch live.
4. **Passwörter:** im Worker → Settings → Variables and Secrets → zwei **Secrets** anlegen:
   - `ARCHIV_PASSWORT`: das Passwort für alle in der Werkstatt
   - `ADMIN_PASSWORT`: das Passwort für Admins (darf löschen). Optional.
   Ohne `ARCHIV_PASSWORT` zeigt der Worker nur „Noch nicht eingerichtet“.
5. **Adresse:** Zum Testen reicht die `…workers.dev`-Adresse, die Cloudflare anzeigt. Später unter Settings → Domains & Routes `archiv.faradgang.berlin` eintragen (geht direkt, wenn die Domain bei Cloudflare liegt, sonst einen CNAME beim Domain-Anbieter setzen).

## Auf dem Handy

Adresse öffnen, Werkstatt-Passwort eingeben, dann im Browser-Menü **„Zum Home-Bildschirm“** (iPhone: Teilen-Knopf → „Zum Home-Bildschirm“). Danach startet das Archiv wie eine App.

## Lokal testen

```bash
npm install
cp .dev.vars.example .dev.vars   # Passwörter für lokal: werkstatt / admin
npx wrangler dev                 # http://localhost:8787
```

`wrangler dev` legt Datenbank und Fotos lokal in `.wrangler/` an, die echten Daten bleiben unberührt.

## Sicherung

Admins und Werkstatt können unter **Statistik → Liste als CSV herunterladen** jederzeit eine Tabelle aller Räder ziehen. D1 hat zusätzlich eine eingebaute Zeitreise (Wiederherstellen bis 30 Tage zurück, Dashboard → D1 → radarchiv → Time Travel).

## Später: Signal-Bot (Phase 2)

Ein Bot in der Werkstatt-Signal-Gruppe, der Foto + Text automatisch als Rad anlegt. Er kann die gleiche API benutzen (`POST /api/bikes`, `POST /api/bikes/:id/fotos`, `PATCH /api/bikes/:id`). Dafür braucht es einen kleinen Server mit signal-cli und eine eigene Telefonnummer. Konzept: https://claude.ai/artifact/CxuT5mVr1cvZtVehU6cVXg

## API

| Methode | Pfad | Zweck |
|---|---|---|
| POST | `/api/login` | `{ "passwort": "…" }` → Cookie |
| GET | `/logout` | abmelden |
| GET | `/api/me` | Rolle (`werkstatt` oder `admin`) |
| GET | `/api/bikes` | alle Räder |
| POST | `/api/bikes` | Rad anlegen (Nummer wird vergeben) |
| PATCH | `/api/bikes/:id` | Felder oder Status ändern; `status: "ausgegeben"` setzt `out_at` auf heute |
| DELETE | `/api/bikes/:id` | löschen (nur Admin) |
| POST | `/api/bikes/:id/fotos` | Foto hochladen (Body = Bild, `content-type: image/jpeg`), max. 4 pro Rad |
| DELETE | `/api/bikes/:id/fotos/:key` | Foto entfernen |
| GET | `/foto/:key` | Foto anzeigen (nur angemeldet) |
| GET | `/api/export.csv` | alle Räder als CSV (Excel-tauglich, Semikolon) |
