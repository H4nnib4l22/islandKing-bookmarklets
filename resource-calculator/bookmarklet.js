/*
 * Islandking Ressourcenrechner — Bookmarklet
 * Läuft same-origin auf islandking.ch (Panel-Overlay), keine Installation
 * (baugleich zum Tampermonkey-Userscript in diesem Ordner, nur oeffnet es
 * sich hier per Klick statt automatisch beim Laden der Seite).
 * Nutzt den vorhandenen /api/islands/:id/tech-path Endpoint, der bereits die
 * volle Voraussetzungskette (Gebäude/Forschung/Schiff) inkl. Gesamtkosten
 * und Bauzeit liefert — wir rechnen nur noch die Ansparzeit aus Lager +
 * Produktion/h dazu.
 */
(function () {
  const VERSION = 'v1.3.1';
  const existing = document.getElementById('ikrc-panel');
  if (existing) { existing.__ikrcCleanup?.(); existing.remove(); return; }

  const token = localStorage.getItem('access_token');
  if (!token) { alert('Kein access_token gefunden — bist du auf islandking.ch eingeloggt?'); return; }

  // Reaktiver Reload bei 401 (2026-09-16, ersetzt den frueheren blinden
  // 5-Min-Timer, siehe userscript.js/alliance-status fuer dasselbe Muster).
  // Erst nach mehreren FOLGE-401ern reloaden, ein einzelnes 401 direkt nach
  // einem Reload ist oft nur transient. Gemeinsamer Cooldown-Key mit ALLEN
  // Panel-Scripts, damit zwei gleichzeitig offene Panels sich nicht
  // gegenseitig ueberholen.
  const LS_LAST_PANEL_RELOAD = 'ikbm_lastPanelReload';
  const RELOAD_COOLDOWN_MS = 60000;
  function guardedReload() {
    const last = Number(localStorage.getItem(LS_LAST_PANEL_RELOAD)) || 0;
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return;
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

  const authFetch = (url) => fetch(url, { headers: { Authorization: 'Bearer ' + token } }).then(r => {
    if (!r.ok) {
      if (r.status === 401) reloadOn401(); else consecutive401 = 0;
      throw new Error('HTTP ' + r.status + ' bei ' + url);
    }
    consecutive401 = 0;
    return r.json();
  });

  const RES = [
    ['wood', '🪵 Holz'],
    ['stone', '🪨 Stein'],
    ['iron', '⚙️ Eisen'],
    ['coal', '🪨 Kohle'],
  ];

  function fmtDuration(totalSeconds) {
    if (!isFinite(totalSeconds)) return 'nie (Produktion = 0)';
    if (totalSeconds <= 0) return 'sofort';
    const d = Math.floor(totalSeconds / 86400);
    const h = Math.floor((totalSeconds % 86400) / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return (d ? d + 'd ' : '') + (h ? h + 'h ' : '') + m + 'm';
  }

  function fmtHHMM(totalSeconds) {
    if (!isFinite(totalSeconds)) return '';
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
  }

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

  const PANEL_ID = 'ikrc-panel';
  const SIDE_KEY = 'ikbm-side-' + PANEL_ID;
  const COLLAPSED_KEY = 'ikbm-collapsed-' + PANEL_ID;
  const side = readPref(SIDE_KEY, 'right');
  const collapsed = readPref(COLLAPSED_KEY, '0') === '1';
  const seq = nextPanelSeq();
  const TITLE_HTML = '🏝️ Ressourcenrechner <span style="opacity:.5;font-weight:normal;font-size:11px">' + VERSION + '</span>';

  const panel = document.createElement('div');
  panel.id = PANEL_ID;
  panel.dataset.ikbmPanel = '1';
  panel.dataset.ikbmSide = side;
  panel.dataset.ikbmSeq = seq;
  // display:flex;flex-direction:column statt overflow:auto direkt auf dem
  // Panel: Header bleibt so als eigenes Flex-Item fix sichtbar, nur der
  // body (flex:1;overflow:auto weiter unten) scrollt (Nutzerwunsch, wie im
  // Kampfrechner-Panel des Reisezeitenrechners uebernommen).
  panel.style.cssText = 'position:fixed;width:420px;overflow:hidden;'
    + 'display:flex;flex-direction:column;'
    + 'background:var(--ikbm-bg);color:var(--ikbm-text);border:1px solid var(--ikbm-border);border-radius:8px;'
    + 'font:13px/1.4 system-ui,sans-serif;padding:14px;z-index:999999;box-shadow:0 8px 24px rgba(0,0,0,.5)';
  applyIkbmTheme(panel);
  panel.innerHTML = '<div data-role="header" style="flex:0 0 auto;display:flex;justify-content:space-between;align-items:center;' + (collapsed ? '' : 'margin-bottom:8px') + '">'
    + '<b data-role="collapse-toggle" style="cursor:pointer;user-select:none">' + (collapsed ? '▸' : '▾') + ' ' + TITLE_HTML + '</b>'
    + '<span style="display:flex;gap:10px;align-items:center">'
    + '<span data-role="side-toggle" title="Seite wechseln (aktuell: ' + (side === 'left' ? 'links' : 'rechts') + ')" style="cursor:pointer;opacity:.7">⇄</span>'
    + '<span data-role="close" style="cursor:pointer;opacity:.7">✕</span>'
    + '</span></div>'
    + '<div data-role="body" id="ikrc-body" style="flex:1;overflow:auto;min-height:0;scrollbar-gutter:stable;padding-right:8px;box-sizing:border-box"' + (collapsed ? ' hidden' : '') + '>Lade Inseln…</div>';
  document.body.appendChild(panel);

  const header = panel.querySelector('[data-role="header"]');
  const collapseToggle = panel.querySelector('[data-role="collapse-toggle"]');
  const sideToggle = panel.querySelector('[data-role="side-toggle"]');
  const closeBtn = panel.querySelector('[data-role="close"]');
  const body = panel.querySelector('[data-role="body"]'); // = #ikrc-body, weiter unten unveraendert per getElementById genutzt

  collapseToggle.addEventListener('click', () => {
    const next = !body.hidden;
    body.hidden = next;
    collapseToggle.innerHTML = (next ? '▸ ' : '▾ ') + TITLE_HTML;
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

  // Reagiert auf einen Theme-Wechsel OHNE Reload (kein Navigations-Event
  // dabei) - siehe Kommentar bei IKBM_THEMES weiter oben.
  const ikbmThemeObserver = new MutationObserver(() => applyIkbmTheme(panel));
  ikbmThemeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

  panel.__ikrcCleanup = () => { clearInterval(repositionHandle); ikbmThemeObserver.disconnect(); };

  closeBtn.onclick = () => { panel.__ikrcCleanup(); panel.remove(); };

  authFetch('/api/empire').then(async (empire) => {
    const islands = empire.islands;
    const currentMatch = location.pathname.match(/\/island\/(\d+)/);
    const currentId = currentMatch ? Number(currentMatch[1]) : islands[0].id;

    // FIELD_STYLE: ohne eigenes background/color wuerden diese Felder die
    // Formularfarben der Website erben (CSS-Variablen, die mit deren Hell-/
    // Dunkelmodus kippen) - dasselbe Muster wie der Weissmodus-Fix im
    // Kampfrechner (siehe travel-calculator/userscript.js).
    const FIELD_STYLE = 'background:var(--ikbm-field);color:var(--ikbm-text);border:1px solid var(--ikbm-border);border-radius:4px';
    body.innerHTML = ''
      + 'Insel: <select id="ikrc-island" style="' + FIELD_STYLE + '"></select><br><br>'
      + 'Typ: <select id="ikrc-type" style="' + FIELD_STYLE + '">'
      + '<option value="building">Gebäude</option>'
      + '<option value="research">Forschung</option>'
      + '<option value="ship">Schiff</option>'
      + '</select><br><br>'
      + 'Ziel: <select id="ikrc-target" style="width:100%;' + FIELD_STYLE + '"></select><br><br>'
      + '<span id="ikrc-level-label">Ziel-Stufe:</span> <input id="ikrc-level" type="number" min="1" value="1" style="width:60px;' + FIELD_STYLE + '"><br><br>'
      + '<button id="ikrc-calc" style="padding:4px 12px;background:#1f6feb;color:#fff;border:none;border-radius:4px;cursor:pointer">Berechnen</button>'
      + '<div id="ikrc-result" style="margin-top:12px"></div>';

    const islandSel = document.getElementById('ikrc-island');
    islands.forEach(isl => {
      const opt = document.createElement('option');
      opt.value = isl.id; opt.textContent = isl.name;
      if (isl.id === currentId) opt.selected = true;
      islandSel.appendChild(opt);
    });

    let overview = null, research = null;

    async function loadTargets() {
      const islandId = islandSel.value;
      [overview, research] = await Promise.all([
        authFetch('/api/islands/' + islandId + '/overview'),
        authFetch('/api/research-overview'),
      ]);
      fillTargets();
    }

    function fillTargets() {
      const type = document.getElementById('ikrc-type').value;
      const targetSel = document.getElementById('ikrc-target');
      const levelInput = document.getElementById('ikrc-level');
      let list;
      if (type === 'building') list = overview.buildings;
      else if (type === 'research') list = research.researches;
      else list = overview.ships;
      targetSel.innerHTML = '';
      list.forEach(it => {
        const cur = it.level !== undefined ? it.level : it.count;
        const opt = document.createElement('option');
        opt.value = it.key;
        opt.dataset.cur = cur;
        opt.textContent = it.name + ' (aktuell ' + cur + (it.maxLevel ? '/' + it.maxLevel : '') + ')';
        targetSel.appendChild(opt);
      });
      // Bei Gebäuden/Forschung ist "level" die absolute Ziel-Stufe (have =
      // aktuelle Stufe). Bei Schiffen ist "level" dagegen die Anzahl NEU zu
      // bauender Schiffe — tech-path liefert dort have=0 unabhängig vom
      // Bestand. Deshalb unterschiedliches Default/Label je Typ.
      const levelLabel = document.getElementById('ikrc-level-label');
      const setLevelDefault = () => {
        const o = targetSel.selectedOptions[0];
        if (!o) return;
        if (type === 'ship') {
          levelLabel.textContent = 'Anzahl neu bauen:';
          levelInput.value = 1;
        } else {
          levelLabel.textContent = 'Ziel-Stufe:';
          levelInput.value = Number(o.dataset.cur) + 1;
        }
      };
      setLevelDefault();
      targetSel.onchange = setLevelDefault;
    }

    islandSel.onchange = loadTargets;
    document.getElementById('ikrc-type').onchange = fillTargets;
    await loadTargets();

    document.getElementById('ikrc-calc').onclick = async () => {
      const resultDiv = document.getElementById('ikrc-result');
      resultDiv.textContent = 'Rechne…';
      try {
        const islandId = islandSel.value;
        const targetKey = document.getElementById('ikrc-target').value;
        const level = document.getElementById('ikrc-level').value;
        const path = await authFetch('/api/islands/' + islandId + '/tech-path?target=' + targetKey + '&level=' + level);
        const isl = islands.find(i => i.id == islandId);

        // tech-path steps can echo the cost/time of an ALREADY-QUEUED order
        // (e.g. build queue length can raise cost/time) instead of what a
        // fresh order costs right now. Re-price every open step from the
        // live building/research/ship catalog so the numbers match "if I
        // order now". Falls back to the tech-path values only when a step
        // needs more than one level/unit at once (catalog only has the
        // single-next-level price).
        const liveCost = { wood: 0, stone: 0, iron: 0, coal: 0 };
        let liveSeconds = 0;
        let unverifiedSteps = [];
        // Pro Schritt der erkannte Zeitbonus (tech-path vs. Katalog-
        // Basiswert je Einheit) - Nutzerwunsch, um zu sehen, wo gerade ein
        // versteckter Bonus wie der Werft-10%-Bonus (siehe Kommentar unten)
        // aktiv ist. catalogPerUnit bleibt null, wenn kein Katalog-
        // Referenzwert vorliegt (Mehrstufiger Sprung bei Gebaeude/Forschung).
        const stepBonuses = [];
        for (const step of path.steps.filter(s => !s.done)) {
          const qty = step.need - step.have;
          let cost = null, seconds = null, catalogPerUnit = null;
          if (step.type === 'building') {
            const b = overview.buildings.find(x => x.key === step.key);
            if (b) catalogPerUnit = b.buildTimeSeconds;
            if (b && qty === 1) { cost = b.upgradeCost; seconds = b.buildTimeSeconds; }
          } else if (step.type === 'research') {
            const r = research.researches.find(x => x.key === step.key);
            if (r) catalogPerUnit = r.researchTimeSeconds;
            if (r && qty === 1) { cost = r.upgradeCost; seconds = r.researchTimeSeconds; }
          } else if (step.type === 'ship') {
            const s = overview.ships.find(x => x.key === step.key);
            if (s) catalogPerUnit = s.buildTimeSeconds;
          }
          // Schiffe bewusst NICHT aus overview.ships nachpreisen: verifiziert
          // (2026-09-12, HAR-Abgleich mit einem echten laufenden Bauauftrag),
          // dass die Werft einen festen ~10%-Zeitbonus gewaehrt (Verhaeltnis
          // tech-path/Katalog = 10/11 bei JEDEM Schiffstyp und JEDER Menge),
          // den NUR tech-path einrechnet - overview.ships[].buildTimeSeconds
          // ist der unrabattierte Basiswert. Der fruehere "Schlachtschiff-
          // Warteschlangen-Bug" (tech-path=113637s vs. Katalog=125000s, siehe
          // Kommentar oben) war vermutlich genau dieser Bonus, faelschlich
          // als Warteschlangen-Artefakt gedeutet - Kosten stimmen bei Schiffen
          // ohnehin exakt mit dem Katalog ueberein, nur die Zeit war betroffen.
          if ((!cost || seconds === null) && step.type !== 'ship') {
            // Mehrstufiger Sprung (qty > 1 bei Gebäude/Forschung): der
            // Katalog kennt nur den Preis für die nächste Stufe, nicht für
            // Zwischenstufen. Fallback auf tech-path — dessen Wert war bei
            // aktiv in der Warteschlange stehenden Zielen schon falsch,
            // hier daher als ungeprüft markieren statt stillschweigend zu
            // übernehmen.
            cost = step.cost; seconds = step.seconds;
            unverifiedSteps.push(step.name);
          } else if (step.type === 'ship') {
            // tech-path ist fuer Schiffe verifiziert korrekt (siehe Kommentar
            // oben) - kein "ungeprueft"-Hinweis noetig.
            cost = step.cost; seconds = step.seconds;
          }
          // Bonus = wie viel schneller tech-path pro Einheit ist als der
          // Katalog-Basiswert. Bei Mehrstufen-Spruengen (kein catalogPerUnit
          // oder qty>1 bei Gebaeude/Forschung ohne Katalogwert) bleibt der
          // Bonus unbekannt statt geraten.
          let bonusPercent = null;
          if (catalogPerUnit && qty > 0) {
            const actualPerUnit = seconds / qty;
            bonusPercent = (1 - actualPerUnit / catalogPerUnit) * 100;
          }
          stepBonuses.push({ name: step.name, bonusPercent });
          for (const k of Object.keys(liveCost)) liveCost[k] += cost[k] || 0;
          liveSeconds += seconds;
        }

        let maxHours = 0;
        let rows = '';
        let overCapacity = false;
        for (const [key, label] of RES) {
          const need = liveCost[key] || 0;
          const have = isl.resources[key] || 0;
          const perHour = isl.productionPerHour[key] || 0;
          const missing = Math.max(0, need - have);
          let hours;
          if (missing === 0) hours = 0;
          else if (perHour <= 0) hours = Infinity;
          else hours = missing / perHour;
          if (hours > maxHours) maxHours = hours;
          if (need > isl.capacity) overCapacity = true;
          rows += '<tr><td>' + label + '</td><td>' + need.toLocaleString() + '</td>'
            + '<td>' + have.toLocaleString() + '</td><td>' + perHour.toLocaleString() + '/h</td>'
            + '<td>' + fmtDuration(hours * 3600) + '</td></tr>';
        }

        const totalSeconds = (isFinite(maxHours) ? maxHours * 3600 : Infinity) + liveSeconds;

        // Bonus-Zeile je Schritt der Kette (Nutzerwunsch): zeigt den gerade
        // aktiven Zeitbonus pro Kategorie, "?" wenn unbekannt (Mehrstufiger
        // Sprung ohne Katalog-Referenzwert).
        const chainLine = stepBonuses.map((s) => {
          if (s.bonusPercent == null) return s.name + ' (?)';
          if (Math.abs(s.bonusPercent) < 0.1) return s.name + ' (kein Bonus)';
          const sign = s.bonusPercent > 0 ? '-' : '+';
          return s.name + ' (' + sign + Math.abs(s.bonusPercent).toFixed(1) + '% Zeit)';
        }).join(' → ');

        resultDiv.innerHTML = ''
          + (unverifiedSteps.length ? '<div style="color:var(--ikbm-gold);margin-bottom:6px">⚠️ Mehrstufiger Sprung bei ' + unverifiedSteps.join(', ') + ' — Wert stammt ungeprüft von tech-path, kann abweichen.</div>' : '')
          + (overCapacity ? '<div style="color:var(--ikbm-gold);margin-bottom:6px">⚠️ Zielkosten übersteigen dein Lager (' + isl.capacity.toLocaleString() + ') — Lager ausbauen nötig.</div>' : '')
          + (stepBonuses.length ? '<div style="opacity:.8;margin-bottom:6px">' + (path.steps.length > 1 ? 'Voraussetzungskette: ' : 'Zeitbonus: ') + chainLine + '</div>' : '')
          + '<table style="width:100%;border-collapse:collapse;font-size:12px">'
          + '<tr style="opacity:.7"><td>Rohstoff</td><td>Ziel</td><td>Hast</td><td>Prod.</td><td>Ansparzeit</td></tr>'
          + rows + '</table>'
          + '<div style="margin-top:8px;font-size:15px">Fertig in (inkl. längste Ansparzeit):<br><b>' + fmtDuration(totalSeconds) + '</b> (' + fmtHHMM(totalSeconds) + ')</div>';
      } catch (e) {
        resultDiv.textContent = 'Fehler: ' + e.message + ' (Token evtl. abgelaufen — Seite neu laden)';
      }
    };
  }).catch(e => {
    body.textContent = 'Fehler beim Laden: ' + e.message;
  });
})();
