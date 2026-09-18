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
 *   Roter Punkt wie beim Angriffe-Tab bei neu hinzugekommenen Meldungen.
 *   v1.6.18: incoming war bis dahin in allen getesteten Faellen leer ([]),
 *   Feldschema daher nur generisch/tolerant geraten. Echtes Schema jetzt
 *   aus IslandView-*.js (Vue-Komponente der Insel-Seite selbst, die
 *   denselben Endpoint konsumiert) dekompiliert: {id, mission, attacker,
 *   ships:[{count,type}], shipCount, attackPower, soldierCount, arriveAt}
 *   - arriveAt im selben Format wie beim Angriffe-Tab (renderFleetBox).
 *   mission ist einer von attack/spy/transport/colonize/board/station.
 *   station ("Stationierung") sind eigene/verbuendete Truppen, KEIN
 *   Angriff - die Site selbst faerbt den ganzen Abschnitt trotzdem pauschal
 *   rot bei jedem incoming-Eintrag (Bug im Spiel-Frontend); unser Panel
 *   faerbt station-Eintraege bewusst gruen (box.outgoing-Klasse,
 *   Nutzerwunsch 2026-09-16), alles andere weiter rot (box.incoming).
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

  // Reaktiver Reload bei 401 (bis 2026-09-16 lief zusaetzlich ein blinder
  // 5-Min-Timer, der aber ohne echten Mehrwert war und als Verdaechtiger in
  // der 401-Logout-Untersuchung entfernt wurde). Erst nach mehreren FOLGE-
  // 401ern reloaden (1:1 das schon geloeste Muster aus content.js der
  // eigenstaendigen Alliance-Status-Extension, Nutzer-Feedback 2026-09-08):
  // direkt nach einem Reload hat die Seite den Token oft noch nicht neu
  // getauscht, ein einzelnes 401 ist dann nur transient - sofortiges
  // Reloaden darauf loeste eine Reload-Schleife aus (Nutzer-Report
  // 2026-09-13). Cooldown weiterhin per localStorage (nicht nur in-memory,
  // da ein Reload den Skript-Zustand ohnehin verwirft).
  // Gemeinsamer Key mit ALLEN Panel-Scripts: verhindert, dass zwei
  // gleichzeitig offene Panels sich gegenseitig ueberholen (ein Panel
  // reloadet, Sekunden spaeter reloadet
  // das andere erneut, bevor die Seite den Token frisch getauscht hat -
  // Nutzer-Report 2026-09-15).
  const LS_LAST_PANEL_RELOAD = 'ikbm_lastPanelReload';
  const RELOAD_COOLDOWN_MS = 60000;
  // Nutzer-Report 2026-09-18: der Cooldown allein verhinderte nur schnelle
  // Reload-Schleifen, nicht den DAUERHAFTEN Fall (Session wirklich
  // abgelaufen) - dann reloadete die Seite unbegrenzt weiter, alle 60s.
  // Gemeinsamer Versuchszaehler ueber ALLE Panels: nach RELOAD_ATTEMPTS_MAX
  // erfolglosen Versuchen wird aufgegeben statt endlos weiterzureloaden.
  const LS_RELOAD_ATTEMPTS = 'ikbm_reloadAttempts';
  const RELOAD_ATTEMPTS_MAX = 5;
  function guardedReload() {
    const last = Number(localStorage.getItem(LS_LAST_PANEL_RELOAD)) || 0;
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
    const attempts = (Number(localStorage.getItem(LS_RELOAD_ATTEMPTS)) || 0) + 1;
    if (attempts > RELOAD_ATTEMPTS_MAX) {
      console.warn('[Islandking] Automatischer Reload nach ' + RELOAD_ATTEMPTS_MAX + ' erfolglosen Versuchen gestoppt - Session vermutlich abgelaufen, bitte manuell auf islandking.ch neu einloggen.');
      return;
    }
    localStorage.setItem(LS_RELOAD_ATTEMPTS, String(attempts));
    localStorage.setItem(LS_LAST_PANEL_RELOAD, String(Date.now()));
    location.reload();
  }
  const AUTO_RELOAD_AFTER_401 = 3;
  let consecutive401 = 0;
  function reloadOn401() {
    consecutive401 += 1;
    if (consecutive401 < AUTO_RELOAD_AFTER_401) return;
    guardedReload();
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
      else { consecutive401 = 0; localStorage.removeItem(LS_RELOAD_ATTEMPTS); }
      throw new ApiError(res.status, body?.error || ('HTTP ' + res.status));
    }
    consecutive401 = 0;
    localStorage.removeItem(LS_RELOAD_ATTEMPTS);
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
      panel.style.top = Math.round(other.getBoundingClientRect().bottom + GAP) + 'px';
    }
  }

  // Live an den Hell-/Dunkelmodus der Seite gekoppelt - 1:1 aus dem
  // Reisezeitenrechner/Kampfrechner uebernommen: islandking.ch schaltet die
  // Klasse "dark" auf <html> um, CSS-Variablen vererben sich an alle
  // Kind-Elemente und aktualisieren sich live.
  const IKBM_THEMES = {
    dark: {
      bg: '#0f1b2b', text: '#e6edf3', border: '#24344a', field: '#142338', gold: '#f0d68a',
      favBg: '#1c2410', favBorder: '#4a4620', incBg: '#3a1414', incBorder: '#7a2a2a', outBg: '#123a1e', outBorder: '#2a7a44',
    },
    light: {
      bg: '#f4f7fb', text: '#1a2333', border: '#c7d2e0', field: '#ffffff', gold: '#92700c',
      favBg: '#f3f7e0', favBorder: '#c9d9a0', incBg: '#fbe8e8', incBorder: '#e3b3b3', outBg: '#e6f5ea', outBorder: '#a8d9b8',
    },
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
    panel.style.setProperty('--ikbm-fav-bg', t.favBg);
    panel.style.setProperty('--ikbm-fav-border', t.favBorder);
    panel.style.setProperty('--ikbm-inc-bg', t.incBg);
    panel.style.setProperty('--ikbm-inc-border', t.incBorder);
    panel.style.setProperty('--ikbm-out-bg', t.outBg);
    panel.style.setProperty('--ikbm-out-border', t.outBorder);
  }

  const PANEL_ID = 'ikas-panel';
  const SIDE_KEY = 'ikbm-side-' + PANEL_ID;
  const COLLAPSED_KEY = 'ikbm-collapsed-' + PANEL_ID;
  const POSMODE_KEY = 'ikbm-posmode-' + PANEL_ID;
  const POS_KEY = 'ikbm-pos-' + PANEL_ID;
  const side = readPref(SIDE_KEY, 'left');
  const collapsed = readPref(COLLAPSED_KEY, '0') === '1';
  let posMode = readPref(POSMODE_KEY, 'fixed');
  let fixedSide = side;
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
  const VERSION = 'v1.6.25';
  const TITLE = '🤝 Allianz Status <span style="opacity:.5;font-weight:normal;font-size:11px">' + VERSION + '</span>';

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.dataset.ikbmPanel = '1';
  panel.dataset.ikbmSide = posMode === 'free' ? 'free' : side;
  panel.dataset.ikbmSeq = seq;
  panel.style.cssText = 'position:fixed;width:420px;display:flex;flex-direction:column;'
    + 'background:var(--ikbm-bg);color:var(--ikbm-text);border:1px solid var(--ikbm-border);border-radius:8px;'
    + 'font:13px/1.4 system-ui,sans-serif;padding:14px;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  applyIkbmTheme(panel);
  panel.innerHTML = '<div data-role="header" style="display:flex;justify-content:space-between;align-items:center;flex:none;' + (collapsed ? '' : 'margin-bottom:8px') + '">'
    + '<span style="display:flex;align-items:center;gap:5px">'
    + '<b data-role="collapse-toggle" style="cursor:pointer;user-select:none">' + (collapsed ? '▸' : '▾') + ' ' + TITLE + '</b>'
    + '<span id="ikas-header-dot" title="Neue Angriffe/Spähposten-Meldungen" style="display:none;width:7px;height:7px;border-radius:50%;background:#f2a0a0;flex:none"></span>'
    + '</span>'
    + '<span style="display:flex;gap:10px;align-items:center">'
    + '<span data-role="gear" title="Positionsmodus einstellen" style="cursor:pointer;opacity:.7">⚙️</span>'
    + '<span data-role="side-toggle" title="Seite wechseln (aktuell: ' + (side === 'left' ? 'links' : 'rechts') + ')" style="cursor:pointer;opacity:.7">⇄</span>'
    + '<span data-role="close" style="cursor:pointer;opacity:.7">✕</span>'
    + '</span></div>'
    // Nutzer-Report 2026-09-18 (echter Alt-Bug): "hidden" alleine reicht
    // hier nicht, weil dieses Div sein eigenes display:flex inline setzt -
    // Inline-Styles gewinnen gegen die Browser-Standardregel
    // "[hidden]{display:none}". Fix: display explizit mitfuehren.
    + '<div data-role="body" style="display:' + (collapsed ? 'none' : 'flex') + ';flex-direction:column;flex:1;min-height:0"' + (collapsed ? ' hidden' : '') + '>'
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
  const gearBtn = panel.querySelector('[data-role="gear"]');
  const sideToggle = panel.querySelector('[data-role="side-toggle"]');
  const closeBtn = panel.querySelector('[data-role="close"]');
  const panelBody = panel.querySelector('[data-role="body"]');

  const posMenu = document.createElement('div');
  posMenu.style.cssText = 'display:none;position:fixed;background:var(--ikbm-field);border:1px solid var(--ikbm-border);color:var(--ikbm-text);border-radius:6px;padding:4px;z-index:1000000;font-size:12px;white-space:nowrap;box-shadow:0 4px 12px rgba(0,0,0,.4)';
  posMenu.innerHTML = '<div data-role="posmenu-fixed" style="padding:4px 10px;cursor:pointer;border-radius:4px">📌 Feste Position</div>'
    + '<div data-role="posmenu-free" style="padding:4px 10px;cursor:pointer;border-radius:4px">↔↕ Frei verschiebbar</div>';
  document.body.appendChild(posMenu);
  applyIkbmTheme(posMenu);
  const posMenuFixed = posMenu.querySelector('[data-role="posmenu-fixed"]');
  const posMenuFree = posMenu.querySelector('[data-role="posmenu-free"]');

  collapseToggle.addEventListener('click', () => {
    const next = !panelBody.hidden;
    panelBody.hidden = next;
    panelBody.style.display = next ? 'none' : 'flex';
    collapseToggle.innerHTML = (next ? '▸ ' : '▾ ') + TITLE;
    header.style.marginBottom = next ? '0' : '8px';
    writePref(COLLAPSED_KEY, next ? '1' : '0');
    updateHeaderDot();
    if (!next && posMode === 'free') avoidOverlap(panel);
  });

  function reposition() {
    if (posMode === 'free') return;
    const s = panel.dataset.ikbmSide;
    const top = computeStackTop(s, seq);
    panel.style.top = top + 'px';
    if (s === 'left') { panel.style.left = '20px'; panel.style.right = ''; }
    else { panel.style.right = '20px'; panel.style.left = ''; }
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
    panel.style.left = Math.max(0, drag.origX + dx) + 'px';
    panel.style.top = Math.max(0, drag.origY + dy) + 'px';
    panel.style.right = '';
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

  panel.__ikasCleanup = () => { clearInterval(refreshHandle); clearInterval(repositionHandle); ikbmThemeObserver.disconnect(); posMenu.remove(); };
  closeBtn.onclick = () => { panel.__ikasCleanup(); panel.remove(); };

  const style = document.createElement('style');
  style.textContent = '#ikas-panel .ikas-tabbtn{position:relative;flex:1;padding:5px;border:1px solid var(--ikbm-border);background:var(--ikbm-field);color:var(--ikbm-text);border-radius:5px;cursor:pointer;font-size:12px}'
    + '#ikas-panel .ikas-tabbtn.active{background:#1f6feb;border-color:#1f6feb}'
    + '#ikas-panel .dot{position:absolute;top:2px;right:4px;width:7px;height:7px;border-radius:50%;background:#f2a0a0}'
    + '#ikas-panel .status{font-size:11px;color:#66727f;margin-bottom:8px}'
    + '#ikas-panel .error{color:#f2a0a0}'
    + '#ikas-panel .group-label{font-size:11px;text-transform:uppercase;letter-spacing:.03em;color:var(--ikbm-gold);margin:10px 0 4px;display:flex;align-items:center;gap:4px;cursor:default}'
    + '#ikas-panel .group-label.collapsible{cursor:pointer;user-select:none}'
    + '#ikas-panel .box{display:flex;align-items:center;gap:8px;background:var(--ikbm-field);border:1px solid var(--ikbm-border);border-radius:6px;padding:4px 8px;margin-bottom:4px}'
    + '#ikas-panel .box.favorite{background:var(--ikbm-fav-bg);border-color:var(--ikbm-fav-border)}'
    + '#ikas-panel .box.incoming{background:var(--ikbm-inc-bg);border-color:var(--ikbm-inc-border)}'
    + '#ikas-panel .box.outgoing{background:var(--ikbm-out-bg);border-color:var(--ikbm-out-border)}'
    + '#ikas-panel .box .info{flex:1;min-width:0}'
    + '#ikas-panel .box .name{font-weight:600;font-size:12px}'
    + '#ikas-panel .box .meta{font-size:11px;color:#a9c6f0}'
    + '#ikas-panel .box .meta.on{color:#9fe0c0}'
    + '#ikas-panel .box .time{font-size:11px;color:#7f95b3;white-space:nowrap;flex-shrink:0}'
    + '#ikas-panel .pin{background:none;border:none;color:#a9c6f0;opacity:.5;cursor:pointer;font-size:14px}'
    + '#ikas-panel .pin.active{color:var(--ikbm-gold);opacity:1}'
    + '#ikas-panel .rm{background:none;border:none;color:#f2a0a0;cursor:pointer;font-size:14px}'
    + '#ikas-panel .msg{color:#a9c6f0;text-decoration:none;opacity:.75}'
    + '#ikas-panel input[type=text]{flex:1;background:var(--ikbm-field);border:1px solid var(--ikbm-border);color:var(--ikbm-text);border-radius:4px;padding:5px 7px;font-size:12px}'
    + '#ikas-panel button.add{padding:5px 10px;border:none;border-radius:5px;background:#1f6feb;color:#fff;cursor:pointer;font-size:12px}';
  panel.appendChild(style);

  // Nutzer-Report 2026-09-18: der rote Punkt bei neuen Angriffen/Spähposten-
  // Meldungen sass bisher NUR in den Tab-Buttons (Teil von "body") -
  // eingeklappt (panelBody.hidden) war er komplett unsichtbar. Eigener
  // Punkt neben dem Titel (ausserhalb von "body", bleibt beim Einklappen
  // sichtbar) - spiegelt "einer der beiden Tab-Punkte ist an".
  // Korrektur (Nutzer-Feedback): NUR im eingeklappten Zustand zeigen - im
  // ausgeklappten Zustand sieht man die Tab-Punkte ohnehin direkt.
  const headerDot = document.getElementById('ikas-header-dot');
  function updateHeaderDot() {
    const attacksOn = !document.getElementById('ikas-attacks-dot').hidden;
    const scoutOn = !document.getElementById('ikas-scout-dot').hidden;
    headerDot.style.display = (panelBody.hidden && (attacksOn || scoutOn)) ? 'inline-block' : 'none';
  }

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
    updateHeaderDot();
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
    updateHeaderDot();

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

  const SCOUT_MISSION_LABELS = { attack: 'Angriff', spy: 'Spionage', transport: 'Transport', colonize: 'Kolonie', board: 'Entern', station: 'Stationierung' };
  const SCOUT_MISSION_ICONS = { attack: '⚔️', spy: '🕵️', transport: '🚚', colonize: '🏝️', board: '🪝', station: '⚓' };

  function renderScoutEntry(e) {
    const box = document.createElement('div');
    box.className = 'box ' + (e.mission === 'station' ? 'outgoing' : 'incoming');
    const info = document.createElement('div');
    info.className = 'info';
    const icon = SCOUT_MISSION_ICONS[e.mission] || '🔭';
    const label = SCOUT_MISSION_LABELS[e.mission] || e.mission || '?';
    const counts = [];
    if (e.attackPower != null) counts.push(`Angriffskraft ca. ${e.attackPower}`);
    if (e.shipCount != null) {
      const ships = (e.ships || []).map((s) => `${s.count}× ${s.type}`).join(', ');
      counts.push(`🚢 ${e.shipCount}` + (ships ? ` (${ships})` : ''));
    }
    if (e.soldierCount) counts.push(`🪖 ${e.soldierCount} Soldaten`);
    info.innerHTML = `<div class="name">${icon} ${label}${e.attacker ? ' von ' + e.attacker : ''}</div>`
      + `<div class="meta">${counts.join(' · ') || 'Details unbekannt'}</div>`;
    box.appendChild(info);
    const time = document.createElement('div');
    time.className = 'time';
    time.textContent = e.arriveAt ? formatCountdown(e.arriveAt) : '?';
    box.appendChild(time);
    return box;
  }

  // Bug (Nutzer-Report 2026-09-16): roter Punkt kam nach JEDEM Reload
  // erneut, auch fuer laengst gesehene Eintraege - Ursache war das rein
  // in-memory-Muster hier ("gleich wie knownFleetKeys" stimmte, nur dass
  // GENAU DAS beim Angriffe-Tab schon mal derselbe Bug war und dort per
  // localStorage-Persistierung gefixt wurde, siehe LS_KNOWN_FLEETS oben -
  // der Fix wurde nie hierher uebertragen). Jetzt 1:1 dasselbe Muster:
  // Baseline in localStorage (LS_KNOWN_SCOUT), scoutKey() aus festen
  // Feldern statt JSON.stringify(e) (robuster falls die API mal
  // Feldreihenfolge/zusaetzliche volatile Felder liefert).
  const LS_KNOWN_SCOUT = 'ikas_knownScoutKeys';
  let knownScoutKeys = (() => {
    const arr = loadJson(LS_KNOWN_SCOUT, null);
    return Array.isArray(arr) ? new Set(arr) : null;
  })();
  function scoutKey(islandId, e) { return [islandId, e.id, e.mission, e.attacker, e.arriveAt].join('|'); }

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
      (r.d.incoming || []).forEach((e) => currentKeys.add(scoutKey(r.isl.id, e)));
    });
    const hasNew = knownScoutKeys && [...currentKeys].some((k) => !knownScoutKeys.has(k));
    knownScoutKeys = currentKeys;
    saveJson(LS_KNOWN_SCOUT, [...currentKeys]);
    if (hasNew && activeTabName !== 'scout') document.getElementById('ikas-scout-dot').hidden = false;
    updateHeaderDot();

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

  // Periodischer Proaktiv-Reload (2026-09-16 entfernt, Nutzerwunsch):
  // reloadete blind alle 5 Min. unabhaengig davon, ob der Token wirklich
  // bald ablief, und war einer der Verdaechtigen in der offenen 401-
  // Logout-Untersuchung (Reload-Race zwischen mehreren offenen Panels
  // ueber denselben Cooldown-Key). Der reaktive Reload bei tatsaechlichem
  // 401 (oben, reloadOn401/guardedReload) deckt den eigentlichen Zweck
  // sauberer ab - reloadet nur, wenn ein Request wirklich fehlschlaegt.

  // Site-Patch (Nutzerwunsch 2026-09-16): die Insel-Seite selbst faerbt
  // ihre eigene 🔭-Spähposten-Kachel pauschal rot bei JEDEM incoming-
  // Eintrag, auch bei einer reinen Stationierung (eigene/verbuendete
  // Truppen, kein Angriff) - Bug im Spiel-Frontend, siehe renderScoutEntry
  // weiter oben. Live-DOM verifiziert: <section class="... border-red-300
  // bg-red-50"><p>🔭 Spähposten</p><ul><li><span class="... text-red-700">
  // ⚓ Stationierung</span>...</li></ul></section>, Missionslabel je <li>
  // im ERSTEN <span>. Faerbt nur um (eigene Klasse + !important gegen die
  // Tailwind-Utility-Klassen des Spiels), aendert deren Klassen nicht -
  // bleibt stabil, falls sich Tailwind-Klassennamen dort mal aendern.
  // ponytail: Polling statt MutationObserver (Vue rendert den Abschnitt
  // oefter neu als noetig zu beobachten waere) - alle 2s reicht, kein
  // spuerbarer Unterschied zur sofortigen Reaktion.
  if (!document.getElementById('ikbm-outpost-style')) {
    const outpostStyle = document.createElement('style');
    outpostStyle.id = 'ikbm-outpost-style';
    outpostStyle.textContent = '.ikbm-outpost-safe{border-color:#2a7a44 !important;background-color:#123a1e !important}'
      + '.ikbm-outpost-safe .text-red-700{color:#9fe0c0 !important}';
    document.head.appendChild(outpostStyle);
  }
  function patchOutpostSection() {
    const heading = [...document.querySelectorAll('p')].find((p) => p.textContent.trim() === '🔭 Spähposten');
    const section = heading?.closest('section');
    if (!section) return;
    const missions = [...section.querySelectorAll('li')].map((li) => li.querySelector('span')?.textContent.trim());
    const allStation = missions.length > 0 && missions.every((m) => m === '⚓ Stationierung');
    section.classList.toggle('ikbm-outpost-safe', allStation);
  }
  const outpostHandle = setInterval(patchOutpostSection, 2000);
  patchOutpostSection();

  const prevCleanup = panel.__ikasCleanup;
  panel.__ikasCleanup = () => { prevCleanup(); clearInterval(outpostHandle); };
})();
