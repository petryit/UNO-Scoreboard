import { api, el, toast, renderNav } from './common.js';

const app = document.getElementById('app');
renderNav('admin');

init();

async function init() {
  let status;
  try {
    status = await api('/api/admin/status');
  } catch (e) {
    app.textContent = 'Fehler: ' + e.message;
    return;
  }
  if (status.admin) renderPanel();
  else renderLogin();
}

function renderLogin() {
  app.innerHTML = '';
  const card = el('div', { class: 'card', style: 'max-width:420px;margin:40px auto' });
  card.append(el('h1', {}, '🔒 Admin-Login'));
  card.append(el('label', {}, 'Passwort'));
  const pw = el('input', { type: 'password', placeholder: 'Passwort…' });
  card.append(pw);
  const btn = el('button', { class: 'success', style: 'margin-top:14px' }, 'Anmelden');
  card.append(btn);

  const doLogin = async () => {
    try {
      await api('/api/admin/login', { method: 'POST', body: { password: pw.value } });
      renderPanel();
    } catch (e) { toast(e.message); }
  };
  btn.addEventListener('click', doLogin);
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
  app.append(card);
}

async function renderPanel() {
  app.innerHTML = '';

  const top = el('div', { class: 'card' });
  const row = el('div', { class: 'row' });
  row.append(el('h1', { class: 'grow' }, 'Admin-Bereich'));
  row.append(el('button', {
    class: 'secondary',
    onClick: async () => { await api('/api/admin/logout', { method: 'POST' }); renderLogin(); },
  }, 'Abmelden'));
  top.append(row);
  app.append(top);

  await renderSettings();
  await renderPlayers();
  await renderMatches();
  renderDangerZone();
}

async function renderSettings() {
  const settings = await api('/api/settings');
  const card = el('div', { class: 'card' });
  card.append(el('h2', {}, 'Einstellungen'));

  const row = el('div', { class: 'row' });
  const cb = el('input', { type: 'checkbox', style: 'width:auto' });
  cb.checked = !!settings.allow_negative;
  const label = el('label', { style: 'margin:0' }, 'Negative Punktewerte erlauben');
  const save = el('button', { class: 'success' }, 'Speichern');
  save.addEventListener('click', async () => {
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { allow_negative: cb.checked } });
      toast('Einstellung gespeichert');
    } catch (e) { toast(e.message); }
  });
  row.append(cb, label, el('span', { class: 'grow' }), save);
  card.append(row);
  card.append(el('p', { class: 'muted' },
    'Standardmäßig deaktiviert: Punkte unter 0 werden nicht gespeichert. Bei Aktivierung sind negative Werte in der Punkteingabe möglich.'));
  app.append(card);
}

function renderDangerZone() {
  const card = el('div', { class: 'card' });
  card.append(el('h2', {}, '⚠️ Gefahrenzone'));
  card.append(el('p', { class: 'muted' },
    'Löscht ALLE Spiele, Runden und Statistiken unwiderruflich. Die Spielerliste bleibt erhalten.'));
  card.append(el('button', {
    class: 'danger',
    onClick: async () => {
      if (!confirm('Wirklich ALLE Statistiken und Spiele löschen? Das kann nicht rückgängig gemacht werden.')) return;
      if (!confirm('Letzte Warnung: Alle Spielverläufe und Statistiken werden endgültig gelöscht. Fortfahren?')) return;
      try {
        await api('/api/admin/stats', { method: 'DELETE' });
        toast('Alle Statistiken gelöscht');
        renderPanel();
      } catch (e) { toast(e.message); }
    },
  }, 'Alle Statistiken löschen'));
  app.append(card);
}

async function renderPlayers() {
  const players = await api('/api/players');
  const card = el('div', { class: 'card table-wrap' });
  card.append(el('h2', {}, 'Spieler verwalten'));

  // Neuen Spieler anlegen
  const addRow = el('div', { class: 'row', style: 'margin-bottom:16px' });
  const newName = el('input', { placeholder: 'Neuer Spielername…', class: 'grow', style: 'max-width:320px' });
  const addBtn = el('button', { class: 'success' }, '+ Spieler anlegen');
  const doAdd = async () => {
    const name = newName.value.trim();
    if (!name) return toast('Name eingeben');
    try {
      await api('/api/players', { method: 'POST', body: { name } });
      toast('Spieler angelegt');
      renderPanel();
    } catch (e) { toast(e.message); }
  };
  addBtn.addEventListener('click', doAdd);
  newName.addEventListener('keydown', (e) => { if (e.key === 'Enter') doAdd(); });
  addRow.append(newName, addBtn);
  card.append(addRow);

  const table = el('table', { class: 'data' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, 'ID'), el('th', {}, 'Name'), el('th', {}, 'Aktionen'))));
  const tbody = el('tbody');
  for (const p of players) {
    const nameInput = el('input', { value: p.name, style: 'max-width:220px' });
    tbody.append(el('tr', {},
      el('td', {}, String(p.id)),
      el('td', {}, nameInput),
      el('td', {},
        el('div', { class: 'row' },
          el('button', {
            class: 'success',
            onClick: async () => {
              try {
                await api(`/api/players/${p.id}`, { method: 'PUT', body: { name: nameInput.value.trim() } });
                toast('Gespeichert');
              } catch (e) { toast(e.message); }
            },
          }, 'Speichern'),
          el('button', {
            class: 'danger',
            onClick: async () => {
              if (!confirm(`Spieler „${p.name}“ löschen? Alle zugehörigen Statistiken gehen verloren.`)) return;
              await api(`/api/players/${p.id}`, { method: 'DELETE' });
              renderPanel();
            },
          }, 'Löschen'),
        )),
    ));
  }
  table.append(tbody);
  card.append(table);
  if (!players.length) card.append(el('p', { class: 'muted' }, 'Keine Spieler.'));
  app.append(card);
}

async function renderMatches() {
  const [matches, players] = await Promise.all([
    api('/api/admin/matches'),
    api('/api/players'),
  ]);
  const nameById = Object.fromEntries(players.map((p) => [p.id, p.name]));

  const card = el('div', { class: 'card table-wrap' });
  card.append(el('h2', {}, 'Spiele verwalten'));
  const table = el('table', { class: 'data' });
  table.append(el('thead', {}, el('tr', {},
    el('th', {}, 'ID'), el('th', {}, 'Status'), el('th', {}, 'Max'),
    el('th', {}, 'Sieger'), el('th', {}, 'Verlierer'), el('th', {}, 'Aktionen'))));
  const tbody = el('tbody');

  for (const m of matches) {
    const winSel = playerSelect(players, m.winner_id);
    const loseSel = playerSelect(players, m.loser_id);
    tbody.append(el('tr', {},
      el('td', {}, String(m.id)),
      el('td', {}, m.status),
      el('td', {}, String(m.max_points)),
      el('td', {}, m.status === 'finished' ? winSel : el('span', { class: 'muted' }, '—')),
      el('td', {}, m.status === 'finished' ? loseSel : el('span', { class: 'muted' }, '—')),
      el('td', {}, el('div', { class: 'row' },
        m.status === 'finished' ? el('button', {
          class: 'success',
          onClick: async () => {
            await api(`/api/admin/matches/${m.id}`, {
              method: 'PUT',
              body: { winner_id: Number(winSel.value) || null, loser_id: Number(loseSel.value) || null },
            });
            toast('Aktualisiert');
          },
        }, 'Speichern') : null,
        el('button', {
          class: 'danger',
          onClick: async () => {
            if (!confirm(`Spiel #${m.id} löschen?`)) return;
            await api(`/api/admin/matches/${m.id}`, { method: 'DELETE' });
            renderPanel();
          },
        }, 'Löschen'),
      )),
    ));
  }
  table.append(tbody);
  card.append(table);
  if (!matches.length) card.append(el('p', { class: 'muted' }, 'Keine Spiele.'));
  app.append(card);
}

function playerSelect(players, selectedId) {
  const sel = el('select', { style: 'max-width:160px' });
  sel.append(el('option', { value: '' }, '—'));
  for (const p of players) {
    const opt = el('option', { value: String(p.id) }, p.name);
    if (p.id === selectedId) opt.setAttribute('selected', 'selected');
    sel.append(opt);
  }
  return sel;
}
