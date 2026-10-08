import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'uno.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Einfache Key-Value-Einstellungen (z.B. ob negative Punkte erlaubt sind).
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  -- Ein "Match" ist ein komplettes Spiel bis zum Punktemaximum.
  CREATE TABLE IF NOT EXISTS matches (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    max_points   INTEGER NOT NULL,
    status       TEXT NOT NULL DEFAULT 'active', -- 'active' | 'finished'
    winner_id    INTEGER,
    loser_id     INTEGER,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at  TEXT,
    FOREIGN KEY (winner_id) REFERENCES players(id) ON DELETE SET NULL,
    FOREIGN KEY (loser_id)  REFERENCES players(id) ON DELETE SET NULL
  );

  -- Teilnehmer eines Matches inkl. Sitzreihenfolge.
  CREATE TABLE IF NOT EXISTS match_players (
    match_id   INTEGER NOT NULL,
    player_id  INTEGER NOT NULL,
    seat       INTEGER NOT NULL,
    PRIMARY KEY (match_id, player_id),
    FOREIGN KEY (match_id)  REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
  );

  -- Eine "Runde" ist ein einzelnes Blatt (eine Tabellenzeile).
  -- winner_id = Spieler, der die Runde "ausgemacht" hat.
  CREATE TABLE IF NOT EXISTS rounds (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id     INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    winner_id    INTEGER,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (match_id, round_number),
    FOREIGN KEY (match_id)  REFERENCES matches(id) ON DELETE CASCADE,
    FOREIGN KEY (winner_id) REFERENCES players(id) ON DELETE SET NULL
  );

  -- Ergebnis eines Spielers in einer Runde.
  CREATE TABLE IF NOT EXISTS round_scores (
    round_id        INTEGER NOT NULL,
    player_id       INTEGER NOT NULL,
    points          INTEGER NOT NULL DEFAULT 0,
    plus_two_count  INTEGER NOT NULL DEFAULT 0,
    plus_four_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (round_id, player_id),
    FOREIGN KEY (round_id)  REFERENCES rounds(id) ON DELETE CASCADE,
    FOREIGN KEY (player_id) REFERENCES players(id) ON DELETE CASCADE
  );
`);

// --- Leichte Migrationen für bereits bestehende Datenbanken ---
const roundCols = db.prepare(`PRAGMA table_info(rounds)`).all();
if (!roundCols.some((c) => c.name === 'winner_id')) {
  db.exec(`ALTER TABLE rounds ADD COLUMN winner_id INTEGER REFERENCES players(id) ON DELETE SET NULL`);
}

export default db;
