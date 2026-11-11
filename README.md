# Baudoku – Fotodokumentation & Foto-Aufmaß (PWA)

Mobile Web-App für Kalkulation/Bauleitung im Dachdeckerhandwerk. Rein statisch (HTML/CSS/JS, kein Build), alle Daten lokal im Gerät (IndexedDB), offline-fähig (Service Worker), installierbar auf Android/iOS.

## Funktionen
- **Projekte**: Name, Kunde, Adresse (auch per GPS ermittelbar), Bauvorhaben-Nr., Datum, Notiz; Suche.
- **Fotos**: Kamera (`capture`), Live-Kamera mit Serienaufnahme (getUserMedia), Galerie (Mehrfachauswahl, EXIF-Zeit/GPS werden übernommen).
  Zeit-, GPS- (inkl. Genauigkeit) und Adress-Stempel (OpenStreetMap Nominatim, nur online) werden ins Bild gebrannt; Original bleibt erhalten. Beschreibung je Foto, Titelbild, Stempel neu erzeugen.
- **Notizen** mit Zeitstempel, optional mit Foto verknüpft.
- **Foto-Aufmaß**: Maßstab (Referenzstrecke) oder 4-Punkt-Perspektive (Referenzrechteck, Homographie); Längen (Polylinien) und Flächen (Polygone) in m / m²; Dachneigungskorrektur (÷ cos α) für Draufsichten; Punkte verschiebbar mit Lupe; Zoom per Pinch/Mausrad; entzerrte Draufsicht als neues Foto.
- **Aufmaß-Liste** je Projekt (Pos., Bezeichnung, Menge, Einheit), manuell editierbar, Rechenausdrücke (`2*3,5+1,25`), Summen je Einheit, automatische Aktualisierung aus Foto-Messungen.
- **PDF-Export** (jsPDF lokal): Deckblatt, Fotos mit Stempel + Beschreibung, Notizen, Aufmaß-Tabelle mit Summen, bemaßte Aufmaßbilder, Seitenzahlen.
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

Quelle in GitHub Pages: Branch `main`, Ordner `/` (root). Bei Updates `VERSION` in `sw.js` erhöhen.

## Hinweise
- Daten liegen nur im Browser-Speicher des Geräts: regelmäßig Backup (ZIP) erstellen. Beim Löschen der Website-Daten / Deinstallation gehen sie verloren.
- Foto-Aufmaß ist eine Schätzung – Genauigkeit hängt von Referenz, Perspektive und Bild ab.
- Fremdbibliotheken: jsPDF 2.5.2 (MIT), JSZip 3.10.1 (MIT/GPLv3). Adressen © OpenStreetMap-Mitwirkende.
