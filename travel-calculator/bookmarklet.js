/*
 * Islandking Reisezeitenrechner — Bookmarklet
 * Läuft same-origin auf islandking.ch (Panel-Overlay), keine Installation.
 * Reine Koordinaten-Rechnung, 1:1 aus runStandaloneTravelCalc() im
 * Schattenflotte Taktischer Koordinator übernommen — braucht keine API,
 * keinen Login-Token, keine Netzwerkanfrage.
 * Nur im Tampermonkey-Userscript in diesem Ordner (nicht hier im
 * Bookmarklet): zusätzliches ⚔️ Kampfrechner-Panel darunter — bewusste
 * Scope-Entscheidung, kein Sync-Rückstand.
 */
(function () {
  const existing = document.getElementById('iktc-panel');
  if (existing) { existing.remove(); return; }

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

  const SHIPS_LIST = [
    { name: 'Fregatte', tempo: 45, pirate: false },
    { name: 'leichte Galeere', tempo: 40, pirate: false },
    { name: 'grosses Piratenschiff', tempo: 40, pirate: true },
    { name: 'schwere Galeere', tempo: 35, pirate: false },
    { name: 'mächtiges Piratenschiff', tempo: 35, pirate: true },
    { name: 'kleines Frachtschiff', tempo: 30, pirate: false },
    { name: 'Schlachtschiff', tempo: 30, pirate: false },
    { name: 'altes Piratenschiff', tempo: 25, pirate: true },
    { name: 'Kolonisationsschiff', tempo: 25, pirate: false },
    { name: 'grosses Frachtschiff', tempo: 20, pirate: false },
    // "Piratenschiff" ohne Zusatz MUSS zuletzt stehen — sonst matcht die
    // Substring-Suche fälschlich vor "altes/grosses/mächtiges Piratenschiff".
    { name: 'Piratenschiff', tempo: 30, pirate: true },
  ];

  function formatTime(totalSeconds) {
    const s = Math.round(totalSeconds);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
    return `${m}m ${String(sec).padStart(2, '0')}s`;
  }

  function parseCoords(coordStr) {
    if (!coordStr) return null;
    const nums = coordStr.match(/-?\d+/g);
    if (nums && nums.length >= 2) return { x: parseInt(nums[0]), y: parseInt(nums[1]) };
    return null;
  }

  const PANEL_ID = 'iktc-panel';
  const SIDE_KEY = 'ikbm-side-' + PANEL_ID;
  const COLLAPSED_KEY = 'ikbm-collapsed-' + PANEL_ID;
  const side = readPref(SIDE_KEY, 'right');
  const collapsed = readPref(COLLAPSED_KEY, '0') === '1';
  const seq = nextPanelSeq();
  const VERSION = 'v1.6.0';
  const TITLE = '🧭 Reisezeitenrechner <span style="opacity:.5;font-weight:normal;font-size:11px">' + VERSION + '</span>';

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.dataset.ikbmPanel = '1';
  panel.dataset.ikbmSide = side;
  panel.dataset.ikbmSeq = seq;
  panel.style.cssText = 'position:fixed;width:380px;overflow:auto;'
    + 'background:#0f1b2b;color:#e6edf3;border:1px solid #24344a;border-radius:8px;'
    + 'font:13px/1.4 system-ui,sans-serif;padding:14px;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  panel.innerHTML = '<div data-role="header" style="display:flex;justify-content:space-between;align-items:center;' + (collapsed ? '' : 'margin-bottom:8px') + '">'
    + '<b data-role="collapse-toggle" style="cursor:pointer;user-select:none">' + (collapsed ? '▸' : '▾') + ' ' + TITLE + '</b>'
    + '<span style="display:flex;gap:10px;align-items:center">'
    + '<span data-role="side-toggle" title="Seite wechseln (aktuell: ' + (side === 'left' ? 'links' : 'rechts') + ')" style="cursor:pointer;opacity:.7">⇄</span>'
    + '<span data-role="close" style="cursor:pointer;opacity:.7">✕</span>'
    + '</span></div>'
    + '<div data-role="body"' + (collapsed ? ' hidden' : '') + '>'
    + '<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">'
    + '<div style="flex:1;min-width:140px">Start: <input id="iktc-start" placeholder="z. B. -40 | -60" style="width:100%;box-sizing:border-box"></div>'
    + '<div style="flex:1;min-width:140px">Ziel: <input id="iktc-ziel" placeholder="z. B. -10 | -40" style="width:100%;box-sizing:border-box"></div>'
    + '</div>'
    + '<div style="margin-bottom:10px">Bezugs-Schiffstempo: <select id="iktc-speed" style="width:100%;margin-top:4px">'
    + '<option value="45">Fregatte (Tempo 45/h)</option>'
    + '<option value="40">leichte Galeere / Pirat (Tempo 40/h)</option>'
    + '<option value="35">schwere Galeere / Pirat (Tempo 35/h)</option>'
    + '<option value="30">Schlachtschiff / Frachtschiff (Tempo 30/h)</option>'
    + '<option value="25">Koloni / altes Piratenschiff (Tempo 25/h)</option>'
    + '<option value="20" selected>grosses Frachtschiff (Tempo 20/h)</option>'
    + '</select></div>'
    + '<div id="iktc-result"><p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">Start- und Zielkoordinaten eingeben.</p></div>'
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
    panel.style.maxHeight = 'calc(100vh - ' + top + 'px - 20px)';
  }
  reposition();
  const repositionHandle = setInterval(reposition, 250);

  closeBtn.onclick = () => { clearInterval(repositionHandle); panel.remove(); };

  function run() {
    const p1 = parseCoords(document.getElementById('iktc-start').value);
    const p2 = parseCoords(document.getElementById('iktc-ziel').value);
    const baseTempo = parseFloat(document.getElementById('iktc-speed').value) || 20;
    const box = document.getElementById('iktc-result');

    if (!p1 || !p2) {
      box.innerHTML = '<p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">Bitte gültige Start- und Zielkoordinaten im Format X | Y eingeben (z. B. -40 | -60).</p>';
      return;
    }

    const dx = (p2.x - p1.x) / 10;
    const dy = (p2.y - p1.y) / 10;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const secOneWay = dist === 0 ? 0 : (32700 / baseTempo) * dist;
    const secRoundTrip = secOneWay * 2;
    const now = new Date();
    const etaArr = new Date(now.getTime() + secOneWay * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

    let html = '<div style="font-weight:bold;color:#a78bfa;margin-bottom:8px">📊 (' + p1.x + ' | ' + p1.y + ') → (' + p2.x + ' | ' + p2.y + ')</div>'
      + '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:10px;font-size:12px">'
      + '<div>Luftlinie (Felder): <b>' + dist.toFixed(2) + '</b></div>'
      + '<div>Ankunft (ETA): <b>' + etaArr + '</b></div>'
      + '<div>Hinreise (einfach): <b style="color:#4ade80">' + formatTime(secOneWay) + '</b></div>'
      + '<div>Hin &amp; Rückfahrt: <b style="color:#f0d68a">' + formatTime(secRoundTrip) + '</b></div>'
      + '</div>'
      + '<div style="font-size:12px;font-weight:bold;margin-bottom:6px">Vergleich aller Schiffstypen:</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<tr style="opacity:.7"><td>Schiffstyp</td><td>Tempo</td><td>Einfache Fahrt</td><td>Rückkehr um</td></tr>';

    SHIPS_LIST.forEach((s) => {
      const tSec = dist === 0 ? 0 : (32700 / s.tempo) * dist;
      const sRet = new Date(now.getTime() + tSec * 2 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const hl = s.tempo === baseTempo ? 'background:rgba(167,139,250,.15);font-weight:bold' : '';
      html += '<tr style="' + hl + '"><td>' + s.name + (s.pirate ? ' 🏴‍☠️' : '') + '</td>'
        + '<td>' + s.tempo + '/h</td><td style="color:#4ade80">' + formatTime(tSec) + '</td>'
        + '<td style="opacity:.75">' + sRet + '</td></tr>';
    });

    html += '</table>';
    box.innerHTML = html;
  }

  document.getElementById('iktc-start').addEventListener('input', run);
  document.getElementById('iktc-ziel').addEventListener('input', run);
  document.getElementById('iktc-speed').addEventListener('change', run);
})();
