// ==UserScript==
// @name         Islandking Content Addon
// @namespace    https://github.com/H4nnib4l22/islandKing-bookmarklets
// @version      1.5.0
// @description  Sammlung kleiner Komfort-Erweiterungen für islandking.ch: Max-Stufe ausblenden (Gebäude/Forschung), Schnell-Buttons in der Kaserne (+5/+10/+20/+50/+100), im Handel (+1000/+5000/+10000/+20000/+25000), im Hafen (Rohstoffe gleichmäßig auf die Laderaumkapazität verteilen) und Stufenanzeige (aktuell → Ziel) bei laufenden Bauten auf der Übersichtsseite.
// @author       Oscar
// @license      MIT
// @match        https://islandking.ch/*
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
 * 4) Hafen-Rohstoffverteilung (v1.4.0): islandking.ch/harbor, Sektion
 *    "Rohstoffe transportieren" hat 4 <label> (Holz/Stein/Eisen/Kohle),
 *    je mit einem namenlosen <input type="number"> - Erkennung nur ueber
 *    den Label-Text moeglich. Je Label ein "Fuellen"-Button: Klick nimmt
 *    alle Rohstoffe, die gerade > 0 sind, PLUS den angeklickten, und
 *    verteilt die freie Laderaum-Kapazitaet (Gesamtkapazitaet minus der
 *    fuer Truppen reservierten Plaetze, die sich denselben Laderaum
 *    teilen) gleichmaessig auf genau diese Menge - bereits befuellte
 *    Rohstoffe werden dabei neu aufgeteilt (Beispiel Laderaum 27000: Holz
 *    fuellen -> 27000; danach Stein fuellen -> beide 13500; danach Eisen
 *    fuellen -> alle drei 9000). Verifiziert live per Claude-in-Chrome:
 *    native Value-Setter + "input"-Event noetig, damit Reacts
 *    kontrollierte Inputs (kein Vue wie bei Kaserne/Handel) reagieren.
 *
 * Alle vier Funktionen ueber ein gemeinsames Poll-Intervall erkannt (gleiche
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
    tickHarborQuickFill();
    tickDashboardLevels();
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
    // anchorEl (Eingabe+Dropdown) auf volle Breite ziehen, damit es buendig
    // mit der Button-Zeile (die als Block-Element die volle Breite nutzt)
    // abschliesst - sonst bleibt anchorEl bei seiner intrinsischen Breite.
    anchorEl.style.width = '100%';
    anchorEl.style.boxSizing = 'border-box';
    input.style.flex = '1';
    input.style.minWidth = '0';
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

  // -------------------------------------------------------------------
  // Hafen-Rohstoffverteilung — siehe Kommentar am Dateikopf. Die Sektion
  // ist als <section> mit Ueberschrift UND "Laderaum:"-Text erkennbar,
  // das grenzt sie zuverlaessig gegen die gleichnamige "Laderaum:"-
  // Anzeige der weiter unten liegenden "Schiffe stationieren"-Sektion ab.
  // -------------------------------------------------------------------

  const HARBOR_RESOURCES = ['Holz', 'Stein', 'Eisen', 'Kohle'];
  const HARBOR_TROOPS = ['Einfacher Soldat', 'Schwertkämpfer', 'Musketiere'];

  function parseNum(text) {
    return parseInt(String(text).replace(/[^\d]/g, ''), 10) || 0;
  }

  // React-kontrollierte Inputs ignorieren ein simples "input.value = x" -
  // der native Setter + ein "input"-Event sind noetig, damit React den
  // Wert uebernimmt (verifiziert live, siehe Dateikopf-Kommentar).
  function setReactInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, String(value));
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function findHarborCard() {
    return Array.from(document.querySelectorAll('section')).find(
      (s) => s.textContent.includes('Rohstoffe transportieren') && s.textContent.includes('Laderaum')
    );
  }

  function findHarborResourceEntries(card) {
    return HARBOR_RESOURCES.map((name) => {
      const label = Array.from(card.querySelectorAll('label')).find(
        (l) => l.querySelector('input[type="number"]') && l.textContent.includes(name)
      );
      return label ? { name, label, input: label.querySelector('input[type="number"]') } : null;
    }).filter(Boolean);
  }

  // Kuerzeste Fundstelle je Text-Anker gewinnt - das ist die konkrete
  // Zeile selbst statt eines Vorfahren, der weitere Sektionsinhalte
  // mit-enthaelt (siehe ensureQuickAddRow-Kommentar zu Robustheit).
  function shortestMatch(card, startsWithText) {
    return Array.from(card.querySelectorAll('*'))
      .filter((e) => e.textContent.trim().startsWith(startsWithText))
      .sort((a, b) => a.textContent.length - b.textContent.length)[0];
  }

  function findHarborCapacity(card) {
    const el = shortestMatch(card, 'Laderaum:');
    const m = el && el.textContent.match(/\/\s*([\d'.,]+)/);
    return m ? parseNum(m[1]) : null;
  }

  function findHarborTroopSum(card) {
    return HARBOR_TROOPS.reduce((sum, name) => {
      const hit = shortestMatch(card, name);
      const input = hit && hit.closest('div') && hit.closest('div').querySelector('input[type="number"]');
      return sum + (input ? parseNum(input.value) : 0);
    }, 0);
  }

  function fillHarborResource(card, entries, target) {
    const capacity = findHarborCapacity(card);
    if (capacity === null) return;
    const room = Math.max(0, capacity - findHarborTroopSum(card));
    const active = entries.filter((e) => e === target || parseNum(e.input.value) > 0);
    const share = Math.floor(room / active.length);
    active.forEach((e) => setReactInputValue(e.input, share));
  }

  function ensureHarborFillButtons(card, entries) {
    entries.forEach((entry) => {
      if (entry.label.querySelector('[data-ikba-harborfill]')) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.ikbaHarborfill = '1';
      btn.textContent = 'Max';
      // Gleiche Tailwind-Klassen wie die nativen "Max"-Buttons der Seite
      // (Schiffszeilen oben), statt eigenem inline-Stil - damit Schriftart/
      // Look identisch sind.
      btn.className = 'ml-1.5 rounded border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        fillHarborResource(card, entries, entry);
      });
      entry.label.appendChild(btn);
    });
  }

  function tickHarborQuickFill() {
    if (location.pathname !== '/harbor') return;
    const card = findHarborCard();
    if (!card) return;
    const entries = findHarborResourceEntries(card);
    if (entries.length < 2) return;
    ensureHarborFillButtons(card, entries);
  }

  // -------------------------------------------------------------------
  // Dashboard "Meine Inseln" — Stufenanzeige (Feature 5). islandking.ch/
  // zeigt je Insel-Kachel eine Bauliste ("🏗️ Haupthaus · 1h 36m"), aber
  // nur den Gebaeudenamen ohne Level. /api/islands/<id>/overview (Bearer-
  // Token aus localStorage.access_token, verifiziert live per Claude-in-
  // Chrome) liefert unter buildQueueItems[].targetLevel das Ziel-Level je
  // Bau-Eintrag; aktuelles Level ist targetLevel-1 (gegen buildings[].level
  // desselben Response verifiziert). Einziges <ul class="grid"> der Seite,
  // daher kein Heading-Anker noetig.
  // -------------------------------------------------------------------

  const dashboardLevelCache = {}; // islandId -> {expires, promise<Map<name, targetLevel>>}

  function fetchIslandLevels(islandId) {
    const cached = dashboardLevelCache[islandId];
    if (cached && cached.expires > Date.now()) return cached.promise;
    const token = localStorage.getItem('access_token');
    const promise = fetch('/api/islands/' + islandId + '/overview', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.json())
      .then((data) => new Map((data.buildQueueItems || []).map((b) => [b.buildingName, b.targetLevel])))
      .catch(() => new Map());
    dashboardLevelCache[islandId] = { expires: Date.now() + 10000, promise };
    return promise;
  }

  function tickDashboardLevels() {
    if (location.pathname !== '/') return;
    document.querySelectorAll('ul.grid > li').forEach((li) => {
      const link = li.querySelector('a[href^="/island/"]');
      if (!link) return;
      const islandId = link.getAttribute('href').split('/')[2];
      li.querySelectorAll('div.border-t span.text-gray-500').forEach((nameSpan) => {
        const name = nameSpan.textContent.replace(/^\S+\s*/, '').trim();
        fetchIslandLevels(islandId).then((levels) => {
          const target = levels.get(name);
          if (target === undefined || nameSpan.dataset.ikbaLevelFor === name + ':' + target) return;
          nameSpan.dataset.ikbaLevelFor = name + ':' + target;
          nameSpan.textContent = nameSpan.textContent.replace(/\s*\(Stufe.*\)$/, '') + ' (Stufe ' + (target - 1) + ' → ' + target + ')';
        });
      });
    });
  }

  tick();
  setInterval(tick, 500);
})();
