# Baudoku – Fotodokumentation & Foto-Aufmaß (PWA)

Mobile Web-App für Kalkulation/Bauleitung im Dachdeckerhandwerk. Rein statisch (HTML/CSS/JS, kein Build), alle Daten lokal im Gerät (IndexedDB), offline-fähig (Service Worker), installierbar auf Android/iOS.

## Funktionen
- **Projekte**: Name, Kunde, Adresse (auch per GPS ermittelbar), Bauvorhaben-Nr., Datum, Notiz; Suche.
- **Fotos**: Kamera (`capture`), Live-Kamera mit Serienaufnahme (getUserMedia), Galerie (Mehrfachauswahl, EXIF-Zeit/GPS werden übernommen).
  Zeit-, GPS- (inkl. Genauigkeit) und Adress-Stempel (OpenStreetMap Nominatim, nur online) werden ins Bild gebrannt; Original bleibt erhalten. Beschreibung je Foto, Titelbild, Stempel neu erzeugen.
- **Notizen** mit Zeitstempel, optional mit Foto verknüpft.
- **Foto-Aufmaß**: Maßstab (Referenzstrecke) oder 4-Punkt-Perspektive (Referenzrechteck, Homographie); Längen (Polylinien) und Flächen (Polygone) in m / m²; Dachneigungskorrektur (÷ cos α) für Draufsichten; Punkte verschiebbar mit Lupe; Zoom per Pinch/Mausrad; entzerrte Draufsicht als neues Foto.
- **Aufmaß-Liste** je Projekt (Pos., Bezeichnung, Menge, Einheit), manuell editierbar, Rechenausdrücke (`2*3,5+1,25`). Keine pauschale Summe über unterschiedliche Maße. Eine Gesamtfläche nur aus ausdrücklich gewählten, gleichartigen m²-Flächen.
- **Zeichnen auf dem Foto**: in der Foto-Übersicht ✎ tippen. Stift und Gerade, **Rückgängig** (mehrfach), Foto ausblenden und wieder einblenden. Striche liegen getrennt vom Foto; das Original bleibt unverändert. Im PDF liegen die Striche über dem Foto.
- **Flächenskizze** (im Aufmaß): Umriss mit Kanten a, b, c und Flächen F1, F2 …, lokale Kantenvorschläge ohne erfundene Meter, Rechenweg für Rechteck, Dreieck, Trapez, zusammengesetzte Flächen und Abzüge. Grundriss und geneigte Fläche bleiben getrennt.
- **Projekt löschen**: in der Projektliste und beim Bearbeiten, erst nach Rückfrage mit dem Projektnamen. Optional ZIP-Backup. Gelöscht werden Fotos, Notizen, Aufmaß, Skizzen und Rechenwege nur dieses Projekts.
- **PDF-Export** (jsPDF lokal): Deckblatt, Fotos mit Stempel + Beschreibung, Notizen, Aufmaß-Tabelle, bemaßte Skizzen mit demselben Rechenweg, Aufmaßbilder, Seitenzahlen. Firmenstempel nur, wenn in den Einstellungen ein Name steht.
- **Teilen**: Nach PDF-Export und nach jedem Backup-ZIP (einzelnes Projekt oder alles) gibt es **Teilen**. Die App prüft `navigator.canShare({ files })` und öffnet dann das Teilen-Menü des Geräts (`navigator.share` mit der Datei) – z. B. Google Drive, Mail oder WhatsApp. Kann der Browser die Datei nicht teilen oder bricht das Teilen mit einem Fehler ab, startet derselbe Knopf einen normalen Download. **Herunterladen** speichert immer direkt.
- **Backup**: ZIP (data.json + alle Bilder) je Projekt oder komplett; Import (bei ID-Konflikt als Kopie).

## Lokal starten
```
python3 -m http.server 8080   # im Repository-Wurzelverzeichnis
```
Dann http://localhost:8080 öffnen. `localhost` gilt als sicherer Kontext (Kamera/GPS/Service Worker funktionieren).
**Im Einsatz auf dem Handy ist HTTPS Pflicht** (Kamera-Live, GPS, Offline, Installation).

## Hosting (statisch, HTTPS)
Die Dateien liegen im Wurzelverzeichnis (inkl. `.nojekyll`, damit GitHub Pages nichts ausfiltert). Alle Asset-, Manifest- (`start_url`, `scope`, Icons) und Service-Worker-Pfade sind relativ und funktionieren unter einem Unterpfad, z. B.

https://rajko89.github.io/baudoku/

Veröffentlichung: Workflow `.github/workflows/pages.yml` (GitHub Actions). In den Repository-Einstellungen muss die Pages-Quelle einmalig auf **GitHub Actions** stehen. Alternativ, ohne Actions: Quelle **Deploy from a branch**, Branch `main`, Ordner `/` (root) – dann den Workflow deaktivieren, damit nicht zwei Quellen gleichzeitig veröffentlichen. Bei Updates `VERSION` in `sw.js` erhöhen.

## Hinweise
- Daten liegen nur im Browser-Speicher des Geräts: regelmäßig Backup (ZIP) erstellen. Beim Löschen der Website-Daten / Deinstallation gehen sie verloren.
- Foto-Aufmaß ist eine Schätzung – Genauigkeit hängt von Referenz, Perspektive und Bild ab.
- Fremdbibliotheken: jsPDF 2.5.2 (MIT), JSZip 3.10.1 (MIT/GPLv3). Adressen © OpenStreetMap-Mitwirkende.
