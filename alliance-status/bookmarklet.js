/*
 * Islandking Alliance Status — Bookmarklet
 * Laeuft als Panel-Overlay auf islandking.ch, keine Installation (baugleich
 * zum Tampermonkey-Userscript in diesem Ordner, nur oeffnet es sich hier
 * per Klick statt automatisch beim Laden der Seite).
 *
 * Nutzt ausschliesslich islandking.chs EIGENE API (same-origin) statt eines
 * externen GitHub-Datenrepos - die CSP der Seite (connect-src 'self')
 * blockt nur FREMDE Domains, same-origin-fetch() funktioniert
 * uneingeschraenkt. Kein GitHub-Token, kein Datenrepo, keine
 * bot-hosting.net-Abhaengigkeit noetig.
 *
 * Vier Tabs:
 * - Allianz: GET /api/alliance (+ /api/me zum Rausfiltern des eigenen
 *   Namens), 1:1 die Architektur aus modules/alliance/content.js der
 *   Allianz-Buddy-&-Tango-Suite-Extension, nur ohne deren Hintergrund-
 *   Watchdog/401-Auto-Reload (reiner Ein-Klick-Overlay ohne
 *   Automatisierungsrisiko).
 * - Verfolgt: manuell eingetragene Spielernamen (auch ausserhalb der
 *   eigenen Allianz), je einzeln ueber GET /api/rankings?q=<name> gesucht -
 *   1:1 das Verfolgt-Tab-Muster aus der eigenstaendigen "Islandking
 *   Alliance Status"-Extension (content.js trackedTick/apiFetch).
 * - Angriffe: GET /api/alliance/fleets liefert bereits serverseitig nach
 *   Allianz gefiltert {incoming:[...], outgoing:[...]}. Echtes Feldschema
 *   je Eintrag (live verifiziert 2026-09-14, Nutzer-Report "Daten
 *   unvollstaendig" - die urspruengliche Annahme aus der HAR-Capture war
 *   falsch, weil outgoing dort leer war): player, playerId, origin
 *   (Name der Herkunftsinsel), target:{x,y,islandName,owner}, shipCount,
 *   soldierCount, arriveAt, remainingSeconds.
 *   Gleicher Endpoint wie im Attack-Notifier (background.js), dort aber
 *   nur die incoming-Haelfte fuer Notifications genutzt.
 *   v1.3.0: roter Punkt am Angriffe-Tab bei neu hinzugekommenen Flotten
 *   (in-memory-Vergleich gegen den letzten Fetch), verschwindet beim
 *   Oeffnen des Tabs.
 * - Spähposten (v1.4.0): GET /api/islands liefert alle eigenen Inseln,
 *   GET /api/islands/<id>/incoming liefert je Insel {hasOutpost,
 *   incoming:[...]} - eigener Spähposten-Fund, NICHT allianzweit wie der
 *   Angriffe-Tab. Tab bleibt unsichtbar, solange keine eigene Insel einen
 *   gebauten Spähposten hat (hasOutpost:true bei mind. einer Insel).
 *   incoming war in allen getesteten Faellen leer ([]) - Feldschema der
 *   Eintraege daher ungetestet, generisch/tolerant gerendert (gleiches
 *   Muster wie outgoing beim Angriffe-Tab). Roter Punkt wie beim
 *   Angriffe-Tab bei neu hinzugekommenen Meldungen.
 */
(function () {
  const existing = document.getElementById('ikas-panel');
  if (existing) { existing.__ikasCleanup?.(); existing.remove(); return; }

  const LS_LAST_SEEN = 'ikas_lastSeenById';
  const LS_FAVORITES = 'ikas_favorites';
  const LS_ALL_COLLAPSED = 'ikas_allMembersCollapsed';
  const LS_TRACKED_NAMES = 'ikas_trackedNames';
  const LS_TRACKED_LAST_SEEN = 'ikas_trackedLastSeenByName';
  const REFRESH_MS = 10000;

  function loadJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
  }
  function saveJson(key, value) { localStorage.setItem(key, JSON.stringify(value)); }

  // ---------------------------------------------------------------------
  // API — same-origin, Bearer-Token aus localStorage (verifizierter
  // Mechanismus, siehe Kommentar oben).
  // ---------------------------------------------------------------------

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  function getAuthToken() {
    try { return localStorage.getItem('access_token'); } catch { return null; }
  }

  // Reaktiver Reload bei 401 statt nur periodisch (siehe reloadHandle weiter
  // unten): der 5-Min-Timer kann den tatsaechlichen Ablaufzeitpunkt des
  // Tokens verpassen. Erst nach mehreren FOLGE-401ern reloaden (1:1 das
  // schon geloeste Muster aus content.js der eigenstaendigen Alliance-
  // Status-Extension, Nutzer-Feedback 2026-09-08): direkt nach einem Reload
  // hat die Seite den Token oft noch nicht neu getauscht, ein einzelnes
  // 401 ist dann nur transient - sofortiges Reloaden darauf loeste eine
  // Reload-Schleife aus (Nutzer-Report 2026-09-13). Cooldown weiterhin per
  // localStorage (nicht nur in-memory, da ein Reload den Skript-Zustand
  // ohnehin verwirft).
  const LS_LAST_AUTH_RELOAD = 'ikas_lastAuthReload';
  const AUTH_RELOAD_COOLDOWN_MS = 60000;
  const AUTO_RELOAD_AFTER_401 = 3;
  let consecutive401 = 0;
  function reloadOn401() {
    consecutive401 += 1;
    if (consecutive401 < AUTO_RELOAD_AFTER_401) return;
    const last = Number(localStorage.getItem(LS_LAST_AUTH_RELOAD)) || 0;
    if (Date.now() - last < AUTH_RELOAD_COOLDOWN_MS) return;
    localStorage.setItem(LS_LAST_AUTH_RELOAD, String(Date.now()));
    location.reload();
  }

  async function apiFetch(path) {
    const token = getAuthToken();
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await fetch(path, { credentials: 'include', headers });
    } catch (err) {
      throw new ApiError(0, 'Netzwerkfehler: ' + (err?.message || String(err)));
    }
    let body = null;
    try { body = await res.json(); } catch { /* leere/ungueltige Antwort */ }
    if (!res.ok) {
      if (res.status === 401) reloadOn401();
      else consecutive401 = 0;
      throw new ApiError(res.status, body?.error || ('HTTP ' + res.status));
    }
    consecutive401 = 0;
    return body;
  }

  function describeError(err) {
    if (err instanceof ApiError) {
      if (err.status === 401) return 'Session abgelaufen (401) - Seite neu laden/einloggen.';
      if (err.status === 403) return 'Zugriff verweigert (403).';
      if (err.status === 0) return err.message;
      return `HTTP ${err.status}: ${err.message}`;
    }
    return err?.message || String(err);
  }

  async function getOwnName() {
    try {
      const data = await apiFetch('/api/me');
      return data?.player?.displayName ?? null;
    } catch {
      return null;
    }
  }

  function formatElapsed(ms) {
    if (ms == null) return 'noch nie gesehen';
    const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return 'gerade eben';
    const m = Math.round(s / 60);
    if (m < 60) return `vor ${m} Min.`;
    const h = Math.round(m / 60);
    if (h < 24) return `vor ${h} Std.`;
    return `vor ${Math.round(h / 24)} Tag(en)`;
  }

  // ---------------------------------------------------------------------
  // UI-Grundgeruest
  // ---------------------------------------------------------------------

  function readPref(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function writePref(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* privater Modus o.ae. — Praeferenz einfach nicht gemerkt */ }
  }

  // Gemeinsame Stapel-Konvention ALLER islandking.ch-Bookmarklets/-
  // Userscripts: dockt je Seite unter das unterste bereits offene Panel
  // derselben Seite an. Seq-basiert statt "alle anderen derselben Seite":
  // jedes Panel bekommt beim Erzeugen eine fortlaufende Nummer
  // (window.__ikbmSeq, geteilt ueber ALLE Scripts hinweg, da @grant none
  // -> gleiches window). Beim Stacken zaehlen nur Panels mit KLEINERER
  // Seq (= frueher erzeugt), nie juengere — sonst wuerden sich zwei
  // gleichseitige, unabhaengig per Intervall pollende Panels gegenseitig
  // beobachten und bei jedem Tick unbegrenzt nach unten aufschaukeln (A
  // reagiert auf B's letzten Stand, B auf A's gerade aktualisierten).
  function nextPanelSeq() {
    window.__ikbmSeq = (window.__ikbmSeq || 0) + 1;
    return window.__ikbmSeq;
  }
  function computeStackTop(side, selfSeq) {
    const others = Array.from(document.querySelectorAll('[data-ikbm-panel][data-ikbm-side="' + side + '"]'))
      .filter((el) => Number(el.dataset.ikbmSeq) < selfSeq);
    let maxBottom = 100;
    others.forEach((el) => { maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom); });
    return Math.round(others.length ? maxBottom + 12 : maxBottom);
  }

  const PANEL_ID = 'ikas-panel';
  const SIDE_KEY = 'ikbm-side-' + PANEL_ID;
  const COLLAPSED_KEY = 'ikbm-collapsed-' + PANEL_ID;
  const side = readPref(SIDE_KEY, 'left');
  const collapsed = readPref(COLLAPSED_KEY, '0') === '1';
  const seq = nextPanelSeq();

  // v1.6.13: feste Hoehe statt dynamischer max-height (Nutzerwunsch) -
  // Panel soll immer die Standardgroesse zeigen (5 Favoriten + Mitglieder-
  // Zeile sichtbar), lange Listen scrollen intern wie zuvor.
  // v1.6.13-Korrektur (2026-09-14): CSS nutzte hier noch "max-height" statt
  // "height" - dadurch war dieses Bookmarklet nie wirklich auf feste Hoehe
  // umgestellt (Kommentar und Code liefen auseinander, nur userscript.js
  // hatte den echten Fix). v1.6.14: "height" statt "max-height" NACHGEZOGEN
  // + BODY_HEIGHT 330px -> 190px (Nutzerwunsch, siehe userscript.js).
  // v1.6.15: 190px war zu knapp - BODY_HEIGHT auf 300px angehoben.
  const BODY_HEIGHT = 300;
  const VERSION = 'v1.6.15';
  const TITLE = '🤝 Allianz Status <span style="opacity:.5;font-weight:normal;font-size:11px">' + VERSION + '</span>';

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.dataset.ikbmPanel = '1';
  panel.dataset.ikbmSide = side;
  panel.dataset.ikbmSeq = seq;
  panel.style.cssText = 'position:fixed;width:420px;display:flex;flex-direction:column;'
    + 'background:#0f1b2b;color:#e6edf3;border:1px solid #24344a;border-radius:8px;'
    + 'font:13px/1.4 system-ui,sans-serif;padding:14px;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  panel.innerHTML = '<div data-role="header" style="display:flex;justify-content:space-between;align-items:center;flex:none;' + (collapsed ? '' : 'margin-bottom:8px') + '">'
    + '<b data-role="collapse-toggle" style="cursor:pointer;user-select:none">' + (collapsed ? '▸' : '▾') + ' ' + TITLE + '</b>'
    + '<span style="display:flex;gap:10px;align-items:center">'
    + '<span data-role="side-toggle" title="Seite wechseln (aktuell: ' + (side === 'left' ? 'links' : 'rechts') + ')" style="cursor:pointer;opacity:.7">⇄</span>'
    + '<span data-role="close" style="cursor:pointer;opacity:.7">✕</span>'
    + '</span></div>'
    + '<div data-role="body" style="display:flex;flex-direction:column;flex:1;min-height:0"' + (collapsed ? ' hidden' : '') + '>'
    + '<nav style="display:flex;gap:4px;margin-bottom:10px;flex:none">'
    + '<button id="ikas-tab-alliance" class="ikas-tabbtn">Allianz</button>'
    + '<button id="ikas-tab-tracked" class="ikas-tabbtn">Verfolgt</button>'
    + '<button id="ikas-tab-attacks" class="ikas-tabbtn">Angriffe<span id="ikas-attacks-dot" class="dot" hidden></span></button>'
    + '<button id="ikas-tab-scout" class="ikas-tabbtn" style="display:none">Spähposten<span id="ikas-scout-dot" class="dot" hidden></span></button>'
    + '</nav>'
    + '<div id="ikas-alliance" style="overflow:auto;height:' + BODY_HEIGHT + 'px;scrollbar-gutter:stable;padding-right:8px;box-sizing:border-box">Lade…</div>'
    + '<div id="ikas-tracked" style="display:none;overflow:auto;height:' + BODY_HEIGHT + 'px;scrollbar-gutter:stable;padding-right:8px;box-sizing:border-box"></div>'
    + '<div id="ikas-attacks" style="display:none;overflow:auto;height:' + BODY_HEIGHT + 'px;scrollbar-gutter:stable;padding-right:8px;box-sizing:border-box"></div>'
    + '<div id="ikas-scout" style="display:none;overflow:auto;height:' + BODY_HEIGHT + 'px;scrollbar-gutter:stable;padding-right:8px;box-sizing:border-box"></div>'
    + '</div>';
  document.body.appendChild(panel);

  const header = panel.querySelector('[data-role="header"]');
  const collapseToggle = panel.querySelector('[data-role="collapse-toggle"]');
  const sideToggle = panel.querySelector('[data-role="side-toggle"]');
  const closeBtn = panel.querySelector('[data-role="close"]');
  const panelBody = panel.querySelector('[data-role="body"]');

  collapseToggle.addEventListener('click', () => {
    const next = !panelBody.hidden;
    panelBody.hidden = next;
    collapseToggle.innerHTML = (next ? '▸ ' : '▾ ') + TITLE;
    header.style.marginBottom = next ? '0' : '8px';
    writePref(COLLAPSED_KEY, next ? '1' : '0');
  });

  sideToggle.addEventListener('click', () => {
    const next = panel.dataset.ikbmSide === 'left' ? 'right' : 'left';
    panel.dataset.ikbmSide = next;
    sideToggle.title = 'Seite wechseln (aktuell: ' + (next === 'left' ? 'links' : 'rechts') + ')';
    writePref(SIDE_KEY, next);
  });

  function reposition() {
    const s = panel.dataset.ikbmSide;
    const top = computeStackTop(s, seq);
    panel.style.top = top + 'px';
    if (s === 'left') { panel.style.left = '20px'; panel.style.right = ''; }
    else { panel.style.right = '20px'; panel.style.left = ''; }
  }
  reposition();
  const repositionHandle = setInterval(reposition, 250);

  panel.__ikasCleanup = () => { clearInterval(refreshHandle); clearInterval(repositionHandle); };
  closeBtn.onclick = () => { panel.__ikasCleanup(); panel.remove(); };

  const style = document.createElement('style');
  style.textContent = '#ikas-panel .ikas-tabbtn{position:relative;flex:1;padding:5px;border:1px solid #24344a;background:#142338;color:#e6edf3;border-radius:5px;cursor:pointer;font-size:12px}'
    + '#ikas-panel .ikas-tabbtn.active{background:#1f6feb;border-color:#1f6feb}'
    + '#ikas-panel .dot{position:absolute;top:2px;right:4px;width:7px;height:7px;border-radius:50%;background:#f2a0a0}'
    + '#ikas-panel .status{font-size:11px;color:#66727f;margin-bottom:8px}'
    + '#ikas-panel .error{color:#f2a0a0}'
    + '#ikas-panel .group-label{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:#f0d68a;margin:10px 0 4px;display:flex;align-items:center;gap:4px;cursor:default}'
    + '#ikas-panel .group-label.collapsible{cursor:pointer;user-select:none}'
    + '#ikas-panel .box{display:flex;align-items:center;gap:8px;background:#142338;border:1px solid #24344a;border-radius:6px;padding:4px 8px;margin-bottom:4px}'
    + '#ikas-panel .box.favorite{background:#1c2410;border-color:#4a4620}'
    + '#ikas-panel .box.incoming{background:#3a1414;border-color:#7a2a2a}'
    + '#ikas-panel .box.outgoing{background:#123a1e;border-color:#2a7a44}'
    + '#ikas-panel .box .info{flex:1;min-width:0}'
    + '#ikas-panel .box .name{font-weight:600;font-size:12px}'
    + '#ikas-panel .box .meta{font-size:11px;color:#a9c6f0}'
    + '#ikas-panel .box .meta.on{color:#9fe0c0}'
    + '#ikas-panel .box .time{font-size:11px;color:#7f95b3;white-space:nowrap;flex-shrink:0}'
    + '#ikas-panel .pin{background:none;border:none;color:#a9c6f0;opacity:.5;cursor:pointer;font-size:14px}'
    + '#ikas-panel .pin.active{color:#f0d68a;opacity:1}'
    + '#ikas-panel .rm{background:none;border:none;color:#f2a0a0;cursor:pointer;font-size:14px}'
    + '#ikas-panel .msg{color:#a9c6f0;text-decoration:none;opacity:.75}'
    + '#ikas-panel input[type=text]{flex:1;background:#0f1b2b;border:1px solid #24344a;color:#e6edf3;border-radius:4px;padding:5px 7px;font-size:12px}'
    + '#ikas-panel button.add{padding:5px 10px;border:none;border-radius:5px;background:#1f6feb;color:#fff;cursor:pointer;font-size:12px}';
  panel.appendChild(style);

  let activeTabName = 'alliance';
  function activateTab(tab) {
    activeTabName = tab;
    document.getElementById('ikas-tab-alliance').classList.toggle('active', tab === 'alliance');
    document.getElementById('ikas-tab-tracked').classList.toggle('active', tab === 'tracked');
    document.getElementById('ikas-tab-attacks').classList.toggle('active', tab === 'attacks');
    document.getElementById('ikas-tab-scout').classList.toggle('active', tab === 'scout');
    document.getElementById('ikas-alliance').style.display = tab === 'alliance' ? 'block' : 'none';
    document.getElementById('ikas-tracked').style.display = tab === 'tracked' ? 'block' : 'none';
    document.getElementById('ikas-attacks').style.display = tab === 'attacks' ? 'block' : 'none';
    document.getElementById('ikas-scout').style.display = tab === 'scout' ? 'block' : 'none';
    if (tab === 'attacks') document.getElementById('ikas-attacks-dot').hidden = true;
    if (tab === 'scout') document.getElementById('ikas-scout-dot').hidden = true;
  }
  document.getElementById('ikas-tab-alliance').onclick = () => activateTab('alliance');
  document.getElementById('ikas-tab-tracked').onclick = () => activateTab('tracked');
  document.getElementById('ikas-tab-attacks').onclick = () => activateTab('attacks');
  document.getElementById('ikas-tab-scout').onclick = () => activateTab('scout');
  activateTab('alliance');

  // ---------------------------------------------------------------------
  // Allianz-Tab
  // ---------------------------------------------------------------------

  async function renderAlliance() {
    const body = document.getElementById('ikas-alliance');
    let data, ownName;
    try {
      [data, ownName] = await Promise.all([apiFetch('/api/alliance'), getOwnName()]);
    } catch (err) {
      body.innerHTML = `<div class="status error">Fehler: ${describeError(err)}</div>`;
      return;
    }

    const alliance = data?.alliance;
    if (!alliance || !Array.isArray(alliance.members)) {
      body.innerHTML = '<div class="status error">Unerwartete Antwort (kein alliance.members-Array).</div>';
      return;
    }

    const members = alliance.members
      .filter((m) => !ownName || m.name.toLowerCase() !== ownName.toLowerCase())
      .map((m) => ({ id: m.id, name: m.name, online: !!m.online }));

    // "Zuletzt online" ist keine API-liefernde Angabe - eigene Schaetzung:
    // Zeitpunkt des letzten Refreshs, bei dem online=true war, persistiert
    // in localStorage (ueberlebt Panel schliessen/neu oeffnen).
    const lastSeenById = loadJson(LS_LAST_SEEN, {});
    const now = Date.now();
    for (const m of members) if (m.online) lastSeenById[m.id] = now;
    saveJson(LS_LAST_SEEN, lastSeenById);

    const favorites = loadJson(LS_FAVORITES, []);
    const favSet = new Set(favorites);
    const sortByOnlineThenName = (a, b) => (a.online !== b.online ? (a.online ? -1 : 1) : a.name.localeCompare(b.name, 'de'));
    const favMembers = members.filter((m) => favSet.has(m.id)).sort(sortByOnlineThenName);
    const otherMembers = members.filter((m) => !favSet.has(m.id)).sort(sortByOnlineThenName);
    const collapsed = loadJson(LS_ALL_COLLAPSED, false);

    body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'status';
    title.textContent = alliance.name
      ? `${alliance.name} · ${members.filter((m) => m.online).length}/${members.length} online`
      : 'Keine Allianz-Daten gefunden.';
    body.appendChild(title);

    function renderMemberBox(m) {
      const box = document.createElement('div');
      box.className = 'box' + (favSet.has(m.id) ? ' favorite' : '');
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = `<div class="name">${m.online ? '🟢' : '🔴'} ${m.name}</div>`
        + `<div class="meta ${m.online ? 'on' : ''}">${m.online ? 'Online' : formatElapsed(lastSeenById[m.id])}</div>`;
      const pin = document.createElement('button');
      pin.className = 'pin' + (favSet.has(m.id) ? ' active' : '');
      pin.textContent = '📌';
      pin.title = favSet.has(m.id) ? 'Favorit entfernen' : 'Favorisieren';
      pin.onclick = () => {
        const next = favSet.has(m.id) ? favorites.filter((id) => id !== m.id) : [...favorites, m.id];
        saveJson(LS_FAVORITES, next);
        renderAlliance();
      };
      const msg = document.createElement('a');
      msg.className = 'msg';
      msg.href = `https://islandking.ch/messages?to=${encodeURIComponent(m.name)}`;
      msg.target = '_blank';
      msg.rel = 'noopener';
      msg.textContent = '✉';
      box.append(info, pin, msg);
      return box;
    }

    if (favMembers.length) {
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = '📌 Favoriten';
      body.appendChild(label);
      for (const m of favMembers) body.appendChild(renderMemberBox(m));
    }

    if (otherMembers.length) {
      const label = document.createElement('div');
      label.className = 'group-label collapsible';
      label.textContent = (collapsed ? '▶ ' : '▼ ') + `Alle Mitglieder (${otherMembers.length})`;
      label.onclick = () => { saveJson(LS_ALL_COLLAPSED, !collapsed); renderAlliance(); };
      body.appendChild(label);
      if (!collapsed) for (const m of otherMembers) body.appendChild(renderMemberBox(m));
    }
  }

  // ---------------------------------------------------------------------
  // Verfolgt-Tab — manuell eingetragene Spielernamen, gesucht ueber
  // GET /api/rankings?q=<name> (1:1 aus der Alliance-Status-Extension).
  // ---------------------------------------------------------------------

  async function renderTracked() {
    const root = document.getElementById('ikas-tracked');
    const names = loadJson(LS_TRACKED_NAMES, []);

    root.innerHTML = '<div style="display:flex;gap:6px;margin-bottom:10px">'
      + '<input type="text" id="ikas-add-input" placeholder="Spielername…">'
      + '<button class="add" id="ikas-add-btn">Hinzufügen</button></div>'
      + '<div id="ikas-tracked-list"></div>';

    document.getElementById('ikas-add-btn').onclick = () => {
      const input = document.getElementById('ikas-add-input');
      const name = input.value.trim();
      if (!name) return;
      if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) {
        saveJson(LS_TRACKED_NAMES, [...names, name]);
      }
      renderTracked();
    };

    const list = document.getElementById('ikas-tracked-list');
    if (names.length === 0) {
      list.innerHTML = '<div class="status">Noch keine verfolgten Spieler.</div>';
      return;
    }
    list.innerHTML = '<div class="status">Lade…</div>';

    const lastSeenByName = loadJson(LS_TRACKED_LAST_SEEN, {});
    const now = Date.now();
    const results = {};
    for (const name of names) {
      try {
        const data = await apiFetch(`/api/rankings?q=${encodeURIComponent(name)}`);
        const players = Array.isArray(data?.players) ? data.players : [];
        const match = players.find((p) => p.name.toLowerCase() === name.toLowerCase()) || players[0] || null;
        if (match?.online) lastSeenByName[name] = now;
        results[name] = match
          ? { found: true, score: match.score, alliance: match.alliance, rank: match.rank, online: !!match.online }
          : { found: false };
      } catch (err) {
        results[name] = { found: false, error: describeError(err) };
      }
    }
    saveJson(LS_TRACKED_LAST_SEEN, lastSeenByName);

    list.innerHTML = '';
    for (const name of names) {
      const r = results[name];
      const box = document.createElement('div');
      box.className = 'box';
      const info = document.createElement('div');
      info.className = 'info';
      if (!r || r.error) {
        info.innerHTML = `<div class="name">⚠️ ${name}</div><div class="meta error">${r?.error || 'Fehler'}</div>`;
      } else if (!r.found) {
        info.innerHTML = `<div class="name">❓ ${name}</div><div class="meta">Nicht gefunden (Tippfehler?)</div>`;
      } else {
        const parts = [];
        if (r.alliance) parts.push(r.alliance);
        if (r.rank != null) parts.push('Rang ' + r.rank);
        if (r.score != null) parts.push(r.score.toLocaleString('de-DE') + ' Punkte');
        info.innerHTML = `<div class="name">${r.online ? '🟢' : '🔴'} ${name}</div>`
          + `<div class="meta ${r.online ? 'on' : ''}">${r.online ? 'Online' : (parts.join(' · ') || formatElapsed(lastSeenByName[name]))}</div>`;
      }
      const msg = document.createElement('a');
      msg.className = 'msg';
      msg.href = `https://islandking.ch/messages?to=${encodeURIComponent(name)}`;
      msg.target = '_blank';
      msg.rel = 'noopener';
      msg.textContent = '✉';
      const rm = document.createElement('button');
      rm.className = 'rm';
      rm.textContent = '✕';
      rm.title = 'Entfernen';
      rm.onclick = () => {
        saveJson(LS_TRACKED_NAMES, names.filter((n) => n !== name));
        renderTracked();
      };
      box.append(info, msg, rm);
      list.appendChild(box);
    }
  }

  // ---------------------------------------------------------------------
  // Angriffe-Tab — GET /api/alliance/fleets, siehe Kommentar am Dateikopf.
  // ---------------------------------------------------------------------

  function formatCountdown(iso) {
    const ms = new Date(iso).getTime() - Date.now();
    if (Number.isNaN(ms)) return '?';
    if (ms <= 0) return 'eingetroffen';
    const s = Math.round(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${sec}s`;
    return `${sec}s`;
  }

  // Echtes Response-Schema von /api/alliance/fleets live verifiziert
  // (2026-09-14, Nutzer-Report "Daten unvollstaendig"): {player, playerId,
  // origin, target:{x,y,islandName,owner}, shipCount, soldierCount,
  // arriveAt, remainingSeconds} — abweichend von den zuvor angenommenen
  // (nie existierenden) Feldern f.islandName/f.count/f.x/f.y.
  function renderFleetBox(f, incoming) {
    const box = document.createElement('div');
    box.className = incoming ? 'box incoming' : 'box outgoing';
    const info = document.createElement('div');
    info.className = 'info';
    const t = f.target || {};
    const coords = (t.x != null && t.y != null) ? ` (${t.x}|${t.y})` : '';
    const counts = [];
    if (f.shipCount != null) counts.push(`🚢 ${f.shipCount}`);
    if (f.soldierCount) counts.push(`⚔️ ${f.soldierCount}`);
    const metaParts = [];
    if (f.origin) metaParts.push(f.origin);
    metaParts.push(`→${coords} ${t.owner || t.islandName || '?'}`);
    if (counts.length) metaParts.push(counts.join(' · '));
    info.innerHTML = `<div class="name">${f.player || '?'}</div>`
      + `<div class="meta">${metaParts.join(' · ')}</div>`;
    box.appendChild(info);
    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = formatCountdown(f.arriveAt);
    box.appendChild(time);
    return box;
  }

  // Erkennung neuer Flotten seit dem letzten Render — in localStorage
  // persistiert (LS_KNOWN_FLEETS), NICHT mehr rein in-memory: der
  // 10-Minuten-Auto-Reload (siehe unten) wuerde sonst bei jedem Reload die
  // Baseline auf null zuruecksetzen und einen Angriff, der kurz nach einem
  // Reload eintrifft, beim ersten Fetch stillschweigend als "schon bekannt"
  // einstufen statt den Punkt zu zeigen (Bug gefunden 2026-09-13, Nutzer-
  // Report "Angriff kam rein, kein Punkt am Tab"). null bleibt weiterhin
  // moeglich (erster Start ueberhaupt, localStorage leer) -> dann wie
  // bisher kein Punkt fuer bereits laufende Angriffe beim allerersten Fetch.
  const LS_KNOWN_FLEETS = 'ikas_knownFleetKeys';
  let knownFleetKeys = (() => {
    const arr = loadJson(LS_KNOWN_FLEETS, null);
    return Array.isArray(arr) ? new Set(arr) : null;
  })();
  function fleetKey(f) { return [f.player, f.target?.x, f.target?.y, f.arriveAt].join('|'); }

  async function renderAttacks() {
    const body = document.getElementById('ikas-attacks');
    let data;
    try {
      data = await apiFetch('/api/alliance/fleets');
    } catch (err) {
      body.innerHTML = `<div class="status error">Fehler: ${describeError(err)}</div>`;
      return;
    }

    const incoming = (Array.isArray(data?.incoming) ? data.incoming : [])
      .slice().sort((a, b) => new Date(a.arriveAt) - new Date(b.arriveAt));
    const outgoing = (Array.isArray(data?.outgoing) ? data.outgoing : [])
      .slice().sort((a, b) => new Date(a.arriveAt) - new Date(b.arriveAt));

    const currentKeys = new Set([...incoming, ...outgoing].map(fleetKey));
    const hasNew = knownFleetKeys && [...currentKeys].some((k) => !knownFleetKeys.has(k));
    knownFleetKeys = currentKeys;
    saveJson(LS_KNOWN_FLEETS, [...currentKeys]);
    if (hasNew && activeTabName !== 'attacks') document.getElementById('ikas-attacks-dot').hidden = false;

    body.innerHTML = '';
    const title = document.createElement('div');
    title.className = 'status';
    title.textContent = `${incoming.length} eingehend · ${outgoing.length} ausgehend`;
    body.appendChild(title);

    if (!incoming.length && !outgoing.length) {
      const none = document.createElement('div');
      none.className = 'status';
      none.textContent = 'Keine laufenden Angriffe.';
      body.appendChild(none);
      return;
    }

    if (incoming.length) {
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = '🛡️ Eingehend';
      body.appendChild(label);
      for (const f of incoming) body.appendChild(renderFleetBox(f, true));
    }
    if (outgoing.length) {
      const label = document.createElement('div');
      label.className = 'group-label';
      label.textContent = '🚀 Ausgehend';
      body.appendChild(label);
      for (const f of outgoing) body.appendChild(renderFleetBox(f));
    }
  }

  // ---------------------------------------------------------------------
  // Spähposten-Tab — GET /api/islands (eigene Inseln) + je Insel GET
  // /api/islands/<id>/incoming, siehe Kommentar am Dateikopf. Anders als
  // Angriffe: rein eigene Inseln, nicht allianzweit.
  // ---------------------------------------------------------------------

  function renderScoutEntry(e) {
    const box = document.createElement('div');
    box.className = 'box';
    const info = document.createElement('div');
    info.className = 'info';
    const label = e.player || e.name || e.owner || '?';
    const coords = (e.x != null && e.y != null) ? ` (${e.x}|${e.y})` : '';
    const metaParts = [];
    if (e.islandName) metaParts.push(e.islandName);
    if (e.count != null) metaParts.push(`${e.count} Flotte(n)`);
    const eta = e.arriveAt ? formatCountdown(e.arriveAt) : null;
    if (eta) metaParts.push('Ankunft in ' + eta);
    info.innerHTML = `<div class="name">🔭 ${label}${coords}</div>`
      + `<div class="meta">${metaParts.join(' · ') || 'Details unbekannt'}</div>`;
    box.appendChild(info);
    return box;
  }

  // Gleiches in-memory-Vergleichsmuster wie knownFleetKeys beim Angriffe-Tab.
  let knownScoutKeys = null;

  async function renderScout() {
    const body = document.getElementById('ikas-scout');
    const tabBtn = document.getElementById('ikas-tab-scout');
    let islands;
    let results;
    try {
      islands = await apiFetch('/api/islands');
      results = await Promise.all(islands.map((isl) =>
        apiFetch('/api/islands/' + isl.id + '/incoming').then((d) => ({ isl, d }))));
    } catch (err) {
      tabBtn.style.display = 'none';
      return;
    }

    const withOutpost = results.filter((r) => r.d && r.d.hasOutpost);
    tabBtn.style.display = withOutpost.length ? '' : 'none';
    if (!withOutpost.length) {
      if (activeTabName === 'scout') activateTab('alliance');
      return;
    }

    const currentKeys = new Set();
    withOutpost.forEach((r) => {
      (r.d.incoming || []).forEach((e) => currentKeys.add(r.isl.id + '|' + JSON.stringify(e)));
    });
    const hasNew = knownScoutKeys && [...currentKeys].some((k) => !knownScoutKeys.has(k));
    knownScoutKeys = currentKeys;
    if (hasNew && activeTabName !== 'scout') document.getElementById('ikas-scout-dot').hidden = false;

    body.innerHTML = '';
    withOutpost.forEach((r) => {
      const label = document.createElement('div');
      label.className = 'group-label';
      const coords = r.isl.coordinates ? ` (${r.isl.coordinates.x} | ${r.isl.coordinates.y})` : '';
      label.textContent = `🔭 ${r.isl.name}${coords}`;
      body.appendChild(label);
      const entries = r.d.incoming || [];
      if (!entries.length) {
        const none = document.createElement('div');
        none.className = 'status';
        none.textContent = 'Keine herannahenden Flotten.';
        body.appendChild(none);
      } else {
        entries.forEach((e) => body.appendChild(renderScoutEntry(e)));
      }
    });
  }

  async function refreshAll() {
    await Promise.all([renderAlliance(), renderTracked(), renderAttacks(), renderScout()]);
  }

  const refreshHandle = setInterval(refreshAll, REFRESH_MS);
  refreshAll();

  // Nutzerwunsch: alle 10 Min. Seite neu laden, damit ein bald ablaufender
  // Token (~15 Min. Lebensdauer laut Notifier-Extension) proaktiv erneuert
  // wird statt erst nach einem sichtbaren 401 zu reagieren. Schliesst das
  // Panel (Bookmarklet injiziert sich nicht automatisch neu) - bewusst in
  // Kauf genommen.
  const reloadHandle = setInterval(() => location.reload(), 5 * 60 * 1000);
  const prevCleanup = panel.__ikasCleanup;
  panel.__ikasCleanup = () => { prevCleanup(); clearInterval(reloadHandle); };
})();
