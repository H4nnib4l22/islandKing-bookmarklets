# Islandking Bookmarklets

Zwei Browser-Add-ons für islandking.ch, wahlweise als Bookmarklet (Klick
zum Öffnen, kein Install) oder als Tampermonkey-Userscript (öffnet
automatisch beim Laden der Seite, kein Copy-Paste bei jeder Änderung
mehr nötig). Beide Varianten laufen same-origin direkt in der Seite mit
deinem eigenen Bearer-Token — kein GitHub-Token, kein externes Datenrepo.

- **Allianz Status** (`alliance-status/`) — Overlay-Panel mit Online-Status
  und "zuletzt online" für alle Allianzmitglieder, Favoriten, und eine
  eigene Verfolgt-Liste beliebiger Spielernamen samt Punkten/Rang.
- **Ressourcenrechner** (`resource-calculator/`) — Overlay-Panel, das für
  Gebäude/Forschung/Schiff die volle Voraussetzungskette samt Kosten,
  Bauzeit und Ansparzeit aus Lager + Produktion berechnet.

Beide Panels erkennen sich gegenseitig und ordnen sich automatisch an:
Allianz Status links, Ressourcenrechner rechts.

**Bookmarklet-Installation:** siehe `INSTALLATION.txt` im jeweiligen
Unterordner, oder komplettes Bundle als `islandking-bookmarklets.zip`.

**Tampermonkey-Installation:** Tampermonkey-Extension installieren, dann
`userscript.js` (im jeweiligen Unterordner) öffnen, kompletten Inhalt
kopieren, in Tampermonkey auf "Neues Script" klicken und einfügen,
speichern. Danach läuft das Panel automatisch auf jeder
islandking.ch-Seite. Dank `@updateURL` schlägt Tampermonkey künftige
Versionen (von diesem GitHub-Repo) selbst vor, sobald sich `@version`
in der Datei erhöht.
