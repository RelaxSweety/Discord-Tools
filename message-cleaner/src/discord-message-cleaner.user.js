// ==UserScript==
// @name         Discord Tools - Message Cleaner
// @namespace    https://github.com/RelaxSweety/Discord-Tools
// @version      0.1.0
// @description  Selected Discord conversations: verify authorship, delete via visible UI, export CSV.
// @match        https://discord.com/channels/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
(() => {
  'use strict';
  if (window.__discordToolsCleaner) return;
  window.__discordToolsCleaner = true;
  const KEY = 'discord-tools-cleaner-v1';
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => [...root.querySelectorAll(s)];
  const state = { selected: [], logs: [], running: false, paused: false, stop: false, found: 0, deleted: 0, skipped: 0, failed: 0, userId: '' };
  try { const saved = JSON.parse(localStorage.getItem(KEY) || '{}'); state.selected = saved.selected || []; state.userId = saved.userId || ''; } catch {}
  const persist = () => localStorage.setItem(KEY, JSON.stringify({ selected: state.selected, userId: state.userId }));
  const path = () => location.pathname.match(/^\/channels\/(?:@me|\d+)\/\d+/)?.[0] || null;
  const name = () => (q('main header h1')?.textContent || q('main header')?.textContent || path() || 'Conversation').trim().slice(0, 100);
  const css = '#dt-cleaner{position:fixed;z-index:2147483647;top:75px;right:16px;width:320px;max-height:80vh;overflow:auto;background:#202127;color:#eee;border:1px solid #777;border-radius:9px;padding:12px;font:13px system-ui;box-shadow:0 6px 24px #0009}#dt-cleaner button{margin:3px;padding:6px 9px;border:0;border-radius:5px;background:#5865f2;color:#fff;cursor:pointer}#dt-cleaner input{width:130px;background:#333;color:#fff;border:1px solid #777;padding:5px}#dt-cleaner .item{padding:5px;border-bottom:1px solid #555}#dt-cleaner small{color:#ccc}';
  const style = document.createElement('style'); style.textContent = css; document.head.append(style);
  const panel = document.createElement('section'); panel.id = 'dt-cleaner';
  panel.innerHTML = '<b>Discord Message Cleaner v0.1.0</b><p><small>Selected channels / DMs only. Experimental UI automation.</small></p><label>Your Discord numeric user ID <input id="dt-user" placeholder="Required"></label><p><button id="dt-add">Add current</button></p><div id="dt-list"></div><p><button id="dt-start">Start</button><button id="dt-pause">Pause</button><button id="dt-stop">Stop</button></p><button id="dt-export">Export CSV</button><p id="dt-count"></p><small id="dt-status">Idle</small>';
  document.body.append(panel);
  const el = id => q('#dt-' + id, panel);
  el('user').value = state.userId;
  el('user').onchange = () => { state.userId = el('user').value.trim(); persist(); };
  const status = s => { el('status').textContent = s; refresh(); };
  const refresh = () => { el('count').textContent = 'Found: ' + state.found + ' | Deleted: ' + state.deleted + ' | Skipped: ' + state.skipped + ' | Failed: ' + state.failed; el('pause').textContent = state.paused ? 'Resume' : 'Pause'; };
  function render() {
    el('list').replaceChildren();
    state.selected.forEach((c, i) => {
      const div = document.createElement('div'); div.className = 'item';
      const span = document.createElement('span'); span.textContent = c.name + ' (' + c.path + ') ';
      const btn = document.createElement('button'); btn.textContent = 'Remove'; btn.disabled = state.running;
      btn.onclick = () => { state.selected.splice(i, 1); persist(); render(); };
      div.append(span, btn); el('list').append(div);
    });
  }
  el('add').onclick = () => {
    if (state.running) return;
    const p = path(); if (!p) return status('Open a channel or DM first.');
    if (state.selected.some(c => c.path === p)) return status('Already selected.');
    state.selected.push({ path: p, name: name() }); persist(); render(); status('Added ' + p);
  };
  el('pause').onclick = () => { if (!state.running) return; state.paused = !state.paused; status(state.paused ? 'Paused' : 'Resumed'); };
  el('stop').onclick = () => { state.stop = true; state.paused = false; status('Stopping…'); };
  const log = (c, id, result, detail) => { state.logs.push({ timestamp: new Date().toISOString(), conversation: c.name, path: c.path, message_id: id, result, detail }); refresh(); };
  el('export').onclick = () => {
    const cols = ['timestamp', 'conversation', 'path', 'message_id', 'result', 'detail'];
    const quote = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
    const csv = [cols.join(','), ...state.logs.map(r => cols.map(k => quote(r[k])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'discord-cleaner-' + Date.now() + '.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  async function gate() { while (state.paused && !state.stop) await sleep(250); if (state.stop) throw Error('Stopped'); }
  const rows = () => qa('li[id^="chat-messages-"]').filter(x => /^chat-messages-\d+$/.test(x.id));
  function owned(row) {
    // Only explicit author identifiers are trusted; never guess from display names or message IDs.
    const author = row.getAttribute('data-author-id') || q('[data-author-id]', row)?.getAttribute('data-author-id');
    return Boolean(state.userId && author === state.userId);
  }
  function scroller() {
    const root = q('[class*="messagesWrapper"]') || q('[data-list-id="chat-messages"]');
    if (!root) return null;
    return [root, ...qa('*', root)].find(x => x.scrollHeight > x.clientHeight + 100 && getComputedStyle(x).overflowY !== 'visible') || null;
  }
  async function remove(row, c) {
    const id = row.id.replace('chat-messages-', '');
    if (!owned(row)) { state.skipped++; log(c, id, 'skipped', 'Author not verified'); return; }
    await gate(); row.scrollIntoView({ block: 'center' }); await sleep(400);
    row.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    const more = q('button[aria-label="More"],button[aria-label="More options"],button[aria-label*="More"]', row);
    if (!more) { state.failed++; log(c, id, 'failed', 'More button unavailable'); return; }
    more.click(); await sleep(350);
    const menu = q('[role="menu"]');
    const del = menu && qa('[role="menuitem"]', menu).find(x => /^Delete Message$|^Delete$/i.test(x.textContent.trim()));
    if (!del) { state.paused = true; state.failed++; log(c, id, 'failed', 'Delete menu item unavailable; paused'); status('Paused: unexpected menu.'); return; }
    del.click(); await sleep(350);
    const dialog = q('[role="dialog"]');
    const confirmButton = dialog && qa('button', dialog).find(x => /^Delete$/i.test(x.textContent.trim()));
    if (!confirmButton) { state.paused = true; state.failed++; log(c, id, 'failed', 'Unexpected confirmation; paused'); status('Paused: unexpected confirmation.'); return; }
    await gate(); confirmButton.click(); await sleep(750);
    if (document.getElementById('chat-messages-' + id)) { state.failed++; log(c, id, 'failed', 'Message still visible'); }
    else { state.deleted++; log(c, id, 'deleted', 'Confirmed through UI'); }
  }
  async function run(c) {
    if (path() !== c.path) return status('Navigate to ' + c.name + ' and press Start again.');
    const s = scroller(); if (!s) throw Error('Message scroller not found');
    const attempted = new Set(); let stable = 0, lastTop = '';
    for (let i = 0; i < 2000; i++) {
      await gate();
      for (const row of rows().reverse()) {
        if (attempted.has(row.id)) continue;
        attempted.add(row.id);
        if (owned(row)) { state.found++; refresh(); await remove(row, c); await sleep(3000); }
        else { state.skipped++; log(c, row.id, 'skipped', 'Author not verified'); }
      }
      const top = rows()[0]?.id || '';
      stable = top === lastTop ? stable + 1 : 0; lastTop = top;
      if (stable >= 6 && s.scrollTop <= 5) break;
      s.scrollTop = Math.max(0, s.scrollTop - s.clientHeight * 0.8); await sleep(850);
    }
    status('Completed current conversation. Export CSV.');
  }
  el('start').onclick = async () => {
    if (state.running) return;
    state.userId = el('user').value.trim(); persist();
    if (!/^\d{15,22}$/.test(state.userId)) return status('Enter your numeric Discord user ID.');
    const c = state.selected.find(x => x.path === path());
    if (!c) return status('Navigate to a selected conversation before starting.');
    if (!confirm('Permanently delete verified messages in ' + c.name + '? This is irreversible and may violate Discord rules.')) return;
    state.running = true; state.stop = false; state.paused = false; el('start').disabled = true; el('add').disabled = true; render();
    try { await run(c); } catch (e) { status('Stopped/error: ' + e.message); }
    finally { state.running = false; state.paused = false; el('start').disabled = false; el('add').disabled = false; render(); refresh(); }
  };
  render(); refresh();
})();
