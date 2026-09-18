// ==UserScript==
// @name         Islandking Spy Report Lookup
// @namespace    https://github.com/H4nnib4l22/islandKing-bookmarklets
// @version      1.2.1
// @description  Spionageberichte nach Benutzername durchsuchen + eigene Flotte auslesen, formatiert zum Kopieren — ein-/ausklappbar, per Zahnrad wahlweise am Rand fest gestapelt oder frei auf dem Bildschirm verschiebbar (Position wird gemerkt), Titelzeile und Tabs bleiben beim Scrollen fixiert, ↻-Update-Check im Panel-Header, 420px breit statt 380px, folgt automatisch dem Hell-/Dunkelmodus von islandking.ch, automatischer Reload bei abgelaufener Session bricht nach mehreren erfolglosen Versuchen ab statt endlos zu reloaden
// @author       Oscar
// @license      MIT
// @match        https://islandking.ch/*
// @grant        GM_xmlhttpRequest
// @grant        GM_openInTab
// @run-at       document-idle
// @downloadURL  https://update.greasyfork.org/scripts/595653/Islandking%20Spy%20Report%20Lookup.user.js
// @updateURL    https://update.greasyfork.org/scripts/595653/Islandking%20Spy%20Report%20Lookup.meta.js
// ==/UserScript==

/*
 * Islandking Spy Report Lookup — Tampermonkey-Userscript.
 *
 * Portierung der gleichnamigen Browser-Extension (siehe
 * plugins/islandking-spy-report-lookup-chrome_opera/content.js) als
 * eigenstaendiges Overlay-Panel, damit sie sich wie alle anderen
 * islandking.ch-Userscripts in diesem Repo verhaelt:
 * ein-/ausklappbar, Seite frei waehlbar, reiht sich unter andere offene
 * Panels ein. Funktional 1:1 identisch zur Extension (gleiche API-Calls,
 * gleiches formatReport()), nur ohne die Popup/Content-Script-Aufteilung -
 * hier laeuft alles direkt im Seitenkontext, kein Messaging noetig.
 *
 * - Spionage-Tab: durchsucht GET /api/spy-reports?archived=0|1 nach einem
 *   Ziel-Benutzernamen (case-insensitive exakter Treffer).
 * - Flotte-Tab: eigene Heimatinsel via GET /api/islands ermitteln, dann
 *   GET /api/islands/:id/overview fuer Schiffe+Soldaten (nur count>0).
 * - Auth: Bearer-Token aus localStorage.getItem('access_token') (gleiches
 *   Muster wie alle anderen Scripts in diesem Repo).
 *
 * v1.1.1: Panel-Header und die Spionage/Flotte-Tabs bleiben jetzt fixiert
 * sichtbar, waehrend nur der Inhalt darunter scrollt (Nutzerwunsch, wie im
 * Kampfrechner-Panel des Reisezeitenrechners uebernommen).
 * v1.1.2: ↻-Button im Panel-Header prueft auf Knopfdruck, ob eine neue
 * Version auf Greasy Fork liegt (braucht @grant GM_xmlhttpRequest statt
 * @grant none, siehe Kommentar bei ikbmWindow weiter unten) - fehlte hier
 * bisher als einzigem der vier Panels (Nutzer-Meldung 2026-09-14).
 * v1.1.3: Panel-Breite 380px -> 420px (Nutzerwunsch) - die Scrollbar
 * ueberlagerte bei 380px Icons am rechten Rand der Zeilen. Zusaetzlich
 * scrollbar-gutter:stable auf dem body-Div, da reines Verbreitern allein
 * nicht reicht (Zeilen sind 100%-breit und wandern mit).
 */
(function () {
  const VERSION = 'v1.2.1';
  const existing = document.getElementById('iksr-panel');
  if (existing) { existing.__iksrCleanup?.(); existing.remove(); return; }

  function readPref(key, fallback) {
    try { const v = localStorage.getItem(key); return v === null ? fallback : v; } catch (e) { return fallback; }
  }
  function writePref(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* privater Modus o.ae. — Praeferenz einfach nicht gemerkt */ }
  }

  // Gemeinsame Stapel-Konvention ALLER islandking.ch-Userscripts: dockt
  // je Seite unter das unterste bereits offene Panel
  // derselben Seite an. Seq-basiert statt "alle anderen derselben Seite":
  // jedes Panel bekommt beim Erzeugen eine fortlaufende Nummer
  // (ikbmWindow.__ikbmSeq, geteilt ueber ALLE Scripts hinweg). Beim
  // Stacken zaehlen nur Panels mit KLEINERER Seq (= frueher erzeugt), nie
  // juengere.
  //
  // ikbmWindow statt direkt "window": seit dem Update-Check-Button braucht
  // dieses Script @grant GM_xmlhttpRequest statt @grant none - Tampermonkey
  // kann Scripts mit einem Grant in einer Sandbox laufen lassen, deren
  // "window" NICHT mehr das echte Seiten-window ist. unsafeWindow ist immer
  // das echte Seiten-window (identisch mit dem "window" der anderen, nach
  // wie vor @grant-none Scripts) - ohne diesen Fallback wuerde das
  // Panel-Stacking zwischen granted und ungranted Scripts auseinanderlaufen.
  const ikbmWindow = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;
  function nextPanelSeq() {
    ikbmWindow.__ikbmSeq = (ikbmWindow.__ikbmSeq || 0) + 1;
    return ikbmWindow.__ikbmSeq;
  }
  function computeStackTop(side, selfSeq) {
    const others = Array.from(document.querySelectorAll('[data-ikbm-panel][data-ikbm-side="' + side + '"]'))
      .filter((el) => Number(el.dataset.ikbmSeq) < selfSeq);
    let maxBottom = 100;
    others.forEach((el) => { maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom); });
    return Math.round(others.length ? maxBottom + 12 : maxBottom);
  }

  // Nutzer-Report 2026-09-18: erster Fix verschob beim Ausklappen das
  // WACHSENDE Panel selbst unter das andere - fuehlte sich wie ueberlagern/
  // ueberspringen an, weil das Panel dabei seine eigene Position verlor.
  // Zweiter Anlauf (Nutzerwunsch): das wachsende/schrumpfende Panel bleibt
  // wo es ist, stattdessen wird die Hoehendifferenz an eng angedockte
  // Panels DARUNTER weitergereicht - Ausklappen schiebt sie um genau die
  // Differenz nach unten, Einklappen holt sie um dieselbe Differenz zurueck.
  // "eng angedockt" = Abstand vor der Groessenaenderung zwischen -1px
  // (Rundungstoleranz/bereits ueberlappend) und 30px - ein bewusst frei
  // weiter weg plaziertes Panel soll NICHT mitgezogen werden. Rekursiv fuer
  // Ketten mehrerer gestapelter Panels.
  function pushDockedBelow(rect, delta) {
    if (!delta) return;
    document.querySelectorAll('[data-ikbm-panel]').forEach((el) => {
      if (el.dataset.ikbmSide !== 'free') return;
      const r = el.getBoundingClientRect();
      if (rect.left >= r.right || rect.right <= r.left) return;
      const gapBefore = r.top - (rect.bottom - delta);
      if (gapBefore < -1 || gapBefore > 30) return;
      const newTop = Math.round(r.top + delta);
      el.style.top = newTop + 'px';
      el.style.maxHeight = 'calc(100vh - ' + newTop + 'px - 20px)';
      pushDockedBelow(el.getBoundingClientRect(), delta);
    });
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

  // ↻-Button im Panel-Header: prueft per GM_xmlhttpRequest (umgeht die
  // CSP von islandking.ch, die einen direkten fetch() auf update.greasyfork.org
  // blockt) die @version im Greasy-Fork-Update-Feed gegen VERSION oben. Bei
  // verfuegbarem Update oeffnet er zusaetzlich per GM_openInTab die
  // @downloadURL - Tampermonkey erkennt diese .user.js-Navigation selbst
  // und zeigt seine eigene Update-Bestaetigungsseite (identischer Ablauf
  // wie ein Klick auf einen Greasy-Fork-Install-Link). GM_openInTab statt
  // window.open(), weil window.open() nach einem asynchronen
  // GM_xmlhttpRequest-Callback (kein direkter Klick-Kontext mehr) vom
  // Popup-Blocker verschluckt werden kann.
  const UPDATE_META_URL = 'https://update.greasyfork.org/scripts/595653/Islandking%20Spy%20Report%20Lookup.meta.js';
  const UPDATE_DOWNLOAD_URL = 'https://update.greasyfork.org/scripts/595653/Islandking%20Spy%20Report%20Lookup.user.js';
  // Einfarbige Glyphen statt Mehrfarben-Emoji fuer jeden Icon-Zustand,
  // gleiche Signalfarben wie in den anderen drei Panels.
  function setIconState(iconEl, glyph, color, title, autoReset) {
    iconEl.textContent = glyph;
    iconEl.style.color = color || '';
    iconEl.title = title;
    if (autoReset) setTimeout(() => { iconEl.textContent = '↻'; iconEl.style.color = ''; }, 8000);
  }
  function checkForUpdate(iconEl) {
    if (typeof GM_xmlhttpRequest === 'undefined') {
      setIconState(iconEl, '⚠', '#f87171', 'Update-Check nicht verfügbar (GM_xmlhttpRequest fehlt).');
      return;
    }
    setIconState(iconEl, '…', '', 'Prüfe…');
    const localVersion = VERSION.replace(/^v/, '');
    GM_xmlhttpRequest({
      method: 'GET',
      url: UPDATE_META_URL,
      onload: (res) => {
        const m = res.responseText.match(/@version\s+([\d.]+)/);
        if (!m) {
          setIconState(iconEl, '⚠', '#f87171', 'Version im Update-Feed nicht gefunden.', true);
          return;
        }
        const remoteVersion = m[1];
        if (remoteVersion === localVersion) {
          setIconState(iconEl, '✓', '#4ade80', 'Aktuell (v' + localVersion + ').', true);
        } else if (typeof GM_openInTab !== 'undefined') {
          setIconState(iconEl, '↑', 'var(--ikbm-gold)', 'Update v' + remoteVersion + ' — Tampermonkey-Update-Seite geöffnet, dort bestätigen.', true);
          GM_openInTab(UPDATE_DOWNLOAD_URL, { active: true });
        } else {
          setIconState(iconEl, '↑', 'var(--ikbm-gold)', 'Update verfügbar: v' + remoteVersion + ' (installiert: v' + localVersion + ') — GM_openInTab fehlt, Update-Seite manuell öffnen: ' + UPDATE_DOWNLOAD_URL, true);
        }
      },
      onerror: () => {
        setIconState(iconEl, '⚠', '#f87171', 'Update-Check fehlgeschlagen (Netzwerkfehler).', true);
      },
    });
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

  // Seit @grant GM_xmlhttpRequest (statt @grant none) laeuft dieses Script in
  // Firefox/Tampermonkey in einer Sandbox, in der ein bares fetch() aus der
  // Script-Sandbox kommt statt aus dem echten Seiten-window - relative URLs
  // loesen dann nicht mehr gegen die Seiten-URL auf ("X is not a valid URL",
  // Nutzer-Report 2026-09-15). unsafeWindow.fetch bindet zurueck ans echte
  // window (gleiches Muster wie ikbmWindow weiter unten fuers Panel-Stacking).
  const pageFetchRaw = (typeof unsafeWindow !== 'undefined') ? unsafeWindow.fetch.bind(unsafeWindow) : fetch;

  // Persistenter Debug-Log fuer die 401/Logout-Diagnose (Ring-Buffer in
  // localStorage, ueberlebt den Reload zu /login) - Nutzer-Report
  // 2026-09-15 "User wieder ausgeloggt", Ursache noch ungeklaert. Geteilter
  // Key mit ALLEN Panel-Scripts, damit sich Requests/Reloads mehrerer
  // gleichzeitig offener Panels in einer gemeinsamen Zeitleiste korrelieren
  // lassen. Auslesen per Konsole: JSON.parse(localStorage.ikbm_debugLog).
  const LS_DEBUG_LOG = 'ikbm_debugLog';
  const DEBUG_LOG_MAX = 200;
  function logDebug(kind, detail) {
    try {
      const log = JSON.parse(localStorage.getItem(LS_DEBUG_LOG)) || [];
      log.push({ t: new Date().toISOString(), panel: 'spy-report-lookup', kind, detail });
      while (log.length > DEBUG_LOG_MAX) log.shift();
      localStorage.setItem(LS_DEBUG_LOG, JSON.stringify(log));
    } catch { /* ignore */ }
  }
  logDebug('start', { url: location.href });
  async function pageFetch(url, opts) {
    let res;
    try {
      res = await pageFetchRaw(url, opts);
    } catch (err) {
      logDebug('fetch-error', { url, message: err?.message || String(err) });
      throw err;
    }
    logDebug('fetch', { url, status: res.status });
    return res;
  }

  // Reaktiver Reload bei 401 (Lektion aus Allianz Status, 2026-09-13): ein
  // reiner Timer kann den tatsaechlichen Token-Ablauf verpassen. Cooldown
  // per localStorage verhindert eine Reload-Schleife, falls die API
  // dauerhaft 401 liefert (z.B. echter Logout statt nur abgelaufener Token).
  // Gemeinsame Keys mit ALLEN Panel-Scripts (statt eigenem iksr_-Key) -
  // zaehlt so in denselben Versuchs-Topf wie Allianz Status/Ressourcenrechner
  // statt unabhaengig danebenzureloaden.
  const LS_LAST_PANEL_RELOAD = 'ikbm_lastPanelReload';
  const AUTH_RELOAD_COOLDOWN_MS = 30000;
  // Nutzer-Report 2026-09-18: der Cooldown allein verhinderte nur schnelle
  // Reload-Schleifen, nicht den DAUERHAFTEN Fall (Session wirklich
  // abgelaufen) - dann reloadete die Seite unbegrenzt weiter. Gemeinsamer
  // Versuchszaehler ueber ALLE Panels: nach RELOAD_ATTEMPTS_MAX erfolglosen
  // Versuchen wird aufgegeben statt endlos weiterzureloaden.
  const LS_RELOAD_ATTEMPTS = 'ikbm_reloadAttempts';
  const RELOAD_ATTEMPTS_MAX = 5;
  function reloadOn401() {
    const last = Number(localStorage.getItem(LS_LAST_PANEL_RELOAD)) || 0;
    if (Date.now() - last < AUTH_RELOAD_COOLDOWN_MS) {
      logDebug('reload-skip-cooldown', { msRemaining: AUTH_RELOAD_COOLDOWN_MS - (Date.now() - last) });
      return;
    }
    const attempts = (Number(localStorage.getItem(LS_RELOAD_ATTEMPTS)) || 0) + 1;
    if (attempts > RELOAD_ATTEMPTS_MAX) {
      logDebug('reload-cap-reached', { attempts });
      console.warn('[Islandking] Automatischer Reload nach ' + RELOAD_ATTEMPTS_MAX + ' erfolglosen Versuchen gestoppt - Session vermutlich abgelaufen, bitte manuell auf islandking.ch neu einloggen.');
      return;
    }
    localStorage.setItem(LS_RELOAD_ATTEMPTS, String(attempts));
    logDebug('reload', { attempts });
    localStorage.setItem(LS_LAST_PANEL_RELOAD, String(Date.now()));
    location.reload();
  }

  async function apiFetch(path) {
    const token = getAuthToken();
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let res;
    try {
      res = await pageFetch(path, { credentials: 'include', headers });
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
  const MINIMIZED_KEY = 'ikbm-minimized-' + PANEL_ID;
  const side = readPref(SIDE_KEY, 'right');
  const collapsed = readPref(COLLAPSED_KEY, '0') === '1';
  let posMode = readPref(POSMODE_KEY, 'fixed');
  let fixedSide = side;
  let minimized = readPref(MINIMIZED_KEY, '0') === '1';
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
    + '<span data-role="update-check" title="Auf Updates prüfen" style="cursor:pointer;opacity:.7">↻</span>'
    + '<span data-role="gear" title="Positionsmodus einstellen" style="cursor:pointer;opacity:.7">⚙️</span>'
    + '<span data-role="side-toggle" title="Seite wechseln (aktuell: ' + (side === 'left' ? 'links' : 'rechts') + ')" style="cursor:pointer;opacity:.7">⇄</span>'
    + '<span data-role="minimize" title="In die Menüleiste legen" style="cursor:pointer;opacity:.7">⬇</span>'
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
  const updateCheckBtn = panel.querySelector('[data-role="update-check"]');
  const gearBtn = panel.querySelector('[data-role="gear"]');
  const sideToggle = panel.querySelector('[data-role="side-toggle"]');
  const minimizeBtn = panel.querySelector('[data-role="minimize"]');
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

  updateCheckBtn.addEventListener('click', () => checkForUpdate(updateCheckBtn));

  collapseToggle.addEventListener('click', () => {
    const rectBefore = panel.getBoundingClientRect();
    const next = !body.hidden;
    body.hidden = next;
    collapseToggle.innerHTML = (next ? '▸ ' : '▾ ') + TITLE_HTML;
    header.style.marginBottom = next ? '0' : '8px';
    writePref(COLLAPSED_KEY, next ? '1' : '0');
    if (posMode === 'free') {
      const rectAfter = panel.getBoundingClientRect();
      pushDockedBelow(rectAfter, rectAfter.height - rectBefore.height);
    }
  });

  function reposition() {
    if (minimized) return;
    if (posMode === 'free') { if (!drag) avoidFixedOverlap(); return; }
    const s = panel.dataset.ikbmSide;
    const top = computeStackTop(s, seq);
    panel.style.top = top + 'px';
    if (s === 'left') { panel.style.left = '20px'; panel.style.right = ''; }
    else { panel.style.right = '20px'; panel.style.left = ''; }
    panel.style.maxHeight = 'calc(100vh - ' + top + 'px - 20px)';
  }

  // Nutzerwunsch 2026-09-18: Panels sollen sich in die islandking.ch-
  // Menueleiste "minimieren" lassen, rechts neben den Nutzernamen - siehe
  // Allianz Status fuer die ausfuehrliche Begruendung des Ankers (DE/EN-
  // Sprachumschalter-Span, live per Claude-in-Chrome verifiziert).
  // Nutzer-Report 2026-09-18 (Nachbesserung): der Tray haengte bisher als
  // ECHTES Kind in der Menueleisten-Flexbox - sobald ein Panel minimiert
  // wurde, sprengte das die verfuegbare Breite und liess die Website-
  // eigenen Menuepunkte (Aufbau/Sozial/Mehr/Nutzername) ineinander
  // rutschen/ueberlappen (Nutzer-Screenshot). Fix: Tray haengt jetzt NICHT
  // mehr im Menueleisten-Flow, sondern als eigenes position:fixed-Element
  // direkt am body, nur optisch (per getBoundingClientRect) am
  // Nutzernamen ausgerichtet - kann die Leiste selbst also nicht mehr
  // beeinflussen.
  function findUsernameWrapper() {
    const span = Array.from(document.querySelectorAll('span')).find(
      (s) => s.className.includes('overflow-hidden') && s.textContent.trim() === 'DEEN'
    );
    return span ? span.parentElement.lastElementChild : null;
  }
  function positionNavbarTray() {
    const tray = document.getElementById('ikbm-navbar-tray');
    const usernameWrapper = findUsernameWrapper();
    if (!tray || !usernameWrapper) return;
    const rect = usernameWrapper.getBoundingClientRect();
    tray.style.top = rect.top + 'px';
    tray.style.left = (rect.right + 8) + 'px';
  }
  function ensureNavbarTray() {
    let tray = document.getElementById('ikbm-navbar-tray');
    if (tray) return tray;
    tray = document.createElement('div');
    tray.id = 'ikbm-navbar-tray';
    tray.style.cssText = 'position:fixed;display:flex;align-items:center;gap:2px;z-index:1000001';
    document.body.appendChild(tray);
    window.addEventListener('resize', positionNavbarTray);
    return tray;
  }
  let navIcon = null;
  function ensureNavIcon() {
    if (!navIcon) {
      const tray = ensureNavbarTray();
      navIcon = document.createElement('button');
      navIcon.type = 'button';
      navIcon.title = 'Spy Report Lookup (minimiert) - Klick zum Wiederherstellen';
      navIcon.style.cssText = 'display:none;align-items:center;justify-content:center;width:32px;height:32px;border-radius:8px;border:none;background:transparent;color:inherit;font-size:16px;line-height:1;cursor:pointer';
      navIcon.textContent = '🔍';
      navIcon.addEventListener('click', restorePanel);
      tray.appendChild(navIcon);
    }
    positionNavbarTray();
  }
  function minimizePanel() {
    minimized = true;
    writePref(MINIMIZED_KEY, '1');
    panel.style.display = 'none';
    ensureNavIcon();
    if (navIcon) navIcon.style.display = 'inline-flex';
  }
  function restorePanel() {
    minimized = false;
    writePref(MINIMIZED_KEY, '0');
    panel.style.display = 'flex';
    if (navIcon) navIcon.style.display = 'none';
    reposition();
  }
  minimizeBtn.addEventListener('click', minimizePanel);

  // Nutzer-Report 2026-09-18: nach dem Wechsel auf "Frei verschiebbar"
  // bleibt das Panel an seiner alten (fest gestapelten) Stelle stehen -
  // die verbleibenden FIXEN Panels derselben Seite ruecken aber automatisch
  // eine Stufe nach oben nach (computeStackTop() zaehlt das jetzt freie
  // Panel nicht mehr mit) und legen sich darueber. Laeuft im selben
  // 250ms-Intervall wie reposition() mit: sobald ein fixes Panel das freie
  // ueberlappt, rutscht das freie darunter. Waehrend des manuellen Ziehens
  // (drag) pausiert, sonst wuerde es sich dem Nutzer aus der Hand reissen.
  function avoidFixedOverlap() {
    const rect = panel.getBoundingClientRect();
    let maxBottom = null;
    document.querySelectorAll('[data-ikbm-panel]:not([data-ikbm-side="free"])').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top) {
        maxBottom = Math.max(maxBottom ?? 0, r.bottom);
      }
    });
    if (maxBottom !== null) {
      const newTop = Math.round(maxBottom + 12);
      panel.style.top = newTop + 'px';
      panel.style.maxHeight = 'calc(100vh - ' + newTop + 'px - 20px)';
    }
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
      avoidFixedOverlap();
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
    if (role === 'update-check' || role === 'gear' || role === 'side-toggle' || role === 'close') return;
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

  if (minimized) {
    panel.style.display = 'none';
    ensureNavIcon();
    if (navIcon) navIcon.style.display = 'inline-flex';
  } else {
    reposition();
  }
  const repositionHandle = setInterval(reposition, 250);
  // Reagiert auf einen Theme-Wechsel OHNE Reload (kein Navigations-Event
  // dabei) - siehe Kommentar bei IKBM_THEMES weiter oben.
  const ikbmThemeObserver = new MutationObserver(() => { applyIkbmTheme(panel); applyIkbmTheme(posMenu); });
  ikbmThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  panel.__iksrCleanup = () => { clearInterval(repositionHandle); ikbmThemeObserver.disconnect(); posMenu.remove(); if (navIcon) navIcon.remove(); };
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
