import express from 'express';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(cookieParser());

/* ------------------------------------------------------------------ *
 *  Admin-Sessions (im Speicher; Cookie verweist auf Token)
 * ------------------------------------------------------------------ */
const adminSessions = new Set();

function isAdmin(req) {
  const token = req.cookies?.admin_session;
  return token && adminSessions.has(token);
}

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Nicht autorisiert' });
  next();
}

/* ------------------------------------------------------------------ *
 *  Prepared statements
 * ------------------------------------------------------------------ */
const q = {
  allPlayers: db.prepare('SELECT * FROM players ORDER BY name COLLATE NOCASE'),
  playerByName: db.prepare('SELECT * FROM players WHERE name = ?'),
  playerById: db.prepare('SELECT * FROM players WHERE id = ?'),
  insertPlayer: db.prepare('INSERT INTO players (name) VALUES (?)'),
  updatePlayer: db.prepare('UPDATE players SET name = ? WHERE id = ?'),
  deletePlayer: db.prepare('DELETE FROM players WHERE id = ?'),

  getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
  setSetting: db.prepare(`INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`),

  activeMatch: db.prepare(`SELECT * FROM matches WHERE status = 'active' ORDER BY id DESC LIMIT 1`),
  matchById: db.prepare('SELECT * FROM matches WHERE id = ?'),
  insertMatch: db.prepare('INSERT INTO matches (max_points) VALUES (?)'),
  updateMatchMax: db.prepare('UPDATE matches SET max_points = ? WHERE id = ?'),
  finishMatch: db.prepare(`UPDATE matches SET status='finished', winner_id=?, loser_id=?, finished_at=datetime('now') WHERE id=?`),
  deleteMatch: db.prepare('DELETE FROM matches WHERE id = ?'),
  allMatches: db.prepare('SELECT * FROM matches ORDER BY id DESC'),

  insertMatchPlayer: db.prepare('INSERT INTO match_players (match_id, player_id, seat) VALUES (?, ?, ?)'),
  matchPlayers: db.prepare(`
    SELECT mp.player_id, mp.seat, p.name
    FROM match_players mp JOIN players p ON p.id = mp.player_id
    WHERE mp.match_id = ? ORDER BY mp.seat`),

  roundsForMatch: db.prepare('SELECT * FROM rounds WHERE match_id = ? ORDER BY round_number'),
  maxRoundNumber: db.prepare('SELECT COALESCE(MAX(round_number),0) AS n FROM rounds WHERE match_id = ?'),
  lastRound: db.prepare('SELECT * FROM rounds WHERE match_id = ? ORDER BY round_number DESC LIMIT 1'),
  insertRound: db.prepare('INSERT INTO rounds (match_id, round_number) VALUES (?, ?)'),
  roundById: db.prepare('SELECT * FROM rounds WHERE id = ?'),
  deleteRound: db.prepare('DELETE FROM rounds WHERE id = ?'),

  scoresForRound: db.prepare('SELECT * FROM round_scores WHERE round_id = ?'),
  upsertScore: db.prepare(`
    INSERT INTO round_scores (round_id, player_id, points, plus_two_count, plus_four_count)
    VALUES (@round_id, @player_id, @points, @plus_two_count, @plus_four_count)
    ON CONFLICT(round_id, player_id) DO UPDATE SET
      points = @points, plus_two_count = @plus_two_count, plus_four_count = @plus_four_count`),
  setRoundWinner: db.prepare('UPDATE rounds SET winner_id = ? WHERE id = ?'),
};

/* ------------------------------------------------------------------ *
 *  Hilfsfunktionen
 * ------------------------------------------------------------------ */

// Ob negative Punktewerte erlaubt sind (Default: nein).
function allowNegative() {
  return q.getSetting.get('allow_negative')?.value === 'true';
}

// Liefert komplette Match-Ansicht: Spieler, Runden, Scores, Summen.
function getMatchState(matchId) {
  const match = q.matchById.get(matchId);
  if (!match) return null;
  const players = q.matchPlayers.all(matchId);
  const rounds = q.roundsForMatch.all(matchId);

  const roundsFull = rounds.map((r) => {
    const scores = q.scoresForRound.all(r.id);
    const byPlayer = {};
    for (const s of scores) byPlayer[s.player_id] = s;
    return {
      id: r.id,
      round_number: r.round_number,
      winner_id: r.winner_id,
      scores: players.map((p) => {
        const s = byPlayer[p.player_id] || { points: 0, plus_two_count: 0, plus_four_count: 0 };
        return {
          player_id: p.player_id,
          points: s.points,
          plus_two_count: s.plus_two_count,
          plus_four_count: s.plus_four_count,
        };
      }),
    };
  });

  const totals = {};
  for (const p of players) totals[p.player_id] = 0;
  for (const r of roundsFull)
    for (const s of r.scores) totals[s.player_id] += s.points;

  return { match, players, rounds: roundsFull, totals };
}

// Bewertet ob das Punktemaximum erreicht wurde und wer Sieger/Verlierer wäre.
// Regel (vom Nutzer gewählt): niedrigste Punktzahl gewinnt.
function evaluateMatch(state) {
  const entries = Object.entries(state.totals).map(([id, pts]) => ({
    player_id: Number(id),
    points: pts,
  }));
  const reached = entries.some((e) => e.points >= state.match.max_points);
  if (!entries.length) return { reached: false };
  const sorted = [...entries].sort((a, b) => a.points - b.points);
  return {
    reached,
    winner_id: sorted[0].player_id,       // wenigste Punkte
    loser_id: sorted[sorted.length - 1].player_id, // meiste Punkte
  };
}

/* ------------------------------------------------------------------ *
 *  Auth-Routen
 * ------------------------------------------------------------------ */
app.post('/api/admin/login', (req, res) => {
  const { password } = req.body || {};
  if (password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: 'Falsches Passwort' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  adminSessions.add(token);
  res.cookie('admin_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 12,
  });
  res.json({ ok: true });
});

app.post('/api/admin/logout', (req, res) => {
  const token = req.cookies?.admin_session;
  if (token) adminSessions.delete(token);
  res.clearCookie('admin_session');
  res.json({ ok: true });
});

app.get('/api/admin/status', (req, res) => {
  res.json({ admin: isAdmin(req) });
});

/* ------------------------------------------------------------------ *
 *  Einstellungen
 * ------------------------------------------------------------------ */
// Öffentlich lesbar – das Frontend passt die Eingabefelder entsprechend an.
app.get('/api/settings', (req, res) => {
  res.json({ allow_negative: allowNegative() });
});

// Nur Admin darf ändern.
app.put('/api/admin/settings', requireAdmin, (req, res) => {
  if (typeof req.body?.allow_negative === 'boolean') {
    q.setSetting.run('allow_negative', req.body.allow_negative ? 'true' : 'false');
  }
  res.json({ allow_negative: allowNegative() });
});

/* ------------------------------------------------------------------ *
 *  Spieler
 * ------------------------------------------------------------------ */
app.get('/api/players', (req, res) => {
  res.json(q.allPlayers.all());
});

app.post('/api/players', requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  const existing = q.playerByName.get(name);
  if (existing) return res.json(existing);
  const info = q.insertPlayer.run(name);
  res.json(q.playerById.get(info.lastInsertRowid));
});

app.put('/api/players/:id', requireAdmin, (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'Name fehlt' });
  try {
    q.updatePlayer.run(name, req.params.id);
  } catch {
    return res.status(409).json({ error: 'Name bereits vergeben' });
  }
  res.json(q.playerById.get(req.params.id));
});

app.delete('/api/players/:id', requireAdmin, (req, res) => {
  q.deletePlayer.run(req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 *  Match: aktuelles Spiel
 * ------------------------------------------------------------------ */
app.get('/api/match/current', (req, res) => {
  const active = q.activeMatch.get();
  if (!active) return res.json(null);
  res.json(getMatchState(active.id));
});

// Neues Match starten: { maxPoints, players: ["Name", ...] }
app.post('/api/match', (req, res) => {
  const maxPoints = Number(req.body?.maxPoints);
  const names = Array.isArray(req.body?.players) ? req.body.players : [];
  if (!Number.isFinite(maxPoints) || maxPoints <= 0)
    return res.status(400).json({ error: 'Ungültiges Punktemaximum' });
  const cleanNames = names.map((n) => String(n).trim()).filter(Boolean);
  if (cleanNames.length < 2)
    return res.status(400).json({ error: 'Mindestens 2 Spieler nötig' });

  // Nur bereits vorhandene Spieler zulassen – Anlegen geschieht nur im Admin.
  const resolved = [];
  for (const name of cleanNames) {
    const player = q.playerByName.get(name);
    if (!player) {
      return res.status(400).json({ error: `Unbekannter Spieler „${name}“. Spieler müssen im Admin-Bereich angelegt werden.` });
    }
    resolved.push(player);
  }

  const start = db.transaction(() => {
    // Aktives Match beenden/löschen falls vorhanden? -> Wir lassen nur eines aktiv.
    const active = q.activeMatch.get();
    if (active) q.deleteMatch.run(active.id);

    const info = q.insertMatch.run(maxPoints);
    const matchId = info.lastInsertRowid;
    let seat = 0;
    for (const player of resolved) {
      q.insertMatchPlayer.run(matchId, player.id, seat++);
    }
    return matchId;
  });

  const matchId = start();
  res.json(getMatchState(matchId));
});

// Punktemaximum ändern (z.B. Spiel verlängern)
app.put('/api/match/:id/max', (req, res) => {
  const maxPoints = Number(req.body?.maxPoints);
  const match = q.matchById.get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match nicht gefunden' });
  if (!Number.isFinite(maxPoints) || maxPoints <= 0)
    return res.status(400).json({ error: 'Ungültiges Punktemaximum' });
  q.updateMatchMax.run(maxPoints, match.id);
  res.json(getMatchState(match.id));
});

// Match manuell beenden / abbrechen ohne Wertung
app.delete('/api/match/:id', (req, res) => {
  q.deleteMatch.run(req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 *  Runden & Scores
 * ------------------------------------------------------------------ */

// Neue leere Runde anlegen
app.post('/api/match/:id/rounds', (req, res) => {
  const match = q.matchById.get(req.params.id);
  if (!match) return res.status(404).json({ error: 'Match nicht gefunden' });
  // Erst wenn die letzte Runde einen Gewinner hat, darf eine neue beginnen.
  const last = q.lastRound.get(match.id);
  if (last && !last.winner_id) {
    return res.status(400).json({ error: 'Die aktuelle Runde hat noch keinen Gewinner (👑).' });
  }
  const next = q.maxRoundNumber.get(match.id).n + 1;
  const info = q.insertRound.run(match.id, next);
  res.json({ id: info.lastInsertRowid, round_number: next });
});

// Runde löschen
app.delete('/api/rounds/:id', (req, res) => {
  q.deleteRound.run(req.params.id);
  res.json({ ok: true });
});

// Scores einer Runde speichern:
// { scores: [{ player_id, points, plus_two_count, plus_four_count }, ...] }
app.put('/api/rounds/:id/scores', (req, res) => {
  const round = q.roundById.get(req.params.id);
  if (!round) return res.status(404).json({ error: 'Runde nicht gefunden' });
  const scores = Array.isArray(req.body?.scores) ? req.body.scores : [];
  const negAllowed = allowNegative();
  // Negative Punkte nur zulassen, wenn im Admin aktiviert.
  if (!negAllowed && scores.some((s) => Math.trunc(Number(s.points) || 0) < 0)) {
    return res.status(400).json({ error: 'Negative Punkte sind nicht erlaubt.' });
  }
  const save = db.transaction(() => {
    for (const s of scores) {
      let points = Math.trunc(Number(s.points) || 0);
      if (!negAllowed) points = Math.max(0, points);
      q.upsertScore.run({
        round_id: round.id,
        player_id: Number(s.player_id),
        points,
        plus_two_count: Math.max(0, Math.trunc(Number(s.plus_two_count) || 0)),
        plus_four_count: Math.max(0, Math.trunc(Number(s.plus_four_count) || 0)),
      });
    }
  });
  save();
  res.json(getMatchState(round.match_id));
});

// Rundengewinner setzen (wer hat die Runde "ausgemacht"). null = keiner.
app.put('/api/rounds/:id/winner', (req, res) => {
  const round = q.roundById.get(req.params.id);
  if (!round) return res.status(404).json({ error: 'Runde nicht gefunden' });
  const winnerId = req.body?.winner_id ? Number(req.body.winner_id) : null;
  q.setRoundWinner.run(winnerId, round.id);
  res.json(getMatchState(round.match_id));
});

// Match auswerten (prüfen ob Ende erreicht)
app.get('/api/match/:id/evaluate', (req, res) => {
  const state = getMatchState(Number(req.params.id));
  if (!state) return res.status(404).json({ error: 'Match nicht gefunden' });
  res.json(evaluateMatch(state));
});

// Match abschließen und Sieger/Verlierer festschreiben
app.post('/api/match/:id/finish', (req, res) => {
  const state = getMatchState(Number(req.params.id));
  if (!state) return res.status(404).json({ error: 'Match nicht gefunden' });
  const result = evaluateMatch(state);
  q.finishMatch.run(result.winner_id, result.loser_id, state.match.id);
  res.json({ ok: true, ...result });
});

/* ------------------------------------------------------------------ *
 *  Statistiken (permanent über alle abgeschlossenen Matches)
 * ------------------------------------------------------------------ */
app.get('/api/stats', (req, res) => {
  const players = q.allPlayers.all();

  const wins = db.prepare(`SELECT winner_id AS pid, COUNT(*) c FROM matches WHERE status='finished' AND winner_id IS NOT NULL GROUP BY winner_id`).all();
  const losses = db.prepare(`SELECT loser_id AS pid, COUNT(*) c FROM matches WHERE status='finished' AND loser_id IS NOT NULL GROUP BY loser_id`).all();

  // Karten- und Punktesummen über round_scores
  const cards = db.prepare(`
    SELECT player_id AS pid,
           SUM(plus_two_count)  AS p2,
           SUM(plus_four_count) AS p4,
           SUM(points)          AS pts,
           COUNT(DISTINCT round_id) AS rounds
    FROM round_scores GROUP BY player_id`).all();

  // Anzahl gespielter Matches je Spieler (nur abgeschlossene)
  const played = db.prepare(`
    SELECT mp.player_id AS pid, COUNT(*) c
    FROM match_players mp JOIN matches m ON m.id = mp.match_id
    WHERE m.status='finished' GROUP BY mp.player_id`).all();

  // Gewonnene Runden (wer die Runde "ausgemacht" hat), über alle Matches
  const roundWins = db.prepare(`
    SELECT winner_id AS pid, COUNT(*) c
    FROM rounds WHERE winner_id IS NOT NULL GROUP BY winner_id`).all();

  const map = (rows) => Object.fromEntries(rows.map((r) => [r.pid, r]));
  const w = map(wins), l = map(losses), c = map(cards), pl = map(played), rw = map(roundWins);

  const stats = players.map((p) => {
    const cc = c[p.id] || {};
    return {
      id: p.id,
      name: p.name,
      wins: w[p.id]?.c || 0,
      losses: l[p.id]?.c || 0,
      matches_played: pl[p.id]?.c || 0,
      round_wins: rw[p.id]?.c || 0,
      plus_two_total: cc.p2 || 0,
      plus_four_total: cc.p4 || 0,
      points_total: cc.pts || 0,
      rounds_played: cc.rounds || 0,
    };
  });

  // Gesamtsummen über alle Spiele (keine Doppelzählung durch Spieler)
  const totalMatches = db.prepare(`SELECT COUNT(*) c FROM matches WHERE status='finished'`).get().c;
  const totalRounds = db.prepare(`
    SELECT COUNT(*) c FROM rounds r
    JOIN matches m ON m.id = r.match_id
    WHERE m.status='finished'`).get().c;

  res.json({ players: stats, totals: { matches: totalMatches, rounds: totalRounds } });
});

// Match-Historie (Liste abgeschlossener Spiele mit Sieger/Verlierer-Namen)
app.get('/api/history', (req, res) => {
  const rows = db.prepare(`
    SELECT m.*, w.name AS winner_name, lo.name AS loser_name
    FROM matches m
    LEFT JOIN players w  ON w.id  = m.winner_id
    LEFT JOIN players lo ON lo.id = m.loser_id
    WHERE m.status='finished'
    ORDER BY m.finished_at DESC`).all();
  res.json(rows);
});

// Kalenderübersicht: an welchen Tagen wurde gespielt und wie viele Spiele.
// Gruppiert nach lokalem Datum (finished_at ist UTC -> 'localtime').
app.get('/api/stats/calendar', (req, res) => {
  const rows = db.prepare(`
    SELECT date(finished_at, 'localtime') AS day, COUNT(*) AS matches
    FROM matches
    WHERE status='finished' AND finished_at IS NOT NULL
    GROUP BY day
    ORDER BY day`).all();
  res.json(rows);
});

// Tagesstatistik: aggregierte Werte aller Spiele eines bestimmten Tages (YYYY-MM-DD).
app.get('/api/stats/day/:day', (req, res) => {
  const day = String(req.params.day);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    return res.status(400).json({ error: 'Ungültiges Datum' });

  // Spiele des Tages
  const matches = db.prepare(`
    SELECT m.id, m.max_points, m.finished_at,
           w.name AS winner_name, lo.name AS loser_name
    FROM matches m
    LEFT JOIN players w  ON w.id  = m.winner_id
    LEFT JOIN players lo ON lo.id = m.loser_id
    WHERE m.status='finished' AND date(m.finished_at, 'localtime') = ?
    ORDER BY m.finished_at`).all(day);

  const matchIds = matches.map((m) => m.id);
  if (!matchIds.length) return res.json({ day, matches: [], players: [] });
  const placeholders = matchIds.map(() => '?').join(',');

  // Match-Siege/Niederlagen des Tages
  const wins = db.prepare(`SELECT winner_id AS pid, COUNT(*) c FROM matches WHERE id IN (${placeholders}) AND winner_id IS NOT NULL GROUP BY winner_id`).all(...matchIds);
  const losses = db.prepare(`SELECT loser_id AS pid, COUNT(*) c FROM matches WHERE id IN (${placeholders}) AND loser_id IS NOT NULL GROUP BY loser_id`).all(...matchIds);

  // Runden-Werte des Tages (nur Runden aus diesen Matches)
  const cards = db.prepare(`
    SELECT rs.player_id AS pid,
           SUM(rs.plus_two_count)  AS p2,
           SUM(rs.plus_four_count) AS p4,
           SUM(rs.points)          AS pts
    FROM round_scores rs
    JOIN rounds r ON r.id = rs.round_id
    WHERE r.match_id IN (${placeholders})
    GROUP BY rs.player_id`).all(...matchIds);

  const roundWins = db.prepare(`
    SELECT winner_id AS pid, COUNT(*) c
    FROM rounds WHERE match_id IN (${placeholders}) AND winner_id IS NOT NULL
    GROUP BY winner_id`).all(...matchIds);

  const map = (rows) => Object.fromEntries(rows.map((r) => [r.pid, r]));
  const w = map(wins), l = map(losses), c = map(cards), rw = map(roundWins);

  // Beteiligte Spieler bestimmen
  const pids = new Set([
    ...wins.map((r) => r.pid), ...losses.map((r) => r.pid),
    ...cards.map((r) => r.pid), ...roundWins.map((r) => r.pid),
  ].filter(Boolean));

  const players = [...pids].map((pid) => {
    const p = q.playerById.get(pid);
    const cc = c[pid] || {};
    return {
      id: pid,
      name: p?.name || '(gelöscht)',
      wins: w[pid]?.c || 0,
      losses: l[pid]?.c || 0,
      round_wins: rw[pid]?.c || 0,
      plus_two_total: cc.p2 || 0,
      plus_four_total: cc.p4 || 0,
      points_total: cc.pts || 0,
    };
  }).sort((a, b) => b.wins - a.wins || b.round_wins - a.round_wins || a.name.localeCompare(b.name));

  res.json({ day, matches, players });
});

/* ------------------------------------------------------------------ *
 *  Admin: Verwaltung
 * ------------------------------------------------------------------ */
app.get('/api/admin/matches', requireAdmin, (req, res) => {
  res.json(q.allMatches.all());
});

app.delete('/api/admin/matches/:id', requireAdmin, (req, res) => {
  q.deleteMatch.run(req.params.id);
  res.json({ ok: true });
});

// ALLE Statistiken/Spiele löschen (Spieler bleiben erhalten).
// Löscht Matches inkl. abhängiger Runden/Scores per ON DELETE CASCADE.
app.delete('/api/admin/stats', requireAdmin, (req, res) => {
  db.prepare('DELETE FROM matches').run();
  res.json({ ok: true });
});

// Sieger/Verlierer eines Matches manuell korrigieren
app.put('/api/admin/matches/:id', requireAdmin, (req, res) => {
  const { winner_id, loser_id } = req.body || {};
  db.prepare('UPDATE matches SET winner_id = ?, loser_id = ? WHERE id = ?')
    .run(winner_id || null, loser_id || null, req.params.id);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ *
 *  Static + Start
 * ------------------------------------------------------------------ */
app.use(express.static(PUBLIC_DIR));

app.listen(PORT, () => {
  console.log(`UNO Scoreboard läuft auf Port ${PORT}`);
});
