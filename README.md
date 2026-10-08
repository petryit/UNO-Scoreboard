# 🎴 UNO Punktezähler

Eine Webapp zum Zählen von UNO-Punkten mit dauerhaften Statistiken und Admin-Bereich.
Läuft komplett in **einem Docker/Podman-Container** (Node + nginx + SQLite).

## Funktionen

- **Spiel-Setup**: Spieler aus einer Liste wählen oder neue eingeben, Reihenfolge festlegen, Punktemaximum bestimmen (z. B. 1000).
- **Scoreboard** in Tabellenform: Spielernamen oben nebeneinander, eine Zeile je Runde, Gesamtsumme unten.
- **+2 / +4 Counter** pro Spieler direkt unter dem Namen, mit großen `−`/`+`-Buttons (iPad-tauglich).
- **Punkte pro Runde und Spieler** eintragen – die Summen werden automatisch berechnet.
- **Spielende**: Wird das Punktemaximum erreicht, kommt eine Abfrage: *verlängern* (neues Maximum) oder *beenden & werten*.
  Gewertet wird nach der Regel **niedrigste Punktzahl gewinnt**.
- **Statistiken** (dauerhaft in SQLite): meiste Siege / Niederlagen, meiste +2 / +4 Karten, meiste Punkte, Spielverlauf.
- **Refresh-sicher**: Das laufende Spiel liegt in der Datenbank – ein Browser-Refresh setzt nichts zurück.
- **Admin-Bereich** (Passwort): Spieler und Spiele bearbeiten, löschen, Sieger/Verlierer korrigieren.

## Schnellstart

### Mit Podman (empfohlen)

`podman compose` benötigt ein separat installiertes Compose-Backend. Ohne dieses
startet man den Container direkt:

```bash
podman build -t uno-scoreboard .
podman volume create uno-data
podman run -d --name uno -p 8080:80 \
  -e ADMIN_PASSWORD="meinGeheimesPasswort" \
  -v uno-data:/data \
  uno-scoreboard
```

Danach im Browser: <http://localhost:8080>

Container-Verwaltung:

```bash
podman logs -f uno     # Logs ansehen
podman restart uno     # neu starten
podman start uno       # nach Stopp wieder starten (Image bleibt gebaut)
podman rm -f uno       # entfernen (Daten bleiben im Volume uno-data)
```

### Mit Docker Compose / Podman Compose

Falls ein Compose-Backend installiert ist:

```bash
ADMIN_PASSWORD="meinGeheimesPasswort" docker compose up -d --build
# oder
ADMIN_PASSWORD="meinGeheimesPasswort" podman compose up -d --build
```

## Wichtige Hinweise

- **Admin-Passwort**: Wird über die Umgebungsvariable `ADMIN_PASSWORD` gesetzt (Default `admin` bzw. `changeme` – unbedingt ändern!).
- **Daten**: Die SQLite-Datenbank liegt im Volume unter `/data/uno.db`. Solange das Volume bestehen bleibt, bleiben alle Statistiken erhalten – auch über Container-Neustarts hinweg.
- **Port**: Extern `8080`, intern liefert nginx auf Port 80 und leitet `/api/*` an das Node-Backend (Port 3000) weiter.

## Architektur

```
Browser ──▶ nginx (Port 80)
              ├── statische Dateien  (/app/public)
              └── /api/*  ──▶ Node/Express (Port 3000) ──▶ SQLite (/data/uno.db)
```

Beide Prozesse (nginx + Node) laufen über **supervisord** im selben Container.

### Begriffe

- **Match** = ein komplettes Spiel bis zum Punktemaximum.
- **Runde** = ein einzelnes Blatt (eine Tabellenzeile im Scoreboard).

## Projektstruktur

```
server/index.js      Express-API + Spiellogik
server/db.js         SQLite-Schema & Verbindung
public/              Frontend (Vanilla JS, keine Build-Tools)
  index.html/game.js   Spiel & Scoreboard
  stats.html/stats.js  Statistiken
  admin.html/admin.js  Admin-Bereich
  common.js/style.css  gemeinsame Helfer & Styles
nginx.conf           Reverse-Proxy-Konfiguration
supervisord.conf     Prozess-Manager
Dockerfile           Container-Build
docker-compose.yml   Deployment
```
