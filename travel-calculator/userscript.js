// ==UserScript==
// @name         Islandking Reisezeitenrechner
// @namespace    https://github.com/H4nnib4l22/islandKing-bookmarklets
// @version      1.6.10
// @description  Berechnet Distanz und Fahrtzeit zwischen zwei Koordinaten für alle Schiffstypen, plus Kampfrechner mit PvP- und Konvoi-entern-Tab (inkl. "An Kampfrechner senden"-Button im Karten-Popup eines Piraten-Konvois) — beide Panels ein-/ausklappbar, Seite (links/rechts) frei wählbar
// @author       Oscar
// @license      MIT
// @match        https://islandking.ch/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://update.greasyfork.org/scripts/595510/Islandking%20Reisezeitenrechner.user.js
// @updateURL    https://update.greasyfork.org/scripts/595510/Islandking%20Reisezeitenrechner.meta.js
// ==/UserScript==

/*
 * Islandking Reisezeitenrechner + Kampfrechner — Tampermonkey-Userscript
 * (baugleich zum Bookmarklet in diesem Ordner, nur oeffnet es sich
 * automatisch beim Laden der Seite statt per Klick).
 * Reisezeit: reine Koordinaten-Rechnung, 1:1 aus runStandaloneTravelCalc()
 * uebernommen. Kampf: 1:1 aus simulateCombatFull() im Schattenflotte
 * Taktischer Koordinator uebernommen (kontinuierlicher HP-Pool, 444/445
 * echte Kaempfe exakt getroffen), zwei Tabs im selben Panel: "PvP" (wie
 * bisher, Truppen + Verteidigungsanlagen) und "Konvoi entern" (nur
 * Schiffe — laut Wiki liegt ein Piraten-Konvoi "vor Anker" und hat keine
 * Landtruppen/Gebaeude, gleiche Kampfformel, andere Katalogauswahl).
 * Beide brauchen keine API, keinen Login-Token, keine Netzwerkanfrage —
 * reiner Katalog + Formel.
 * Beide Panels sind ein-/ausklappbar (Header bleibt sichtbar) und koennen
 * per Klick die Seite (links/rechts) wechseln; Klapp-/Seitenzustand wird
 * pro Panel in localStorage gemerkt.
 * v1.6.0: "An Kampfrechner senden"-Button im spielinternen Karten-Popup
 * eines Piraten-Konvois (DOM der Vue-SPA der Seite, kein eigenes Panel) —
 * uebertraegt dessen Schiffstypen+Anzahl direkt in den Konvoi-entern-Tab.
 * Nur sichtbar, solange das Popup selbst offen ist.
 * v1.6.8: gleicher "An Kampfrechner senden"-Button auch bei jedem
 * Spionagebericht (/spy-reports, neben "Erneut spähen") — uebertraegt
 * Verteidigungsgebaeude/Schiffe/Soldaten des Berichts in den PvP-Tab
 * (Verteidiger-Seite). Erkennung ueber den einzigartigen "Erneut
 * spähen"-Buttontext, existiert nur auf Spionageberichten.
 * v1.6.9: "Eigene Flotte laden"-Button neben "Angreifer" im PvP-Tab (holt
 * Schiffe+Soldaten aller eigenen Inseln ueber /api/islands/:id/overview,
 * aufsummiert). Ausserdem ein kleines "✕" rechts neben jedem Angreifer-
 * Feld (PvP UND Konvoi entern) zum Leeren einzelner Zeilen.
 * v1.6.10: "Eigene Flotte laden" fragt jetzt erst, von welcher Insel
 * geladen werden soll (Dropdown erscheint nur bei mehr als einer Insel,
 * inkl. "Alle Inseln" als weiterhin verfuegbare Summen-Option).
 */
(function () {
  const existing = document.getElementById('iktc-panel') || document.getElementById('ikcc-panel');
  if (existing) {
    const other = document.getElementById('iktc-panel');
    const other2 = document.getElementById('ikcc-panel');
    if (other) other.remove();
    if (other2) other2.remove();
    return;
  }

  function readPref(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writePref(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* privater Modus o.ae. — Praeferenz einfach nicht gemerkt */ }
  }

  // Gemeinsame Stapel-Konvention ALLER islandking.ch-Bookmarklets/-
  // Userscripts (siehe Allianz Status/Ressourcenrechner): dockt je Seite
  // unter das unterste bereits offene Panel derselben Seite an, egal aus
  // welchem Script — reine Messung der aktuellen Bounding-Box.
  //
  // Seq-basiert statt "alle anderen derselben Seite": jedes Panel bekommt
  // beim Erzeugen eine fortlaufende Nummer (window.__ikbmSeq, geteilt über
  // ALLE Scripts hinweg, da @grant none -> gleiches window). Beim Stacken
  // zaehlen nur Panels mit KLEINERER Seq (= frueher erzeugt), nie juengere.
  // Ohne diese Regel wuerden zwei gleichseitige Panels, die BEIDE per
  // Intervall repositionieren, sich gegenseitig beobachten und bei jedem
  // Tick unbegrenzt nach unten aufschaukeln (A reagiert auf B's letzten
  // Stand, B auf A's gerade aktualisierten — daher strikt einseitig: nur
  // rueckwaerts in der Entstehungsreihenfolge schauen, nie vorwaerts).
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

  // Baut ein ein-/ausklappbares Overlay-Panel mit Seiten-Umschalter. Klapp-
  // und Seitenzustand landen in localStorage (Schluessel je Panel-id), damit
  // sie einen Seitenwechsel/Reload ueberleben.
  const VERSION = 'v1.6.10';
  const VERSION_HTML = ' <span style="opacity:.5;font-weight:normal;font-size:11px">' + VERSION + '</span>';

  function createPanel(id, title, width, defaultSide, bodyHtml) {
    title = title + VERSION_HTML;
    const sideKey = 'ikbm-side-' + id;
    const collapsedKey = 'ikbm-collapsed-' + id;
    const side = readPref(sideKey, defaultSide);
    const collapsed = readPref(collapsedKey, '0') === '1';
    const seq = nextPanelSeq();

    const panel = document.createElement('div');
    panel.id = id;
    panel.dataset.ikbmPanel = '1';
    panel.dataset.ikbmSide = side;
    panel.dataset.ikbmSeq = seq;
    panel.style.cssText = 'position:fixed;width:' + width + 'px;overflow:auto;'
      + 'background:#0f1b2b;color:#e6edf3;border:1px solid #24344a;border-radius:8px;'
      + 'font:13px/1.4 system-ui,sans-serif;padding:14px;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,.5)';
    panel.innerHTML = '<div data-role="header" style="display:flex;justify-content:space-between;align-items:center;' + (collapsed ? '' : 'margin-bottom:8px') + '">'
      + '<b data-role="collapse-toggle" style="cursor:pointer;user-select:none">' + (collapsed ? '▸' : '▾') + ' ' + title + '</b>'
      + '<span style="display:flex;gap:10px;align-items:center">'
      + '<span data-role="side-toggle" title="Seite wechseln (aktuell: ' + (side === 'left' ? 'links' : 'rechts') + ')" style="cursor:pointer;opacity:.7">⇄</span>'
      + '<span data-role="close" style="cursor:pointer;opacity:.7">✕</span>'
      + '</span></div>'
      + '<div data-role="body"' + (collapsed ? ' hidden' : '') + '>' + bodyHtml + '</div>';
    document.body.appendChild(panel);

    const header = panel.querySelector('[data-role="header"]');
    const collapseToggle = panel.querySelector('[data-role="collapse-toggle"]');
    const sideToggle = panel.querySelector('[data-role="side-toggle"]');
    const closeBtn = panel.querySelector('[data-role="close"]');
    const body = panel.querySelector('[data-role="body"]');

    collapseToggle.addEventListener('click', () => {
      const next = !body.hidden;
      body.hidden = next;
      collapseToggle.innerHTML = (next ? '▸ ' : '▾ ') + title;
      header.style.marginBottom = next ? '0' : '8px';
      writePref(collapsedKey, next ? '1' : '0');
    });

    sideToggle.addEventListener('click', () => {
      const next = panel.dataset.ikbmSide === 'left' ? 'right' : 'left';
      panel.dataset.ikbmSide = next;
      sideToggle.title = 'Seite wechseln (aktuell: ' + (next === 'left' ? 'links' : 'rechts') + ')';
      writePref(sideKey, next);
    });

    function reposition() {
      const s = panel.dataset.ikbmSide;
      const top = computeStackTop(s, seq);
      panel.style.top = top + 'px';
      if (s === 'left') { panel.style.left = '20px'; panel.style.right = ''; }
      else { panel.style.right = '20px'; panel.style.left = ''; }
      panel.style.maxHeight = 'calc(100vh - ' + top + 'px - 20px)';
    }

    return { panel, body, reposition, closeBtn };
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

  const travelBodyHtml = '<div style="display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap">'
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
    + '<div id="iktc-result"><p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">Start- und Zielkoordinaten eingeben.</p></div>';

  const travel = createPanel('iktc-panel', '🧭 Reisezeitenrechner', 380, 'right', travelBodyHtml);

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

  // ---- Kampfrechner ----------------------------------------------------
  // Katalog + Formel 1:1 aus simulateCombatFull() im Schattenflotte
  // Taktischer Koordinator uebernommen (444/445 echte Kaempfe exakt).
  const SHIPS_COMBAT = [
    { name: 'Schlachtschiff', attack: 4000, hp: 5000 },
    { name: 'schwere Galeere', attack: 200, hp: 500 },
    { name: 'leichte Galeere', attack: 40, hp: 60 },
    { name: 'Fregatte', attack: 650, hp: 7000 },
    { name: 'kleines Frachtschiff', attack: 0, hp: 50 },
    { name: 'grosses Frachtschiff', attack: 0, hp: 150 },
    { name: 'Kolonisationsschiff', attack: 10, hp: 150 },
    { name: 'mächtiges Piratenschiff', attack: 3500, hp: 7500 },
    { name: 'grosses Piratenschiff', attack: 400, hp: 6500 },
    { name: 'altes Piratenschiff', attack: 10, hp: 200 },
    { name: 'Piratenschiff', attack: 120, hp: 800 },
  ];
  // Baukosten nur der vom Spieler baubaren Schiffe (Piratenschiffe haben
  // kein unitCost, koennen nicht gebaut/repariert werden) - live verifiziert
  // ueber /api/islands/:id/overview -> ships[].unitCost (2026-09-13).
  const SHIP_BUILD_COST = {
    'Schlachtschiff': { wood: 200000, stone: 80000, iron: 80000 },
    'schwere Galeere': { wood: 40000, stone: 500, iron: 15600 },
    'leichte Galeere': { wood: 9000, stone: 300, iron: 5000 },
    'Fregatte': { wood: 120000, stone: 30000, iron: 50000 },
    'kleines Frachtschiff': { wood: 6500, stone: 150, iron: 4100 },
    'grosses Frachtschiff': { wood: 24000, stone: 500, iron: 12000 },
    'Kolonisationsschiff': { wood: 30000, stone: 10000, iron: 15000 },
  };
  // Ressourcen-Icons statt Emoji fuer die Reparaturkosten-Anzeige - direkt
  // von islandking.ch selbst geladen (same-origin, /resources/<key>.webp,
  // Fund vom 2026-09-13: dieselben Icons wie im Spiel-eigenen Ressourcen-
  // Balken). Kein Base64-Embed noetig, immer im aktuellen Spiel-Look.
  const ICON_WOOD = '/resources/wood.webp';
  const ICON_STONE = '/resources/stone.webp';
  const ICON_IRON = '/resources/iron.webp';
  // Ein Piraten-Konvoi besteht laut Wiki ausschliesslich aus Piratenschiffen
  // (kein Spieler faehrt eigene Fregatten/Galeeren/Frachter im Konvoi) -
  // Angreifer-Katalog bleibt SHIPS_COMBAT (alle Schiffstypen), nur die
  // Konvoi-Verteidigerseite ist auf die 4 Piratenschiffs-Typen eingeschraenkt.
  const PIRATE_SHIPS_COMBAT = SHIPS_COMBAT.filter((u) => u.name.includes('Piratenschiff'));
  const TROOPS_COMBAT = [
    { name: 'Soldat', attack: 3, hp: 2 },
    { name: 'Schwertkämpfer', attack: 3, hp: 5 },
    { name: 'Musketier', attack: 14, hp: 6 },
    { name: 'Kanonier', attack: 40, hp: 10 },
    { name: 'Ritter', attack: 12, hp: 21 },
  ];
  // Verteidigungsanlagen: nur beim Verteidiger, level-skaliert (Lv 1-50), ausser
  // den beiden festen Anlagen ohne Level (Kanonen zur Stadtmauer/Stadtmauer selbst).
  const BUILDINGS_COMBAT = [
    { name: 'Kanonen zur Stadtmauer', fixed: { attack: 20000, hp: 1 } },
    { name: 'Stadtmauer', fixed: { attack: 0, hp: 30000 } },
    { name: 'Leichter Turm', perLv: { attack: 30, hp: 100 } },
    { name: 'Schwerer Turm', perLv: { attack: 180, hp: 700 } },
    { name: 'Kanonenturm', perLv: { attack: 1600, hp: 3000 } },
    { name: 'Wasserblockade', perLv: { attack: 0, hp: 5000 } },
  ];

  // 1:1 aus index.php: kontinuierlicher HP-Pool pro Einheitentyp statt diskreter
  // Rundenverluste. Schaden wird proportional zum verbleibenden Pool-Anteil verteilt,
  // curCount = ceil(pool/hp) haelt angeschlagene Einheiten voll angriffsstark im Kampf.
  function simulateCombatFull(attackerUnits, defenderUnits, maxRounds) {
    if (maxRounds === undefined) maxRounds = 6;
    let att = attackerUnits.map((u) => Object.assign({}, u, { curHpPool: u.count * u.hp }));
    let def = defenderUnits.map((u) => Object.assign({}, u, { curHpPool: u.count * u.hp }));
    let round = 1;
    let rounds = 0;

    while (round <= maxRounds) {
      const totalAtk_A = att.reduce((s, u) => s + (u.curHpPool > 0 ? Math.ceil(u.curHpPool / u.hp) * u.attack : 0), 0);
      const totalHp_A = att.reduce((s, u) => s + Math.max(0, u.curHpPool), 0);
      const totalAtk_D = def.reduce((s, u) => s + (u.curHpPool > 0 ? Math.ceil(u.curHpPool / u.hp) * u.attack : 0), 0);
      const totalHp_D = def.reduce((s, u) => s + Math.max(0, u.curHpPool), 0);

      if (totalHp_A <= 0 || totalHp_D <= 0) break;

      def.forEach((u) => {
        if (u.curHpPool > 0 && totalHp_D > 0) {
          const share = u.curHpPool / totalHp_D;
          u.curHpPool = Math.max(0, u.curHpPool - totalAtk_A * share);
        }
      });
      att.forEach((u) => {
        if (u.curHpPool > 0 && totalHp_A > 0) {
          const share = u.curHpPool / totalHp_A;
          u.curHpPool = Math.max(0, u.curHpPool - totalAtk_D * share);
        }
      });

      rounds = round;
      const remHp_A = att.reduce((s, u) => s + Math.max(0, u.curHpPool), 0);
      const remHp_D = def.reduce((s, u) => s + Math.max(0, u.curHpPool), 0);
      if (remHp_D <= 0 || remHp_A <= 0) break;
      round++;
    }

    const toFinal = (list) => list.map((u) => Object.assign({}, u, { after: Math.ceil(Math.max(0, u.curHpPool) / u.hp) }));
    const attFinal = toFinal(att);
    const defFinal = toFinal(def);
    const defDestroyed = defFinal.every((u) => u.after === 0) && attFinal.some((u) => u.after > 0);
    return { attFinal, defFinal, rounds, defDestroyed };
  }

  // clearable: kleines "✕" rechts neben dem Feld zum Leeren dieser einen
  // Zeile - nur bei der eigenen Flotte sinnvoll (Angreifer in PvP UND
  // Konvoi entern), nicht beim Verteidiger/Piraten-Konvoi (Gegner-Daten).
  function unitRow(prefix, u, extra, clearable) {
    const key = prefix + ':' + u.name;
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:2px 0">'
      + '<span style="opacity:.85">' + u.name + (extra || '') + '</span>'
      + '<span style="display:flex;align-items:center;gap:4px">'
      + '<input type="number" min="0" value="0" data-ikcc-unit="' + key + '" style="width:70px;box-sizing:border-box">'
      + (clearable ? '<span data-ikcc-clear="' + key + '" title="Leeren" style="cursor:pointer;opacity:.5;font-size:12px">✕</span>' : '')
      + '</span>'
      + '</div>';
  }

  function buildingRow(b) {
    if (b.fixed) {
      return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:2px 0">'
        + '<span style="opacity:.85">' + b.name + '</span>'
        + '<input type="checkbox" data-ikcc-bldg-fixed="' + b.name + '">'
        + '</div>';
    }
    return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:2px 0">'
      + '<span style="opacity:.85">' + b.name + ' (Lv)</span>'
      + '<input type="number" min="0" max="50" value="0" data-ikcc-bldg-lv="' + b.name + '" style="width:70px;box-sizing:border-box">'
      + '</div>';
  }

  // Angreifer/Verteidiger UNTEREINANDER statt nebeneinander — bei der
  // einheitlichen Panel-Breite (siehe unten) wuerden zwei Spalten mit
  // langen Einheitennamen ("mächtiges Piratenschiff") zu eng, gestapelt
  // nutzt jede Zeile die volle Breite.
  function unitSection(prefix, title, color, clearable, headerExtra) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;font-weight:bold;color:' + color + ';margin:8px 0 4px">'
      + '<span>' + title + '</span>' + (headerExtra || '') + '</div>'
      + '<div style="font-size:11px;opacity:.6;margin:4px 0">Schiffe</div>'
      + SHIPS_COMBAT.map((u) => unitRow(prefix, u, null, clearable)).join('')
      + '<div style="font-size:11px;opacity:.6;margin:4px 0">Truppen</div>'
      + TROOPS_COMBAT.map((u) => unitRow(prefix, u, null, clearable)).join('');
  }

  // Angreifer/Verteidiger-Sektion nur mit Schiffen (keine Truppen) — fuer
  // den Konvoi-entern-Tab, der laut Wiki (Piraten-Konvoi liegt "vor Anker",
  // reine Schiffsflotte) keine Landtruppen/Gebaeude kennt.
  function shipOnlySection(prefix, title, color, catalog, clearable) {
    return '<div style="font-weight:bold;color:' + color + ';margin:8px 0 4px">' + title + '</div>'
      + catalog.map((u) => unitRow(prefix, u, null, clearable)).join('');
  }

  // "Eigene Flotte laden" — kleiner Button rechts neben "Angreifer" im
  // PvP-Tab, holt Schiffe+Soldaten der eigenen Insel(n) (siehe
  // loadOwnFleet() weiter unten) und traegt sie in die Angreifer-Felder
  // ein. Das Dropdown daneben bleibt versteckt, solange nur eine Insel
  // existiert (populateOwnFleetSelect() weiter unten) — Nutzerwunsch:
  // bei mehreren Inseln erst abfragen, von welcher geladen wird, statt
  // immer stumm alle zu summieren.
  const ownFleetBtnHtml = '<span style="display:flex;gap:4px;align-items:center">'
    + '<select id="ikcc-own-fleet-island" style="display:none;font-size:11px;padding:1px 4px;border-radius:4px;'
    + 'background:#142338;color:#e6edf3;border:1px solid #24344a"></select>'
    + '<button id="ikcc-own-fleet" style="font-size:11px;padding:2px 8px;border-radius:4px;'
    + 'border:none;cursor:pointer;background:#1f6feb;color:#fff">🚢 Eigene Flotte laden</button>'
    + '</span>';

  const pvpBodyHtml = unitSection('att', 'Angreifer', '#a78bfa', true, ownFleetBtnHtml)
    + unitSection('def', 'Verteidiger', '#f0d68a', false)
    + '<div style="font-size:11px;opacity:.6;margin:4px 0">Verteidigungsanlagen</div>'
    + BUILDINGS_COMBAT.map(buildingRow).join('')
    + '<button id="ikcc-run" style="width:100%;padding:6px;margin:10px 0;cursor:pointer">Kämpfen</button>'
    + '<div id="ikcc-result"><p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">Einheiten eingeben und auf "Kämpfen" klicken.</p></div>';

  const convoyBodyHtml = '<p style="opacity:.6;font-size:11px;margin:4px 0 10px">Nur Schiffe — Piraten-Konvois haben keine Landtruppen/Verteidigungsanlagen.</p>'
    + shipOnlySection('catt', 'Angreifer', '#a78bfa', SHIPS_COMBAT, true)
    + shipOnlySection('cdef', 'Piraten-Konvoi', '#f0d68a', PIRATE_SHIPS_COMBAT, false)
    + '<button id="ikcc-convoy-run" style="width:100%;padding:6px;margin:10px 0;cursor:pointer">Entern</button>'
    + '<div id="ikcc-convoy-result"><p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">Schiffe eingeben und auf "Entern" klicken.</p></div>';

  const ikccTabBtnStyle = 'flex:1;padding:5px;border:1px solid #24344a;background:#142338;color:#e6edf3;border-radius:5px;cursor:pointer;font-size:12px';
  const combatBodyHtml = '<nav style="display:flex;gap:4px;margin-bottom:10px">'
    + '<button id="ikcc-tab-pvp" style="' + ikccTabBtnStyle + '">PvP</button>'
    + '<button id="ikcc-tab-convoy" style="' + ikccTabBtnStyle + '">Konvoi entern</button>'
    + '</nav>'
    + '<div id="ikcc-tabbody-pvp">' + pvpBodyHtml + '</div>'
    + '<div id="ikcc-tabbody-convoy" style="display:none">' + convoyBodyHtml + '</div>';

  // Einheitliche Panel-Breite ueber alle vier Panels (Allianz Status,
  // Ressourcenrechner, Reisezeitenrechner, Kampfrechner) — passt so in
  // den verfuegbaren Freiraum, ohne dass eines breiter herausragt.
  const combat = createPanel('ikcc-panel', '⚔️ Kampfrechner', 380, 'right', combatBodyHtml);

  // Ein Klick auf ein "✕" (data-ikcc-clear, siehe unitRow) leert genau das
  // dazugehoerige Feld — ein einziger delegierter Listener statt einem pro
  // Zeile, da die Zeilen per innerHTML gebaut werden.
  combat.panel.addEventListener('click', (e) => {
    const clearBtn = e.target.closest('[data-ikcc-clear]');
    if (!clearBtn) return;
    const input = combat.panel.querySelector('[data-ikcc-unit="' + clearBtn.dataset.ikccClear + '"]');
    if (input) input.value = 0;
  });

  // "Eigene Flotte laden": Schiffe+Soldaten einer Insel (oder aller, falls
  // "Alle Inseln" gewaehlt). Schema live verifiziert (2026-09-14) ueber
  // /api/islands/:id/overview: ships[].name matcht 1:1 die SHIPS_COMBAT-
  // Katalognamen, soldiers[].name dagegen NICHT ("Einfacher Soldat"/
  // "Musketiere"/"Kanoniere" statt "Soldat"/"Musketier"/"Kanonier") —
  // daher key-basierte Zuordnung fuer Truppen statt Namensvergleich.
  const SOLDIER_KEY_TO_NAME = { so: 'Soldat', sk: 'Schwertkämpfer', mu: 'Musketier', ka: 'Kanonier', ri: 'Ritter' };

  function ikccAuthHeaders() {
    const token = (() => { try { return localStorage.getItem('access_token'); } catch (e) { return null; } })();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  let ownIslandsCache = null;
  async function loadOwnIslands() {
    if (!ownIslandsCache) ownIslandsCache = await fetch('/api/islands', { headers: ikccAuthHeaders() }).then((r) => r.json());
    return ownIslandsCache;
  }

  // Dropdown bleibt versteckt (und "Eigene Flotte laden" laedt direkt alle
  // Inseln zusammen), solange nur eine Insel existiert — die Abfrage lohnt
  // sich erst bei mehreren (Nutzerwunsch 2026-09-14: "sofern mehrere
  // vorhanden" nachfragen statt immer stumm zu summieren).
  async function populateOwnFleetSelect() {
    const select = document.getElementById('ikcc-own-fleet-island');
    try {
      const islands = await loadOwnIslands();
      if (islands.length <= 1) return;
      select.innerHTML = '<option value="all">Alle Inseln</option>'
        + islands.map((isl) => '<option value="' + isl.id + '">' + isl.name + ' (' + isl.coordinates.x + '|' + isl.coordinates.y + ')</option>').join('');
      select.style.display = 'inline-block';
    } catch (e) {
      console.error('Insel-Liste laden fehlgeschlagen:', e);
    }
  }
  populateOwnFleetSelect();

  async function loadOwnFleet() {
    const btn = document.getElementById('ikcc-own-fleet');
    const select = document.getElementById('ikcc-own-fleet-island');
    const originalLabel = btn.textContent;
    btn.disabled = true;
    btn.textContent = '… lädt';
    try {
      const islands = await loadOwnIslands();
      const chosenId = select.style.display !== 'none' ? select.value : 'all';
      const targetIslands = chosenId === 'all' ? islands : islands.filter((isl) => String(isl.id) === chosenId);
      const headers = ikccAuthHeaders();
      const shipTotals = {};
      const soldierTotals = {};
      for (const isl of targetIslands) {
        const ov = await fetch('/api/islands/' + isl.id + '/overview', { headers }).then((r) => r.json());
        (ov.ships || []).forEach((s) => { shipTotals[s.name] = (shipTotals[s.name] || 0) + s.count; });
        (ov.soldiers || []).forEach((s) => { soldierTotals[s.key] = (soldierTotals[s.key] || 0) + s.count; });
      }
      SHIPS_COMBAT.forEach((u) => {
        const input = combat.panel.querySelector('[data-ikcc-unit="att:' + u.name + '"]');
        if (input) input.value = shipTotals[u.name] || 0;
      });
      TROOPS_COMBAT.forEach((u) => {
        const key = Object.keys(SOLDIER_KEY_TO_NAME).find((k) => SOLDIER_KEY_TO_NAME[k] === u.name);
        const input = combat.panel.querySelector('[data-ikcc-unit="att:' + u.name + '"]');
        if (input) input.value = key ? (soldierTotals[key] || 0) : 0;
      });
    } catch (e) {
      console.error('Eigene Flotte laden fehlgeschlagen:', e);
    } finally {
      btn.disabled = false;
      btn.textContent = originalLabel;
    }
  }
  document.getElementById('ikcc-own-fleet').addEventListener('click', loadOwnFleet);

  function collectUnits(prefix, catalog) {
    const units = [];
    catalog.forEach((u) => {
      const input = combat.panel.querySelector('[data-ikcc-unit="' + prefix + ':' + u.name + '"]');
      const count = parseInt(input.value) || 0;
      if (count > 0) units.push({ name: u.name, attack: u.attack, hp: u.hp, count });
    });
    return units;
  }

  function collectBuildings() {
    const units = [];
    BUILDINGS_COMBAT.forEach((b) => {
      if (b.fixed) {
        const box = combat.panel.querySelector('[data-ikcc-bldg-fixed="' + b.name + '"]');
        if (box.checked) units.push({ name: b.name, attack: b.fixed.attack, hp: b.fixed.hp, count: 1 });
      } else {
        const input = combat.panel.querySelector('[data-ikcc-bldg-lv="' + b.name + '"]');
        const lv = parseInt(input.value) || 0;
        if (lv > 0) units.push({ name: b.name, attack: b.perLv.attack * lv, hp: b.perLv.hp * lv, count: 1 });
      }
    });
    return units;
  }

  // Bei Ueberleben mit angeschlagenem HP-Pool geht die letzte (angebrochene)
  // Einheit nicht kampfbereit, sondern beschaedigt ins Reparaturdock zurueck
  // (Nutzer-Beobachtung 2026-09-13: 1 von 2 Schlachtschiffen kam mit 76%
  // SCHADEN ins Dock). curHpPool minus die vollen Einheiten davor = Rest-HP
  // der angebrochenen letzten Einheit, 100% minus deren Anteil = Schaden%.
  function dockDamagePercent(f) {
    if (!f || f.after <= 0) return null;
    const rest = f.curHpPool - (f.after - 1) * f.hp;
    const restPct = Math.round((rest / f.hp) * 100);
    return restPct < 100 ? 100 - restPct : null;
  }

  // ANG:/DEF: am Ende der Titelzeile - gleiche Emoji-Konvention wie die
  // Seite selbst (Schiffswerft-Karten: "Tempo … · ⚔️ 40 · 🛡 60 …", kein
  // Icon-Asset, reines Unicode - live verifiziert im DOM 2026-09-14).
  function totalStats(units) {
    let att = 0, hp = 0;
    units.forEach((u) => { att += u.attack * u.count; hp += u.hp * u.count; });
    return '<span style="font-weight:normal;opacity:.8;float:right">⚔️ ANG: ' + att.toLocaleString()
      + ' &nbsp; 🛡 DEF: ' + hp.toLocaleString() + '</span>';
  }

  // Reparaturkosten = Schaden% der angebrochenen Einheit * ihre Baukosten
  // (Nutzerangabe 2026-09-13: bei 76% Schaden fallen exakt 76% der
  // Baukosten als Reparaturkosten an). Nur fuer Schiffstypen mit bekanntem
  // SHIP_BUILD_COST - Truppen/Gebaeude/Piratenschiffe haben keins.
  function resultTable(title, before, final) {
    let html = '<div style="font-size:12px;font-weight:bold;margin:8px 0 4px">' + title + totalStats(before) + '</div>'
      + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
      + '<tr style="opacity:.7"><td>Einheit</td><td>Vorher</td><td>Nachher</td><td>Verlust</td><td>Dock (Schaden)</td></tr>';
    const repairTotal = { wood: 0, stone: 0, iron: 0 };
    before.forEach((u) => {
      const f = final.find((x) => x.name === u.name);
      const after = f ? f.after : 0;
      const dmgPct = dockDamagePercent(f);
      html += '<tr><td>' + u.name + '</td><td>' + u.count + '</td>'
        + '<td style="color:' + (after > 0 ? '#4ade80' : '#f87171') + '">' + after + '</td>'
        + '<td style="opacity:.75">' + (u.count - after) + '</td>'
        + '<td style="opacity:.75">' + (dmgPct !== null ? '1x ' + dmgPct + '%' : '—') + '</td></tr>';
      const buildCost = SHIP_BUILD_COST[u.name];
      if (dmgPct !== null && buildCost) {
        repairTotal.wood += buildCost.wood * dmgPct / 100;
        repairTotal.stone += buildCost.stone * dmgPct / 100;
        repairTotal.iron += buildCost.iron * dmgPct / 100;
      }
    });
    html += '</table>';
    if (repairTotal.wood || repairTotal.stone || repairTotal.iron) {
      // Als eigene Tabelle statt Flex-Zeile: eine Tabellenzelle je Icon+Zahl
      // bricht nie mitten im Paar um, egal wie eng die Panel-Breite ist.
      // display:inline-block auf dem img noetig, weil islandking.ch selbst
      // global "img { display: block }" setzt - white-space:nowrap allein
      // verhindert nur Textumbruch, nicht den erzwungenen Block-Umbruch vor
      // dem folgenden Text (Nutzer-Korrektur 2026-09-13/14: Zahl blieb
      // trotz nowrap unter dem Icon).
      const cell = (src, val) => '<td style="white-space:nowrap;padding-right:10px">'
        + '<img src="' + src + '" width="14" height="14" style="display:inline-block;vertical-align:middle;margin-right:3px">'
        + Math.round(val).toLocaleString() + '</td>';
      html += '<table style="font-size:11px;opacity:.75;margin-top:4px;border-collapse:collapse">'
        + '<tr><td style="padding-right:8px">Reparaturkosten:</td>'
        + cell(ICON_WOOD, repairTotal.wood) + cell(ICON_STONE, repairTotal.stone) + cell(ICON_IRON, repairTotal.iron)
        + '</tr></table>';
    }
    return html;
  }

  function outcome(result, defenderLabel) {
    const attSurvives = result.attFinal.some((u) => u.after > 0);
    const defSurvives = result.defFinal.some((u) => u.after > 0);
    if (!defSurvives && attSurvives) return { text: '🏆 Angreifer siegt — ' + defenderLabel + ' vollständig vernichtet', color: '#4ade80' };
    if (!attSurvives && !defSurvives) return { text: '💀 Gegenseitige Vernichtung — zählt als abgewehrter Angriff', color: '#f87171' };
    return { text: '🛡️ ' + defenderLabel + ' hält (max. 6 Runden erreicht)', color: '#f0d68a' };
  }

  function runCombat() {
    const attackerUnits = collectUnits('att', SHIPS_COMBAT).concat(collectUnits('att', TROOPS_COMBAT));
    const defenderUnits = collectUnits('def', SHIPS_COMBAT).concat(collectUnits('def', TROOPS_COMBAT)).concat(collectBuildings());
    const box = document.getElementById('ikcc-result');

    if (attackerUnits.length === 0) {
      box.innerHTML = '<p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">Angreifer braucht mindestens eine Einheit.</p>';
      return;
    }
    if (defenderUnits.length === 0) {
      box.innerHTML = '<p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">0 Verteidiger → kein Kampf, reine Plünderung.</p>';
      return;
    }

    const result = simulateCombatFull(attackerUnits, defenderUnits);
    const o = outcome(result, 'Verteidiger');

    let html = '<div style="font-weight:bold;color:' + o.color + ';margin-bottom:4px">' + o.text + '</div>'
      + '<div style="font-size:12px;opacity:.8">Runden: <b>' + result.rounds + '</b> / 6</div>'
      + resultTable('Angreifer', attackerUnits, result.attFinal)
      + resultTable('Verteidiger', defenderUnits, result.defFinal);
    box.innerHTML = html;
  }

  // Konvoi entern: gleiche simulateCombatFull()-Formel wie PvP, aber nur
  // Schiffe (keine Truppen/Gebaeude) — siehe Wiki "Piraten-Konvoi entern":
  // ein Konvoi liegt vor Anker und hat nur eine Schiffsflotte als Verteidigung.
  function runConvoy() {
    const attackerUnits = collectUnits('catt', SHIPS_COMBAT);
    const defenderUnits = collectUnits('cdef', PIRATE_SHIPS_COMBAT);
    const box = document.getElementById('ikcc-convoy-result');

    if (attackerUnits.length === 0) {
      box.innerHTML = '<p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">Angreifer braucht mindestens ein Schiff.</p>';
      return;
    }
    if (defenderUnits.length === 0) {
      box.innerHTML = '<p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">0 Konvoi-Schiffe → nichts zu entern.</p>';
      return;
    }

    const result = simulateCombatFull(attackerUnits, defenderUnits);
    const o = outcome(result, 'Konvoi');

    let html = '<div style="font-weight:bold;color:' + o.color + ';margin-bottom:4px">' + o.text + '</div>'
      + '<div style="font-size:12px;opacity:.8">Runden: <b>' + result.rounds + '</b> / 6</div>'
      + resultTable('Angreifer', attackerUnits, result.attFinal)
      + resultTable('Piraten-Konvoi', defenderUnits, result.defFinal);
    box.innerHTML = html;
  }

  document.getElementById('ikcc-run').addEventListener('click', runCombat);
  document.getElementById('ikcc-convoy-run').addEventListener('click', runConvoy);

  // "An Kampfrechner senden"-Button im Karten-Popup eines Piraten-Konvois.
  // Das Popup ist Teil der Vue-SPA der Seite (kein eigenes DOM von uns) und
  // erscheint/verschwindet, sobald der Spieler auf der Karte einen anderen
  // Punkt anklickt — daher kein eigener State noetig: der Button lebt nur
  // so lange wie das Popup selbst, ueber das ohnehin laufende 250ms-Poll
  // (repositionAll) erkannt statt per eigenem MutationObserver.
  // Schiffsnamen-Zeilen im Popup: <li><span>Name</span><span class="font-mono">...×N</span></li>,
  // "Name" matcht 1:1 (bis auf ß/ss) die Katalognamen in PIRATE_SHIPS_COMBAT.
  function normalizeShipName(s) { return s.trim().replace(/ß/g, 'ss').toLowerCase(); }

  function parseConvoyShips(panel) {
    const ships = [];
    panel.querySelectorAll('ul li').forEach((li) => {
      const spans = li.querySelectorAll(':scope > span');
      if (spans.length < 2) return;
      const m = spans[1].textContent.match(/×\s*(\d+)/);
      if (m) ships.push({ name: spans[0].textContent.trim(), count: parseInt(m[1], 10) });
    });
    return ships;
  }

  function sendConvoyToKampfrechner(panel) {
    const ships = parseConvoyShips(panel);
    if (!ships.length) return;
    const body = combat.panel.querySelector('[data-role="body"]');
    if (body.hidden) combat.panel.querySelector('[data-role="collapse-toggle"]').click();
    activateCombatTab('convoy');
    ships.forEach((s) => {
      const target = normalizeShipName(s.name);
      const input = Array.from(combat.panel.querySelectorAll('[data-ikcc-unit^="cdef:"]'))
        .find((inp) => normalizeShipName(inp.dataset.ikccUnit.slice(5)) === target);
      if (input) input.value = s.count;
    });
    combat.panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Die Karte ersetzt ein Popup NICHT beim naechsten Klick, sondern stapelt
  // mehrere Info-Panels in der Sidebar (bestaetigt live: ein bereits
  // geoeffnetes Konvoi-Panel blieb nach Klick auf eine andere Insel stehen).
  // Daher alle aktuell vorhandenen Konvoi-Panels behandeln, nicht nur das
  // erste — jedes bekommt seinen eigenen Button (per-Panel-Check verhindert
  // Duplikate bei wiederholten Polls).
  function ensureConvoySendButton() {
    const markers = Array.from(document.querySelectorAll('p'))
      .filter((p) => p.children.length === 0 && p.textContent.includes('Piraten-Konvoi ('));
    markers.forEach((marker) => {
      const panel = marker.parentElement;
      if (!panel || panel.querySelector('[data-ikcc-send-convoy]')) return;
      const enternBtn = Array.from(panel.querySelectorAll('button')).find((b) => b.textContent.includes('Entern'));
      const btn = document.createElement('button');
      btn.dataset.ikccSendConvoy = '1';
      btn.textContent = '⚔️ An Kampfrechner senden';
      btn.style.cssText = 'margin-top:8px;width:100%;padding:6px;border-radius:6px;border:1px solid #24344a;'
        + 'background:#1f6feb;color:#fff;cursor:pointer;font-size:13px;font-weight:500';
      btn.addEventListener('click', (e) => { e.preventDefault(); sendConvoyToKampfrechner(panel); });
      (enternBtn || panel).insertAdjacentElement(enternBtn ? 'afterend' : 'beforeend', btn);
    });
  }

  // "An Kampfrechner senden"-Button bei Spionageberichten (/spy-reports),
  // rechts neben "Erneut spähen" — uebertraegt Verteidigungsgebaeude,
  // Schiffe und Soldaten des Berichts in den PvP-Tab (Verteidiger-Seite).
  // Live-DOM verifiziert 2026-09-14: jede Karte hat ein .grid mit Feldern
  // (<p class="text-xs">Label</p><p>Wert</p>), Wert-Format "1× Schiffsname,
  // 3× anderer Name" bzw. "leichter Turm Lv2" bzw. "keine"/"Keine
  // Gebaeudeverteidigung vorhanden" wenn leer. Erkennung ausschliesslich
  // ueber den einzigartigen "Erneut spähen"-Buttontext (existiert nur auf
  // Spionageberichten, nicht auf Kampfberichten) statt einer URL-Pruefung.
  function getSpyCardField(card, label) {
    const grid = card.querySelector('.grid');
    if (!grid) return null;
    const field = Array.from(grid.children).find((el) => el.querySelector('p.text-xs')?.textContent.trim() === label);
    if (!field) return null;
    const valueP = Array.from(field.querySelectorAll('p')).find((p) => !p.className.includes('text-xs'));
    return valueP ? valueP.textContent.replace(/\s+/g, ' ').trim() : null;
  }

  function parseCountList(text) {
    if (!text || /^keine/i.test(text.trim())) return [];
    return text.split(',').map((part) => {
      const m = part.trim().match(/^(\d+)\s*[×x]\s*(.+)$/i);
      return m ? { name: m[2].trim(), count: parseInt(m[1], 10) } : null;
    }).filter(Boolean);
  }

  function parseBuildingList(text) {
    if (!text || /^keine/i.test(text.trim())) return [];
    return text.split(',').map((part) => {
      const t = part.trim();
      const m = t.match(/^(.+?)\s+Lv\s*(\d+)$/i);
      return m ? { name: m[1].trim(), level: parseInt(m[2], 10) } : { name: t, level: null };
    });
  }

  function sendSpyDefenseToKampfrechner(card) {
    const ships = parseCountList(getSpyCardField(card, 'Schiffe'));
    const troops = parseCountList(getSpyCardField(card, 'Soldaten'));
    const buildings = parseBuildingList(getSpyCardField(card, 'Verteidigungsgebäude'));

    const body = combat.panel.querySelector('[data-role="body"]');
    if (body.hidden) combat.panel.querySelector('[data-role="collapse-toggle"]').click();
    activateCombatTab('pvp');

    // Verteidiger-Seite erst zuruecksetzen, sonst vermischen sich alte
    // Handeingaben mit den neu uebertragenen Werten.
    combat.panel.querySelectorAll('[data-ikcc-unit^="def:"]').forEach((inp) => { inp.value = 0; });
    combat.panel.querySelectorAll('[data-ikcc-bldg-lv]').forEach((inp) => { inp.value = 0; });
    combat.panel.querySelectorAll('[data-ikcc-bldg-fixed]').forEach((box) => { box.checked = false; });

    [...ships, ...troops].forEach((s) => {
      const target = normalizeShipName(s.name);
      const input = Array.from(combat.panel.querySelectorAll('[data-ikcc-unit^="def:"]'))
        .find((inp) => normalizeShipName(inp.dataset.ikccUnit.slice(4)) === target);
      if (input) input.value = s.count;
    });
    buildings.forEach((b) => {
      const target = normalizeShipName(b.name);
      const fixedBox = Array.from(combat.panel.querySelectorAll('[data-ikcc-bldg-fixed]'))
        .find((box) => normalizeShipName(box.dataset.ikccBldgFixed) === target);
      if (fixedBox) { fixedBox.checked = true; return; }
      const lvInput = Array.from(combat.panel.querySelectorAll('[data-ikcc-bldg-lv]'))
        .find((inp) => normalizeShipName(inp.dataset.ikccBldgLv) === target);
      if (lvInput && b.level != null) lvInput.value = b.level;
    });

    combat.panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function ensureSpySendButton() {
    const spahenBtns = Array.from(document.querySelectorAll('button')).filter((b) => b.textContent.includes('Erneut spähen'));
    spahenBtns.forEach((spahenBtn) => {
      const container = spahenBtn.parentElement;
      if (!container || container.querySelector('[data-ikcc-send-spy]')) return;
      const card = spahenBtn.closest('li') || container;
      const btn = document.createElement('button');
      btn.dataset.ikccSendSpy = '1';
      // Gleiches Blau wie die "Ausbau"-Buttons im Gebäude-Ausbau
      // (bg-ocean-500/hover:bg-ocean-900, live verifiziert 2026-09-14) statt
      // eines generischen Tailwind-Blaus, auf Nutzerwunsch.
      btn.className = spahenBtn.className.replace(/\bbg-amber-600\b/, 'bg-ocean-500').replace(/\bhover:bg-amber-700\b/, 'hover:bg-ocean-900');
      btn.textContent = '⚔️ An Kampfrechner senden';
      btn.addEventListener('click', (e) => { e.preventDefault(); sendSpyDefenseToKampfrechner(card); });
      container.appendChild(btn);
    });
  }

  const ikccTabPvp = document.getElementById('ikcc-tab-pvp');
  const ikccTabConvoy = document.getElementById('ikcc-tab-convoy');
  const ikccBodyPvp = document.getElementById('ikcc-tabbody-pvp');
  const ikccBodyConvoy = document.getElementById('ikcc-tabbody-convoy');
  function activateCombatTab(tab) {
    ikccTabPvp.style.background = tab === 'pvp' ? '#1f6feb' : '#142338';
    ikccTabConvoy.style.background = tab === 'convoy' ? '#1f6feb' : '#142338';
    ikccBodyPvp.style.display = tab === 'pvp' ? 'block' : 'none';
    ikccBodyConvoy.style.display = tab === 'convoy' ? 'block' : 'none';
  }
  ikccTabPvp.onclick = () => activateCombatTab('pvp');
  ikccTabConvoy.onclick = () => activateCombatTab('convoy');
  activateCombatTab('pvp');

  // Ein gemeinsames Intervall reicht: beide Panels lesen bei jedem Tick ihre
  // eigene (ggf. per Seiten-Umschalter geaenderte) data-ikbm-side neu aus,
  // reine Bounding-Box-Messung — kein Resize-Event fuer variable Panel-
  // Hoehen (Ein-/Ausklappen, wachsende Ergebnistabellen) vorhanden.
  // ponytail: Poll statt ResizeObserver/MutationObserver, reicht für zwei
  // simple Overlay-Panels; bei spürbarem Ruckeln auf Observer umstellen.
  // Reihenfolge egal — computeStackTop() ist seq-basiert und daher nie
  // zyklisch (siehe Kommentar dort).
  function repositionAll() {
    travel.reposition();
    combat.reposition();
    ensureConvoySendButton();
    ensureSpySendButton();
  }
  repositionAll();
  const repositionHandle = setInterval(repositionAll, 250);

  travel.closeBtn.onclick = () => { travel.panel.remove(); };
  combat.closeBtn.onclick = () => { combat.panel.remove(); };
})();
