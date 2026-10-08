import { api, el, toast, renderNav } from './common.js';

const app = document.getElementById('app');
renderNav('game');

let state = null;      // aktuelles Match (getMatchState-Ausgabe)
let allPlayers = [];   // alle bekannten Spieler
let saveTimers = {};   // Debounce je Runde
let allowNegative = false; // ob negative Punkte erlaubt sind (Admin-Setting)

init();

async function init() {
  try {
    const [players, current, settings] = await Promise.all([
      api('/api/players'),
      api('/api/match/current'),
      api('/api/settings'),
    ]);
    allPlayers = players;
    state = current;
    allowNegative = !!settings.allow_negative;
  } catch (e) {
    app.textContent = 'Verbindungsfehler: ' + e.message;
    return;
  }
  if (state) renderScoreboard();
  else renderSetup();
}

/* ================================================================== *
 *  SETUP: Spieler & Punktemaximum wählen
 * ================================================================== */
function renderSetup() {
  app.innerHTML = '';
  const selected = []; // Namen in Reihenfolge

  const card = el('div', { class: 'card' });
  card.append(el('h1', {}, 'Neues Spiel'));

  // --- Vorhandene Spieler als Chips ---
  card.append(el('label', {}, 'Spieler auswählen'));
  const chips = el('div', { class: 'chips' });
  card.append(chips);
  // Hinweis: neue Spieler werden ausschließlich im Admin-Bereich angelegt.
  card.append(el('p', { class: 'muted' },
    'Spieler werden im ', el('a', { href: 'admin.html' }, 'Admin-Bereich'), ' angelegt oder gelöscht.'));

  // --- Gewählte Spieler (Reihenfolge) ---
  card.append(el('label', {}, 'Mitspieler in Reihenfolge'));
  const selList = el('div', { class: 'selected-players' });
  card.append(selList);

  // --- Punktemaximum ---
  card.append(el('label', {}, 'Spiel endet bei (Punktemaximum)'));
  const maxRow = el('div', { class: 'row' });
  const maxInput = el('input', { type: 'number', value: '500', min: '1', class: 'grow' });
  maxRow.append(maxInput);
  for (const v of [300, 500, 1000]) {
    maxRow.append(el('button', {
      class: 'secondary',
      onClick: () => { maxInput.value = v; },
    }, String(v)));
  }
  card.append(maxRow);

  const startBtn = el('button', { class: 'success', style: 'margin-top:18px;font-size:19px;padding:16px' }, '▶ Spiel starten');
  card.append(startBtn);
  app.append(card);

  function refreshChips() {
    chips.innerHTML = '';
    for (const p of allPlayers) {
      const isSel = selected.includes(p.name);
      chips.append(el('div', {
        class: 'chip' + (isSel ? ' selected' : ''),
        onClick: () => {
          if (isSel) selected.splice(selected.indexOf(p.name), 1);
          else selected.push(p.name);
          refresh();
        },
      }, p.name));
    }
    if (!allPlayers.length) chips.append(el('span', { class: 'muted' }, 'Noch keine Spieler vorhanden – bitte im Admin-Bereich anlegen.'));
  }

  function refreshSelected() {
    selList.innerHTML = '';
    selected.forEach((name, i) => {
      selList.append(el('div', { class: 'sp' },
        el('span', { class: 'num' }, `${i + 1}.`),
        el('span', { class: 'name' }, name),
        el('button', { class: 'ghost', onClick: () => { moveUp(i); } }, '↑'),
        el('button', { class: 'ghost', onClick: () => { moveDown(i); } }, '↓'),
        el('button', { class: 'danger', onClick: () => { selected.splice(i, 1); refresh(); } }, '✕'),
      ));
    });
    if (!selected.length) selList.append(el('span', { class: 'muted' }, 'Noch niemand gewählt.'));
  }

  function moveUp(i) { if (i > 0) { [selected[i-1], selected[i]] = [selected[i], selected[i-1]]; refresh(); } }
  function moveDown(i) { if (i < selected.length-1) { [selected[i+1], selected[i]] = [selected[i], selected[i+1]]; refresh(); } }
  function refresh() { refreshChips(); refreshSelected(); }

  startBtn.addEventListener('click', async () => {
    const maxPoints = Number(maxInput.value);
    if (selected.length < 2) return toast('Mindestens 2 Spieler wählen');
    if (!maxPoints || maxPoints <= 0) return toast('Punktemaximum ungültig');
    try {
      state = await api('/api/match', { method: 'POST', body: { maxPoints, players: selected } });
      renderScoreboard();
    } catch (e) { toast(e.message); }
  });

  refresh();
}

/* ================================================================== *
 *  SCOREBOARD
 * ================================================================== */
function renderScoreboard() {
  app.innerHTML = '';
  const { match, players, rounds, totals } = state;

  // Kopfleiste – aktives Spiel farblich hervorgehoben
  const head = el('div', { class: 'card active-game' });
  const headRow = el('div', { class: 'row' });
  headRow.append(el('h1', { class: 'grow' },
    el('span', { class: 'live-dot', title: 'Spiel läuft' }),
    `Spiel läuft · Ende bei ${match.max_points} Punkten`));
  // "+ Neue Runde" nur möglich, wenn die letzte Runde einen Gewinner hat.
  const lastRound = rounds[rounds.length - 1];
  const needsWinner = lastRound && !lastRound.winner_id;
  const addBtn = el('button', {
    class: 'success' + (needsWinner ? ' disabled' : ''),
    title: needsWinner ? 'Zuerst Gewinner der aktuellen Runde markieren' : '',
    onClick: addRound,
  }, '+ Neue Runde');
  headRow.append(addBtn);
  headRow.append(el('button', { class: 'danger', onClick: abortMatch }, 'Spiel abbrechen'));
  head.append(headRow);
  head.append(el('p', { class: 'muted' }, 'Niedrigste Punktzahl gewinnt. 🃏 = Geber der aktuellen Runde (wechselt reihum). Trage pro Runde die Kartenpunkte ein und markiere mit 👑, wer die Runde ausgemacht hat.'));
  app.append(head);

  // Tabelle – bei vielen Spielern kompakter darstellen, um Scrollen zu vermeiden.
  const wrap = el('div', { class: 'card table-wrap' });
  const compactClass = players.length >= 5 ? ' compact' : '';
  const table = el('table', { class: 'scoreboard' + compactClass });

  // Kopf: Spielernamen + Gesamt + Counter
  const thead = el('thead');
  const trHead = el('tr');
  trHead.append(el('th', {}, 'Runde'));
  const leaderId = leadingPlayer(totals);
  const dealerId = currentDealerId();
  for (const p of players) {
    const isLeader = p.player_id === leaderId;
    const isDealer = p.player_id === dealerId;
    trHead.append(el('th', {},
      el('div', { class: 'player-head' },
        el('div', { class: 'pname-row' },
          isDealer ? el('span', { class: 'dealer', title: 'Gibt die aktuelle Runde' }, '🃏') : null,
          el('span', { class: 'pname' + (isLeader ? ' leader' : '') }, p.name),
        ),
        el('div', { class: 'ptotal' }, String(totals[p.player_id] ?? 0)),
        el('div', { class: 'counter-group' },
          counterEl(p.player_id, 'plus_two_count', '+2', 'badge2'),
          counterEl(p.player_id, 'plus_four_count', '+4', 'badge4'),
        ),
      ),
    ));
  }
  trHead.append(el('th', {}, ''));
  thead.append(trHead);
  table.append(thead);

  // Körper: eine Zeile je Runde
  const tbody = el('tbody');
  for (const r of rounds) {
    const tr = el('tr');
    tr.append(el('td', { class: 'round-label' }, `#${r.round_number}`));
    for (const p of players) {
      const sc = r.scores.find((s) => s.player_id === p.player_id);
      const input = el('input', {
        type: 'number',
        // Ziffernblock; Minus nur wenn negative Werte erlaubt sind.
        inputmode: allowNegative ? 'numeric' : 'numeric',
        class: 'score-input',
        value: String(sc?.points ?? 0),
        min: allowNegative ? null : '0',
      });
      // Beim Fokussieren eine alleinstehende 0 leeren, damit man nicht
      // erst löschen muss; sonst Inhalt markieren (Desktop). iPad-tauglich.
      input.addEventListener('focus', () => {
        if (input.value === '0') input.value = '';
        else input.select();
      });
      // Verlässt man ein leeres Feld, wieder auf 0 setzen; negative Werte
      // bei deaktivierter Option auf 0 klemmen.
      input.addEventListener('blur', () => {
        if (input.value.trim() === '') { input.value = '0'; scheduleSave(r.id); }
        else if (!allowNegative && Number(input.value) < 0) {
          input.value = '0'; scheduleSave(r.id);
          toast('Negative Punkte sind nicht erlaubt.');
        }
      });
      input.addEventListener('change', () => scheduleSave(r.id));
      input.dataset.round = r.id;
      input.dataset.player = p.player_id;
      input.dataset.field = 'points';

      const isWinner = r.winner_id === p.player_id;
      // Krone: markiert wer die Runde ausgemacht hat. Erneuter Klick hebt auf.
      const crown = el('button', {
        class: 'crown' + (isWinner ? ' active' : ''),
        title: isWinner ? 'Rundengewinner (Klick zum Aufheben)' : 'Als Rundengewinner markieren',
        onClick: () => setRoundWinner(r.id, isWinner ? null : p.player_id),
      }, '👑');

      tr.append(el('td', { class: isWinner ? 'round-cell winner-cell' : 'round-cell' },
        input, crown));
    }
    tr.append(el('td', { class: 'rowmenu' },
      el('button', { class: 'danger', onClick: () => deleteRound(r.id) }, '🗑')));
    tbody.append(tr);
  }
  table.append(tbody);

  // Fuß: Gesamtsummen
  const tfoot = el('tfoot');
  const trTot = el('tr', { class: 'totals-row' });
  trTot.append(el('td', {}, 'Gesamt'));
  for (const p of players) {
    const isLeader = p.player_id === leaderId;
    trTot.append(el('td', { class: isLeader ? 'leader' : '' }, String(totals[p.player_id] ?? 0)));
  }
  trTot.append(el('td', {}, ''));
  tfoot.append(trTot);
  table.append(tfoot);

  wrap.append(table);
  if (!rounds.length) wrap.append(el('p', { class: 'muted' }, 'Noch keine Runde. Klicke „+ Neue Runde“.'));
  app.append(wrap);

  maybePromptEnd();
}

// Zelle mit Score-Input in Zeile hängen
function td_cell(tr, input) {
  tr.append(el('td', {}, input));
}

// +2/+4-Counter unter dem Namen (mit +/- Buttons)
function counterEl(playerId, field, label, cls) {
  const valSpan = el('span', { class: 'cval ' + cls });
  const update = () => {
    valSpan.textContent = String(cardCount(playerId, field));
  };
  update();
  return el('div', { class: 'counter' },
    el('span', { class: cls }, label),
    el('button', { class: 'cbtn danger', onClick: () => adjustCard(playerId, field, -1, update) }, '−'),
    valSpan,
    el('button', { class: 'cbtn success', onClick: () => adjustCard(playerId, field, +1, update) }, '+'),
  );
}

// Summe der +2/+4 über alle Runden (im aktuellen Match)
function cardCount(playerId, field) {
  let sum = 0;
  for (const r of state.rounds) {
    const s = r.scores.find((x) => x.player_id === playerId);
    if (s) sum += s[field] || 0;
  }
  return sum;
}

// +2/+4 anpassen: schreibt in die zuletzt angelegte Runde.
async function adjustCard(playerId, field, delta, updateFn) {
  if (!state.rounds.length) {
    toast('Erst eine Runde anlegen');
    return;
  }
  const round = state.rounds[state.rounds.length - 1];
  const sc = round.scores.find((s) => s.player_id === playerId);
  const current = sc?.[field] || 0;
  const next = Math.max(0, current + delta);
  if (sc) sc[field] = next; else round.scores.push({ player_id: playerId, points: 0, plus_two_count: 0, plus_four_count: 0, [field]: next });
  updateFn();
  await saveRound(round.id);
}

function leadingPlayer(totals) {
  // Führender = wenigste Punkte (nur wenn schon Runden gespielt)
  const entries = Object.entries(totals);
  if (!entries.length || !state.rounds.length) return null;
  return Number(entries.sort((a, b) => a[1] - b[1])[0][0]);
}

// Geber der aktuellen Runde: startet beim ersten Spieler (Sitz 0) und
// wechselt pro Runde reihum weiter. Ohne Runde gibt der erste Spieler.
function currentDealerId() {
  const players = state.players; // bereits nach Sitz sortiert
  if (!players.length) return null;
  const roundNo = state.rounds.length ? state.rounds[state.rounds.length - 1].round_number : 1;
  const idx = (roundNo - 1) % players.length;
  return players[idx].player_id;
}

/* ---------- Aktionen ---------- */
async function addRound() {
  // Keine neue Runde, solange die letzte Runde noch keinen Gewinner hat.
  const last = state.rounds[state.rounds.length - 1];
  if (last && !last.winner_id) {
    toast('Bitte zuerst mit 👑 den Gewinner der aktuellen Runde markieren.');
    return;
  }
  try {
    await api(`/api/match/${state.match.id}/rounds`, { method: 'POST' });
    state = await api('/api/match/current');
    renderScoreboard();
  } catch (e) { toast(e.message); }
}

async function deleteRound(roundId) {
  if (!confirm('Diese Runde wirklich löschen?')) return;
  try {
    await api(`/api/rounds/${roundId}`, { method: 'DELETE' });
    state = await api('/api/match/current');
    renderScoreboard();
  } catch (e) { toast(e.message); }
}

// Rundengewinner markieren/aufheben (wer hat die Runde ausgemacht).
async function setRoundWinner(roundId, playerId) {
  try {
    state = await api(`/api/rounds/${roundId}/winner`, { method: 'PUT', body: { winner_id: playerId } });
    renderScoreboard();
  } catch (e) { toast(e.message); }
}

function scheduleSave(roundId) {
  clearTimeout(saveTimers[roundId]);
  saveTimers[roundId] = setTimeout(() => saveRound(roundId, true), 400);
}

// Runde speichern. rerender=true aktualisiert Summen (nach Punkteingabe).
async function saveRound(roundId, rerender = false) {
  const inputs = document.querySelectorAll(`input.score-input[data-round="${roundId}"]`);
  const round = state.rounds.find((r) => r.id === roundId);
  const byPlayer = {};
  for (const s of round.scores) byPlayer[s.player_id] = { ...s };
  for (const inp of inputs) {
    const pid = Number(inp.dataset.player);
    byPlayer[pid] = byPlayer[pid] || { player_id: pid, points: 0, plus_two_count: 0, plus_four_count: 0 };
    byPlayer[pid].points = Math.trunc(Number(inp.value) || 0);
  }
  const scores = Object.values(byPlayer);
  try {
    state = await api(`/api/rounds/${roundId}/scores`, { method: 'PUT', body: { scores } });
    if (rerender) renderScoreboard();
  } catch (e) { toast(e.message); }
}

async function abortMatch() {
  if (!confirm('Spiel abbrechen? Es wird NICHT in die Statistik übernommen.')) return;
  try {
    await api(`/api/match/${state.match.id}`, { method: 'DELETE' });
    state = null;
    renderSetup();
  } catch (e) { toast(e.message); }
}

/* ---------- Ende-Erkennung ---------- */
let endHandled = false;
async function maybePromptEnd() {
  const ev = await api(`/api/match/${state.match.id}/evaluate`);
  if (!ev.reached) { endHandled = false; return; }
  if (endHandled) return;
  endHandled = true;
  showEndModal(ev);
}

function nameOf(id) {
  const p = state.players.find((x) => x.player_id === id);
  return p ? p.name : '?';
}

function showEndModal(ev) {
  const backdrop = el('div', { class: 'modal-backdrop' });
  const modal = el('div', { class: 'modal' });

  modal.append(el('h2', {}, '🏁 Punktemaximum erreicht!'));
  modal.append(el('p', {},
    'Aktueller Sieger (wenigste Punkte): ',
    el('strong', { class: 'leader' }, nameOf(ev.winner_id)),
  ));
  modal.append(el('p', { class: 'muted' },
    `${nameOf(ev.loser_id)} hat aktuell die meisten Punkte.`));

  modal.append(el('hr', {}));
  modal.append(el('p', {}, 'Wie möchtet ihr weitermachen?'));

  // Option: verlängern
  modal.append(el('label', {}, 'Neues Punktemaximum (verlängern)'));
  const newMax = el('input', { type: 'number', value: String(state.match.max_points + 500), min: String(state.match.max_points + 1) });
  modal.append(newMax);

  const btnRow = el('div', { class: 'row', style: 'margin-top:16px' });
  const extendBtn = el('button', { class: 'secondary grow' }, 'Weiterspielen (verlängern)');
  const finishBtn = el('button', { class: 'success grow' }, 'Spiel beenden & werten');
  btnRow.append(extendBtn, finishBtn);
  modal.append(btnRow);

  extendBtn.addEventListener('click', async () => {
    const val = Number(newMax.value);
    if (!val || val <= state.match.max_points) return toast('Neues Maximum muss größer sein');
    try {
      state = await api(`/api/match/${state.match.id}/max`, { method: 'PUT', body: { maxPoints: val } });
      endHandled = false;
      backdrop.remove();
      renderScoreboard();
    } catch (e) { toast(e.message); }
  });

  finishBtn.addEventListener('click', async () => {
    try {
      const res = await api(`/api/match/${state.match.id}/finish`, { method: 'POST' });
      backdrop.remove();
      showFinalScreen(res);
    } catch (e) { toast(e.message); }
  });

  backdrop.append(modal);
  document.body.append(backdrop);
}

function showFinalScreen(res) {
  app.innerHTML = '';
  const card = el('div', { class: 'card', style: 'text-align:center' });
  card.append(el('h1', {}, '🏆 Spiel beendet'));
  card.append(el('p', { style: 'font-size:22px' },
    'Sieger: ', el('strong', { class: 'leader' }, nameOf(res.winner_id))));
  card.append(el('p', { class: 'muted' }, 'Verlierer: ' + nameOf(res.loser_id)));
  card.append(el('button', {
    class: 'success', style: 'margin-top:16px',
    onClick: async () => { state = null; endHandled = false; await init(); },
  }, '▶ Neues Spiel'));
  card.append(el('a', { href: 'stats.html', class: 'btn secondary', style: 'margin-left:10px' }, 'Statistiken ansehen'));
  app.append(card);
}
