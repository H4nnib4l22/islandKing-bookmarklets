# Islandking Bookmarklets

Drei Browser-Add-ons für islandking.ch, wahlweise als Bookmarklet (Klick
zum Öffnen, kein Install) oder als Tampermonkey-Userscript (öffnet
automatisch beim Laden der Seite, kein Copy-Paste bei jeder Änderung
mehr nötig). Alle Varianten laufen same-origin direkt in der Seite —
Allianz Status und Ressourcenrechner mit deinem eigenen Bearer-Token,
kein GitHub-Token, kein externes Datenrepo.

- **Allianz Status** (`alliance-status/`) — Overlay-Panel mit Online-Status
  und "zuletzt online" für alle Allianzmitglieder, Favoriten, und eine
  eigene Verfolgt-Liste beliebiger Spielernamen samt Punkten/Rang.
- **Ressourcenrechner** (`resource-calculator/`) — Overlay-Panel, das für
  Gebäude/Forschung/Schiff die volle Voraussetzungskette samt Kosten,
  Bauzeit und Ansparzeit aus Lager + Produktion berechnet.
- **Reisezeitenrechner** (`travel-calculator/`) — Overlay-Panel, das aus
  zwei Koordinaten Distanz, Fahrtzeit und ETA für alle Schiffstypen
  berechnet. Reine Rechnerei ohne API/Token/Netzwerk. Nur im
  Tampermonkey-Userscript (nicht im Bookmarklet) zusätzlich mit einem
  eigenen **⚔️ Kampfrechner**-Panel darunter — volle Kampfformel aus dem
  Schattenflotte Taktischer Koordinator (444/445 echte Kämpfe exakt),
  Angreifer/Verteidiger-Stückzahlen für alle Schiffs- und Truppentypen
  sowie Verteidigungsanlagen, Ergebnis inkl. Sieger, Rundenzahl und
  Verlusten je Einheitentyp.

Alle vier Panels (alle drei Tampermonkey-Userscripts zusammen) erkennen
sich gegenseitig, sind ein-/ausklappbar (Header bleibt sichtbar) und
haben ein ⇄-Symbol zum Seitenwechsel links/rechts — beides merkt sich
der Browser pro Panel über Reloads hinweg. Sie stapeln sich dabei immer
überlappungsfrei nach Erzeugungsreihenfolge: dockt ein Panel um oder
klappt es ein/aus, rücken alle NACH ihm erzeugten, gleichseitigen
Panels automatisch nach — unabhängig davon, welches Script sie erzeugt
hat oder auf welcher Seite sie gerade stehen.

**Bookmarklet-Installation:** siehe `INSTALLATION.txt` im jeweiligen
Unterordner, oder komplettes Bundle als `islandking-bookmarklets.zip`.

**Tampermonkey-Installation:** Tampermonkey-Extension installieren, dann
`userscript.js` (im jeweiligen Unterordner) öffnen, kompletten Inhalt
kopieren, in Tampermonkey auf "Neues Script" klicken und einfügen,
speichern. Danach läuft das Panel automatisch auf jeder
islandking.ch-Seite. Dank `@updateURL` schlägt Tampermonkey künftige
Versionen (von diesem GitHub-Repo) selbst vor, sobald sich `@version`
in der Datei erhöht.
