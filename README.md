# Einkaufsliste App

Eine mobile-optimierte Web-App zur effizienten Planung und Durchführung von Einkäufen.

## 🚀 Funktionen

### 🔐 Benutzer & Sicherheit
- **Registrierung & Login:** Sicherer Zugriff auf persönliche Einkaufslisten.
- **E-Mail-Verifizierung:** Sicherstellung gültiger Nutzerkonten.
- **Passwort-Verwaltung:** Einfacher Prozess zum Zurücksetzen des Passworts.

### 📦 Konfiguration (Stammdaten)
- **Bereiche verwalten:** Erstellen, Bearbeiten und Sortieren von Einkaufsbereichen (z. B. "Obst", "Getränke"), um die Wege im Supermarkt zu optimieren.
- **Waren verwalten:** Anlegen von Produkten und deren Zuordnung zu festen Bereichen.

### 🛒 Einkaufslisten
- **Listen erstellen:** Schnelles Generieren einer neuen Liste durch Auswahl gespeicherter Produkte.
- **Aktiver Einkauf:**
    - **Interaktives Abhaken:** Produkte direkt beim Einkauf markieren.
    - **Optimierte Bedienung:** Die Scroll-Position bleibt beim Abhaken erhalten, was die Nutzung auf Mobilgeräten erheblich erleichtert.
    - **Spontankäufe:** Neue Artikel können jederzeit während des Einkaufs hinzugefügt werden.
    - **Einkauf abschließen:** Archivierung der Liste nach dem Einkauf.
- **Verlauf:** Übersicht und Detailansicht aller bisherigen Einkäufe.

### 🛠️ Administration
- **Nutzerverwaltung:** Verwalten von registrierten Nutzern und Vergabe von Administrator-Rechten.
- **Account-Management:** Verwaltung der System-Zugänge.

## 🛠️ Technologie-Stack
- **Backend:** Python (FastAPI)
- **Frontend:** HTML, CSS (Bootstrap), JavaScript
- **Datenbank:** SQLite

## ⚙️ Installation & Start

### Installation
1. Abhängigkeiten installieren: `pip install -r requirements.txt`

### Starten
1. **Backend:**
   ```bash
   uvicorn backend.main:app --reload
   ```
2. **Frontend:** Die `index.html` über einen Webserver öffnen.
