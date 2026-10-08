import { api, el, renderNav } from './common.js';

const app = document.getElementById('app');
renderNav('stats');

init();

async function init() {
  let statsResp, history;
  try {
    [statsResp, history] = await Promise.all([api('/api/stats'), api('/api/history')]);
  } catch (e) {
    app.textContent = 'Fehler: ' + e.message;
    return;
  }
  const stats = statsResp.players || [];
  const totals = statsResp.totals || { matches: 0, rounds: 0 };
  app.innerHTML = '';

  if (!stats.length) {
    app.append(el('div', { class: 'card' }, el('p', { class: 'muted' }, 'Noch keine Statistiken vorhanden. Spiele ein paar Runden!')));
    return;
  }

  // Gesamt-Kacheln (über alle Spiele)
  const totalGrid = el('div', { class: 'stat-grid' });
  totalGrid.append(
    tile('Gespielte Spiele (gesamt)', { name: String(totals.matches), value: '' }),
    tile('Gespielte Runden (gesamt)', { name: String(totals.rounds), value: '' }),
  );

  // Highlight-Kacheln
  const tiles = el('div', { class: 'stat-grid' });
  tiles.append(
    tile('Meiste Siege', top(stats, 'wins')),
    tile('Meiste Niederlagen', top(stats, 'losses')),
    tile('Meiste Runden gewonnen', top(stats, 'round_wins')),
    tile('Meiste +4 Karten', top(stats, 'plus_four_total')),
    tile('Meiste +2 Karten', top(stats, 'plus_two_total')),
    tile('Meiste Punkte gesamt', top(stats, 'points_total')),
    tile('Meiste Spiele gespielt', top(stats, 'matches_played')),
  );
  const tileCard = el('div', { class: 'card' });
  tileCard.append(el('h1', {}, 'Bestenlisten'));
  tileCard.append(totalGrid);
  tileCard.append(el('h2', { style: 'margin-top:18px' }, 'Rekorde'));
  tileCard.append(tiles);
  app.append(tileCard);

  // Detailtabelle
  const tableCard = el('div', { class: 'card table-wrap' });
  tableCard.append(el('h2', {}, 'Alle Spieler'));
  const table = el('table', { class: 'data' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Spieler'),
    el('th', {}, 'Siege'),
    el('th', {}, 'Niederlagen'),
    el('th', {}, 'Spiele'),
    el('th', {}, 'Runden'),
    el('th', {}, 'Runden gew.'),
    el('th', {}, '+2 gesamt'),
    el('th', {}, '+4 gesamt'),
    el('th', {}, 'Punkte gesamt'),
  )));
  const tbody = el('tbody');
  for (const s of [...stats].sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name))) {
    tbody.append(el('tr', {},
      el('td', {}, el('strong', {}, s.name)),
      el('td', {}, String(s.wins)),
      el('td', {}, String(s.losses)),
      el('td', {}, String(s.matches_played)),
      el('td', {}, String(s.rounds_played)),
      el('td', {}, String(s.round_wins)),
      el('td', { class: 'badge2' }, String(s.plus_two_total)),
      el('td', { class: 'badge4' }, String(s.plus_four_total)),
      el('td', {}, String(s.points_total)),
    ));
  }
  table.append(tbody);
  tableCard.append(table);
  app.append(tableCard);

  // Match-Historie
  const histCard = el('div', { class: 'card table-wrap' });
  histCard.append(el('h2', {}, 'Spielverlauf'));
  if (!history.length) {
    histCard.append(el('p', { class: 'muted' }, 'Noch keine abgeschlossenen Spiele.'));
  } else {
    const ht = el('table', { class: 'data' });
    ht.append(el('thead', {}, el('tr', {},
      el('th', {}, 'Datum'),
      el('th', {}, 'Max. Punkte'),
      el('th', {}, 'Sieger'),
      el('th', {}, 'Verlierer'),
    )));
    const hb = el('tbody');
    for (const m of history) {
      hb.append(el('tr', {},
        el('td', {}, fmtDate(m.finished_at)),
        el('td', {}, String(m.max_points)),
        el('td', {}, el('span', { class: 'pill win' }, m.winner_name || '—')),
        el('td', {}, el('span', { class: 'pill lose' }, m.loser_name || '—')),
      ));
    }
    ht.append(hb);
    histCard.append(ht);
  }
  app.append(histCard);

  // --- Kalenderübersicht + Tagesstatistik ---
  await renderCalendarSection();
}

async function renderCalendarSection() {
  let days = [];
  try { days = await api('/api/stats/calendar'); } catch { return; }
  if (!days.length) return;

  const card = el('div', { class: 'card' });
  card.append(el('h2', {}, 'Spieltage-Kalender'));
  card.append(el('p', { class: 'muted' }, 'Tage mit Spielen. Zahl = Anzahl Spiele. Klicke einen Tag für die Tagesstatistik.'));

  const byDay = Object.fromEntries(days.map((d) => [d.day, d.matches]));

  // Monate bestimmen (vom ersten bis letzten Spieltag)
  const first = days[0].day, last = days[days.length - 1].day;
  const months = monthRange(first, last);

  const calWrap = el('div', { class: 'cal-wrap' });
  const dayPanel = el('div', { class: 'card day-panel' });
  dayPanel.append(el('p', { class: 'muted' }, 'Wähle oben einen Spieltag aus.'));

  const selectDay = async (day) => {
    for (const b of calWrap.querySelectorAll('.cal-day.has-games'))
      b.classList.toggle('selected', b.dataset.day === day);
    await renderDay(day, dayPanel);
  };

  for (const m of months) calWrap.append(renderMonth(m, byDay, selectDay));
  card.append(calWrap);
  app.append(card);
  app.append(dayPanel);

  // Neuesten Spieltag direkt anzeigen
  selectDay(last);
}

// Liste "YYYY-MM" von first..last (inklusive)
function monthRange(first, last) {
  const [fy, fm] = first.split('-').map(Number);
  const [ly, lm] = last.split('-').map(Number);
  const out = [];
  let y = fy, mo = fm;
  while (y < ly || (y === ly && mo <= lm)) {
    out.push(`${y}-${String(mo).padStart(2, '0')}`);
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return out;
}

function renderMonth(ym, byDay, onSelect) {
  const [y, m] = ym.split('-').map(Number);
  const monthName = new Date(y, m - 1, 1).toLocaleString('de-DE', { month: 'long', year: 'numeric' });
  const grid = el('div', { class: 'cal-month' });
  grid.append(el('div', { class: 'cal-title' }, monthName));

  const dow = el('div', { class: 'cal-grid' });
  for (const d of ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'])
    dow.append(el('div', { class: 'cal-dow' }, d));

  // Offset: Wochentag des 1. (Mo=0)
  const firstDow = (new Date(y, m - 1, 1).getDay() + 6) % 7;
  for (let i = 0; i < firstDow; i++) dow.append(el('div', { class: 'cal-day empty' }));

  const daysInMonth = new Date(y, m, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const count = byDay[key];
    if (count) {
      const cell = el('div', {
        class: 'cal-day has-games',
        'data-day': key,
        title: `${count} Spiel${count === 1 ? '' : 'e'}`,
        onClick: () => onSelect(key),
      }, el('span', { class: 'cd-num' }, String(d)), el('span', { class: 'cd-badge' }, String(count)));
      dow.append(cell);
    } else {
      dow.append(el('div', { class: 'cal-day' }, String(d)));
    }
  }
  grid.append(dow);
  return grid;
}

async function renderDay(day, panel) {
  panel.innerHTML = '';
  let data;
  try { data = await api('/api/stats/day/' + day); } catch (e) { panel.append(el('p', {}, 'Fehler: ' + e.message)); return; }

  const title = new Date(day + 'T00:00').toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  panel.append(el('h2', {}, 'Tagesstatistik · ' + title));

  if (!data.matches.length) {
    panel.append(el('p', { class: 'muted' }, 'Keine Spiele an diesem Tag.'));
    return;
  }

  // Kacheln: Anzahl Spiele + Tagessieger (meiste Match-Siege)
  const tiles = el('div', { class: 'stat-grid' });
  tiles.append(tile('Spiele an diesem Tag', { name: String(data.matches.length), value: '' }));
  tiles.append(tile('Tagessieger', top(data.players, 'wins')));
  tiles.append(tile('Meiste Runden gewonnen', top(data.players, 'round_wins')));
  tiles.append(tile('Meiste +4 Karten', top(data.players, 'plus_four_total')));
  panel.append(tiles);

  // Spieler-Tabelle des Tages – nach Platz (Siege absteigend, dann Rundensiege)
  const ranked = [...data.players].sort((a, b) =>
    b.wins - a.wins || b.round_wins - a.round_wins || a.points_total - b.points_total || a.name.localeCompare(b.name));
  const table = el('table', { class: 'data' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Platz'), el('th', {}, 'Spieler'), el('th', {}, 'Siege'), el('th', {}, 'Niederlagen'),
    el('th', {}, 'Runden gew.'), el('th', {}, '+2'), el('th', {}, '+4'), el('th', {}, 'Punkte'))));
  const tb = el('tbody');
  ranked.forEach((p, i) => {
    const medal = ['🥇', '🥈', '🥉'][i] || '';
    tb.append(el('tr', {},
      el('td', { class: 'rank' }, medal ? `${medal} ${i + 1}` : String(i + 1)),
      el('td', {}, el('strong', {}, p.name)),
      el('td', {}, String(p.wins)),
      el('td', {}, String(p.losses)),
      el('td', {}, String(p.round_wins)),
      el('td', { class: 'badge2' }, String(p.plus_two_total)),
      el('td', { class: 'badge4' }, String(p.plus_four_total)),
      el('td', {}, String(p.points_total)),
    ));
  });
  table.append(tb);
  panel.append(el('div', { class: 'table-wrap' }, table));

  // Spiele des Tages
  const ml = el('table', { class: 'data', style: 'margin-top:16px' });
  ml.append(el('thead', {}, el('tr', {},
    el('th', {}, 'Uhrzeit'), el('th', {}, 'Max.'), el('th', {}, 'Sieger'), el('th', {}, 'Verlierer'))));
  const mb = el('tbody');
  for (const m of data.matches) {
    mb.append(el('tr', {},
      el('td', {}, fmtTime(m.finished_at)),
      el('td', {}, String(m.max_points)),
      el('td', {}, el('span', { class: 'pill win' }, m.winner_name || '—')),
      el('td', {}, el('span', { class: 'pill lose' }, m.loser_name || '—')),
    ));
  }
  ml.append(mb);
  panel.append(el('div', { class: 'table-wrap' }, ml));
}

function fmtTime(s) {
  if (!s) return '—';
  return new Date(s.replace(' ', 'T') + 'Z').toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function top(stats, key) {
  const sorted = [...stats].sort((a, b) => b[key] - a[key]);
  const best = sorted[0];
  if (!best || best[key] === 0) return { name: '—', value: 0 };
  return { name: best.name, value: best[key] };
}

function tile(label, { name, value }) {
  return el('div', { class: 'stat-tile' },
    el('div', { class: 'label' }, label),
    el('div', { class: 'value' }, name),
    el('div', { class: 'sub' }, `${value}`),
  );
}

function fmtDate(s) {
  if (!s) return '—';
  const d = new Date(s.replace(' ', 'T') + 'Z');
  return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}
