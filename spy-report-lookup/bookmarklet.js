/*
 * Islandking Spy Report Lookup — Bookmarklet
 * Läuft same-origin auf islandking.ch (Panel-Overlay), keine Installation
 * (baugleich zum Tampermonkey-Userscript in diesem Ordner, nur öffnet es
 * sich hier per Klick statt automatisch beim Laden der Seite).
 *
 * Portierung der gleichnamigen Browser-Extension (siehe
 * plugins/islandking-spy-report-lookup-chrome_opera/content.js) als
 * eigenständiges Overlay-Panel — Spionage-Tab (GET /api/spy-reports)
 * + Flotte-Tab (GET /api/islands + /api/islands/:id/overview), Bearer-
 * Token aus localStorage. Ein-/ausklappbar, Seite frei wählbar, reiht
 * sich unter andere offene islandking.ch-Panels ein.
 */
(function () {
  const VERSION = 'v1.1.5';
  const existing = document.getElementById('iksr-panel');
  if (existing) { existing.__iksrCleanup?.(); existing.remove(); return; }

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
  // Seq (= frueher erzeugt), nie juengere.
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

  // Nutzer-Report 2026-09-18: frei positionierte Panels nehmen NICHT an
  // computeStackTop() teil (kein data-ikbm-side mehr), koennen sich also
  // beim Ausklappen ueber ein anderes Panel legen. Simpler Greedy-Fix:
  // nach dem Ausklappen pruefen, ob die eigene Box irgendein anderes Panel
  // ueberlappt, und falls ja, unter dessen Unterkante schieben - wiederholt
  // (max. 6x) fuer Ketten mehrerer ueberlappender Panels.
  function avoidOverlap(panel) {
    const GAP = 12;
    for (let i = 0; i < 6; i++) {
      const rect = panel.getBoundingClientRect();
      const other = Array.from(document.querySelectorAll('[data-ikbm-panel]')).find((el) => {
        if (el === panel) return false;
        const r = el.getBoundingClientRect();
        return rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top;
      });
      if (!other) break;
      const newTop = Math.round(other.getBoundingClientRect().bottom + GAP);
      panel.style.top = newTop + 'px';
      panel.style.maxHeight = 'calc(100vh - ' + newTop + 'px - 20px)';
    }
  }

  // Live an den Hell-/Dunkelmodus der Seite gekoppelt - 1:1 aus dem
  // Reisezeitenrechner/Kampfrechner uebernommen: islandking.ch schaltet die
  // Klasse "dark" auf <html> um, CSS-Variablen vererben sich an alle
  // Kind-Elemente und aktualisieren sich live.
  const IKBM_THEMES = {
    dark: { bg: '#0f1b2b', text: '#e6edf3', border: '#24344a', field: '#142338', gold: '#f0d68a' },
    light: { bg: '#f4f7fb', text: '#1a2333', border: '#c7d2e0', field: '#ffffff', gold: '#92700c' },
  };
  function ikbmCurrentTheme() {
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  }
  function applyIkbmTheme(panel) {
    const t = IKBM_THEMES[ikbmCurrentTheme()];
    panel.style.setProperty('--ikbm-bg', t.bg);
    panel.style.setProperty('--ikbm-text', t.text);
    panel.style.setProperty('--ikbm-border', t.border);
    panel.style.setProperty('--ikbm-field', t.field);
    panel.style.setProperty('--ikbm-gold', t.gold);
  }

  // ---------------------------------------------------------------------
  // API — same-origin, Bearer-Token aus localStorage.
  // ---------------------------------------------------------------------

  class ApiError extends Error {
    constructor(status, message) { super(message); this.status = status; }
  }

  function getAuthToken() {
    try { return localStorage.getItem('access_token'); } catch { return null; }
  }

  // Reaktiver Reload bei 401 (Lektion aus Allianz Status, 2026-09-13): ein
  // reiner Timer kann den tatsaechlichen Token-Ablauf verpassen. Cooldown
  // per localStorage verhindert eine Reload-Schleife, falls die API
  // dauerhaft 401 liefert (z.B. echter Logout statt nur abgelaufener Token).
  // Gemeinsame Keys mit ALLEN Panel-Scripts (statt eigenem iksr_-Key).
  const LS_LAST_PANEL_RELOAD = 'ikbm_lastPanelReload';
  const AUTH_RELOAD_COOLDOWN_MS = 30000;
  // Nutzer-Report 2026-09-18: Cooldown allein verhinderte nur schnelle
  // Reload-Schleifen, nicht den DAUERHAFTEN Fall (Session wirklich
  // abgelaufen). Gemeinsamer Versuchszaehler ueber ALLE Panels.
  const LS_RELOAD_ATTEMPTS = 'ikbm_reloadAttempts';
  const RELOAD_ATTEMPTS_MAX = 5;
  function reloadOn401() {
    const last = Number(localStorage.getItem(LS_LAST_PANEL_RELOAD)) || 0;
    if (Date.now() - last < AUTH_RELOAD_COOLDOWN_MS) return;
    const attempts = (Number(localStorage.getItem(LS_RELOAD_ATTEMPTS)) || 0) + 1;
    if (attempts > RELOAD_ATTEMPTS_MAX) {
      console.warn('[Islandking] Automatischer Reload nach ' + RELOAD_ATTEMPTS_MAX + ' erfolglosen Versuchen gestoppt - Session vermutlich abgelaufen, bitte manuell auf islandking.ch neu einloggen.');
      return;
    }
    localStorage.setItem(LS_RELOAD_ATTEMPTS, String(attempts));
    localStorage.setItem(LS_LAST_PANEL_RELOAD, String(Date.now()));
    location.reload();
  }

  async function apiFetch(path) {
    const token = getAuthToken();
    const headers = { Accept: 'application/json' };
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
      throw new ApiError(res.status, body?.error || ('HTTP ' + res.status));
    }
    localStorage.removeItem(LS_RELOAD_ATTEMPTS);
    return body;
  }

  function describeError(err) {
    if (err instanceof ApiError) {
      if (err.status === 401) return 'Session abgelaufen (401) - Seite wird neu geladen…';
      if (err.status === 403) return 'Zugriff verweigert (403).';
      if (err.status === 0) return err.message;
      return `HTTP ${err.status}: ${err.message}`;
    }
    return err?.message || String(err);
  }

  // ---------------------------------------------------------------------
  // Formatierung + Datenbeschaffung — 1:1 aus der Extension uebernommen.
  // ---------------------------------------------------------------------

  function formatNumber(n) {
    return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "'");
  }

  function formatReport(report) {
    const { target, islandName, coordinates, snapshot, createdAt } = report;
    const { resources, ships, soldiers, defense } = snapshot;
    const timestamp = new Date(createdAt).toLocaleString('de-CH');
    const buildings = defense.buildings.length
      ? defense.buildings.map((b) => `${b.name} Lv${b.level}`).join(', ')
      : '-';
    const shipsText = ships.length ? ships.map((s) => `${s.count}× ${s.name}`).join(', ') : '-';
    const soldiersText = soldiers.length ? soldiers.map((s) => `${s.count}× ${s.name}`).join(', ') : '-';
    return [
      `${target} · ${islandName} (${coordinates.x} | ${coordinates.y})`,
      timestamp,
      `Rohstoffe: Holz: ${formatNumber(resources.wood)}, Stein: ${formatNumber(resources.stone)}, Eisen: ${formatNumber(resources.iron)}`,
      `Verteidigung: ${defense.attack} · ${defense.hitPoints} HP`,
      `Verteidigungsgebäude: ${buildings}`,
      `Schiffe: ${shipsText}`,
      `Soldaten: ${soldiersText}`,
    ].join('\n');
  }

  // Ein Ziel kann mehrere Inseln haben, jede mit eigenem Spionagebericht -
  // sammelt daher ALLE Treffer (aktiv + archiviert), statt beim ersten
  // abzubrechen, damit der Aufrufer bei mehreren Treffern eine Auswahl
  // anzeigen kann (Nutzerwunsch 2026-09-13).
  async function findReports(username) {
    const needle = username.toLowerCase();
    let matches = [];
    for (const archived of [0, 1]) {
      const data = await apiFetch('/api/spy-reports?archived=' + archived);
      const found = (data?.reports || []).filter((r) => r.target.toLowerCase() === needle);
      matches = matches.concat(found);
    }
    return matches;
  }

  async function fetchFleetText() {
    const islands = await apiFetch('/api/islands');
    const island = islands.find((i) => i.isHome) ?? islands[0];
    if (!island) throw new Error('Keine Insel gefunden.');
    const overview = await apiFetch('/api/islands/' + island.id + '/overview');
    const units = [...overview.ships, ...overview.soldiers].filter((u) => u.count > 0);
    if (!units.length) return '-';
    return units.map((u) => `${u.count}× ${u.name}`).join(', ');
  }

  // ---------------------------------------------------------------------
  // Panel-Grundgeruest
  // ---------------------------------------------------------------------

  const PANEL_ID = 'iksr-panel';
  const SIDE_KEY = 'ikbm-side-' + PANEL_ID;
  const COLLAPSED_KEY = 'ikbm-collapsed-' + PANEL_ID;
  const POSMODE_KEY = 'ikbm-posmode-' + PANEL_ID;
  const POS_KEY = 'ikbm-pos-' + PANEL_ID;
  const side = readPref(SIDE_KEY, 'right');
  const collapsed = readPref(COLLAPSED_KEY, '0') === '1';
  let posMode = readPref(POSMODE_KEY, 'fixed');
  let fixedSide = side;
  const seq = nextPanelSeq();
  const TITLE_HTML = '🔎 Spy Report Lookup <span style="opacity:.5;font-weight:normal;font-size:11px">' + VERSION + '</span>';

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.dataset.ikbmPanel = '1';
  panel.dataset.ikbmSide = posMode === 'free' ? 'free' : side;
  panel.dataset.ikbmSeq = seq;
  // display:flex;flex-direction:column statt overflow:auto direkt auf dem
  // Panel: Header UND die Spionage/Flotte-Tabs (position:sticky im body
  // weiter unten) bleiben so fix sichtbar, nur der Inhalt darunter scrollt
  // (Nutzerwunsch, wie im Kampfrechner-Panel des Reisezeitenrechners
  // uebernommen).
  panel.style.cssText = 'position:fixed;width:420px;overflow:hidden;'
    + 'display:flex;flex-direction:column;'
    + 'background:var(--ikbm-bg);color:var(--ikbm-text);border:1px solid var(--ikbm-border);border-radius:8px;'
    + 'font:13px/1.4 system-ui,sans-serif;padding:14px;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  applyIkbmTheme(panel);
  panel.innerHTML = '<div data-role="header" style="flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;' + (collapsed ? '' : 'margin-bottom:8px') + '">'
    + '<b data-role="collapse-toggle" style="cursor:pointer;user-select:none">' + (collapsed ? '▸' : '▾') + ' ' + TITLE_HTML + '</b>'
    + '<span style="display:flex;gap:10px;align-items:center">'
    + '<span data-role="gear" title="Positionsmodus einstellen" style="cursor:pointer;opacity:.7">⚙️</span>'
    + '<span data-role="side-toggle" title="Seite wechseln (aktuell: ' + (side === 'left' ? 'links' : 'rechts') + ')" style="cursor:pointer;opacity:.7">⇄</span>'
    + '<span data-role="close" style="cursor:pointer;opacity:.7">✕</span>'
    + '</span></div>'
    + '<div data-role="body" id="iksr-body" style="flex:1;overflow:auto;min-height:0;scrollbar-gutter:stable;padding-right:8px;box-sizing:border-box"' + (collapsed ? ' hidden' : '') + '>'
    + '<nav style="display:flex;gap:4px;margin-bottom:10px;position:sticky;top:0;background:var(--ikbm-bg);padding:2px 0;z-index:1">'
    + '<button id="iksr-tab-spy" class="iksr-tabbtn active">Spionage</button>'
    + '<button id="iksr-tab-fleet" class="iksr-tabbtn">Flotte</button>'
    + '</nav>'
    + '<div id="iksr-spy-pane">'
    + '<input type="text" id="iksr-username" placeholder="Benutzername…">'
    + '<button class="primary" id="iksr-run-spy">Bericht auslesen</button>'
    + '</div>'
    + '<div id="iksr-spy-choices" style="display:none;margin-bottom:8px"></div>'
    + '<div id="iksr-fleet-pane" style="display:none">'
    + '<button class="primary" id="iksr-run-fleet">Flotte auslesen</button>'
    + '</div>'
    + '<div id="iksr-status" class="status"></div>'
    + '<textarea id="iksr-result" readonly></textarea>'
    + '<button class="secondary" id="iksr-copy">In die Zwischenablage kopieren</button>'
    + '</div>';
  document.body.appendChild(panel);

  const header = panel.querySelector('[data-role="header"]');
  const collapseToggle = panel.querySelector('[data-role="collapse-toggle"]');
  const gearBtn = panel.querySelector('[data-role="gear"]');
  const sideToggle = panel.querySelector('[data-role="side-toggle"]');
  const closeBtn = panel.querySelector('[data-role="close"]');
  const body = panel.querySelector('[data-role="body"]');

  // Positions-Menue als eigenes body-Element statt Panel-Kind: das Panel
  // hat overflow:hidden (fuer die runden Ecken), das schneidet ein absolut
  // positioniertes Kind-Menue ab, sobald das Panel eingeklappt ist.
  const posMenu = document.createElement('div');
  posMenu.style.cssText = 'display:none;position:fixed;background:var(--ikbm-field);border:1px solid var(--ikbm-border);color:var(--ikbm-text);border-radius:6px;padding:4px;z-index:1000000;font-size:12px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.4)';
  posMenu.innerHTML = '<div data-role="posmenu-fixed" style="padding:4px 10px;cursor:pointer;border-radius:4px">📌 Feste Position</div>'
    + '<div data-role="posmenu-free" style="padding:4px 10px;cursor:pointer;border-radius:4px">↔↕ Frei verschiebbar</div>';
  document.body.appendChild(posMenu);
  applyIkbmTheme(posMenu);
  const posMenuFixed = posMenu.querySelector('[data-role="posmenu-fixed"]');
  const posMenuFree = posMenu.querySelector('[data-role="posmenu-free"]');

  collapseToggle.addEventListener('click', () => {
    const next = !body.hidden;
    body.hidden = next;
    collapseToggle.innerHTML = (next ? '▸ ' : '▾ ') + TITLE_HTML;
    header.style.marginBottom = next ? '0' : '8px';
    writePref(COLLAPSED_KEY, next ? '1' : '0');
    if (!next && posMode === 'free') avoidOverlap(panel);
  });

  function reposition() {
    if (posMode === 'free') return;
    const s = panel.dataset.ikbmSide;
    const top = computeStackTop(s, seq);
    panel.style.top = top + 'px';
    if (s === 'left') { panel.style.left = '20px'; panel.style.right = ''; }
    else { panel.style.right = '20px'; panel.style.left = ''; }
    panel.style.maxHeight = 'calc(100vh - ' + top + 'px - 20px)';
  }

  sideToggle.addEventListener('click', () => {
    if (posMode === 'free') return;
    const next = panel.dataset.ikbmSide === 'left' ? 'right' : 'left';
    fixedSide = next;
    panel.dataset.ikbmSide = next;
    sideToggle.title = 'Seite wechseln (aktuell: ' + (next === 'left' ? 'links' : 'rechts') + ')';
    writePref(SIDE_KEY, next);
  });

  gearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (posMenu.style.display === 'none') {
      const rect = gearBtn.getBoundingClientRect();
      posMenu.style.top = (rect.bottom + 4) + 'px';
      posMenu.style.right = (window.innerWidth - rect.right - 10) + 'px';
      posMenu.style.left = 'auto';
      posMenu.style.display = 'block';
    } else {
      posMenu.style.display = 'none';
    }
  });
  document.addEventListener('click', () => { posMenu.style.display = 'none'; });
  posMenu.addEventListener('click', (e) => e.stopPropagation());

  function applyPosMode(mode) {
    posMode = mode;
    writePref(POSMODE_KEY, mode);
    posMenu.style.display = 'none';
    if (mode === 'free') {
      panel.dataset.ikbmSide = 'free';
      sideToggle.textContent = '↔↕';
      sideToggle.title = 'Frei positionierbar - Panel zum Verschieben ziehen';
      sideToggle.style.cursor = 'default';
      const saved = (() => { try { return JSON.parse(localStorage.getItem(POS_KEY)); } catch { return null; } })();
      const rect = panel.getBoundingClientRect();
      const pos = saved || { x: rect.left, y: rect.top };
      panel.style.left = pos.x + 'px';
      panel.style.top = pos.y + 'px';
      panel.style.right = '';
      panel.style.maxHeight = 'calc(100vh - ' + pos.y + 'px - 20px)';
    } else {
      panel.dataset.ikbmSide = fixedSide;
      sideToggle.textContent = '⇄';
      sideToggle.title = 'Seite wechseln (aktuell: ' + (fixedSide === 'left' ? 'links' : 'rechts') + ')';
      sideToggle.style.cursor = 'pointer';
      reposition();
    }
  }
  posMenuFixed.addEventListener('click', () => applyPosMode('fixed'));
  posMenuFree.addEventListener('click', () => applyPosMode('free'));
  if (posMode === 'free') applyPosMode('free');

  let drag = null;
  panel.addEventListener('mousedown', (e) => {
    if (posMode !== 'free') return;
    const role = e.target.closest('[data-role]')?.dataset.role;
    if (role === 'gear' || role === 'side-toggle' || role === 'close') return;
    if (e.target.closest('input, select, textarea, button, a, label')) return;
    if (role !== 'collapse-toggle' && role !== 'header' && getComputedStyle(e.target).cursor === 'pointer') return;
    const rect = panel.getBoundingClientRect();
    drag = { startX: e.clientX, startY: e.clientY, origX: rect.left, origY: rect.top, moved: false };
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
    if (!drag.moved) return;
    const x = Math.max(0, drag.origX + dx);
    const y = Math.max(0, drag.origY + dy);
    panel.style.left = x + 'px';
    panel.style.top = y + 'px';
    panel.style.right = '';
    panel.style.maxHeight = 'calc(100vh - ' + y + 'px - 20px)';
  });
  document.addEventListener('mouseup', () => {
    if (!drag) return;
    if (drag.moved) {
      const rect = panel.getBoundingClientRect();
      localStorage.setItem(POS_KEY, JSON.stringify({ x: rect.left, y: rect.top }));
    }
    drag = null;
  });

  reposition();
  const repositionHandle = setInterval(reposition, 250);
  // Reagiert auf einen Theme-Wechsel OHNE Reload (kein Navigations-Event
  // dabei) - siehe Kommentar bei IKBM_THEMES weiter oben.
  const ikbmThemeObserver = new MutationObserver(() => { applyIkbmTheme(panel); applyIkbmTheme(posMenu); });
  ikbmThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  panel.__iksrCleanup = () => { clearInterval(repositionHandle); ikbmThemeObserver.disconnect(); posMenu.remove(); };
  closeBtn.onclick = () => { panel.__iksrCleanup(); panel.remove(); };

  const style = document.createElement('style');
  style.textContent = '#iksr-panel .iksr-tabbtn{flex:1;padding:5px;border:1px solid var(--ikbm-border);background:var(--ikbm-field);color:var(--ikbm-text);border-radius:5px;cursor:pointer;font-size:12px}'
    + '#iksr-panel .iksr-tabbtn.active{background:#1f6feb;border-color:#1f6feb}'
    + '#iksr-panel .status{font-size:11px;color:#66727f;min-height:14px;margin:-2px 0 8px}'
    + '#iksr-panel .status.error{color:#f2a0a0}'
    + '#iksr-panel .status.success{color:#9fe0c0}'
    + '#iksr-panel input[type=text]{width:100%;box-sizing:border-box;background:var(--ikbm-field);border:1px solid var(--ikbm-border);color:var(--ikbm-text);border-radius:6px;padding:7px 8px;font-size:13px;margin-bottom:8px}'
    + '#iksr-panel textarea{width:100%;box-sizing:border-box;height:170px;background:var(--ikbm-field);border:1px solid var(--ikbm-border);color:var(--ikbm-text);border-radius:6px;padding:8px;font-family:monospace;font-size:12px;resize:vertical;margin-bottom:8px}'
    + '#iksr-panel button.primary{width:100%;box-sizing:border-box;padding:7px;border:none;border-radius:6px;background:#1f6feb;color:#fff;font-size:12px;cursor:pointer;margin-bottom:8px}'
    + '#iksr-panel button.primary:disabled{opacity:.6;cursor:default}'
    + '#iksr-panel button.secondary{width:100%;box-sizing:border-box;padding:7px;border:1px solid var(--ikbm-border);border-radius:6px;background:var(--ikbm-border);color:var(--ikbm-text);font-size:12px;cursor:pointer}'
    + '#iksr-panel #iksr-spy-choices{display:flex;flex-direction:column;gap:4px}'
    + '#iksr-panel button.choice{width:100%;box-sizing:border-box;text-align:left;padding:6px 8px;border:1px solid var(--ikbm-border);border-radius:6px;background:var(--ikbm-field);color:var(--ikbm-text);font-size:12px;cursor:pointer}'
    + '#iksr-panel button.choice:hover{background:rgba(127,127,127,.2)}';
  panel.appendChild(style);

  // ---------------------------------------------------------------------
  // Verhalten
  // ---------------------------------------------------------------------

  const tabSpyBtn = document.getElementById('iksr-tab-spy');
  const tabFleetBtn = document.getElementById('iksr-tab-fleet');
  const spyPane = document.getElementById('iksr-spy-pane');
  const fleetPane = document.getElementById('iksr-fleet-pane');
  const usernameInput = document.getElementById('iksr-username');
  const runSpyBtn = document.getElementById('iksr-run-spy');
  const spyChoicesEl = document.getElementById('iksr-spy-choices');
  const runFleetBtn = document.getElementById('iksr-run-fleet');
  const statusEl = document.getElementById('iksr-status');
  const resultEl = document.getElementById('iksr-result');
  const copyBtn = document.getElementById('iksr-copy');

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
  }

  function clearSpyChoices() {
    spyChoicesEl.innerHTML = '';
    spyChoicesEl.style.display = 'none';
  }

  // Mehrere Treffer (z.B. mehrere Inseln desselben Spielers) -> Auswahl-
  // Liste statt blind den ersten zu nehmen. Neueste zuerst, da der
  // aktuellste Bericht meist der relevanteste ist.
  function renderSpyChoices(reports) {
    spyChoicesEl.innerHTML = '';
    spyChoicesEl.style.display = '';
    reports
      .slice()
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .forEach((r) => {
        const btn = document.createElement('button');
        btn.className = 'choice';
        const ts = new Date(r.createdAt).toLocaleString('de-CH');
        btn.textContent = `${r.islandName} (${r.coordinates.x} | ${r.coordinates.y}) — ${ts}`;
        btn.onclick = () => {
          resultEl.value = formatReport(r);
          setStatus('Bericht ausgewählt.', 'success');
          clearSpyChoices();
        };
        spyChoicesEl.appendChild(btn);
      });
  }

  tabSpyBtn.onclick = () => {
    tabSpyBtn.classList.add('active');
    tabFleetBtn.classList.remove('active');
    spyPane.style.display = '';
    fleetPane.style.display = 'none';
  };
  tabFleetBtn.onclick = () => {
    tabFleetBtn.classList.add('active');
    tabSpyBtn.classList.remove('active');
    fleetPane.style.display = '';
    spyPane.style.display = 'none';
    clearSpyChoices();
  };

  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSpyBtn.click(); }
  });

  runSpyBtn.onclick = async () => {
    const username = usernameInput.value.trim();
    setStatus('');
    resultEl.value = '';
    clearSpyChoices();
    if (!username) { setStatus('Bitte einen Benutzernamen eingeben.', 'error'); return; }
    runSpyBtn.disabled = true;
    try {
      const reports = await findReports(username);
      if (!reports.length) {
        setStatus(`Kein Spionagebericht für "${username}" gefunden.`, 'error');
      } else if (reports.length === 1) {
        resultEl.value = formatReport(reports[0]);
        setStatus('Bericht gefunden.', 'success');
      } else {
        setStatus(`${reports.length} Berichte gefunden — welchen willst du?`, 'success');
        renderSpyChoices(reports);
      }
    } catch (err) {
      setStatus(describeError(err), 'error');
    } finally {
      runSpyBtn.disabled = false;
    }
  };

  runFleetBtn.onclick = async () => {
    setStatus('');
    resultEl.value = '';
    clearSpyChoices();
    runFleetBtn.disabled = true;
    try {
      resultEl.value = await fetchFleetText();
      setStatus('Flotte ausgelesen.', 'success');
    } catch (err) {
      setStatus(describeError(err), 'error');
    } finally {
      runFleetBtn.disabled = false;
    }
  };

  copyBtn.onclick = async () => {
    if (!resultEl.value) return;
    try {
      await navigator.clipboard.writeText(resultEl.value);
      setStatus('In Zwischenablage kopiert.', 'success');
    } catch (err) {
      setStatus('Kopieren fehlgeschlagen: ' + (err?.message || String(err)), 'error');
    }
  };
})();
