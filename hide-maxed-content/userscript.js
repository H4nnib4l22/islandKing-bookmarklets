// ==UserScript==
// @name         Islandking Max-Stufe ausblenden
// @namespace    https://github.com/H4nnib4l22/islandKing-bookmarklets
// @version      1.1.0
// @description  Blendet auf der Inselseite und der Forschungsseite Gebäude/Forschungen aus, die bereits ihre max. Stufe erreicht haben, per Ein/Aus-Schalter über der jeweiligen Liste.
// @author       Oscar
// @license      MIT
// @match        https://islandking.ch/island/*
// @match        https://islandking.ch/research
// @grant        none
// @run-at       document-idle
// @downloadURL  https://update.greasyfork.org/scripts/595511/Islandking%20Max-Stufe%20ausblenden.user.js
// @updateURL    https://update.greasyfork.org/scripts/595511/Islandking%20Max-Stufe%20ausblenden.meta.js
// ==/UserScript==

/*
 * Islandking Max-Stufe ausblenden — Tampermonkey-Userscript.
 * Sowohl die Gebäudeliste auf der Inselseite (islandking.ch/island/<id>)
 * als auch die Forschungsliste (islandking.ch/research) zeigen jeden
 * Eintrag als <li>, maxed Eintraege tragen ein <p>max. Stufe</p> statt
 * eines "Ausbau"/"Erforschen"-Buttons (verifiziert live per Claude-in-
 * Chrome-DOM-Inspektion, 2026-09-12/13 - identisches Markup auf beiden
 * Seiten, nur die Ueberschrift-Ebene unterscheidet sich: <h2>Gebäude</h2>
 * auf der Inselseite, <h1>Forschung</h1> auf der Forschungsseite).
 * Je Seite ein eigener Schalter über der jeweiligen Liste, blendet deren
 * Eintraege aus/ein - eigener localStorage-Zustand pro Seite (Default:
 * ausgeblendet, da genau das der Wunsch war).
 * Kein eigenes Panel/Overlay, keine API — reine DOM-Filterung der
 * spielinternen Vue-SPA-Seite. Ueber ein einfaches Poll-Intervall erkannt
 * (gleiche Technik wie in den anderen drei Islandking-Userscripts dieses
 * Repos), da die Seite bei Ausbau/Forschungsstart/Inselwechsel per Vue
 * nachlädt, ohne einen vollen Seiten-Reload auszulösen.
 */
(function () {
  function readPref(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function writePref(key, val) {
    try { localStorage.setItem(key, val); } catch (e) { /* privater Modus o.ae. — Praeferenz einfach nicht gemerkt */ }
  }

  // Zwei Listen mit identischem Markup, nur die Ueberschrift unterscheidet
  // sich (Tag + Text). localStorage-Key/Label-id je Sektion eigenstaendig,
  // damit "Gebäude ausblenden" und "Forschungen ausblenden" unabhaengig
  // voneinander gemerkt werden.
  const SECTIONS = [
    { tag: 'h2', text: 'Gebäude', lsKey: 'ikhm_hideMaxed_buildings', labelId: 'ikhm-toggle-buildings', label: 'Max. Stufe ausblenden' },
    { tag: 'h1', text: 'Forschung', lsKey: 'ikhm_hideMaxed_research', labelId: 'ikhm-toggle-research', label: 'Max. Stufe ausblenden' },
  ];

  function findSection(cfg) {
    const heading = Array.from(document.querySelectorAll(cfg.tag)).find((h) => h.textContent.trim().startsWith(cfg.text));
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

  function ensureToggle(cfg, row, ul) {
    if (row.querySelector('#' + cfg.labelId)) return;
    const label = document.createElement('label');
    label.id = cfg.labelId;
    label.style.cssText = 'margin-left:auto;display:flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;cursor:pointer;user-select:none';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = readPref(cfg.lsKey, '1') === '1';
    checkbox.addEventListener('change', () => {
      writePref(cfg.lsKey, checkbox.checked ? '1' : '0');
      applyHiding(ul, checkbox.checked);
    });
    label.append(checkbox, document.createTextNode(cfg.label));
    row.appendChild(label);
  }

  function tick() {
    SECTIONS.forEach((cfg) => {
      const section = findSection(cfg);
      if (!section) return;
      ensureToggle(cfg, section.row, section.ul);
      applyHiding(section.ul, readPref(cfg.lsKey, '1') === '1');
    });
  }

  tick();
  setInterval(tick, 500);
})();
