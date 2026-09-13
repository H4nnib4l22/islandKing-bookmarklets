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
  const VERSION = 'v1.0.1';
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
  const LS_LAST_AUTH_RELOAD = 'iksr_lastAuthReload';
  const AUTH_RELOAD_COOLDOWN_MS = 30000;
  function reloadOn401() {
    const last = Number(localStorage.getItem(LS_LAST_AUTH_RELOAD)) || 0;
    if (Date.now() - last < AUTH_RELOAD_COOLDOWN_MS) return;
    localStorage.setItem(LS_LAST_AUTH_RELOAD, String(Date.now()));
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

  async function findReport(username) {
    const needle = username.toLowerCase();
    for (const archived of [0, 1]) {
      const data = await apiFetch('/api/spy-reports?archived=' + archived);
      const match = (data?.reports || []).find((r) => r.target.toLowerCase() === needle);
      if (match) return match;
    }
    return null;
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
  const side = readPref(SIDE_KEY, 'right');
  const collapsed = readPref(COLLAPSED_KEY, '0') === '1';
  const seq = nextPanelSeq();
  const TITLE_HTML = '🔎 Spy Report Lookup <span style="opacity:.5;font-weight:normal;font-size:11px">' + VERSION + '</span>';

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.dataset.ikbmPanel = '1';
  panel.dataset.ikbmSide = side;
  panel.dataset.ikbmSeq = seq;
  panel.style.cssText = 'position:fixed;width:380px;overflow:auto;'
    + 'background:#0f1b2b;color:#e6edf3;border:1px solid #24344a;border-radius:8px;'
    + 'font:13px/1.4 system-ui,sans-serif;padding:14px;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  panel.innerHTML = '<div data-role="header" style="display:flex;justify-content:space-between;align-items:center;' + (collapsed ? '' : 'margin-bottom:8px') + '">'
    + '<b data-role="collapse-toggle" style="cursor:pointer;user-select:none">' + (collapsed ? '▸' : '▾') + ' ' + TITLE_HTML + '</b>'
    + '<span style="display:flex;gap:10px;align-items:center">'
    + '<span data-role="side-toggle" title="Seite wechseln (aktuell: ' + (side === 'left' ? 'links' : 'rechts') + ')" style="cursor:pointer;opacity:.7">⇄</span>'
    + '<span data-role="close" style="cursor:pointer;opacity:.7">✕</span>'
    + '</span></div>'
    + '<div data-role="body" id="iksr-body"' + (collapsed ? ' hidden' : '') + '>'
    + '<nav style="display:flex;gap:4px;margin-bottom:10px">'
    + '<button id="iksr-tab-spy" class="iksr-tabbtn active">Spionage</button>'
    + '<button id="iksr-tab-fleet" class="iksr-tabbtn">Flotte</button>'
    + '</nav>'
    + '<div id="iksr-spy-pane">'
    + '<input type="text" id="iksr-username" placeholder="Benutzername…">'
    + '<button class="primary" id="iksr-run-spy">Bericht auslesen</button>'
    + '</div>'
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
  const sideToggle = panel.querySelector('[data-role="side-toggle"]');
  const closeBtn = panel.querySelector('[data-role="close"]');
  const body = panel.querySelector('[data-role="body"]');

  collapseToggle.addEventListener('click', () => {
    const next = !body.hidden;
    body.hidden = next;
    collapseToggle.innerHTML = (next ? '▸ ' : '▾ ') + TITLE_HTML;
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
    panel.style.maxHeight = 'calc(100vh - ' + top + 'px - 20px)';
  }
  reposition();
  const repositionHandle = setInterval(reposition, 250);
  panel.__iksrCleanup = () => { clearInterval(repositionHandle); };
  closeBtn.onclick = () => { panel.__iksrCleanup(); panel.remove(); };

  const style = document.createElement('style');
  style.textContent = '#iksr-panel .iksr-tabbtn{flex:1;padding:5px;border:1px solid #24344a;background:#142338;color:#e6edf3;border-radius:5px;cursor:pointer;font-size:12px}'
    + '#iksr-panel .iksr-tabbtn.active{background:#1f6feb;border-color:#1f6feb}'
    + '#iksr-panel .status{font-size:11px;color:#66727f;min-height:14px;margin:-2px 0 8px}'
    + '#iksr-panel .status.error{color:#f2a0a0}'
    + '#iksr-panel .status.success{color:#9fe0c0}'
    + '#iksr-panel input[type=text]{width:100%;box-sizing:border-box;background:#142338;border:1px solid #24344a;color:#e6edf3;border-radius:6px;padding:7px 8px;font-size:13px;margin-bottom:8px}'
    + '#iksr-panel textarea{width:100%;box-sizing:border-box;height:170px;background:#142338;border:1px solid #24344a;color:#e6edf3;border-radius:6px;padding:8px;font-family:monospace;font-size:12px;resize:vertical;margin-bottom:8px}'
    + '#iksr-panel button.primary{width:100%;box-sizing:border-box;padding:7px;border:none;border-radius:6px;background:#1f6feb;color:#fff;font-size:12px;cursor:pointer;margin-bottom:8px}'
    + '#iksr-panel button.primary:disabled{opacity:.6;cursor:default}'
    + '#iksr-panel button.secondary{width:100%;box-sizing:border-box;padding:7px;border:1px solid #24344a;border-radius:6px;background:#24344a;color:#e6edf3;font-size:12px;cursor:pointer}';
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
  const runFleetBtn = document.getElementById('iksr-run-fleet');
  const statusEl = document.getElementById('iksr-status');
  const resultEl = document.getElementById('iksr-result');
  const copyBtn = document.getElementById('iksr-copy');

  function setStatus(text, kind) {
    statusEl.textContent = text;
    statusEl.className = 'status' + (kind ? ' ' + kind : '');
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
  };

  usernameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runSpyBtn.click(); }
  });

  runSpyBtn.onclick = async () => {
    const username = usernameInput.value.trim();
    setStatus('');
    resultEl.value = '';
    if (!username) { setStatus('Bitte einen Benutzernamen eingeben.', 'error'); return; }
    runSpyBtn.disabled = true;
    try {
      const report = await findReport(username);
      if (!report) {
        setStatus(`Kein Spionagebericht für "${username}" gefunden.`, 'error');
      } else {
        resultEl.value = formatReport(report);
        setStatus('Bericht gefunden.', 'success');
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
