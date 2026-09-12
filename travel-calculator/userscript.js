// ==UserScript==
// @name         Islandking Reisezeitenrechner
// @namespace    https://github.com/H4nnib4l22/islandKing-bookmarklets
// @version      1.0.0
// @description  Berechnet Distanz und Fahrtzeit zwischen zwei Koordinaten für alle Schiffstypen
// @author       Oscar
// @license      MIT
// @match        https://islandking.ch/*
// @grant        none
// @run-at       document-idle
// @updateURL    https://raw.githubusercontent.com/H4nnib4l22/islandKing-bookmarklets/main/travel-calculator/userscript.js
// @downloadURL  https://raw.githubusercontent.com/H4nnib4l22/islandKing-bookmarklets/main/travel-calculator/userscript.js
// ==/UserScript==

/*
 * Islandking Reisezeitenrechner — Tampermonkey-Userscript (baugleich zum
 * Bookmarklet in diesem Ordner, nur oeffnet es sich automatisch beim Laden
 * der Seite statt per Klick).
 * Reine Koordinaten-Rechnung, 1:1 aus runStandaloneTravelCalc() im
 * Schattenflotte Taktischer Koordinator uebernommen — braucht keine API,
 * keinen Login-Token, keine Netzwerkanfrage.
 */
(function () {
  const existing = document.getElementById('iktc-panel');
  if (existing) { existing.remove(); return; }

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

  // Gemeinsame Stapel-Konvention aller islandking.ch-Bookmarklets/-
  // Userscripts (siehe Allianz Status/Ressourcenrechner): dockt rechts
  // unter das unterste bereits offene Panel derselben Seite an.
  // excludeEl blendet das eigene Panel aus der Messung aus, sonst würde
  // es sich bei jedem reposition()-Tick unter sich selbst einsortieren.
  function computeStackTop(side, excludeEl) {
    const others = Array.from(document.querySelectorAll('[data-ikbm-panel][data-ikbm-side="' + side + '"]')).filter((el) => el !== excludeEl);
    let maxBottom = 100;
    others.forEach((el) => { maxBottom = Math.max(maxBottom, el.getBoundingClientRect().bottom); });
    return Math.round(others.length ? maxBottom + 12 : maxBottom);
  }

  const panel = document.createElement('div');
  panel.id = 'iktc-panel';
  panel.dataset.ikbmPanel = '1';
  panel.dataset.ikbmSide = 'right';
  panel.style.cssText = 'position:fixed;width:380px;overflow:auto;'
    + 'background:#1a1428;color:#e6edf3;border:1px solid #3d2f5c;border-radius:8px;'
    + 'font:13px/1.4 system-ui,sans-serif;padding:14px;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
    + '<b>🧭 Reisezeitenrechner</b>'
    + '<span id="iktc-close" style="cursor:pointer;opacity:.7">✕</span></div>'
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
    + '<div id="iktc-result"><p style="opacity:.6;text-align:center;font-style:italic;padding:15px 0">Start- und Zielkoordinaten eingeben.</p></div>';
  document.body.appendChild(panel);

  // Ressourcenrechner (rechte Spalte) wächst/schrumpft je nach Eingabe
  // (z.B. sobald eine Berechnung Ergebnisse zeigt) - kein Resize-Event
  // dafür vorhanden, daher periodisch neu einsortieren statt einmalig beim
  // Öffnen. ponytail: Poll statt ResizeObserver/MutationObserver, reicht
  // für ein simples Overlay-Panel; bei spürbarem Ruckeln auf Observer
  // umstellen.
  function reposition() {
    const top = computeStackTop('right', panel);
    panel.style.top = top + 'px';
    panel.style.right = '20px';
    panel.style.maxHeight = 'calc(100vh - ' + top + 'px - 20px)';
  }
  reposition();
  const repositionHandle = setInterval(reposition, 250);

  document.getElementById('iktc-close').onclick = () => { clearInterval(repositionHandle); panel.remove(); };

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
