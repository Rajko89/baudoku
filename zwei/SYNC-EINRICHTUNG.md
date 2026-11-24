# Baudoku 2 mit Google Drive verbinden

Die Synchronisation liegt nur in Baudoku 2. Es gibt keinen eigenen Server. Die Daten liegen im versteckten App-Ordner von Google Drive (`appDataFolder`). Dort sieht man sie nicht in der normalen Drive-Ansicht, und andere Apps kommen nicht heran. Deshalb diese Ablage und nicht frei wählbare Drive-Dateien.

Die Client-ID wird in der App eingetragen. Sie steht nicht im Quelltext.

## 1. Google-Cloud-Projekt

1. Öffne https://console.cloud.google.com/ und lege ein Projekt an, zum Beispiel „Baudoku 2“.
2. Aktiviere die **Google Drive API** unter „APIs und Dienste“ → „Bibliothek“.

## 2. OAuth-Zustimmungsbildschirm

1. „APIs und Dienste“ → „OAuth-Zustimmungsbildschirm“.
2. Nutzertyp **Extern**.
3. App-Name zum Beispiel „Baudoku 2“, Support-E-Mail deine Adresse.
4. Scope später nicht öffentlich freigeben. Solange die App im Test ist: unter **Testnutzer** genau deine Gmail-Adresse eintragen.
5. Speichern. Eine Prüfung durch Google ist für den Testbetrieb nicht nötig.

## 3. Web-Client-ID

1. „APIs und Dienste“ → „Anmeldedaten“ → „Anmeldedaten erstellen“ → „OAuth-Client-ID“.
2. Anwendungstyp **Webanwendung**.
3. Autorisierte JavaScript-Ursprünge:
   - `https://rajko89.github.io`
4. Kein Client-Geheimnis verwenden. Die App im Browser nutzt nur die Client-ID.
5. Die angezeigte **Client-ID** kopieren. Sie endet auf `.apps.googleusercontent.com`.

## 4. In Baudoku 2 eintragen

1. Öffne https://rajko89.github.io/baudoku/zwei/
2. Einstellungen → Feld **Google Client-ID** → einfügen → Speichern.
3. Im Bereich Sync auf **Mit Google verbinden** tippen und mit der als Testnutzer eingetragenen Adresse zustimmen.
4. **Jetzt synchronisieren**. Optional **Automatisch beim Öffnen und nach Änderungen**.

Dieselbe Client-ID auf dem Computer und auf dem Handy verwenden. Beide müssen mit demselben Google-Konto verbunden sein.

Ohne Client-ID bleibt der Sync-Bereich aus. Ein echtes Verbinden kann diese Anleitung nicht vorwegnehmen.
