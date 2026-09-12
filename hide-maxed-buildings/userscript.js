// ==UserScript==
// @name         Islandking Max-Stufe ausblenden
// @namespace    https://github.com/H4nnib4l22/islandKing-bookmarklets
// @version      1.0.0
// @description  Blendet auf der Inselseite Gebäude aus, die bereits ihre max. Stufe erreicht haben, per Ein/Aus-Schalter über der Gebäudeliste.
// @author       Oscar
// @license      MIT
// @match        https://islandking.ch/island/*
// @grant        none
// @run-at       document-idle
// @downloadURL  https://update.greasyfork.org/scripts/595511/Islandking%20Max-Stufe%20ausblenden.user.js
// @updateURL    https://update.greasyfork.org/scripts/595511/Islandking%20Max-Stufe%20ausblenden.meta.js
// ==/UserScript==

/*
 * Islandking Max-Stufe ausblenden — Tampermonkey-Userscript.
 * Die Gebäudeliste auf der Inselseite (https://islandking.ch/island/<id>)
 * zeigt jedes Gebäude als <li>, maxed Gebäude tragen ein <p>max. Stufe</p>
 * statt eines "Ausbau"-Buttons (verifiziert live per Claude-in-Chrome-DOM-
 * Inspektion, 2026-09-12). Ein Schalter über der Liste blendet diese
 * Eintraege aus/ein, Zustand landet in localStorage (Default: ausgeblendet,
 * da genau das der Wunsch war).
 * Kein eigenes Panel/Overlay, keine API — reine DOM-Filterung der
 * spielinternen Vue-SPA-Seite. Ueber ein einfaches Poll-Intervall erkannt
 * (gleiche Technik wie in den anderen drei Islandking-Userscripts dieses
 * Repos), da die Seite bei Gebäude-Ausbau/Inselwechsel per Vue nachlädt,
 * ohne einen vollen Seiten-Reload auszulösen.
 */
(function () {
  const LS_HIDE_MAXED = 'ikhm_hideMaxed';

  function readPref(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writePref(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* privater Modus o.ae. — Praeferenz einfach nicht gemerkt */ }
  }

  function findGebaeudeSection() {
    const heading = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.trim().startsWith('Gebäude'));
    if (!heading) return null;
    const row = heading.parentElement;
    const ul = row.parentElement.querySelector('ul');
    return ul ? { row, ul } : null;
  }

  function isMaxedLi(li) {
    return !!Array.from(li.querySelectorAll('p')).find((p) => p.textContent.trim() === 'max. Stufe');
  }

  function applyHiding(ul, hide) {
    Array.from(ul.children).forEach((li) => {
      if (isMaxedLi(li)) li.style.display = hide ? 'none' : '';
    });
  }

  function ensureToggle(row, ul) {
    if (row.querySelector('#ikhm-toggle-label')) return;
    const label = document.createElement('label');
    label.id = 'ikhm-toggle-label';
    label.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;cursor:pointer;user-select:none';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = readPref(LS_HIDE_MAXED, '1') === '1';
    checkbox.addEventListener('change', () => {
      writePref(LS_HIDE_MAXED, checkbox.checked ? '1' : '0');
      applyHiding(ul, checkbox.checked);
    });
    label.append(checkbox, document.createTextNode('Max. Stufe ausblenden'));
    row.appendChild(label);
  }

  function tick() {
    const section = findGebaeudeSection();
    if (!section) return;
    ensureToggle(section.row, section.ul);
    applyHiding(section.ul, readPref(LS_HIDE_MAXED, '1') === '1');
  }

  tick();
  setInterval(tick, 500);
})();
