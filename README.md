# Islandking Bookmarklets

Fünf Tampermonkey-Userscripts für islandking.ch (öffnen automatisch beim
Laden der Seite). Alle laufen same-origin direkt in der Seite — Allianz
Status, Ressourcenrechner und Spy Report Lookup mit deinem eigenen
Bearer-Token, kein GitHub-Token, kein externes Datenrepo.

- **Allianz Status** (`alliance-status/`) — Overlay-Panel mit Online-Status
  und "zuletzt online" für alle Allianzmitglieder, Favoriten, eine eigene
  Verfolgt-Liste beliebiger Spielernamen samt Punkten/Rang, sowie ein
  **Angriffe**-Tab mit allen laufenden Flottenbewegungen der Allianz
  (eingehend/ausgehend, Ziel, Koordinaten, Ankunfts-Countdown) samt rotem
  Benachrichtigungspunkt am Tab bei neu hinzugekommenen Flotten, der beim
  Öffnen des Tabs wieder verschwindet. Ein **Spähposten**-Tab zeigt die
  Meldungen der eigenen gebauten Spähposten (herannahende Flotten je
  eigener Insel) — erscheint erst, sobald mindestens eine eigene Insel
  einen Spähposten hat, mit demselben Benachrichtigungspunkt-Muster wie
  Angriffe.
- **Ressourcenrechner** (`resource-calculator/`) — Overlay-Panel, das für
  Gebäude/Forschung/Schiff die volle Voraussetzungskette samt Kosten,
  Bauzeit und Ansparzeit aus Lager + Produktion berechnet.
- **Reisezeitenrechner** (`travel-calculator/`) — Overlay-Panel, das aus
  zwei Koordinaten Distanz, Fahrtzeit und ETA für alle Schiffstypen
  berechnet. Reine Rechnerei ohne API/Token/Netzwerk. Bringt zusätzlich
  ein eigenes **⚔️ Kampfrechner**-Panel darunter mit — volle Kampfformel aus dem
  Schattenflotte Taktischer Koordinator (444/445 echte Kämpfe exakt), mit
  zwei Tabs: **PvP** (Angreifer/Verteidiger-Stückzahlen für alle Schiffs-
  und Truppentypen sowie Verteidigungsanlagen) und **Konvoi entern** (nur
  Schiffe, da Piraten-Konvois keine Landtruppen/Gebäude haben). Ergebnis
  inkl. Sieger, Rundenzahl und Verlusten je Einheitentyp. Im spielinternen
  Karten-Popup eines Piraten-Konvois erscheint zusätzlich ein **"An
  Kampfrechner senden"**-Button, der dessen Schiffstypen+Anzahl direkt in
  den Konvoi-entern-Tab überträgt — nur sichtbar, solange das Popup offen ist.
- **Content Addon** (`content-addon/`) — Sammlung kleiner
  Komfort-Erweiterungen: je ein Ein/Aus-Schalter über die
  Gebäudeliste der Inselseite und über die Forschungsliste, die bereits
  maximierte Gebäude/Forschungen ausblenden (standardmäßig beide aktiv);
  auf der Kaserne-Seite Schnell-Buttons (+5/+10/+20/+50/+100, summieren
  sich bei mehrfachem Klick) plus Leeren-Button je Truppenzeile, erscheint
  automatisch auch für Truppen, die erst später freigeschaltet werden;
  auf der Handel-Seite dieselben Schnell-Buttons (+1000/+5000/+10000/
  +20000/+25000) je für "Biete" und "Suche" im Angebotsformular.
  Kein eigenes Panel, reine DOM-Filterung.
- **Spy Report Lookup** (`spy-report-lookup/`) — Overlay-Panel, Portierung
  der gleichnamigen Browser-Extension. **Spionage**-Tab durchsucht
  gespeicherte Spionageberichte nach Benutzername und formatiert Treffer
  fertig zum Kopieren (Rohstoffe, Verteidigung, Gebäude, Schiffe,
  Soldaten). **Flotte**-Tab listet die eigenen Schiffe/Soldaten der
  Heimatinsel, ebenfalls fertig formatiert. Eigenes Bearer-Token, kein
  GitHub-Token, kein externes Datenrepo.

Alle vier Panel-Userscripts erkennen sich gegenseitig, sind
ein-/ausklappbar (Header bleibt sichtbar) und haben ein ⇄-Symbol zum
Seitenwechsel links/rechts — beides merkt sich der Browser pro Panel
über Reloads hinweg. Sie stapeln sich dabei immer überlappungsfrei nach
Erzeugungsreihenfolge: dockt ein Panel um oder klappt es ein/aus, rücken
alle NACH ihm erzeugten, gleichseitigen Panels automatisch nach —
unabhängig davon, welches Script sie erzeugt hat oder auf welcher Seite
sie gerade stehen.

**Installation:** siehe `INSTALLATION.txt` im jeweiligen Unterordner,
oder kurz: Tampermonkey-Extension installieren, dann `userscript.js` (im
jeweiligen Unterordner) öffnen, kompletten Inhalt kopieren, in
Tampermonkey auf "Neues Script" klicken und einfügen, speichern. Danach
läuft das Panel automatisch auf jeder islandking.ch-Seite. Dank
`@updateURL` schlägt Tampermonkey künftige Versionen (von Greasy Fork,
synchronisiert aus diesem GitHub-Repo) selbst vor, sobald sich `@version`
in der Datei erhöht.
