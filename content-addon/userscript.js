// ==UserScript==
// @name         Islandking Content Addon
// @namespace    https://github.com/H4nnib4l22/islandKing-bookmarklets
// @version      1.3.1
// @description  Sammlung kleiner Komfort-Erweiterungen für islandking.ch: Max-Stufe ausblenden (Gebäude/Forschung), Schnell-Buttons in der Kaserne (+5/+10/+20/+50/+100) und im Handel (+1000/+5000/+10000/+20000/+25000).
// @author       Oscar
// @license      MIT
// @match        https://islandking.ch/island/*
// @match        https://islandking.ch/research
// @match        https://islandking.ch/barracks
// @match        https://islandking.ch/market
// @grant        none
// @run-at       document-idle
// @downloadURL  https://update.greasyfork.org/scripts/595584/Islandking%20Content%20Addon.user.js
// @updateURL    https://update.greasyfork.org/scripts/595584/Islandking%20Content%20Addon.meta.js
// ==/UserScript==

/*
 * Islandking Content Addon — Tampermonkey-Userscript, Sammlung kleiner
 * DOM-Komfortfunktionen fuer islandking.ch (kein eigenes Panel, keine API).
 *
 * 1) Max-Stufe ausblenden: Sowohl die Gebäudeliste auf der Inselseite
 *    (islandking.ch/island/<id>) als auch die Forschungsliste
 *    (islandking.ch/research) zeigen jeden Eintrag als <li>, maxed
 *    Eintraege tragen ein <p>max. Stufe</p> statt eines "Ausbau"/
 *    "Erforschen"-Buttons (verifiziert live per Claude-in-Chrome-DOM-
 *    Inspektion, 2026-09-12/13 - identisches Markup auf beiden Seiten,
 *    nur die Ueberschrift-Ebene unterscheidet sich: <h2>Gebäude</h2> auf
 *    der Inselseite, <h1>Forschung</h1> auf der Forschungsseite). Je Seite
 *    ein eigener Schalter über der jeweiligen Liste, blendet deren
 *    Eintraege aus/ein - eigener localStorage-Zustand pro Seite (Default:
 *    ausgeblendet, da genau das der Wunsch war).
 *
 * 2) Kaserne-Schnellauswahl (v1.2.0): islandking.ch/barracks hat genau
 *    EIN <ul> mit einem <li> je aktuell verfuegbarem Truppentyp
 *    (verifiziert live: noch nicht freigeschaltete Truppen wie Kanonier/
 *    Ritter fehlen komplett im DOM, kein "gesperrt"-Zustand zum Ausblenden
 *    - sie erscheinen von selbst im naechsten Poll-Tick, sobald sie
 *    freigeschaltet werden). Je Zeile Buttons +5/+10/+20/+50/+100, die
 *    kumulativ zum aktuellen Wert im Anzahl-Feld addieren (natives
 *    "input"-Event ausgeloest, damit Vue's v-model reagiert und Kosten/
 *    Ausbilden-Button live aktualisiert), sowie ein ✕-Button zum Leeren.
 *
 * 3) Handel-Schnellauswahl (v1.3.0): islandking.ch/market, "Neues
 *    Angebot"-Formular hat zwei <label> ("Biete"/"Suche"), je mit
 *    identischem input[number]+select-Markup. Gleiche Buttons-Logik wie
 *    Kaserne (via gemeinsamer ensureQuickAddRow()-Funktion), nur mit
 *    groesseren Schritten (+1000/+5000/+10000/+20000/+25000) passend zu
 *    Handelsmengen statt Truppenzahlen.
 *
 * Alle drei Funktionen ueber ein gemeinsames Poll-Intervall erkannt (gleiche
 * Technik wie in den anderen drei Islandking-Userscripts dieses Repos),
 * da die Seiten per Vue nachladen (Ausbau/Forschungsstart/Rekrutierung/
 * Inselwechsel), ohne einen vollen Seiten-Reload auszuloesen.
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
    tickBarracksQuickAdd();
    tickMarketQuickAdd();
  }

  // -------------------------------------------------------------------
  // Kaserne-Schnellauswahl — siehe Kommentar am Dateikopf. Nur ein <ul>
  // auf der ganzen Seite, daher kein Heading-basiertes Suchen noetig wie
  // bei den beiden Sektionen oben.
  // -------------------------------------------------------------------

  const BARRACKS_STEPS = [5, 10, 20, 50, 100];

  // Gemeinsame Schnellauswahl-Buttons (+N, summieren sich, plus ✕ zum
  // Leeren) fuer ein beliebiges <input type="number"> - Kaserne UND
  // Handel nutzen dieselbe Funktion, nur mit unterschiedlichen Schritten
  // und Einfuegepunkten. anchorEl ist das Element, NACH dem die
  // Button-Zeile eingefuegt wird (afterend).
  function ensureQuickAddRow(scopeEl, input, steps, anchorEl) {
    if (scopeEl.querySelector('[data-ikba-quickadd]')) return;
    const wrap = document.createElement('div');
    wrap.dataset.ikbaQuickadd = '1';
    wrap.style.cssText = 'display:flex;gap:4px;margin-top:4px;justify-content:flex-end;flex-wrap:wrap';
    steps.forEach((n) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = '+' + n;
      btn.style.cssText = 'padding:2px 6px;font-size:11px;border-radius:4px;border:1px solid #24344a;background:#142338;color:#e6edf3;cursor:pointer';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        const max = parseInt(input.max, 10) || Infinity;
        const cur = parseInt(input.value, 10) || 0;
        input.value = Math.min(max, cur + n);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      });
      wrap.appendChild(btn);
    });
    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = '✕';
    clearBtn.title = 'Feld leeren';
    clearBtn.style.cssText = 'padding:2px 6px;font-size:11px;border-radius:4px;border:1px solid #24344a;background:#3a1f28;color:#f2a0a0;cursor:pointer';
    clearBtn.addEventListener('click', (e) => {
      e.preventDefault();
      input.value = '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    wrap.appendChild(clearBtn);
    anchorEl.insertAdjacentElement('afterend', wrap);
  }

  function tickBarracksQuickAdd() {
    if (location.pathname !== '/barracks') return;
    const ul = document.querySelector('ul');
    if (!ul) return;
    Array.from(ul.children).forEach((li) => {
      const input = li.querySelector('input[type="number"]');
      if (!input) return;
      ensureQuickAddRow(li, input, BARRACKS_STEPS, input.closest('div'));
    });
  }

  // -------------------------------------------------------------------
  // Handel-Schnellauswahl — islandking.ch/market, "Neues Angebot"-
  // Formular hat zwei <label>, je eines fuer "Biete" und "Suche", beide
  // mit identischem Markup (<input type="number"> + <select> Rohstoff in
  // einer <div>). Erkennung ueber "hat sowohl input[number] als auch
  // select", statt ueber Label-Text (robuster gegen Uebersetzung/Aenderung).
  // -------------------------------------------------------------------

  const MARKET_STEPS = [1000, 5000, 10000, 20000, 25000];

  function tickMarketQuickAdd() {
    if (location.pathname !== '/market') return;
    document.querySelectorAll('label').forEach((label) => {
      const input = label.querySelector('input[type="number"]');
      const select = label.querySelector('select');
      if (!input || !select) return;
      // Das Formular fuellt "Biete"/"Suche" mit "100" vor - ohne diesen
      // Reset wuerde der erste Klick auf einen Schnell-Button darauf
      // aufaddieren (z.B. +10000 -> 10100 statt 10000). Nur beim ersten
      // Erkennen leeren (vor dem Einfuegen der Buttons), nicht bei jedem
      // Poll-Tick, damit ein spaeter manuell eingetragener Wert bleibt.
      if (!label.querySelector('[data-ikba-quickadd]') && input.value === '100') {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
      ensureQuickAddRow(label, input, MARKET_STEPS, input.closest('div'));
    });
  }

  tick();
  setInterval(tick, 500);
})();
