# Offline-First Sync-Plan — Einkaufsliste

## Überblick

Die App wird **local-first**: Alle Daten leben primär in IndexedDB auf dem Client. Änderungen werden sofort im UI sichtbar und bei bestehender Verbindung automatisch mit dem Server synchronisiert.

### Zielkonflikt: Wenige Nutzer pro Account
Max. 2-3 Personen greifen gleichzeitig auf denselben Account zu. Das erlaubt eine **einfache Konfliktlösung** (letzte Änderung gewinnt), statt komplexer Mechanismen wie CRDTs oder Operational Transformation.

---

## Phase 1: Backend — Sync-Grundlage

### 1.1. `updated_at`-Felder hinzufügen

**Betroffene Models:** `Area`, `Product`, `ShoppingListItem`
(`ShoppingTrip` hat bereits `created_at`, reicht aus)

```python
# In jedem Model ergänzen:
updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
```

- **Aufwand:** ~10 Zeilen pro Model, 3 Models → **30 Min.**
- **Migrations-Hinweis:** Da kein Alembic o.Ä. im Einsatz ist, muss die SQLite-Spalte per Raw-SQL nachträglich hinzugefügt werden (oder `shopping_list.db` wird bei Schema-Änderung neu erstellt).
- **Voreinstellung:** Alle bestehenden Datensätze erhalten `updated_at = created_at` (bzw. `datetime.utcnow()`).

**Warum:** Ohne Zeitstempel kann der Client nicht nachvollziehen, welche Daten älter oder neuer sind als seine lokalen Kopien.

---

### 1.2. Endpoint: `GET /sync/changes?since=<ISO-timestamp>`

**Zweck:** Liefert alle Entities, die sich seit einem Zeitpunkt verändert haben.

**Rückgabe-Format:**
```json
{
  "timestamp": "2026-05-21T10:30:00Z",
  "areas": [
    { "id": 1, "name": "Obst & Gemüse", "position": 1, "updated_at": "2026-05-21T10:00:00Z" }
  ],
  "products": [],
  "items": [
    { "id": 5, "trip_id": 3, "name": "Äpfel", "is_checked": false, "updated_at": "2026-05-21T10:15:00Z" }
  ]
}
```

**Logik:**
```python
@router.get("/sync/changes")
async def get_changes(since: str = Query(...), current_user=Depends(get_current_user)):
    now = datetime.utcnow()
    # Alle Tables durchsuchen, wo updated_at >= since
    # Nur die account_id des aktuellen Users zurückgeben
    # Neuesten `updated_at`-Wert als Antwort-Timestamp zurückgeben
```

**Konflikt-Prinzip:** Server ist Source-of-Truth. Wenn ein lokaler Datensatz älter ist als der Server-Datensatz (gemessen an `updated_at`), gewinnt der Server-Wert.

**Aufwand:** ~100 Zeilen Code, **2 Std.**

---

### 1.3. Endpoint: `POST /sync/operations`

**Zweck:** Der Client sendet alle lokalen Operationen, die noch nicht auf dem Server angekommen sind.

**Request-Format:**
```json
{
  "client_id": "device-uuid",
  "server_timestamp": "2026-05-21T10:30:00Z",
  "operations": [
    {
      "op_id": "cli-uuid-001",
      "op_type": "create",
      "entity": "item",
      "data": { "trip_id": 3, "name": "Milch", "is_checked": false }
    },
    {
      "op_id": "cli-uuid-002",
      "op_type": "patch",
      "entity": "item",
      "entity_id": 7,
      "data": { "is_checked": true }
    },
    {
      "op_id": "cli-uuid-003",
      "op_type": "delete",
      "entity": "item",
      "entity_id": 12
    }
  ]
}
```

**Response-Format:**
```json
{
  "server_timestamp": "2026-05-21T10:30:01Z",
  "results": [
    { "op_id": "cli-uuid-001", "status": "ok", "server_id": 42, "server_updated_at": "2026-05-21T10:30:01Z" },
    { "op_id": "cli-uuid-002", "status": "conflict", "reason": "stale_update", "server_data": { ... } },
    { "op_id": "cli-uuid-003", "status": "ok" }
  ]
}
```

**Logik:**
1. Jede Operation mit `op_id` auf Existenz in einer lokalen `sync_log`-Tabelle prüfen (Duplikatsvermeidung bei Netzwerk-Wiederholungen). Wenn bereits verarbeitet → überspringen.
2. Operation ausführen:
   - `create`: Neuen Eintrag anlegen, `updated_at = now`
   - `patch`: Vorhandenen Eintrag updaten, `updated_at = now`
   - `delete`: Eintrag löschen
3. **Konflikterkennung:**
   - Bei `patch`: Prüfen, ob der lokale `updated_at` des Clients älter ist als der `updated_at` auf dem Server.
   - Wenn ja → `status: "conflict"` mit `server_data` zurückgeben.
4. Ergebnis mit serverseitiger `id` (für Creates) und `updated_at` zurückgeben.

**Aufwand:** ~200 Zeilen Code, **3 Std.**

---

### 1.4. Endpoint: `GET /sync/pending-check`

**Zweck:** Leichtgewichtiger Poll, der dem Client mitteilt, ob Sync nötig ist.

**Response:**
```json
{ "needs_sync": false, "server_timestamp": "2026-05-21T10:30:00Z" }
```

**Logik:** Vergleicht `server_timestamp` des Clients mit dem neuesten `updated_at` aller Entities des Accounts. Wenn `server_timestamp >= server_max_updated_at` → `needs_sync: false`.

**Aufwand:** ~50 Zeilen Code, **1 Std.**

---

## Phase 1.5: Backend — Push-Sync über SSE (Server-Sent Events)

**Zweck:** Änderungen, die auf dem Server eintreffen, werden **aktiv an alle verbunden Clients desselben Accounts** verteilt. Kein Polling mehr nötig, um fremde Änderungen zu sehen.

### 1.5.1. SSE-Endpoint: `GET /sync/stream`

```python
from sse_starlette import ServerSentEvent

@router.get("/sync/stream")
async def sync_stream(current_user=Depends(get_current_user)):
    """Sendet Server-Änderungen in Echtzeit via SSE."""
    # Client registrieren
    event_queue = asyncio.Queue()
    REGISTRY.add(current_user.account_id, event_queue)

    async def event_stream():
        try:
            while True:
                changes = await event_queue.get()
                yield ServerSentEvent(
                    data=json.dumps(changes),
                    event="sync_update",
                    id=str(changes.get("timestamp", ""))
                )
        except asyncio.CancelledError:
            REGISTRY.remove(current_user.account_id, event_queue)

    return StreamingResponse(event_stream(), media_type="text/event-stream")
```

### 1.5.2. Change-Broadcast bei jeder Write-Operation

Jede Write-Operation (CREATE/UPDATE/DELETE) auf `areas`, `products`, `items`, `trips` muss:
1. Die Änderung ausführen
2. Eine Broadcast-Nachricht an alle Clients desselben Accounts senden:
```json
{
  "type": "item_changed",
  "entity": "items",
  "entity_id": 42,
  "operation": "create",
  "data": { "id": 42, "name": "Milch", "is_checked": false, "updated_at": "2026-05-21T10:30:00Z" }
}
```

**Umsetzung:** Ein einfacher `asyncio.Queue` pro Account in einem globalen `Registry` (Dict `account_id → Set[Queue]`). Bei jeder Write-Operation wird die Nachricht in alle Queues geschrieben.

**Bibliothek:** `sse-starlette` (einfachste SSE-Implementierung für FastAPI).

**Alternativen:**
- **WebSockets** (`websockets`-Bibliothek) — mächtiger, aber aufwendiger (Reconnect-Logik, Heartbeat, Protokoll-Handling)
- **Empfehlung:** SSE — einfacher, native browser-Unterstützung (`new EventSource()`), automatische Reconnect, weniger Overhead

**Aufwand:** ~150 Zeilen Code, **2 Std.**

---

## Phase 2: Frontend — IndexedDB-Schicht

### 2.1. IndexedDB-Design

Da kein Build-Tool und kein Framework im Einsatz ist, wird eine **eigene IndexedDB-Wrapper-Bibliothek** erstellt (`frontend/js/db.js`).

**Database-Name:** `einkaufsliste-db`
**Version:** `1`

**Object Stores:**

| Store | Key Path | Indizes | Inhalt |
|---|---|---|---|
| `areas` | `id` | `account_id` | Vollständige Area-Daten + `updated_at` |
| `products` | `id` | `account_id`, `area_id` | Vollständige Product-Daten + `updated_at` |
| `trips` | `id` | `account_id` | Vollständige Trip-Daten + `updated_at` |
| `items` | `id` | `trip_id`, `account_id` | Vollständige Item-Daten + `updated_at` |
| `pending_ops` | `op_id` | `entity`, `status` | Ausstehende Operationen (`status: "pending" | "synced" | "conflict"`) |
| `sync_state` | `key` (einziger Entry) | — | `{ key: "last_sync", value: "2026-05-21T10:30:00Z" }` |
| `device_info` | `key` (einziger Entry) | — | `{ key: "device_id", value: "browser-uuid" }` |

**Aufwand:** ~300 Zeilen Code, **3 Std.**

---

### 2.2. Wrapper-Methoden

```javascript
// CRUD-Operationen (lesen aus IndexedDB, nicht vom Server)
await db.getAll('areas')
await db.get('products', productId)
await db.put('items', itemData)    // upsert
await db.delete('items', itemId)

// Pending Operations
await db.addPendingOp(op)           // op_id, op_type, entity, entity_id, data, timestamp
await db.getPendingOps()            // alle mit status === 'pending'
await db.updateOpStatus(opId, status, result)

// Sync State
await db.getSyncTimestamp()
await db.setSyncTimestamp(timestamp)
```

**Aufwand:** enthalten in 2.1

---

## Phase 3: Frontend — Sync-Engine

### 3.1. Architektur

```
┌──────────────────────────────────────────────────────┐
│                   UI (app.js)                        │
│  • Liest/Schreibt aus IndexedDB                       │
│  • Rendert direkt aus local data                     │
│  • Reagiert auf SSE-Echtzeit-Updates                 │
└──────────┬───────────────────────────┬───────────────┘
           │                           │
    ┌──────▼──────┐          ┌─────────▼──────────┐
    │  db.js      │          │  sync.js           │
    │  (IndexedDB)│          │  (Sync-Engine)     │
    └──────┬──────┘          └─────┬──────────────┘
           │                       │
           │         ┌─────────────▼──────────────┐
           │         │  Operation Queue            │
           │         │  • pending_ops Store        │
           │         │  • Batch-Processing         │
           │         │  • Retry mit Backoff        │
           │         └─────────────┬──────────────┘
           │                       │
           │               ┌───────▼───────┐
           │               │  fetch()      │
           │               │  → Backend    │
           │               └───────┬───────┘
           │                       │
           └───────────────────────┘
                   │               │
                   │         ┌─────▼─────┐
                   └─────────│ EventSource│
                             │ (SSE)     │
                             │ → Backend │
                             └───────────┘
```

**Kommunikationswege:**
| Richtung | Protokoll | Zweck |
|---|---|---|
| Client → Server | `fetch()` (HTTP) | Operationen pushen (Queue) |
| Server → Client | SSE (`EventSource`) | Echtzeit-Änderungen pushen |

---

### 3.2. Sync-Zyklus

**Initiierung:**
1. **Beim Laden der Seite:**
   - Sofortiger Full-Sync der Operation-Queue (wenn online)
   - SSE-Stream öffnen (`EventSource("/sync/stream")`)
2. **Echtzeit-Änderungen:** Über SSE empfangene Änderungen sofort in IndexedDB schreiben und UI aktualisieren
3. **Bei Verbindungswechsel:** `online`-Event → Full-Sync der Operation-Queue + SSE-Stream neu öffnen
4. **Manuell:** User-klickbarer "Sync jetzt"-Button (trigger + SSE reconnect)

**Full-Sync-Ablauf (Operation Queue):**

```
1. pending_ops = await db.getPendingOps()
2. Wenn pending_ops leer → fertig (nichts zu tun)

3. response = await fetch('/sync/operations', { body: { operations: pending_ops } })

4. Für jedes Ergebnis:
   Wenn status === "ok":
     Wenn entity === "item" && op_type === "create":
       await db.put(entity, { ...server_data, id: result.server_id })
     await db.updateOpStatus(opId, "synced")

   Wenn status === "conflict":
     await db.put(entity, result.server_data)
     await db.updateOpStatus(opId, "conflict_resolved")

5. await db.setSyncTimestamp(response.server_timestamp)
```

### 3.2.1. SSE-Client: Echtzeit-Updates empfangen

```javascript
class SSEClient {
  constructor() {
    this.eventSource = null;
    this.reconnectDelay = 1000;
  }

  connect(accountId, authToken) {
    this.eventSource = new EventSource(`/sync/stream?account_id=${accountId}`, {
      headers: { Authorization: `Bearer ${authToken}` }
      // Hinweis: EventSource unterstützt keine custom headers.
      // Token muss als Query-Param oder Cookie übergeben werden.
    });

    this.eventSource.addEventListener('sync_update', (event) => {
      const data = JSON.parse(event.data);
      this.handleUpdate(data);
    });

    this.eventSource.addEventListener('error', () => {
      // EventSource reconnectet automatisch
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    });
  }

  async handleUpdate(change) {
    // 1. Änderung in IndexedDB schreiben
    if (change.entity === 'items') {
      if (change.operation === 'delete') {
        await db.delete('items', change.entity_id);
      } else {
        await db.put('items', change.data);
      }
    } else if (change.entity === 'areas') {
      if (change.operation === 'delete') {
        await db.delete('areas', change.entity_id);
      } else {
        await db.put('areas', change.data);
      }
    }
    // ... für products, trips analog

    // 2. UI sofort aktualisieren
    renderCurrentView();

    // 3. Wenn der Client selbst die Änderung gemacht hat → ignorieren
    // (op_id im change.data prüfen, ob vom aktuellen Client gesendet)
  }
}
```

**Wichtig:** `EventSource` unterstützt keine custom HTTP-Headers (also kein `Authorization`-Header). Optionen:
- **Token als Query-Parameter** (`/sync/stream?token=...`) — einfach, aber Token im URL-Log → weniger sicher
- **Cookie-basierte Auth** — Token als HttpOnly-Cookie → sicherer, aber komplexer
- **Empfehlung für MVP:** Token als Query-Parameter, HTTPS vorausgesetzt

**Aufwand:** ~250 Zeilen Code, **3 Std.**

---

### 3.3. Operation Queue mit Retry

- **Max. Retry-Versuche:** 5
- **Exponentielles Backoff:** 1s → 2s → 4s → 8s → 16s
- **Bei dauerhaftem Fehler:** User wird benachrichtigt ("Sync fehlgeschlagen — bitte versuch es später erneut")
- **Queue wird in IndexedDB gespeichert** → überlebt Seitenneuladen und Browser-Neustarts

**Aufwand:** enthalten in 3.2

---

### 3.4. Konnektivitätsmanagement

```javascript
// Einfache Abfrage der Navigator-Online-Status
function isOnline() {
  return navigator.onLine;
}

window.addEventListener('online', () => {
  showNotification('Wieder online — synchronisiere...');
  syncEngine.fullSync();
});

window.addEventListener('offline', () => {
  showNotification('Offline-Modus aktiv');
});
```

**Aufwand:** ~30 Zeilen Code, **30 Min.**

---

## Phase 4: Frontend — Integration in `app.js`

### 4.1. Datenladen ersetzen

**Aktueller Zustand:**
```javascript
// Jedes Mal, wenn eine Seite geöffnet wird:
areas = await apiRequest('/areas', 'GET');
products = await apiRequest('/products', 'GET');
trips = await apiRequest('/trips', 'GET');
```

**Neuer Zustand:**
```javascript
// Sofort aus IndexedDB:
areas = await db.getAll('areas');
products = await db.getAll('products');
trips = await db.getAll('trips');

// Sync-Engine kümmert sich um Aktualisierung im Hintergrund
```

### 4.2. CRUD-Operationen umschreiben

**Erstellen (z.B. neues Item):**
```javascript
// Alt:
const newItem = await apiRequest('/items', 'POST', data);

// Neu:
// 1. Sofort ins IndexedDB (optimistic UI)
const localItem = { ...data, id: crypto.randomUUID(), is_checked: false, updated_at: now };
await db.put('items', localItem);
renderItems();  // Sofortiges UI-Update

// 2. Operation in die Warteschlange
await db.addPendingOp({
  op_id: crypto.randomUUID(),
  op_type: 'create',
  entity: 'item',
  data: data
});
syncEngine.trigger();  // Sync anstoßen
```

**Löschen (z.B. Item entfernen):**
```javascript
// Alt:
await apiRequest(`/items/${id}`, 'DELETE');

// Neu:
await db.delete('items', id);
renderItems();  // Sofortiges UI-Update

await db.addPendingOp({
  op_id: crypto.randomUUID(),
  op_type: 'delete',
  entity: 'item',
  entity_id: id
});
syncEngine.trigger();
```

**Aktualisieren (z.B. Item checked toggeln):**
```javascript
// Alt:
await apiRequest(`/items/${id}/check`, 'PATCH');

// Neu:
const item = await db.get('items', id);
item.is_checked = !item.is_checked;
item.updated_at = new Date().toISOString();
await db.put('items', item);
renderItems();

await db.addPendingOp({
  op_id: crypto.randomUUID(),
  op_type: 'patch',
  entity: 'item',
  entity_id: id,
  data: { is_checked: item.is_checked }
});
syncEngine.trigger();
```

**Aufwand:** ~150 Zeilen Änderungen in `app.js`, **3 Std.**

---

## Phase 5: Frontend — UI-Anpassungen

### 5.1. Offline-Indikator

Ein kleines Badge/Icon in der Navbar:

```html
<span id="offline-indicator" class="badge bg-secondary d-none">
  <i class="bi bi-wifi-off"></i> Offline
</span>
<span id="sync-indicator" class="badge bg-info d-none">
  <i class="bi bi-arrow-repeat spin"></i> Sync
</span>
```

**Aufwand:** ~30 Zeilen HTML/CSS/JS, **30 Min.**

### 5.2. Sync-Status-Nachricht

```javascript
function showSyncStatus(message, type = 'info') {
  // Toast oder Inline-Nachricht
  // z.B. "3 von 5 Änderungen synchronisiert"
}
```

**Aufwand:** ~40 Zeilen, **30 Min.**

### 5.3. Manueller Sync-Button

```html
<button id="sync-now-btn" class="btn btn-sm btn-outline-primary">
  <i class="bi bi-arrow-repeat"></i> Jetzt sync
</button>
```

Klick → `syncEngine.fullSync()` sofort ausführen.

**Aufwand:** ~20 Zeilen, **15 Min.**

---

## Zeitansätzung Gesamt

| Phase | Aufwand | Beschreibung |
|---|---|---|
| **Phase 1: Backend** | ~6 Std. | `updated_at` + 2 Sync-Endpoints |
| **Phase 1.5: SSE-Push** | ~2 Std. | `GET /sync/stream` + Broadcast bei Writes |
| **Phase 2: IndexedDB-Schicht** | ~3 Std. | Wrapper-Bibliothek |
| **Phase 3: Sync-Engine** | ~4 Std. | Queue, SSE-Client, Retry, Konnektivität |
| **Phase 4: app.js-Integration** | ~3 Std. | CRUD-Operationen umschreiben |
| **Phase 5: UI-Anpassungen** | ~1,5 Std. | Offline-Badge, Sync-Button, Nachrichten |
| **Testing & Bugfixing** | ~5 Std. | Cross-Browser, SSE-Reconnect, Konflikt-Szenarien |
| **Gesamt** | **~24 Std.** | ~3,5 Arbeitstage |

---

## Risiken & Offene Punkte

### 1. SQLite-Schema-Änderung (`updated_at`)
Da kein Migration-Tool im Einsatz ist, muss entweder:
- **A:** Eine init-Funktion beim Start prüfen, ob `updated_at` existiert, und per `ALTER TABLE` hinzufügen.
- **B:** Die Datenbankdatei `shopping_list.db` beim ersten Start nach dem Update zurückgesetzt werden (Datenverlust!).
- **Empfehlung:** Option A — `ALTER TABLE IF EXISTS`-Muster in `database.py` einbauen.

### 2. Soft Deletes für `items`
Wenn ein User ein Item löscht, aber ein anderer User es parallel erstellt, kommt es zu Kollisionen. **Empfehlung:** `items` bekommen ein `is_deleted`-Flag (Soft Delete) statt echtes `DELETE`. Der Sync sendet dann `op_type: "soft_delete"`.

### 3. Trip-Archivierung
Wenn ein Trip auf dem Client archiviert wird, aber parallel Items hinzugefügt werden, muss der Sync das korrekt verarbeiten. **Empfehlung:** Archivierung ist eine normale `patch`-Operation mit `is_archived: true`.

### 4. Performance bei vielen Items
IndexedDB ist schnell, aber bei 1000+ Items pro Table sollte geprüft werden, ob Pagination oder Cursor-basiertes Laden nötig ist. **Empfehlung:** Nicht priorisieren, bis es ein Problem wird.

### 5. Mehrere Tabs / Sessions
Wenn der User die App in zwei Tabs offen hat, werden Änderungen im einen Tab im anderen **automatisch via SSE aktualisiert** (jeder Tab öffnet einen eigenen SSE-Stream). Kein zusätzliches `BroadcastChannel` nötig.

### 6. SSE-Authentifizierung
`EventSource` unterstützt keine custom `Authorization`-Header. **Lösung:** Token als Query-Parameter (`/sync/stream?token=...`) mit HTTPS. Alternativ: Cookie-basierte Session-Auth statt JWT.

### 7. SSE-Verbindung bei schlechter Netzwerkverbindung
`EventSource` reconnectet automatisch, aber in dieser Zeit sieht der User keine Echtzeit-Updates. **Empfehlung:** Queue-Sync priorisieren (der funktioniert auch bei instabiler Verbindung). SSE ist ein "Nice-to-have" für Echtzeit-Updates, kein Ersatz für den Queue-Sync.

### 8. SQLite-Locking bei vielen gleichzeitigen Writes
SQLite erlaubt nur einen Writer. Bei zwei Clients, die gleichzeitig ein Item checked, kann es zu `database is locked` kommen. **Lösung:** `timeout=30` bei `sqlite3.connect()` (bereits vorhanden?) und/oder Retry-Logic im Backend.

---

## Empfohlene Implementierungsreihenfolge

1. **Backend Phase 1.1** (`updated_at` — schnellste Änderung, Blocker für alles andere)
2. **Backend Phase 1.2, 1.3 & 1.5** (Sync-Endpoints + SSE-Stream) — kann parallel zu Phase 2
3. **Frontend Phase 2** (IndexedDB-Wrapper)
4. **Frontend Phase 3** (Sync-Engine + SSE-Client)
5. **Frontend Phase 4** (Integration in `app.js`)
6. **Frontend Phase 5** (UI-Anpassungen)
7. **Testing**

---

## Nicht enthalten (für künftige Iterationen)

- **WebSockets** statt SSE — bidirektional, mehr Kontrolle, aber deutlich aufwendiger
- **File-Attachments** (z.B. Fotos von Einkaufszetteln)
- **Version History / Undo:** Vergangene Zustände von Items speichern
- **Service Worker für API-Caching:** Vollständiges Caching der gesamten App auch ohne IndexedDB
- **PWA-Features:** Installierbarkeit, Splash Screen, Manifest
