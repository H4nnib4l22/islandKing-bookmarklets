// ==UserScript==
// @name         Islandking Content Addon
// @namespace    https://github.com/H4nnib4l22/islandKing-bookmarklets
// @version      1.13.2
// @description  Sammlung kleiner Komfort-Erweiterungen für islandking.ch: Max-Stufe ausblenden (Gebäude/Forschung), Schnell-Buttons in der Kaserne (+5/+10/+20/+50/+100), im Handel (+1000/+5000/+10000/+20000/+25000), im Hafen (Rohstoffe gleichmäßig auf die Laderaumkapazität verteilen), Stufenanzeige (aktuell → Ziel) bei laufenden Bauten und live hochzählende Rohstoffe in den Insel-Kacheln der Übersichtsseite, Allianzkürzel hinter dem Namen bei Angriffs-/Spionageberichten samt Allianz-Filter (Posteingang und Archiv), live hochzählender aktueller Rohstoffbestand unter den Bau-/Forschungs-/Ausbildungs-/Schiffsbaukosten, „wird gebaut”/„wird ausgebildet” in Werft und Kaserne, Restzeit unter „wird ausgebaut”/„wird erforscht”/„wird gebaut”/„wird ausgebildet”, und je eine Schiffe- und Soldaten-Tabelle je Insel auf der Reichsübersicht.
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
 * 7) Aktuelle Rohstoffe unter Bau-/Forschungs-/Ausbildungs-/Schiffsbaukosten
 *    (v1.6.0, erweitert auf Kaserne+Schiffswerft in v1.10.0) — auf
 *    /island/<id> (Gebäude-Liste), /research, /barracks und /shipyard zeigt
 *    jede Zeile schon die Kosten (<p class="mt-1 text-xs text-gray-500">
 *    mit einem <span> je Rohstoff: <img alt="wood|stone|iron|coal"> +
 *    Betrag, identisches Markup auf allen vier Seiten, verifiziert live per
 *    Claude-in-Chrome 2026-09-18/2026-09-23). Darunter fügt dieses Script
 *    eine zweite Zeile "Du hast:" ein, mit dem aktuellen Bestand je dort
 *    genanntem Rohstoff - live hochgezaehlt anhand productionPerHour (die
 *    Seite selbst aktualisiert ihre eigene Kopfzeilen-Anzeige NICHT
 *    automatisch, nur bei Reload, ebenfalls live verifiziert). Rot, wenn
 *    der Bestand (noch) nicht fuer die Kosten dieser Zeile reicht, gruen
 *    sonst. Datenquelle /api/empire (resources/productionPerHour/capacity
 *    je Insel) - nur /research zahlt aus der Heimatinsel (Forschung ist
 *    global, /api/research-overview.homeIslandId sagt welche Insel das
 *    ist). Kaserne und Schiffswerft sind dagegen JE INSEL gebaut (Nutzer-
 *    Korrektur 2026-09-23: eine urspruengliche "immer Heimatinsel"-Annahme
 *    fuer /barracks war falsch, Kaserne ist nur zufaellig meist auf der
 *    Heimatinsel zuerst gebaut) - beide Seiten zeigen entweder Insel-Tabs
 *    (mehrere Inseln mit dieser Gebaeudeart, aktiv erkennbar an der
 *    Tailwind-Klasse "bg-ocean-500", Klick loest live einen neuen
 *    /api/islands/<id>/overview-Request fuer genau diese Insel aus) oder,
 *    bei nur einer qualifizierenden Insel, reinen Text ohne Tabs - siehe
 *    findDisplayedIsland().
 *
 * 6) Allianzkuerzel bei Berichten (v1.5.1) — auf /spy-reports und
 *    /battle-reports steht jetzt hinter jedem Spielernamen das
 *    Allianzkuerzel in Klammern, z. B. "OscarZulu (BOB)" - 1:1 aus dem
 *    Reisezeitenrechner/Kampfrechner uebernommen (Nachschlag ueber
 *    /api/rankings?q=<Name>, players[0].alliance ist bereits das Kuerzel).
 *    Gemeinsames Markierungs-Attribut "data-ikbm-alliance-done" mit dem
 *    Reisezeitenrechner: laeuft der gleichzeitig, annotiert nur EINES der
 *    beiden Scripts einen gegebenen Bericht, kein doppeltes "(TAG) (TAG)".
 *
 * Alle Funktionen ueber ein gemeinsames Poll-Intervall erkannt (gleiche
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
    tickDashboardResources();
    tickResourceStock();
    annotateReportAllianceTags();
    tickReportAllianceFilter();
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

  function fetchIslandOverview(islandId) {
    const cached = dashboardLevelCache[islandId];
    if (cached && cached.expires > Date.now()) return cached.promise;
    const token = localStorage.getItem('access_token');
    const promise = fetch('/api/islands/' + islandId + '/overview', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.json())
      .catch(() => ({}));
    dashboardLevelCache[islandId] = { expires: Date.now() + 10000, promise };
    return promise;
  }

  function fetchIslandLevels(islandId) {
    return fetchIslandOverview(islandId)
      .then((data) => new Map((data.buildQueueItems || []).map((b) => [b.buildingName, b.targetLevel])));
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

  // -------------------------------------------------------------------
  // Allianzkuerzel hinter dem Namen bei Angriffs-/Spionageberichten
  // (Feature 6, v1.5.1) — 1:1 aus travel-calculator/userscript.js
  // uebernommen (siehe dortiger Kommentar fuer Details zu API-Schema,
  // Cache-Promise-Bug und Regex-Muster). Weder /api/battle-reports noch
  // /api/spy-reports liefern das Kuerzel mit, Nachschlag ueber
  // /api/rankings?q=<Name>.
  // Gemeinsames Markierungs-Attribut "data-ikbm-alliance-done" statt eines
  // eigenen: der Reisezeitenrechner/Kampfrechner bringt dieselbe Funktion
  // mit (dort meist geoeffnet, wenn man Berichte auswertet) - ohne
  // gemeinsames Attribut wuerden beide Scripts denselben Bericht doppelt
  // annotieren ("Name (TAG) (TAG)"), falls beide gleichzeitig aktiv sind.
  // -------------------------------------------------------------------

  function ikbmAuthHeaders() {
    const token = (() => { try { return localStorage.getItem('access_token'); } catch (e) { return null; } })();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  const allianceTagCache = new Map();
  function fetchAllianceTag(name) {
    if (allianceTagCache.has(name)) return allianceTagCache.get(name);
    const p = fetch('/api/rankings?q=' + encodeURIComponent(name), { headers: ikbmAuthHeaders() })
      .then((r) => r.json())
      .then((data) => {
        const player = (data.players || []).find((pl) => pl.name === name);
        return player && player.alliance ? player.alliance : '';
      })
      .catch(() => '');
    allianceTagCache.set(name, p);
    return p;
  }

  function insertTagAfterName(textNode, name, tag) {
    if (!tag || !textNode.parentNode) return;
    textNode.textContent = textNode.textContent.replace(name, name + ' (' + tag + ')');
  }

  function annotateSpyReportNames() {
    document.querySelectorAll('li:not([data-ikbm-alliance-done])').forEach((li) => {
      const span = Array.from(li.querySelectorAll('span')).find((s) =>
        s.childNodes[0] && s.childNodes[0].nodeType === 3 && s.childNodes[0].textContent.includes('🔍'));
      if (!span) return;
      li.dataset.ikbmAllianceDone = '1';
      const textNode = span.childNodes[0];
      const m = textNode.textContent.match(/🔍\s*([^·]+?)\s*·/);
      if (!m) return;
      const name = m[1].trim();
      fetchAllianceTag(name).then((tag) => insertTagAfterName(textNode, name, tag));
    });
  }

  function annotateBattleReportNames() {
    document.querySelectorAll('li:not([data-ikbm-alliance-done])').forEach((li) => {
      const p = Array.from(li.querySelectorAll('p')).find((el) =>
        el.childNodes[0] && el.childNodes[0].nodeType === 3 && el.childNodes[0].textContent.includes('⚔️'));
      if (!p) return;
      li.dataset.ikbmAllianceDone = '1';
      const textNode = p.childNodes[0];
      const m = textNode.textContent.match(/^(.+?)\s*⚔️\s*(.+?)\s*·/);
      if (!m) return;
      const attacker = m[1].trim();
      const defender = m[2].trim();
      fetchAllianceTag(attacker).then((tag) => insertTagAfterName(textNode, attacker, tag));
      fetchAllianceTag(defender).then((tag) => insertTagAfterName(textNode, defender, tag));
    });
  }

  function annotateReportAllianceTags() {
    if (location.pathname === '/spy-reports') annotateSpyReportNames();
    else if (location.pathname === '/battle-reports') annotateBattleReportNames();
  }

  // -------------------------------------------------------------------
  // Allianz-Filter bei Kampf-/Spionageberichten (Feature 13, v1.13.0).
  // Posteingang und Archiv sind dieselbe Seite (Umschalt-Buttons
  // "📥 Posteingang"/"🗄 Archiv"), die Liste wird nur neu gerendert - der
  // Filter sitzt unter dieser Button-Zeile und wirkt daher in beiden
  // Ansichten. Kuerzel werden je Bericht selbst ermittelt (nicht aus dem
  // annotierten Text gelesen), weil evtl. der Reisezeitenrechner die
  // Annotation uebernommen hat. Auswahl bleibt beim Wechsel Posteingang/
  // Archiv erhalten, "✕" setzt auf "Alle Allianzen" zurueck.
  // -------------------------------------------------------------------

  const NO_ALLIANCE = '(ohne Allianz)';
  let reportAllianceFilter = '';

  function stripTag(name) {
    return name.replace(/\s*\([^()]*\)$/, '').trim();
  }

  // [{li, names}] - gleiche Erkennung wie annotate*ReportNames() oben.
  function findReportEntries() {
    const spy = location.pathname === '/spy-reports';
    const out = [];
    document.querySelectorAll('li').forEach((li) => {
      const el = Array.from(li.querySelectorAll(spy ? 'span' : 'p')).find((e) =>
        e.childNodes[0] && e.childNodes[0].nodeType === 3 && e.childNodes[0].textContent.includes(spy ? '🔍' : '⚔️'));
      if (!el) return;
      const text = el.childNodes[0].textContent;
      const m = spy ? text.match(/🔍\s*([^·]+?)\s*·/) : text.match(/^(.+?)\s*⚔️\s*(.+?)\s*·/);
      if (m) out.push({ li, names: m.slice(1).map(stripTag) });
    });
    return out;
  }

  // anchorRow.parentElement ist die flex-wrap/justify-between-Zeile mit
  // Posteingang/Archiv links und dem spieleigenen "Älter als N Tage"+
  // "Aufräumen" rechts - der Filter kommt als eigene Zeile DARUNTER, sonst
  // drückt er die Aufräumen-Gruppe in die zweite Zeile (v1.13.1).
  function ensureReportFilterBar(anchorRow) {
    let bar = document.getElementById('ikca-report-filter');
    if (bar && bar.previousElementSibling === anchorRow) return bar;
    if (bar) bar.remove();
    bar = document.createElement('div');
    bar.id = 'ikca-report-filter';
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;margin:12px 0 8px;font-size:13px;color:#6b7280';
    const select = document.createElement('select');
    select.className = 'rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-700';
    select.addEventListener('change', () => { reportAllianceFilter = select.value; });
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.textContent = '✕';
    reset.title = 'Filter zurücksetzen';
    reset.className = 'rounded px-2 py-1 text-sm bg-gray-100 text-gray-600 hover:bg-gray-200';
    reset.addEventListener('click', () => { reportAllianceFilter = ''; select.value = ''; });
    bar.append(document.createTextNode('Allianz:'), select, reset);
    anchorRow.insertAdjacentElement('afterend', bar);
    return bar;
  }

  function tickReportAllianceFilter() {
    if (location.pathname !== '/spy-reports' && location.pathname !== '/battle-reports') return;
    const archiveBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent.includes('Archiv'));
    if (!archiveBtn) return;
    const select = ensureReportFilterBar(archiveBtn.parentElement.parentElement).querySelector('select');

    const tags = new Set();
    findReportEntries().forEach(({ li, names }) => {
      if (li.dataset.ikcaTags === undefined && !li.dataset.ikcaTagsPending) {
        li.dataset.ikcaTagsPending = '1';
        Promise.all(names.map(fetchAllianceTag)).then((t) => {
          li.dataset.ikcaTags = t.map((x) => x || NO_ALLIANCE).join('|');
        });
      }
      const liTags = li.dataset.ikcaTags === undefined ? null : li.dataset.ikcaTags.split('|');
      if (liTags) liTags.forEach((t) => tags.add(t));
      // Noch unaufgeloeste Berichte sichtbar lassen statt kurz zu flackern.
      li.style.display = reportAllianceFilter && liTags && !liTags.includes(reportAllianceFilter) ? 'none' : '';
    });

    if (reportAllianceFilter) tags.add(reportAllianceFilter);
    const wanted = [''].concat(Array.from(tags).sort((a, b) => a.localeCompare(b)));
    const have = Array.from(select.options).map((o) => o.value);
    if (wanted.join('\n') !== have.join('\n')) {
      select.replaceChildren(...wanted.map((v) => new Option(v || 'Alle Allianzen', v)));
    }
    if (select.value !== reportAllianceFilter) select.value = reportAllianceFilter;
  }

  // -------------------------------------------------------------------
  // Aktuelle Rohstoffe unter Bau-/Forschungskosten — siehe Kommentar am
  // Dateikopf (Feature 7). /api/empire liefert resources/productionPerHour/
  // capacity je Insel, gecacht wie fetchIslandLevels() oben (10s), damit
  // das 500ms-Poll-Intervall nicht bei jedem Tick neu abfragt.
  // -------------------------------------------------------------------

  let empireCache = null; // {expires, promise<{data, fetchedAt}>}
  function fetchEmpireCached() {
    if (empireCache && empireCache.expires > Date.now()) return empireCache.promise;
    const token = localStorage.getItem('access_token');
    const fetchedAt = Date.now();
    const promise = fetch('/api/empire', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.json())
      .then((data) => ({ data, fetchedAt }))
      .catch(() => null);
    empireCache = { expires: fetchedAt + 10000, promise };
    return promise;
  }

  let researchOverviewCache = null; // {expires, promise}
  function fetchResearchOverviewCached() {
    if (researchOverviewCache && researchOverviewCache.expires > Date.now()) return researchOverviewCache.promise;
    const token = localStorage.getItem('access_token');
    const promise = fetch('/api/research-overview', { headers: { Authorization: 'Bearer ' + token } })
      .then((r) => r.json())
      .catch(() => null);
    researchOverviewCache = { expires: Date.now() + 2000, promise };
    return promise;
  }

  // Nur Forschung wird immer aus der Heimatinsel bezahlt (research-overview.
  // homeIslandId) - Forschung ist global, unabhaengig von einer einzelnen
  // Insel. Kaserne und Schiffswerft sind dagegen JE INSEL gebaut (Nutzer-
  // Korrektur 2026-09-23, live verifiziert: Nassau hat z.B. keine Kaserne,
  // /island/464 zeigt in der Gebaeudeliste keinen Kaserne-Eintrag und keinen
  // "Kaserne"-Link - /barracks zeigt deshalb nur Tortuga an, NICHT weil
  // Kaserne "immer die Heimatinsel" waere, sondern weil dort zufaellig nur
  // die Heimatinsel eine Kaserne hat). Beide Seiten zeigen die aktuell
  // betrachtete Insel entweder als Tab-Buttons (mehrere qualifizierende
  // Inseln, aktiv erkennbar an der Tailwind-Klasse "bg-ocean-500" - Klick
  // loest live einen neuen /api/islands/<id>/overview-Request fuer GENAU
  // diese Insel aus) oder, wenn nur eine Insel qualifiziert, als reiner
  // Text "Name (x | y)" ohne Tabs (<p class="text-sm text-gray-500">Name
  // <span class="text-xs">(x | y)</span></p>, identisch auf beiden Seiten).
  function findDisplayedIsland(islands) {
    const btn = Array.from(document.querySelectorAll('button')).find(
      (b) => /\bbg-ocean-500\b/.test(b.className) && /\(-?\d+\s*\|\s*-?\d+\)/.test(b.textContent)
    );
    const headingSpan = !btn && Array.from(document.querySelectorAll('main p.text-sm.text-gray-500 span.text-xs'))
      .find((s) => /\(-?\d+\s*\|\s*-?\d+\)/.test(s.textContent));
    const text = btn ? btn.textContent : headingSpan && headingSpan.textContent;
    const m = text && text.match(/\((-?\d+)\s*\|\s*(-?\d+)\)/);
    return m ? islands.find((i) => i.coordinates.x === +m[1] && i.coordinates.y === +m[2]) : null;
  }

  async function currentIslandStock() {
    const empire = await fetchEmpireCached();
    if (!empire) return null;
    let islandId;
    if (location.pathname.startsWith('/island/')) {
      islandId = location.pathname.split('/')[2];
    } else if (location.pathname === '/shipyard' || location.pathname === '/barracks') {
      const active = findDisplayedIsland(empire.data.islands);
      // Fallback Heimatinsel nur als letzter Ausweg, falls (noch) keine
      // Insel erkannt wurde (z.B. Seite noch nicht fertig gerendert).
      islandId = active ? active.id : (await fetchResearchOverviewCached())?.homeIslandId;
    } else if (location.pathname === '/research') {
      const research = await fetchResearchOverviewCached();
      islandId = research && research.homeIslandId;
    }
    if (!islandId) return null;
    const island = empire.data.islands.find((i) => String(i.id) === String(islandId));
    if (!island) return null;
    return { resources: island.resources, perHour: island.productionPerHour, capacity: island.capacity, fetchedAt: empire.fetchedAt };
  }

  function formatNum(n) {
    return Math.floor(n).toLocaleString('de-CH');
  }

  function findCostRow(li) {
    return Array.from(li.querySelectorAll('p')).find((p) => p.querySelector('img'));
  }

  // Nutzerwunsch (Nachbesserung): der Bestand soll nicht als eigene
  // Zeile darunter, sondern SPALTENWEISE direkt unter dem jeweiligen
  // Rohstoff stehen (Holz unter Holz, Stein unter Stein). Dafuer die
  // Kosten-<p> selbst auf CSS-Grid umstellen (repeat(n, max-content), die
  // " · "-Trenn-Textknoten dabei entfernt - der Grid-Spaltenabstand
  // uebernimmt die Trennung) und die neuen Bestands-<span>s einfach
  // ANHAENGEN: bei n Original-Spans in Reihe 1 landen sie automatisch
  // in Reihe 2 an derselben Spalte (Grid-Auto-Placement, kein eigenes
  // Positionieren noetig).
  function ensureStockRow(costP, stock) {
    // Nur Rohstoff-Spans (mit <img>): bei Geld-Mangel haengt die Seite ein
    // "⏳ reicht in ..."-Span OHNE Icon an die Kostenzeile - der liess frueher
    // img.alt werfen und brach die Schleife fuer ALLE folgenden Gebaeude ab.
    const allSpans = Array.from(costP.children).filter((c) => c.tagName === 'SPAN' && !c.dataset.ikbaStock);
    const originalSpans = allSpans.filter((c) => c.querySelector('img'));
    if (!originalSpans.length) return;
    // Bei JEDEM Tick neu setzen statt einmalig: nach Bauende rendert Vue die
    // Kostenzeile neu (Trenn-Textknoten zurueck, "⏳ reicht in"-Span kommt
    // dazu/faellt weg) - eine einmal fixierte Spaltenzahl + Auto-Placement
    // warf dann Kosten, Bestand und "reicht in" durcheinander (Nutzer-
    // Screenshot 2026-09-26). Daher explizite Platzierung: Kosten Reihe 1,
    // Bestand Reihe 2 (je gleiche Spalte), alles ohne Icon Reihe 3 ueber
    // die volle Breite.
    Array.from(costP.childNodes).forEach((n) => { if (n.nodeType === 3) costP.removeChild(n); });
    costP.style.gridTemplateColumns = 'repeat(' + originalSpans.length + ', max-content)';
    originalSpans.forEach((span, i) => { span.style.gridRow = '1'; span.style.gridColumn = String(i + 1); });
    allSpans.filter((c) => !c.querySelector('img')).forEach((span) => { span.style.gridRow = '3'; span.style.gridColumn = '1 / -1'; });
    {
      costP.style.display = 'grid';
      // Nutzerwunsch: mehr Luft zwischen Kosten- und Bestandszeile sowie
      // zwischen den Spalten, sonst wirken die (oft laengeren) Bestands-
      // zahlen bei knapper Spaltenbreite zu dicht gedraengt.
      costP.style.columnGap = '18px';
      costP.style.rowGap = '6px';
      // Eigentliche Ursache des "wirkt uneben/passt nicht"-Eindrucks
      // (Nutzer-Screenshot trotz gleicher Ziffernanzahl je Spalte): die
      // Website nutzt eine proportionale Schrift, in der z.B. "9" breiter
      // ist als "1" - gleich viele Ziffern ergeben also unterschiedlich
      // breite Spalten. tabular-nums erzwingt einheitliche Ziffernbreite,
      // live per Claude-in-Chrome als Ursache bestaetigt und gefixt.
      costP.style.fontVariantNumeric = 'tabular-nums';
      // Nutzerwunsch: Icons sollen je Spalte an derselben Position stehen,
      // unabhaengig davon, wie lang die Zahl in dieser Zeile/Spalte ist -
      // die Website vererbt text-align:right von einem Vorfahren-Div
      // ("shrink-0 text-right"), das rechtsbuendige Grid-Items lassen das
      // Icon abhaengig von der Zahlenlaenge hin- und herspringen (live per
      // Claude-in-Chrome bestaetigt). justify-items:start + text-align:left
      // ueberschreiben das - jede Zelle nimmt nur ihre eigene Breite und
      // sitzt links in der (durch max-content ohnehin breiten genug)
      // Spalte, Icon-Position wird dadurch zeilenunabhaengig fix.
      costP.style.textAlign = 'left';
      costP.style.justifyItems = 'start';
    }
    const haveSpans = Array.from(costP.querySelectorAll('span[data-ikba-stock]'));
    originalSpans.forEach((span, i) => {
      const img = span.querySelector('img');
      const key = img.alt;
      const needed = parseInt(span.textContent.replace(/[^\d]/g, ''), 10) || 0;
      const have = stock && stock.resources[key] !== undefined
        ? Math.min(stock.capacity, stock.resources[key] + (stock.perHour[key] || 0) * (Date.now() - stock.fetchedAt) / 3600000)
        : null;
      let haveSpan = haveSpans[i];
      if (!haveSpan) {
        // Aeusserer Span bleibt plain/block (siehe Kommentar-Historie: ein
        // display:inline-flex HIER verschob die Spalte um einen konstanten
        // Betrag). Das Icon selbst braucht aber einen eigenen inline-flex-
        // Wrapper - die Website setzt <img> global auf display:block
        // (Tailwind-Reset), und ein block-Icon als direktes Kind eines
        // block-Grid-Items (costP ist display:grid, blockifiziert seine
        // Kinder) rutscht sonst auf eine eigene Zeile, die Zahl darunter
        // (Nutzer-Report 2026-09-18, live per Claude-in-Chrome als
        // "childNodes-Hoehe 32px statt 18px" bestaetigt). Das Original
        // macht das genauso: <span class="...inline-flex...">[img]</span>.
        haveSpan = document.createElement('span');
        haveSpan.dataset.ikbaStock = '1';
        const iconWrap = document.createElement('span');
        iconWrap.style.cssText = 'display:inline-flex;align-items:center;vertical-align:middle';
        iconWrap.appendChild(img.cloneNode(true));
        haveSpan.appendChild(iconWrap);
        haveSpan.appendChild(document.createTextNode(''));
        costP.appendChild(haveSpan);
      }
      haveSpan.style.gridRow = '2';
      haveSpan.style.gridColumn = String(i + 1);
      haveSpan.style.color = have === null ? '' : (have < needed ? '#f87171' : '#4ade80');
      haveSpan.lastChild.textContent = ' ' + (have === null ? '?' : formatNum(have));
    });
  }

  // Kaserne/Schiffswerft haben kein Heading zum Verankern wie SECTIONS
  // (Kaserne: genau ein <ul>, Schiffswerft: Bauliste + Reparaturliste als
  // zwei <ul> - siehe Kommentare bei tickBarracksQuickAdd/tickHarborQuickFill).
  // Einfach alle <ul> der Seite nehmen, ensureStockRow greift ohnehin nur,
  // wenn ein <li> eine Kosten-Zeile mit Rohstoff-Icons hat.
  function relevantStockLists() {
    if (location.pathname === '/shipyard' || location.pathname === '/barracks') {
      return Array.from(document.querySelectorAll('ul'));
    }
    return SECTIONS.map(findSection).filter(Boolean).map((s) => s.ul);
  }

  // Dashboard-Kacheln: Rohstoffwerte live hochzaehlen (Feature 11, v1.11.0).
  // Markup live verifiziert 2026-09-24: <span class="text-gray-600">
  // <span class="group ...">[img alt=wood|stone|iron|coal]</span> 155'432</span>,
  // die Zahl ist der letzte Textknoten. Vue setzt ihn beim eigenen Poll
  // zurueck, der naechste 500ms-Tick ueberschreibt ihn wieder.
  function tickDashboardResources() {
    if (location.pathname !== '/') return;
    const lis = document.querySelectorAll('ul.grid > li');
    if (!lis.length) return;
    fetchEmpireCached().then((empire) => {
      if (!empire) return;
      lis.forEach((li) => {
        const link = li.querySelector('a[href^="/island/"]');
        const island = link && empire.data.islands.find((i) => String(i.id) === link.getAttribute('href').split('/')[2]);
        if (!island) return;
        li.querySelectorAll('span.text-gray-600 > span.group > img').forEach((img) => {
          const res = island.resources[img.alt];
          if (res === undefined) return;
          const grown = res + (island.productionPerHour[img.alt] || 0) * (Date.now() - empire.fetchedAt) / 3600000;
          const textNode = img.parentElement.parentElement.lastChild;
          if (textNode.nodeType === 3) textNode.textContent = ' ' + formatNum(Math.max(res, Math.min(island.capacity, grown)));
        });
      });
    });
  }

  function tickResourceStock() {
    const relevant = relevantStockLists();
    if (!relevant.length) return;
    currentIslandStock().then((stock) => {
      relevant.forEach((ul) => {
        Array.from(ul.children).forEach((li) => {
          const costP = findCostRow(li);
          if (costP) ensureStockRow(costP, stock);
        });
      });
    });
  }

  // -------------------------------------------------------------------
  // Laufende Forschung wie laufender Ausbau darstellen (Feature 8, v1.7.1).
  // Die Gebaeudeliste ersetzt bei laufendem Ausbau selbst den Button durch
  // <p class="text-xs font-medium text-ocean-500">🏗 wird ausgebaut</p>
  // (IslandView-Bundle, `e.inProgress`). Die Forschungsliste tut das nicht:
  // der laufende Eintrag behaelt seinen (disabled) "Erforschen → N"-Button.
  // Hier wird er analog ausgeblendet (samt Kosten-Zeile) und durch den
  // gleichen Text-Stil "🔬 wird erforscht" ersetzt. Laufende Forschung aus
  // research-overview.researchQueueItems, Zuordnung ueber "<Name> Stufe
  // <Ziel-1> von".
  // -------------------------------------------------------------------

  // Restzeit-Zeile ("⏱ noch 1h 46m 5s", Format wie die Website selbst) direkt
  // unter dem "wird ausgebaut/erforscht"-Text (Feature 9). finishAt (ISO)
  // liefern buildQueueItems[] bzw. researchQueueItems[]; die Zeile wird bei
  // jedem 500-ms-Tick neu berechnet, die API-Antworten sind gecacht.
  function formatRemaining(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s === 0) return 'gleich fertig';
    const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
    return 'noch ' + [h ? h + 'h' : '', m ? m + 'm' : '', sec ? sec + 's' : ''].filter(Boolean).join(' ');
  }

  function ensureEta(anchorP, finishAt) {
    let eta = anchorP.nextElementSibling;
    if (!eta || !eta.dataset.ikbaEta) {
      eta = document.createElement('p');
      eta.dataset.ikbaEta = '1';
      eta.className = 'text-xs text-gray-500';
      anchorP.insertAdjacentElement('afterend', eta);
    }
    eta.textContent = '⏱ ' + formatRemaining(new Date(finishAt).getTime() - Date.now());
  }

  function tickRunningBuilds() {
    const m = location.pathname.match(/^\/island\/(\d+)/);
    if (!m) return;
    const section = findSection(SECTIONS[0]);
    if (!section) return;
    fetchIslandOverview(m[1]).then((data) => {
      // Laengster Name zuerst, damit "Haus" nicht "Haupthaus" verschluckt.
      const items = ((data && data.buildQueueItems) || []).slice().sort((a, b) => b.buildingName.length - a.buildingName.length);
      Array.from(section.ul.children).forEach((li) => {
        const p = Array.from(li.querySelectorAll('p')).find((x) => !x.dataset.ikbaEta && x.textContent.includes('wird ausgebaut'));
        const item = p && items.find((b) => li.textContent.includes(b.buildingName));
        if (item) ensureEta(p, item.finishAt);
        else { const eta = li.querySelector('[data-ikba-eta]'); if (eta) eta.remove(); }
      });
    });
  }

  function tickRunningResearch() {
    if (location.pathname !== '/research') return;
    const section = findSection(SECTIONS[1]);
    if (!section) return;
    fetchResearchOverviewCached().then((r) => {
      const running = ((r && r.researchQueueItems) || []).map((q) => ({ key: q.researchName + ' Stufe ' + (q.targetLevel - 1) + ' von', finishAt: q.finishAt }));
      Array.from(section.ul.children).forEach((li) => {
        const btn = li.querySelector('button');
        const marker = li.querySelector('[data-ikba-running]');
        const runItem = running.find((q) => li.textContent.includes(q.key));
        const isRunning = !!runItem;
        if (!isRunning) {
          if (marker) { marker.remove(); }
          const eta = li.querySelector('[data-ikba-eta]');
          if (eta) eta.remove();
          if (btn && btn.dataset.ikbaHidden) {
            btn.style.display = '';
            if (btn.nextElementSibling) btn.nextElementSibling.style.display = '';
            delete btn.dataset.ikbaHidden;
          }
          return;
        }
        if (!btn) return;
        btn.dataset.ikbaHidden = '1';
        btn.style.display = 'none';
        if (btn.nextElementSibling && !btn.nextElementSibling.dataset.ikbaRunning) btn.nextElementSibling.style.display = 'none';
        let p = marker;
        if (!p) {
          p = document.createElement('p');
          p.dataset.ikbaRunning = '1';
          p.className = 'text-xs font-medium text-ocean-500';
          p.textContent = '🔬 wird erforscht';
          btn.insertAdjacentElement('beforebegin', p);
        }
        ensureEta(p, runItem.finishAt);
      });
    });
  }

  // -------------------------------------------------------------------
  // Laufender Schiffsbau / laufende Ausbildung (Feature 12, v1.12.0) wie
  // Ausbau/Forschung: Eingabe+Button und Kosten des laufenden Eintrags
  // ausblenden, "🚢 wird gebaut"/"🪖 wird ausgebildet" + Restzeit zeigen.
  // Quelle: /api/islands/<id>/overview shipQueue {shipName, count, finishAt}
  // bzw. soldierQueue {soldierName, count, ...} (Felder live verifiziert
  // 2026-09-24, soldierQueue aus dem BarracksView-Bundle). Pro Insel laeuft
  // je Gebaeude nur ein Auftrag. Zuordnung ueber den Namen = erster
  // Textknoten von <p class="font-semibold"> im <li>.
  // -------------------------------------------------------------------
  function tickRunningUnits() {
    const isShipyard = location.pathname === '/shipyard';
    if (!isShipyard && location.pathname !== '/barracks') return;
    const ul = document.querySelector('main ul');
    if (!ul) return;
    fetchEmpireCached().then((empire) => {
      const island = empire && findDisplayedIsland(empire.data.islands);
      return island && fetchIslandOverview(island.id);
    }).then((o) => {
      if (!o) return;
      const q = isShipyard ? o.shipQueue : o.soldierQueue;
      const name = q && (isShipyard ? q.shipName : q.soldierName);
      Array.from(ul.children).forEach((li) => {
        const title = li.querySelector('p.font-semibold');
        const running = name && title && title.firstChild && title.firstChild.textContent.trim() === name;
        const marker = li.querySelector('[data-ikba-running]');
        if (!running) {
          if (marker) marker.remove();
          const eta = li.querySelector('[data-ikba-eta]');
          if (eta) eta.remove();
          li.querySelectorAll('[data-ikba-hidden]').forEach((el) => { el.style.display = ''; delete el.dataset.ikbaHidden; });
          return;
        }
        const input = li.querySelector('input[type="number"]');
        if (!input) return;
        const inputRow = input.parentElement;
        [inputRow, findCostRow(li), li.querySelector('[data-ikba-quickadd]')].forEach((el) => {
          if (el) { el.dataset.ikbaHidden = '1'; el.style.display = 'none'; }
        });
        let p = marker;
        if (!p) {
          p = document.createElement('p');
          p.dataset.ikbaRunning = '1';
          p.className = 'text-xs font-medium text-ocean-500';
          inputRow.insertAdjacentElement('beforebegin', p);
        }
        p.textContent = (isShipyard ? '🚢 wird gebaut' : '🪖 wird ausgebildet') + (q.count > 1 ? ' (' + q.count + '×)' : '');
        if (q.finishAt) ensureEta(p, q.finishAt);
      });
    });
  }

  // -------------------------------------------------------------------
  // Flotte & Truppen je Insel (Feature 10) — /empire zeigt bereits eine
  // Tabelle mit Insel/Rohstoffen/Gebaeuden/Schiffs- UND Soldaten-SUMME
  // je Insel (verifiziert live per Claude-in-Chrome), aber keine Aufschluesselung
  // nach Typ. /api/islands/<id>/overview (bereits von fetchIslandOverview()
  // fuer Feature 5 genutzt, 10s gecacht) liefert ships[]/soldiers[] mit
  // name+count je Typ. Neue Tabelle direkt unter der bestehenden eingefuegt,
  // gleiche Tailwind-Klassen wie das Original (Tabelle: "table"-Selektor auf
  // /empire trifft nur die eine bestehende Tabelle, kein Heading noetig).
  // Spalten nur fuer Typen, die auf MINDESTENS EINER Insel > 0 sind, sonst
  // waere die Tabelle bei 10 Schiffs- + 5 Soldatentypen unnoetig breit.
  // -------------------------------------------------------------------

  // Insel-Namenszelle 1:1 wie im Original-Empire-Table nachgebaut (live
  // per Claude-in-Chrome verifiziert): <a href="/island/<id>" class=
  // "font-medium text-ocean-700 hover:underline">Name</a> + <span
  // class="text-xs text-gray-400"> (x | y)</span>.
  function buildIslandNameCell(island) {
    const td = document.createElement('td');
    td.className = 'px-3 py-2 whitespace-nowrap';
    const a = document.createElement('a');
    a.href = '/island/' + island.id;
    a.className = 'font-medium text-ocean-700 hover:underline';
    a.textContent = island.name;
    const span = document.createElement('span');
    span.className = 'text-xs text-gray-400';
    span.textContent = ' (' + island.coordinates.x + ' | ' + island.coordinates.y + ')';
    td.append(a, span);
    return td;
  }

  // Baut eine Insel x Typ-Tabelle im Original-Look (gleiche Tailwind-
  // Klassen wie die bestehende Empire-Tabelle, inkl. Summenzeile im
  // tfoot) und haengt sie nach anchorEl an. Fuer Schiffe und Soldaten
  // getrennt aufgerufen (Nutzerwunsch: zwei eigene Tabellen statt einer
  // gemeinsamen breiten).
  function buildUnitTable(marker, islands, overviews, listKey) {
    const names = [];
    overviews.forEach((o) => {
      (o[listKey] || []).forEach((s) => { if (s.count > 0 && !names.includes(s.name)) names.push(s.name); });
    });
    if (!names.length) return null;

    const div = document.createElement('div');
    div.dataset[marker] = '1';
    div.className = 'mt-6 overflow-x-auto rounded-lg bg-white shadow';
    const newTable = document.createElement('table');
    newTable.className = 'w-full text-sm';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    headRow.className = 'border-b border-gray-100 text-left text-xs uppercase text-gray-400';
    ['Insel'].concat(names).forEach((label, i) => {
      const th = document.createElement('th');
      th.className = i === 0 ? 'px-3 py-2 whitespace-nowrap' : 'px-3 py-2';
      th.textContent = label;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    newTable.appendChild(thead);

    const totals = names.map(() => 0);
    const tbody = document.createElement('tbody');
    islands.forEach((island, i) => {
      const m = new Map((overviews[i][listKey] || []).map((e) => [e.name, e.count]));
      const tr = document.createElement('tr');
      tr.className = 'border-b border-gray-50 last:border-0';
      tr.appendChild(buildIslandNameCell(island));
      names.forEach((name, j) => {
        const count = m.get(name) || 0;
        totals[j] += count;
        const td = document.createElement('td');
        td.className = 'px-3 py-2 text-right';
        td.textContent = formatNum(count);
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    newTable.appendChild(tbody);

    const tfoot = document.createElement('tfoot');
    const totalTr = document.createElement('tr');
    totalTr.className = 'border-t border-gray-200 font-semibold text-ocean-900';
    const totalNameTd = document.createElement('td');
    totalNameTd.className = 'px-3 py-2 whitespace-nowrap';
    totalNameTd.textContent = 'Summe (' + islands.length + ' Inseln)';
    totalTr.appendChild(totalNameTd);
    totals.forEach((sum) => {
      const td = document.createElement('td');
      td.className = 'px-3 py-2 text-right';
      td.textContent = formatNum(sum);
      totalTr.appendChild(td);
    });
    tfoot.appendChild(totalTr);
    newTable.appendChild(tfoot);

    div.appendChild(newTable);
    return div;
  }

  async function tickEmpireUnitBreakdown() {
    if (location.pathname !== '/empire') return;
    const table = document.querySelector('table');
    if (!table) return;
    let anchor = table.parentElement;
    if (anchor.nextElementSibling && anchor.nextElementSibling.dataset.ikbaShipTable) return;

    const empire = await fetchEmpireCached();
    if (!empire) return;
    const islands = empire.data.islands;
    const overviews = await Promise.all(islands.map((i) => fetchIslandOverview(i.id)));

    [
      buildUnitTable('ikbaShipTable', islands, overviews, 'ships'),
      buildUnitTable('ikbaSoldierTable', islands, overviews, 'soldiers'),
    ].forEach((div) => {
      if (!div) return;
      anchor.insertAdjacentElement('afterend', div);
      anchor = div;
    });
  }

  tick();
  setInterval(() => { tick(); tickRunningResearch(); tickRunningBuilds(); tickRunningUnits(); tickEmpireUnitBreakdown(); }, 500);
})();
