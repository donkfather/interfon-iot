// Interfon: admin + control page, embedded in the firmware (web_server.js_include → /0.js).
// Works with no internet. Live state: the device's /events stream. Entity actions:
// POST /<domain>/<Entity Name>/<action>. Settings: /admin/* (components/interfon_admin).
// Secrets never come back from the device: password fields are write-only.
(() => {
  'use strict';

  // ---- page shell ---------------------------------------------------------------
  const vp = document.createElement('meta');
  vp.name = 'viewport';
  vp.content = 'width=device-width,initial-scale=1,viewport-fit=cover';
  document.head.appendChild(vp);
  document.title = 'Interfon';

  const css = `
:root{--bg:#0f1115;--card:#181b21;--line:#2a2f39;--text:#eef0f4;--mute:#9aa1ad;
  --ok:#3ecf8e;--warn:#f5b642;--bad:#ff6b6b;--accent:#4f8cff;--ring:#ff9f43;--field:#12151a;
  color-scheme:dark}
@media (prefers-color-scheme:light){:root{--bg:#f3f4f7;--card:#fff;--line:#dfe3e9;--field:#f8f9fb;
  --text:#14171c;--mute:#5d6572;--ok:#12805a;--warn:#9a6300;--bad:#c62828;--accent:#1f5fd6;
  --ring:#b8530a;color-scheme:light}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  padding:max(14px,env(safe-area-inset-top)) 14px max(24px,env(safe-area-inset-bottom))}
main{max-width:560px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr);gap:14px}
main>*,.view>*,.card,.field{min-width:0}
header{display:flex;align-items:center;justify-content:space-between}
h1{font-size:22px;margin:0}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.8px;color:var(--mute);margin:0 0 12px}
.live{display:flex;align-items:center;gap:8px;color:var(--mute);font-size:13px}
.dot{width:9px;height:9px;border-radius:50%;background:var(--bad)}
.dot.on{background:var(--ok)}
nav{display:flex;gap:4px;background:var(--card);border:1px solid var(--line);border-radius:12px;padding:4px;overflow-x:auto}
nav a{flex:1;text-align:center;padding:8px 10px;border-radius:9px;color:var(--mute);text-decoration:none;
  font-size:14px;white-space:nowrap}
nav a[aria-current=page]{background:var(--line);color:var(--text);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px}
.view{display:none;gap:14px}
.view.show{display:grid;grid-template-columns:minmax(0,1fr)}
.banner{display:none;border-radius:16px;padding:16px;background:var(--ring);color:#111;font-weight:700;
  font-size:18px;text-align:center}
.banner.show{display:block;animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.75}}
.notice{display:none;border-radius:12px;padding:10px 14px;font-size:14px;text-align:center;
  border:1px dashed var(--bad);color:var(--bad)}
.notice.show{display:block}
.door{display:grid;place-items:center;gap:12px;padding:22px 16px}
.open{width:180px;height:180px;border-radius:50%;border:0;cursor:pointer;background:var(--accent);color:#fff;
  font-size:21px;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.25);transition:transform .08s,background .2s}
.open:active{transform:scale(.97)}
.open.armed{background:var(--warn);color:#111}
.open:disabled{background:var(--line);color:var(--mute);cursor:default;box-shadow:none}
.hint{color:var(--mute);font-size:14px;min-height:20px;text-align:center}
.steps{display:flex;gap:6px;width:100%;max-width:300px}
.steps span{flex:1;height:6px;border-radius:3px;background:var(--line)}
.steps span.done{background:var(--ok)}
.steps span.now{background:var(--warn)}
.row{display:flex;align-items:center;justify-content:space-between;gap:12px}
.row+.row,.row+.field,.field+.row,.field+.field,.checks+.row,.row+.checks{margin-top:14px}
.sep{border-top:1px solid var(--line);margin:16px 0}
.label{font-weight:600}
.sub{color:var(--mute);font-size:14px}
.sw{position:relative;width:52px;height:30px;flex:none;border:0;border-radius:15px;background:var(--line);cursor:pointer}
.sw::after{content:"";position:absolute;top:3px;left:3px;width:24px;height:24px;border-radius:50%;background:#fff;transition:transform .2s}
.sw[aria-checked=true]{background:var(--ok)}
.sw[aria-checked=true]::after{transform:translateX(22px)}
.stats{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px}
.stat b{display:block;font-size:20px}
.stat .sub{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
ol{list-style:none;margin:0;padding:0}
li{display:flex;gap:12px;align-items:baseline;padding:9px 0;border-top:1px solid var(--line)}
li:first-child{border-top:0}
li time{font-variant-numeric:tabular-nums;color:var(--mute);min-width:44px}
li.day{color:var(--mute);font-size:13px;padding:12px 0 2px;border:0}
.tag{font-size:12px;padding:2px 8px;border-radius:10px;background:var(--line);color:var(--mute);margin-left:auto;white-space:nowrap}
.tag.ok{color:var(--ok)}.tag.warn{color:var(--warn)}.tag.bad{color:var(--bad)}
.field{display:grid;gap:6px}
.field label{font-size:14px;font-weight:600}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;align-items:start}
.grid2>.field{margin-top:0!important}
input[type=text],input[type=password],input[type=number],input[type=url]{width:100%;padding:11px 12px;border-radius:10px;
  border:1px solid var(--line);background:var(--field);color:var(--text);font-size:16px}
input:disabled{opacity:.5}
input:focus{outline:2px solid var(--accent);outline-offset:1px}
.checks{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:8px}
.checks label{display:flex;gap:8px;align-items:center;font-size:15px}
.seg{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.seg button{flex:1;padding:10px;border:0;background:transparent;color:var(--mute);font-size:15px;cursor:pointer}
.seg button[aria-pressed=true]{background:var(--accent);color:#fff}
.btn{border:1px solid var(--line);background:transparent;color:var(--text);border-radius:10px;padding:10px 16px;font-size:15px;cursor:pointer}
.btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:600}
.btn.danger{color:var(--bad)}
.btn:disabled{opacity:.5;cursor:default}
.actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;margin-top:16px}
.err{color:var(--bad);font-size:14px;min-height:0}
.kv{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px}
.kv dt{color:var(--mute)}.kv dd{margin:0;font-variant-numeric:tabular-nums;word-break:break-all}
.link{background:none;border:0;color:var(--accent);padding:0;font-size:14px;cursor:pointer}
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);display:none;place-items:center;padding:20px;z-index:10}
.overlay.show{display:grid}
.overlay .card{max-width:400px;text-align:center}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--text);color:var(--bg);
  padding:10px 16px;border-radius:10px;font-size:14px;opacity:0;transition:opacity .2s;pointer-events:none;z-index:11}
.toast.show{opacity:1}
button:focus-visible,a:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}`;
  const st = document.createElement('style');
  st.textContent = css;
  document.head.appendChild(st);

  const EVENTS = [[1, 'Ring'], [2, 'Door opened'], [4, 'Auto-answer changed'], [8, 'Device online']];
  const checks = (name) => `<div class="checks" data-events="${name}">${EVENTS.map(([b, l]) =>
    `<label><input type="checkbox" value="${b}"> ${l}</label>`).join('')}</div>`;

  document.body.innerHTML = `
<main>
  <header>
    <h1>Interfon</h1>
    <div class="live"><span id="clock"></span><span class="dot" id="dot" title="Live connection"></span></div>
  </header>
  <nav aria-label="Sections">
    <a href="#home">Intercom</a><a href="#notify">Notifications</a><a href="#mqtt">MQTT</a>
    <a href="#network">Network</a><a href="#system">System</a>
  </nav>
  <div class="notice" id="offline" role="status">Connection lost. Reconnecting…</div>
  <div class="banner" id="banner" role="alert">🔔 Someone is ringing</div>

  <section class="view" id="v-home">
    <div class="card door">
      <button class="open" id="open" type="button">Open door</button>
      <div class="steps" id="steps" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="hint" id="hint" aria-live="polite"></div>
    </div>
    <div class="card"><div class="row">
      <div><div class="label">Auto-answer</div><div class="sub" id="autoSub">…</div></div>
      <button class="sw" id="auto" role="switch" aria-checked="false" aria-label="Auto-answer"></button>
    </div></div>
    <div class="stats">
      <div class="stat"><span class="sub">Last ring</span><b id="lastRing">–</b><span class="sub" id="ringCount"></span></div>
      <div class="stat"><span class="sub">Last opened</span><b id="lastDoor">–</b><span class="sub" id="doorCount"></span></div>
    </div>
    <div class="card"><h2>History</h2><ol id="history"><li class="sub">Loading…</li></ol></div>
  </section>

  <section class="view" id="v-notify">
    <form class="card" id="f-webhook">
      <h2>Webhook</h2>
      <div class="row"><div><div class="label">Send webhooks</div>
        <div class="sub">An HTTP POST with a small JSON body, 5 s after the event</div></div>
        <button class="sw" type="button" data-field="webhook_enabled" role="switch" aria-checked="false" aria-label="Send webhooks"></button></div>
      <div class="field"><label for="webhook_url">URL</label>
        <input type="url" id="webhook_url" name="webhook_url" placeholder="http://your-server:5678/webhook/interfon" autocomplete="off">
        <span class="sub">Plain <b>http://</b> only: this board can't do HTTPS. For Telegram or ntfy, point it at a relay on your network (e.g. an n8n webhook) that forwards the message.</span></div>
      <div class="field"><span class="label">Send for</span></div>
      ${checks('webhook_events')}
      <div class="sep"></div>
      <div class="row"><div><div class="label">Last delivery</div><div class="sub" id="whLast">–</div></div>
        <button class="btn" type="button" id="whTest">Send test</button></div>
      <div class="err" id="e-webhook"></div>
      <div class="actions"><button class="btn primary" type="submit">Save</button></div>
    </form>
    <form class="card" id="f-mqttev">
      <h2>MQTT events</h2>
      <div class="sub">Published to <b id="evTopic">interfon/event</b> when MQTT is on (set up under MQTT).</div>
      <div class="field" style="margin-top:12px"><span class="label">Publish for</span></div>
      ${checks('mqtt_events')}
      <div class="err" id="e-mqttev"></div>
      <div class="actions"><button class="btn primary" type="submit">Save</button></div>
    </form>
  </section>

  <section class="view" id="v-mqtt">
    <form class="card" id="f-mqtt">
      <h2>MQTT broker</h2>
      <div class="row"><div><div class="label">Use MQTT</div><div class="sub" id="mqttState">–</div></div>
        <button class="sw" type="button" data-field="mqtt_enabled" role="switch" aria-checked="false" aria-label="Use MQTT"></button></div>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label for="mqtt_host">Broker host</label><input type="text" id="mqtt_host" name="mqtt_host" placeholder="mqtt.local" autocomplete="off"></div>
        <div class="field"><label for="mqtt_port">Port</label><input type="number" id="mqtt_port" name="mqtt_port" min="1" max="65535"></div>
      </div>
      <div class="grid2" style="margin-top:14px">
        <div class="field"><label for="mqtt_user">Username</label><input type="text" id="mqtt_user" name="mqtt_user" autocomplete="off"></div>
        <div class="field"><label for="mqtt_pass">Password</label><input type="password" id="mqtt_pass" name="mqtt_pass" autocomplete="new-password"></div>
      </div>
      <div class="sub" id="passNote" style="margin-top:6px"></div>
      <div class="sep"></div>
      <div class="field"><label for="mqtt_prefix">Topic prefix</label><input type="text" id="mqtt_prefix" name="mqtt_prefix" autocomplete="off">
        <span class="sub">States under <b id="pfx1">interfon</b>/…, events on <b id="pfx2">interfon</b>/event.</span></div>
      <div class="row"><div><div class="label">Home Assistant discovery</div><div class="sub">Announce the entities so HA adds them automatically</div></div>
        <button class="sw" type="button" data-field="mqtt_discovery" role="switch" aria-checked="false" aria-label="Home Assistant discovery"></button></div>
      <div class="err" id="e-mqtt"></div>
      <div class="actions"><button class="btn" type="button" id="mqttTest">Publish test</button><button class="btn primary" type="submit">Save</button></div>
    </form>
  </section>

  <section class="view" id="v-network">
    <div class="card">
      <h2>Connected now</h2>
      <dl class="kv" id="netNow"></dl>
    </div>
    <form class="card" id="f-net">
      <h2>Address</h2>
      <div class="seg" role="group" aria-label="Address mode">
        <button type="button" data-mode="static" aria-pressed="false">Fixed IP</button>
        <button type="button" data-mode="dhcp" aria-pressed="false">Automatic (DHCP)</button>
      </div>
      <div id="staticFields">
        <div class="grid2" style="margin-top:14px">
          <div class="field"><label for="ip">IP address</label><input type="text" id="ip" name="ip" inputmode="decimal"></div>
          <div class="field"><label for="subnet">Subnet mask</label><input type="text" id="subnet" name="subnet" inputmode="decimal"></div>
        </div>
        <div class="field" style="margin-top:14px"><label for="gateway">Gateway</label><input type="text" id="gateway" name="gateway" inputmode="decimal"></div>
        <div class="grid2" style="margin-top:14px">
          <div class="field"><label for="dns1">DNS 1</label><input type="text" id="dns1" name="dns1" inputmode="decimal"></div>
          <div class="field"><label for="dns2">DNS 2</label><input type="text" id="dns2" name="dns2" inputmode="decimal"></div>
        </div>
        <div style="margin-top:8px"><button class="link" type="button" id="factory">Fill in the factory values</button></div>
      </div>
      <div class="sep"></div>
      <h2>Wi-Fi network</h2>
      <div class="sub" style="margin-bottom:12px">Leave empty to keep the current network.</div>
      <div class="grid2">
        <div class="field"><label for="wifi_ssid">Network name</label><input type="text" id="wifi_ssid" name="wifi_ssid" autocomplete="off"></div>
        <div class="field"><label for="wifi_password">Password</label><input type="password" id="wifi_password" name="wifi_password" autocomplete="new-password"></div>
      </div>
      <div class="sep"></div>
      <div class="sub">Saving restarts the intercom (about 20 s). If it can't connect with the new settings,
        it opens its own Wi-Fi <b>Interfon WiFi</b>: join it and open <b>http://192.168.4.1</b> to fix them.</div>
      <div class="err" id="e-net"></div>
      <div class="actions"><button class="btn primary" type="submit">Save and restart</button></div>
    </form>
  </section>

  <section class="view" id="v-system">
    <div class="card"><h2>Device</h2><dl class="kv" id="sysInfo"></dl></div>
    <div class="card">
      <div class="row"><div><div class="label">Simulate ring</div>
        <div class="sub">Runs the full chain: history, notifications, auto-answer. Safe: with no real call the line is dead, so no door opens.</div></div>
        <button class="btn" type="button" id="sim">Test</button></div>
      <div class="row"><div><div class="label">Restart</div><div class="sub">Settings and history are kept.</div></div>
        <button class="btn danger" type="button" id="reboot">Restart</button></div>
      <div class="row"><div><div class="label">Advanced</div><div class="sub">The standard ESPHome page: logs, every entity, firmware upload. Needs internet.</div></div>
        <button class="btn" type="button" id="adv">Open</button></div>
    </div>
  </section>
</main>
<div class="overlay" id="overlay"><div class="card"><h2 id="ovTitle">Restarting</h2><p id="ovText" class="sub"></p></div></div>
<div class="toast" id="toast" role="status"></div>`;

  const $ = (id) => document.getElementById(id);
  const S = {};          // live entity state by id ("switch/Auto-answer")
  let CFG = null;        // /admin/settings
  let INFO = null;       // /admin/info
  let uptime = 0;

  // ---- helpers ------------------------------------------------------------------
  let toastT;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('show'), 2800);
  }
  async function post(id, action) {
    const [domain, name] = id.split('/');
    try {
      const r = await fetch(`/${domain}/${encodeURIComponent(name)}/${action}`, { method: 'POST' });
      if (!r.ok) throw new Error(r.status);
      return true;
    } catch (e) {
      toast(`Didn't reach the intercom (${e.message}). Try again.`);
      return false;
    }
  }
  async function getJSON(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }
  async function saveSettings(fields, errEl) {
    errEl.textContent = '';
    let r, j;
    try {
      r = await fetch('/admin/settings', { method: 'POST', body: new URLSearchParams(fields) });
      j = await r.json();
    } catch (e) {
      errEl.textContent = `Didn't reach the intercom (${e.message}).`;
      return null;
    }
    if (!j.ok) { errEl.textContent = j.error || 'Not saved'; return null; }
    return j;
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  function dur(sec) {
    const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
    return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm';
  }
  function parseStamp(s) {                        // "25.09.2026 19:50:32 (door auto)"
    const m = /^(\d\d)\.(\d\d)\.(\d{4}) (\d\d:\d\d)(?::\d\d)?(?: \((.+)\))?$/.exec(s || '');
    return m ? { d: `${m[1]}.${m[2]}`, y: m[3], t: m[4], rest: m[5] || '' } : null;
  }
  function today() {                              // the device clock is the reference
    const p = parseStamp((S['text_sensor/Device time'] || {}).value);
    if (!p) return null;
    const [dd, mm] = p.d.split('.').map(Number);
    return new Date(Number(p.y), mm - 1, dd);
  }
  function dayLabel(dm) {
    const t = today();
    if (!t) return dm;
    const [dd, mm] = dm.split('.').map(Number);
    let d = new Date(t.getFullYear(), mm - 1, dd);
    if (d > t) d = new Date(t.getFullYear() - 1, mm - 1, dd);
    const diff = Math.round((t - d) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  }
  function when(s) {
    const p = parseStamp(s);
    if (!p) return s || '–';
    const l = dayLabel(p.d);
    return (l === 'Today' ? '' : l + ', ') + p.t;
  }
  const HOW = { 'door auto': 'automatically', 'door remote': 'remotely', 'door button': 'with the button' };

  // switches bound to settings fields (data-field) toggle locally until Save
  document.querySelectorAll('.sw[data-field]').forEach((b) => b.addEventListener('click', () => {
    b.setAttribute('aria-checked', b.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
    syncEnabled();
  }));
  const swVal = (field) => document.querySelector(`.sw[data-field="${field}"]`).getAttribute('aria-checked') === 'true';
  const setSw = (field, on) => document.querySelector(`.sw[data-field="${field}"]`).setAttribute('aria-checked', on ? 'true' : 'false');
  const readMask = (name) => [...document.querySelectorAll(`[data-events="${name}"] input`)]
    .reduce((m, i) => m | (i.checked ? Number(i.value) : 0), 0);
  const setMask = (name, mask) => document.querySelectorAll(`[data-events="${name}"] input`)
    .forEach((i) => { i.checked = (mask & Number(i.value)) !== 0; });
  function syncEnabled() {
    const wh = swVal('webhook_enabled');
    $('webhook_url').disabled = !wh;
    document.querySelectorAll('[data-events="webhook_events"] input').forEach((i) => { i.disabled = !wh; });
    const mq = swVal('mqtt_enabled');
    ['mqtt_host', 'mqtt_port', 'mqtt_user', 'mqtt_pass', 'mqtt_prefix'].forEach((id) => { $(id).disabled = !mq; });
  }

  // ---- routing ------------------------------------------------------------------
  const VIEWS = ['home', 'notify', 'mqtt', 'network', 'system'];
  function route() {
    const v = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'home';
    VIEWS.forEach((n) => $('v-' + n).classList.toggle('show', n === v));
    document.querySelectorAll('nav a').forEach((a) => a.setAttribute('aria-current', a.getAttribute('href') === '#' + v ? 'page' : 'false'));
    if (v !== 'home') loadAdmin();
  }
  window.addEventListener('hashchange', route);

  // ---- intercom view ------------------------------------------------------------
  function renderHistory() {
    const raw = (S['text_sensor/History'] || {}).value;
    const ol = $('history');
    if (!raw || raw === 'no events yet') { ol.innerHTML = '<li class="sub">No events yet</li>'; return; }
    const items = raw.split(' | ').map((s) => {
      const m = /^(\d\d\.\d\d) (\d\d:\d\d) (.+)$/.exec(s);
      return m ? { d: m[1], t: m[2], k: m[3] } : { d: '', t: '', k: s.replace('(no time) ', '') };
    });
    const ev = [];                                // newest first; ring + door in the same minute = one event
    for (let i = 0; i < items.length; i++) {
      const a = items[i], b = items[i + 1];
      if (a.k.startsWith('door') && b && b.k === 'ring' && b.d === a.d && b.t === a.t) {
        ev.push({ d: a.d, t: a.t, text: 'Rang', tag: 'opened ' + HOW[a.k], cls: 'ok' });
        i++;
      } else if (a.k === 'ring') {
        ev.push({ d: a.d, t: a.t, text: 'Rang', tag: 'not opened', cls: 'warn' });
      } else {
        ev.push({ d: a.d, t: a.t, text: 'Door opened', tag: HOW[a.k] || a.k, cls: '' });
      }
    }
    let html = '', lastDay = null;
    for (const e of ev) {
      if (e.d !== lastDay) { html += `<li class="day">${e.d ? dayLabel(e.d) : 'Time unknown'}</li>`; lastDay = e.d; }
      html += `<li><time>${e.t || '--:--'}</time><span>${e.text}</span><span class="tag ${e.cls}">${e.tag}</span></li>`;
    }
    ol.innerHTML = html;
  }

  let armedT = null, running = false, doorDone = false;
  function renderDoor() {
    const pickup = S['switch/Handset off-hook'] && S['switch/Handset off-hook'].value;
    const door = S['switch/Door relay'] && S['switch/Door relay'].value;
    const bars = [...$('steps').children], btn = $('open'), hint = $('hint');
    if (pickup || door) {                         // follows the REAL relays: pick up → door → hang up
      running = true;
      btn.disabled = true;
      btn.classList.remove('armed');
      btn.textContent = 'Opening…';
      const phase = door ? 1 : (doorDone ? 2 : 0);
      bars.forEach((b, i) => { b.className = i < phase ? 'done' : i === phase ? 'now' : ''; });
      hint.textContent = ['Picking up the handset', 'Pressing the door button', 'Hanging up'][phase];
      return;
    }
    if (running) {
      running = false;
      doorDone = false;
      bars.forEach((b) => { b.className = 'done'; });
      hint.textContent = 'Done. The door only opens during a live call.';
      setTimeout(() => { bars.forEach((b) => { b.className = ''; }); if (!armedT) hint.textContent = ''; }, 4000);
    }
    btn.disabled = false;
    if (!armedT) { btn.textContent = 'Open door'; btn.classList.remove('armed'); }
  }

  function render() {
    const auto = S['switch/Auto-answer'] && S['switch/Auto-answer'].value;
    $('auto').setAttribute('aria-checked', auto ? 'true' : 'false');
    $('autoSub').textContent = auto ? 'On: calls are answered and the door opens by itself'
      : 'Off: nothing happens until you press Open door';
    const ringing = S['binary_sensor/Ring'] && S['binary_sensor/Ring'].value;
    $('banner').classList.toggle('show', !!ringing);
    $('banner').textContent = ringing && auto ? '🔔 Someone is ringing. Opening automatically…' : '🔔 Someone is ringing';
    const lr = (S['text_sensor/Last ring'] || {}).value;
    $('lastRing').textContent = lr === 'never' ? 'Never' : when(lr);
    const ld = (S['text_sensor/Last door open'] || {}).value;
    const p = parseStamp(ld);
    $('lastDoor').textContent = ld === 'never' ? 'Never' : when(ld);
    $('ringCount').textContent = S['sensor/Ring count'] ? `${S['sensor/Ring count'].value} rings total` : '';
    $('doorCount').textContent = S['sensor/Door opens']
      ? `${p && p.rest ? (HOW[p.rest] || p.rest) + ' · ' : ''}${S['sensor/Door opens'].value} total` : '';
    const dt = (S['text_sensor/Device time'] || {}).value;
    const tp = parseStamp(dt);
    $('clock').textContent = tp ? tp.t : (dt === 'not synced' ? 'clock not synced' : '');
    renderHistory();
    renderDoor();
  }

  $('open').addEventListener('click', async () => {
    const btn = $('open');
    if (!armedT) {                                // two taps, so a pocket tap can't open the door
      btn.classList.add('armed');
      btn.textContent = 'Tap again to open';
      $('hint').textContent = 'Opens the door for the person calling right now';
      armedT = setTimeout(() => { armedT = null; btn.classList.remove('armed'); btn.textContent = 'Open door'; $('hint').textContent = ''; }, 3000);
      return;
    }
    clearTimeout(armedT);
    armedT = null;
    btn.classList.remove('armed');
    btn.disabled = true;
    btn.textContent = 'Opening…';
    if (!(await post('button/Open door', 'press'))) { btn.disabled = false; btn.textContent = 'Open door'; }
  });
  $('auto').addEventListener('click', () => post('switch/Auto-answer', 'toggle'));

  // ---- admin views --------------------------------------------------------------
  let adminLoaded = false;
  async function loadAdmin(force) {
    try {
      INFO = await getJSON('/admin/info');
      if (!adminLoaded || force) { CFG = await getJSON('/admin/settings'); fillForms(); adminLoaded = true; }
      renderAdmin();
    } catch (e) {
      toast(`Couldn't load settings (${e.message})`);
    }
  }
  function fillForms() {
    const c = CFG;
    setSw('webhook_enabled', c.webhook_enabled);
    $('webhook_url').value = c.webhook_url;
    setMask('webhook_events', c.webhook_events);
    setMask('mqtt_events', c.mqtt_events);
    setSw('mqtt_enabled', c.mqtt_enabled);
    setSw('mqtt_discovery', c.mqtt_discovery);
    $('mqtt_host').value = c.mqtt_host;
    $('mqtt_port').value = c.mqtt_port || 1883;
    $('mqtt_user').value = c.mqtt_user;
    $('mqtt_pass').value = '';
    $('mqtt_pass').placeholder = c.mqtt_pass_set ? '•••••• (saved)' : '';
    $('passNote').innerHTML = c.mqtt_pass_set ? 'Leave empty to keep the saved password. <button class="link" type="button" id="passClear">Remove it</button>' : '';
    if (c.mqtt_pass_set) $('passClear').addEventListener('click', async () => {
      if (await saveSettings({ mqtt_pass_clear: '1' }, $('e-mqtt'))) { toast('Password removed'); loadAdmin(true); }
    });
    $('mqtt_prefix').value = c.mqtt_prefix;
    setMode(c.net_mode);
    ['ip', 'gateway', 'subnet', 'dns1', 'dns2'].forEach((k) => { $(k).value = c[k] === '0.0.0.0' ? '' : c[k]; });
    $('wifi_ssid').value = '';
    $('wifi_password').value = '';
    syncEnabled();
  }
  function renderAdmin() {
    const i = INFO, c = CFG || {};
    const wl = i.webhook_last;
    $('whLast').innerHTML = !wl.at ? 'Nothing sent since the last restart'
      : `<span class="tag ${wl.code >= 200 && wl.code < 300 ? 'ok' : 'bad'}" style="margin:0">${wl.code > 0 ? 'HTTP ' + wl.code : esc(wl.error || 'failed')}</span> ${dur(Math.max(0, i.uptime - wl.at))} ago`;
    $('mqttState').textContent = !c.mqtt_enabled ? 'Off' : (i.mqtt_connected ? 'Connected' : 'Not connected');
    const pfx = c.mqtt_prefix || 'interfon';
    $('pfx1').textContent = pfx;
    $('pfx2').textContent = pfx;
    $('evTopic').textContent = pfx + '/event';
    $('netNow').innerHTML = `<dt>IP</dt><dd>${esc(i.ip)}</dd><dt>Wi-Fi</dt><dd>${esc(i.ssid)} (${i.rssi} dBm)</dd>
      <dt>Mode</dt><dd>${c.net_mode === 'static' ? 'Fixed IP' : 'Automatic (DHCP)'}</dd><dt>MAC</dt><dd>${esc(i.mac)}</dd>`;
    $('sysInfo').innerHTML = `<dt>Firmware</dt><dd>ESPHome ${esc(i.esphome)}, built ${esc(i.built)}</dd>
      <dt>Up for</dt><dd>${dur(i.uptime)}</dd><dt>Free memory</dt><dd>${Math.round(i.free_heap / 1024)} KB</dd>
      <dt>Settings</dt><dd>${i.storage.loaded ? `saved (slot ${i.storage.slot}, #${i.storage.seq})` : 'factory defaults, never saved'}${i.storage.last_save_ok ? '' : ' · <b style="color:var(--bad)">last save FAILED</b>'}</dd>
      <dt>Address</dt><dd>${esc(i.ip)} · ${esc(i.mac)}</dd>`;
  }
  let adminTimer = setInterval(() => { if (location.hash && location.hash !== '#home') loadAdmin(); }, 5000);

  function setMode(m) {
    document.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === m ? 'true' : 'false'));
    $('staticFields').style.display = m === 'static' ? '' : 'none';
  }
  document.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const mode = () => document.querySelector('.seg button[aria-pressed=true]').dataset.mode;
  $('factory').addEventListener('click', () => {
    const f = CFG.factory;
    ['ip', 'gateway', 'subnet', 'dns1', 'dns2'].forEach((k) => { $(k).value = f[k] && f[k] !== '0.0.0.0' ? f[k] : ''; });
  });

  $('f-webhook').addEventListener('submit', async (e) => {
    e.preventDefault();
    const ok = await saveSettings({ webhook_enabled: swVal('webhook_enabled') ? '1' : '0',
      webhook_url: $('webhook_url').value.trim(), webhook_events: readMask('webhook_events') }, $('e-webhook'));
    if (ok) { toast('Saved'); loadAdmin(true); }
  });
  $('f-mqttev').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (await saveSettings({ mqtt_events: readMask('mqtt_events') }, $('e-mqttev'))) { toast('Saved'); loadAdmin(true); }
  });
  $('whTest').addEventListener('click', async () => {
    await fetch('/admin/test', { method: 'POST', body: new URLSearchParams({ what: 'webhook' }) });
    toast('Test sent. Result shows in a few seconds (uses the saved URL)');
    setTimeout(() => loadAdmin(), 4000);
  });
  $('f-mqtt').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = { mqtt_enabled: swVal('mqtt_enabled') ? '1' : '0', mqtt_host: $('mqtt_host').value.trim(),
      mqtt_port: $('mqtt_port').value, mqtt_user: $('mqtt_user').value.trim(), mqtt_prefix: $('mqtt_prefix').value.trim(),
      mqtt_discovery: swVal('mqtt_discovery') ? '1' : '0' };
    if ($('mqtt_pass').value) f.mqtt_pass = $('mqtt_pass').value;
    const j = await saveSettings(f, $('e-mqtt'));
    if (!j) return;
    if (j.reboot) restarting(location.host, 'Applying the MQTT settings.'); else { toast('Saved'); loadAdmin(true); }
  });
  $('mqttTest').addEventListener('click', async () => {
    await fetch('/admin/test', { method: 'POST', body: new URLSearchParams({ what: 'mqtt' }) });
    toast(INFO && INFO.mqtt_connected ? `Published to ${CFG.mqtt_prefix}/event` : 'MQTT is not connected');
  });
  $('f-net').addEventListener('submit', async (e) => {
    e.preventDefault();
    const m = mode();
    const f = { net_mode: m };
    if (m === 'static') ['ip', 'gateway', 'subnet', 'dns1', 'dns2'].forEach((k) => { f[k] = $(k).value.trim(); });
    if ($('wifi_ssid').value.trim()) { f.wifi_ssid = $('wifi_ssid').value.trim(); f.wifi_password = $('wifi_password').value; }
    const next = m === 'static' ? f.ip : null;
    if (!confirm(`Save and restart the intercom?${next && next !== INFO.ip ? `\n\nIt will move to ${next}.` : ''}`)) return;
    const j = await saveSettings(f, $('e-net'));
    if (!j) return;
    if (j.reboot) restarting(next || location.host, next ? '' : 'With DHCP the router picks the address. Find it in the router, in Homey, or via interfon.local.');
    else { toast('Nothing changed'); }
  });

  // After a restart: poll the (possibly new) address, then go there.
  function restarting(host, extra) {
    if (es) es.close();
    $('overlay').classList.add('show');
    $('ovText').textContent = `Waiting for the intercom at ${host}… ${extra || ''}`;
    const t0 = Date.now();
    const poll = setInterval(async () => {
      if (Date.now() - t0 < 6000) return;         // let it actually go down first
      if (host === location.host) {
        try { await getJSON('/admin/info'); clearInterval(poll); location.reload(); } catch (_) {}
      } else {
        // Another origin: a no-cors fetch resolves on ANY HTTP answer (even 401) and only
        // rejects when nothing responds, which is exactly "is it back yet".
        try {
          await fetch(`http://${host}/`, { mode: 'no-cors', cache: 'no-store' });
          clearInterval(poll);
          location.href = `http://${host}/#network`;
        } catch (_) {}
      }
      if (Date.now() - t0 > 90000) {
        clearInterval(poll);
        $('ovTitle').textContent = 'Not back yet';
        $('ovText').textContent = `No answer at ${host} after 90 s. If the settings were wrong it has opened the "Interfon WiFi" hotspot: join it and open http://192.168.4.1.`;
      }
    }, 2000);
  }

  $('sim').addEventListener('click', async () => { if (await post('button/Simulate ring', 'press')) toast('Test ring sent'); });
  $('reboot').addEventListener('click', async () => {
    if (!confirm('Restart the intercom? It is back in about 20 s.')) return;
    await fetch('/admin/reboot', { method: 'POST' });
    restarting(location.host, '');
  });
  $('adv').addEventListener('click', () => {
    if (es) es.close();
    clearInterval(adminTimer);
    document.head.querySelectorAll('style').forEach((n) => n.remove());
    document.body.innerHTML = '<esp-app></esp-app>';
    const s = document.createElement('script');
    s.src = 'https://oi.esphome.io/v3/www.js';
    s.onerror = () => { document.body.textContent = 'The advanced page needs internet access (oi.esphome.io). Reload to go back.'; };
    document.body.appendChild(s);
  });

  // ---- live stream --------------------------------------------------------------
  let es = null;
  function connect() {
    es = new EventSource('/events');
    es.onopen = () => { $('dot').classList.add('on'); $('offline').classList.remove('show'); };
    es.onerror = () => { $('dot').classList.remove('on'); $('offline').classList.add('show'); };
    es.addEventListener('ping', (e) => { try { const j = JSON.parse(e.data); if (j.uptime != null) uptime = j.uptime; } catch (_) {} });
    es.addEventListener('state', (e) => {
      let j;
      try { j = JSON.parse(e.data); } catch (_) { return; }
      const prev = S[j.id];
      if (j.id === 'switch/Door relay' && prev && prev.value && !j.value) doorDone = true;
      S[j.id] = j;
      render();
    });
  }
  connect();
  route();
})();
