/**
 * Caching layer for offline-first shopping list app.
 * Intercepts API responses, caches them in IndexedDB, and provides
 * fallback when backend is unavailable (offline mode).
 */

import db from '../db.js';

// --- Network Status ---
let isOnline = navigator.onLine;

window.addEventListener('online', () => {
    isOnline = true;
    if (window.debugLog) window.debugLog.info('CACHE', '🌐 System: online');
    hideOfflineBanner();
    if (window.cacheLayer) window.cacheLayer.onOnline?.();
});

window.addEventListener('offline', () => {
    isOnline = false;
    showOfflineBanner();
    if (window.cacheLayer) window.cacheLayer.onOffline?.();
});

function showOfflineBanner() {
    let banner = document.getElementById('offline-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'offline-banner';
        banner.className = 'alert alert-warning text-center mb-0';
        banner.innerHTML = '<strong>⚠ Offline-Modus</strong> — Du arbeitest mit lokalen Daten.';
        document.body.prepend(banner);
    }
    banner.style.display = 'block';
}

function hideOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (banner) banner.style.display = 'none';
}

// --- Cache API Responses ---
const originalFetch = window.fetch;

window.fetch = async function(...args) {
    const [url, options] = args;
    const urlStr = url instanceof URL ? url.toString() : url;

    const isGetRequest = !options || !options.method || options.method === 'GET';
    const response = await originalFetch.apply(this, args);

    const clonedResponse = response.clone();

    if (isGetRequest && response.ok) {
        clonedResponse.json().then(data => {
            cacheApiResponse(urlStr, data);
        }).catch(() => {});
    }

    return response;
};

// Log cache-layer initialization
if (window.debugLog) {
    window.debugLog.info('CACHE', '💾 Caching layer initialisiert (Online: ' + isOnline + ')');
}

async function cacheApiResponse(url, data) {
    try {
        let auth = await db.getAuth();
        // Fallback: Wenn keine Auth in IndexedDB, hole account_id aus localStorage
        if (!auth?.account_id) {
            const localToken = localStorage.getItem('authToken');
            if (localToken) {
                const storedAccountId = localStorage.getItem('_auth_account_id');
                if (storedAccountId) {
                    auth = { account_id: parseInt(storedAccountId) };
                }
            }
        }
        // Zweiter Fallback: Versuche account_id aus den Antwortdaten selbst zu extrahieren
        // (nützlich wenn _auth_account_id noch nicht gesetzt ist)
        if (!auth?.account_id) {
            const localToken = localStorage.getItem('authToken');
            if (localToken) {
                if (Array.isArray(data) && data.length > 0 && data[0]?.account_id) {
                    auth = { account_id: data[0].account_id };
                } else if (typeof data === 'object' && data !== null && data?.account_id) {
                    auth = { account_id: data.account_id };
                }
            }
        }
        if (!auth?.account_id) return;

        // Speichere account_id persistent im localStorage für alle localStorage-Fallbacks
        localStorage.setItem('_auth_account_id', String(auth.account_id));

        // Server.updated_at priorisieren — der Server ist die autoritative Quelle.
        // Client-Zeit nur als Fallback, wenn der Server keinen Wert mitteilt.
        const now = new Date().toISOString();

        if (url.includes('/areas') && !url.includes('with-products') && Array.isArray(data)) {
            for (const area of data) {
                await db.saveArea({ ...area, account_id: auth.account_id, updated_at: area.updated_at || now });
            }
            if (window.debugLog) window.debugLog.info('CACHE', '💾 Gecacht: ' + data.length + ' Bereiche von ' + url.substring(0, 60));
        }

        if (url.includes('/products') && Array.isArray(data)) {
            for (const product of data) {
                await db.saveProduct({ ...product, account_id: auth.account_id, updated_at: product.updated_at || now });
            }
            if (window.debugLog) window.debugLog.info('CACHE', '💾 Gecacht: ' + data.length + ' Produkte von ' + url.substring(0, 60));
        }

        if (url.includes('/trips') && !url.includes('/archive') && Array.isArray(data)) {
            for (const trip of data) {
                await db.saveTrip({ ...trip, account_id: auth.account_id, updated_at: trip.updated_at || now });
            }
            if (window.debugLog) window.debugLog.info('CACHE', '💾 Gecacht: ' + data.length + ' Trips von ' + url.substring(0, 60));
        }

         if (url.includes('/items/trip/') && Array.isArray(data)) {
            const tripId = url.match(/\/items\/trip\/(\d+)/)?.[1];
            if (tripId) {
                for (const item of data) {
                    await db.saveItem({
                        ...item,
                        trip_id: parseInt(tripId),
                        account_id: auth.account_id,
                        updated_at: item.updated_at || now,
                    });
                }
                if (window.debugLog) window.debugLog.info('CACHE', '💾 Gecacht: ' + data.length + ' Items für Trip ' + tripId);
            }
        }

        if (url.includes('/trips/') && !url.includes('/archive') && !url.includes('/archived') && typeof data === 'object' && data.id) {
            await db.saveTrip({ ...data, account_id: auth.account_id, updated_at: data.updated_at || now });
            if (window.debugLog) window.debugLog.info('CACHE', '💾 Gecacht: Einzeltrip ' + data.id);
        }

        if (url.match(/\/areas\/\d+$/) && typeof data === 'object' && data.id) {
            await db.saveArea({ ...data, account_id: auth.account_id, updated_at: data.updated_at || now });
            if (window.debugLog) window.debugLog.info('CACHE', '💾 Gecacht: Einzelbereich ' + data.id);
        }

        if (url.match(/\/products\/\d+$/) && typeof data === 'object' && data.id) {
            await db.saveProduct({ ...data, account_id: auth.account_id, updated_at: data.updated_at || now });
            if (window.debugLog) window.debugLog.info('CACHE', '💾 Gecacht: Einzelprodukt ' + data.id);
        }

        if (url.match(/\/items\/\d+$/) && typeof data === 'object' && data.id) {
            await db.saveItem({ ...data, account_id: auth.account_id, updated_at: data.updated_at || now });
            if (window.debugLog) window.debugLog.info('CACHE', '💾 Gecacht: Einzelitem ' + data.id);
        }

    } catch (err) {
        if (window.debugLog) window.debugLog.error('CACHE', '❌ Cache-Write fehlgeschlagen: ' + err.message);
        console.error('Cache write failed:', err);
    }
}

// --- Load cached data ---
async function loadFromCache(endpoint) {
    try {
        await db.open();
        const auth = await db.getAuth();
        if (!auth?.account_id) return [];

        if (endpoint === '/areas') {
            const data = await db.getAllAreas();
            if (window.debugLog) window.debugLog.info('CACHE', '📖 Cache-Lese: ' + data.length + ' Bereiche');
            return data;
        }

        if (endpoint === '/products') {
            const data = await db.getAllProducts();
            if (window.debugLog) window.debugLog.info('CACHE', '📖 Cache-Lese: ' + data.length + ' Produkte');
            return data;
        }

        if (endpoint.includes('/items/trip/')) {
            const tripId = endpoint.match(/\/items\/trip\/(\d+)/)?.[1];
            if (tripId) {
                const data = await db.getItemsByTrip(parseInt(tripId));
                if (window.debugLog) window.debugLog.info('CACHE', '📖 Cache-Lese: ' + data.length + ' Items für Trip ' + tripId);
                return data;
            }
        }

        if (endpoint === '/trips') {
            const data = await db.getAllTrips();
            if (window.debugLog) window.debugLog.info('CACHE', '📖 Cache-Lese: ' + data.length + ' Trips');
            return data;
        }

        if (endpoint.includes('/trips?archived=true')) {
            const allTrips = await db.getAllTrips();
            const archived = allTrips.filter(t => t.is_archived);
            if (window.debugLog) window.debugLog.info('CACHE', '📖 Cache-Lese: ' + archived.length + ' archivierte Trips');
            return archived;
        }

        return [];
    } catch (err) {
        if (window.debugLog) window.debugLog.error('CACHE', '❌ Cache-Lese fehlgeschlagen: ' + err.message);
        console.error('Cache load failed:', err);
        return [];
    }
}

// --- Patch functions after all modules are loaded ---
function applyPatches() {
    // --- Patch loadFromCache to merge local changes for item endpoints ---
    // WICHTIG: Bei /items/trip/{id} muessen lokale Änderungen (z.B. gesetzte Checkboxen)
    // priorisiert werden, da der Server-Cache diese nicht enthaelt.
    const originalLoadFromCache = window.loadFromCache;
    if (originalLoadFromCache) {
        window.loadFromCache = async function(endpoint) {
            // Prüfe, ob es sich um einen Item-Endpoint handelt
            const itemsTripMatch = endpoint.match(/^\/items\/trip\/(\d+)$/);
            if (itemsTripMatch) {
                console.log('[CACHE DEBUG] loadFromCache called for:', endpoint, 'db available:', !!window.db);
                try {
                    // Hole db Instanz über window.db oder den importierten db Verweis
                    const dbInstance = window.db || (window.cacheLayer && window.cacheLayer._db);
                    if (dbInstance) {
                        const tripId = itemsTripMatch[1];
                        console.log('[CACHE DEBUG] tripId from endpoint:', tripId);
                        // Lade Items aus IndexedDB (enthält lokale Änderungen)
                        const localItems = await dbInstance.getItemsByTrip(tripId);
                        console.log('[CACHE DEBUG] localItems from IndexedDB:', localItems?.length || 0, 'items');
                        if (localItems && localItems.length > 0) {
                            // Merge lokale Änderungen in Server-Cache Items
                            const cachedItems = await originalLoadFromCache(endpoint);
                            const mergedItems = cachedItems.map(cachedItem => {
                                const localItem = localItems.find(li => li.id === cachedItem.id);
                                if (localItem) {
                                    console.log('[CACHE DEBUG] Merge item', cachedItem.id, ': is_checked', cachedItem.is_checked, '->', localItem.is_checked);
                                    return { ...cachedItem, is_checked: localItem.is_checked, updated_at: localItem.updated_at };
                                }
                                return cachedItem;
                            });
                            // Neue lokale Items hinzufügen, die nicht im Cache sind
                            const cachedIds = new Set(cachedItems.map(i => i.id));
                            localItems.forEach(li => {
                                if (!cachedIds.has(li.id)) {
                                    mergedItems.push(li);
                                }
                            });
                            if (window.debugLog) window.debugLog.info('CACHE', '📝 Items gemergt aus IndexedDB (mit lokalen Änderungen): ' + mergedItems.length);
                            return mergedItems;
                        }
                    } else {
                        console.log('[CACHE DEBUG] Kein db verfügbar, versuche Server-Cache');
                    }
                } catch (dbErr) {
                    console.warn('[CACHE DEBUG] IndexedDB-Lese fehlgeschlagen, versuche Server-Cache:', dbErr.message);
                }
            }
            // Fallback auf Original (Server-Cache)
            return originalLoadFromCache(endpoint);
        };
    }

    // --- Patch: Merge pending operations into API responses ---
    // WICHTIG: Wenn loadCurrentTrip Items von der API lädt, MUSS das Sync-Queue
    // beruecksichtigt werden, da die Aenderungen noch nicht auf dem Server angekommen sind.
    function mergePendingOperations(items, tripId) {
        if (!items || !window.sync?.getPendingOperations) return items;
        
        // Hole ALLE pending item operations (nicht nach Trip filtern - das machen wir unten)
        const allPendingOps = window.sync.getPendingOperations('items');

        if (allPendingOps.length === 0) return items;
        
          
        // Merge pending operations into items
        const mergedItems = items.map(item => {
          for (const op of allPendingOps) {
                let applies = false;
                if (op.entity_id && item.id === op.entity_id) {
                    applies = true;
                } else if (op.data && op.data.id && item.id === op.data.id) {
                    applies = true;
                }
                
                if (applies && op.operation === 'patch' && op.data.is_checked !== undefined) {
                    console.log('[CACHE DEBUG] Merge pending patch op:', op.operation, 'item', item.id, 'is_checked:', item.is_checked, '->', op.data.is_checked);
                    return { ...item, is_checked: op.data.is_checked };
                }
                if (applies && op.operation === 'delete') {
                    // Item aus der Liste entfernen
                    console.log('[CACHE DEBUG] Remove deleted item', item.id);
                    return item; // Wird unten gefiltert
                }
            }
            return item;
        }).filter(item => {
            // Entferne Items, die geloescht wurden
            const deletedOps = allPendingOps.filter(op => op.operation === 'delete');
            return !deletedOps.some(op => op.entity_id === item.id);
        });
        
        // Neue Items hinzufügen (die noch nicht auf dem Server sind)
        const createOps = allPendingOps.filter(op => op.operation === 'create');
        createOps.forEach(op => {
            const newItem = op.data;
            if (newItem.id && !mergedItems.find(i => i.id === newItem.id)) {
                mergedItems.push({ ...newItem, trip_id: parseInt(tripId) });
            }
        });
        
        return mergedItems;
    }

    // Patch originalApiRequest to merge pending ops for GET /items/trip/{id}
    const originalApiRequest = window.apiRequest;

    if (originalApiRequest) {
        window.apiRequest = async function(endpoint, method = 'GET', body = null) {
            // Intercept GET /items/trip/{id} to merge pending operations
            const itemsTripMatch = endpoint.match(/^\/items\/trip\/(\d+)$/);
            
            let result;
            try {
                result = await originalApiRequest(endpoint, method, body);
            } catch (error) {
                console.warn(`API request failed (${endpoint}):`, error.message);
                if (window.debugLog) window.debugLog.error('API', '❌ ' + method + ' ' + endpoint + ': ' + error.message);
                showOfflineBanner();

                // Write operations: queue for sync
                if (method !== 'GET') {
                    if (window.sync?.queueOperation) {
                        const parts = endpoint.split('/').filter(Boolean);
                        const entity = parts[0] === 'admin' ? parts[2] : parts[0];
                        const entityId = parts[1] && !isNaN(parts[1]) ? parseInt(parts[1]) : undefined;
                        window.sync.queueOperation(entity,
                            method === 'POST' ? 'create' : method === 'DELETE' ? 'delete' : 'patch',
                            body,
                            entityId
                        );
                    }
                    if (window.debugLog) window.debugLog.warn('API', '→ Operation in Warteschlange gelegt');
                    return null;
                }

                // GET operations: fallback to cache silently
                if (window.debugLog) window.debugLog.warn('API', '→ Fallback auf Cache: ' + endpoint);
                showOfflineBanner();
                const cached = await window.loadFromCache(endpoint);
                if (cached && cached.length > 0) {
                    if (window.debugLog) window.debugLog.success('API', '✓ Cache bereitgestellt: ' + cached.length + ' Einträge');
                } else {
                    if (window.debugLog) window.debugLog.warn('API', '⚠ Kein Cachespeicher verfügbar');
                }
                return cached;
            }
            
            // Merge pending operations into item list responses
            if (itemsTripMatch && result && Array.isArray(result)) {
                const tripId = itemsTripMatch[1];
                console.log('[CACHE DEBUG] apiRequest loaded', result.length, 'items for trip', tripId, 'with pending ops check');
                return mergePendingOperations(result, tripId);
            }
            
            return result;
        };
    }

    // --- Patch specific load functions for cache fallback ---
    if (window.loadAreas) {
        const origLoadAreas = window.loadAreas;
        window.loadAreas = async function() {
            try {
                return await origLoadAreas();
            } catch (err) {
                console.error('loadAreas failed, using cache:', err);
                try {
                    areas = await loadFromCache('/areas');
                    const list = document.getElementById('areas-list');
                    if (list) {
                        list.innerHTML = '';
                        if (!areas || areas.length === 0) {
                            list.innerHTML = '<div class="text-muted">Keine Bereiche vorhanden. Erstelle deinen ersten Bereich.</div>';
                        } else {
                            areas.forEach(area => {
                                const item = document.createElement('div');
                                item.className = 'list-group-item d-flex justify-content-between align-items-center';
                                item.setAttribute('data-id', area.id);
                                item.innerHTML = `
                                    <div class="d-flex align-items-center flex-grow-1">
                                        <span class="area-name">${area.name}</span>
                                        <span class="edit-icon" onclick="startEditArea(${area.id}, this)">&#9998;</span>
                                    </div>
                                    <button class="btn btn-sm btn-outline-danger" onclick="deleteArea(${area.id})">Löschen</button>
                                `;
                                list.appendChild(item);
                            });
                            new Sortable(list, {
                                animation: 150,
                                onEnd: async () => {
                                    const newOrder = Array.from(list.children).map(el => parseInt(el.getAttribute('data-id')));
                                    try {
                                        await apiRequest('/areas/reorder', 'PATCH', { area_ids: newOrder });
                                    } catch (e) {
                                        // Silently fail in offline mode
                                        loadAreas();
                                    }
                                }
                            });
                        }
                    }
                } catch (cacheErr) {
                    console.error('Cache fallback failed:', cacheErr);
                }
            }
        };
    }

    if (window.loadProductsAndAreas) {
        const origLoadProductsAndAreas = window.loadProductsAndAreas;
        window.loadProductsAndAreas = async function() {
            try {
                return await origLoadProductsAndAreas();
            } catch (err) {
                console.error('loadProductsAndAreas failed, using cache:', err);
                try {
                    areas = await loadFromCache('/areas');
                    products = await loadFromCache('/products');
                    renderProductsList();
                    updateProductAreaSelect();
                } catch (cacheErr) {
                    console.error('Cache fallback failed:', cacheErr);
                }
            }
        };
    }

    if (window.prepareTripCreation) {
        const origPrepareTripCreation = window.prepareTripCreation;
        window.prepareTripCreation = async function() {
            try {
                return await origPrepareTripCreation();
            } catch (err) {
                console.error('prepareTripCreation failed, using cache:', err);
                try {
                    areas = await loadFromCache('/areas');
                    products = await loadFromCache('/products');
                    renderTripCreationForm();
                } catch (cacheErr) {
                    console.error('Cache fallback failed:', cacheErr);
                }
            }
        };
    }

    // loadCurrentTrip wurde zu cache-first umgebaut und handhabt
    // intern sowohl Cache-Lese als auch Hintergrund-Sync.
    // Der alte Wrapper hier ist nicht mehr nötig.

    if (window.loadTripHistory) {
        const origLoadTripHistory = window.loadTripHistory;
        window.loadTripHistory = async function() {
            try {
                return await origLoadTripHistory();
            } catch (err) {
                console.error('loadTripHistory failed, using cache:', err);
                try {
                    const allTrips = await loadFromCache('/trips');
                    const archivedTrips = allTrips.filter(t => t.is_archived);
                    const listContainer = document.getElementById('trip-history-list');
                    if (listContainer) {
                        listContainer.innerHTML = '';
                        archivedTrips.forEach(trip => {
                            const tripElement = document.createElement('div');
                            tripElement.className = 'list-group-item';
                            tripElement.setAttribute('data-trip-id', trip.id);
                            const date = new Date(trip.created_at).toLocaleDateString('de-DE', {
                                year: 'numeric', month: '2-digit', day: '2-digit'
                            });
                            tripElement.innerHTML = `
                                <span>${trip.name} (${date})</span>
                                <button class="btn btn-sm btn-outline-primary" onclick="viewTripDetail(${trip.id})">ansehen</button>
                            `;
                            listContainer.appendChild(tripElement);
                        });
                    }
                } catch (cacheErr) {
                    console.error('Cache fallback failed:', cacheErr);
                }
            }
        };
    }

    // --- Offline generateTrip ---
    if (window.generateTrip) {
        const origGenerateTrip = window.generateTrip;
        window.generateTrip = async function() {
            if (!isOnline) {
                // Create trip locally when offline
                try {
                    await db.open();
                    const auth = await db.getAuth();
                    if (!auth) {
                        showAlert('Keine Sitzung im Cache. Bitte online anmelden.');
                        return;
                    }

                    const newTrip = {
                        id: Date.now(),
                        name: `Einkauf ${new Date().toLocaleDateString('de-DE')}`,
                        account_id: auth.account_id,
                        created_at: new Date().toISOString(),
                        is_archived: false,
                        updated_at: new Date().toISOString(),
                    };

                    await db.saveTrip(newTrip);
                    currentTripId = newTrip.id;

                    // Save items locally
                    const selectedElements = document.querySelectorAll('.product-selector:checked');
                    for (const el of selectedElements) {
                        const name = el.getAttribute('data-name');
                        const area_id = parseInt(el.getAttribute('data-area-id'));
                        const productId = el.value;

                        const newItem = {
                            id: Date.now() + Math.random(),
                            trip_id: newTrip.id,
                            name: name,
                            is_checked: false,
                            area_id: area_id,
                            product_id: parseInt(productId),
                            account_id: auth.account_id,
                            updated_at: new Date().toISOString(),
                        };
                        await db.saveItem(newItem);
                    }

                    // selected_product_ids auf dem Trip auf leeres Array setzen
                    newTrip.selected_product_ids = [];
                    await db.saveTrip(newTrip);

                    showPage('current-trip');
                    if (window.sync) {
                        window.sync.fullSync();
                    }
                    return;
                } catch (err) {
                    console.error('Offline trip creation failed:', err);
                    showAlert('Fehler beim Erstellen des Trips im Offline-Modus: ' + err.message);
                    return;
                }
            }

            // Online: use original function
            return await origGenerateTrip();
        };
    }

  // --- Toggle item check with optimistic local save ---
    // WICHTIG: Muss VOR dem Originalaufruf speichern, weil apiRequest bei Fehler null
    // zurueckgibt (kein Error) und der try-Block in toggleItemCheck erfolgreich durchlaeuft.
    // Ohne optimistisches Speichern waere die Aenderung nur in der UI und verschwindet
    // beim naechsten loadCurrentTrip (das aus dem Cache neu rendert).
    if (window.toggleItemCheck) {
        const origToggleItemCheck = window.toggleItemCheck;
        window.toggleItemCheck = async function(itemId, isChecked) {
            // Optimistisch: Speichere SOFORT lokal, bevor die API aufgerufen wird
            try {
                if (!db._db) await db.open();
                const auth = await db.getAuth();
                const localToken = localStorage.getItem('authToken');
                let accountId = auth?.account_id;
                if (!accountId && localToken) {
                    const stored = localStorage.getItem('_auth_account_id');
                    if (stored) accountId = parseInt(stored);
                }
                if (accountId) {
                    const existing = await db.get(db.STORES.ITEMS, itemId);
                    if (existing) {
                        await db.saveItem({ ...existing, is_checked: isChecked, updated_at: new Date().toISOString() });
                        if (window.sync) {
                            window.sync.queueOperation('items', 'patch', { is_checked: isChecked }, itemId);
                        }
                        if (window.debugLog) window.debugLog.info('CACHE', '✅ Item ' + itemId + ' lokal aktualisiert (optimistisch)');
                    }
                }
            } catch (dbErr) {
                console.error('Optimistic toggleItemCheck save failed:', dbErr);
            }

           // Dann Originalaufruf ausfuehren (UI-Update + API-Sync)
            try {
                const result = await origToggleItemCheck(itemId, isChecked);
                // Badge aktualisieren nach erfolgreichem Check/Uncheck
                try {
                    if (!db._db) await db.open();
                    const items = await db.getItemsByTrip(currentTripId);
                    if (window.updateOpenCountBadge) {
                        window.updateOpenCountBadge(items);
                    }
                } catch (badgeErr) {
                    console.warn('Badge update failed:', badgeErr);
                }
                return result;
            } catch (err) {
                // Wenn Original auch fehlaeuft und offline: UI manuell updaten als Fallback
                if (!isOnline) {
                    const itemRow = document.querySelector(`[data-item-id="${itemId}"]`);
                    if (itemRow) {
                        const checkbox = itemRow.querySelector('.product-item-checkbox');
                        const nameSpan = itemRow.querySelector('.product-item-name');
                        if (checkbox) checkbox.checked = isChecked;
                        if (nameSpan) {
                            if (isChecked) nameSpan.classList.add('item-checked');
                            else nameSpan.classList.remove('item-checked');
                        }
                    }
                }
            }
        };
    }

    // --- deleteItem: optimistisches Löschen VOR API-Aufruf ---
    // WICHTIG: apiRequest gibt bei fehlgeschlagenen write-Op null zurueck (kein Error).
    // Ohne optimistisches Loeschen bleibt die Aenderung nur in der UI und verschwindet
    // beim naechsten loadCurrentTrip.
    if (window.deleteItem) {
        const origDeleteItem = window.deleteItem;
        window.deleteItem = async function(itemId) {
            if (window.debugLog) window.debugLog.info('CACHE', '🔄 deleteItem gestartet (optimistisch)');

            // Immer: zuerst lokal löschen (optimistisch), dann API-Aufruf
            let localDeleted = false;
            try {
                if (!db._db) await db.open();
                const auth = await db.getAuth();
                const localToken = localStorage.getItem('authToken');
                let accountId = auth?.account_id;
                if (!accountId && localToken) {
                    const stored = localStorage.getItem('_auth_account_id');
                    if (stored) accountId = parseInt(stored);
                }
                if (accountId) {
                    const existing = await db.get(db.STORES.ITEMS, itemId);
                    if (existing) {
                        await db.delete(db.STORES.ITEMS, itemId);
                        localDeleted = true;
                        if (window.sync) {
                            window.sync.queueOperation('items', 'delete', null, itemId);
                        }
                        if (window.debugLog) window.debugLog.info('CACHE', '✅ Item ' + itemId + ' lokal gelöscht (optimistisch)');
                    }
                }
            } catch (dbErr) {
                console.error('Optimistic deleteItem failed:', dbErr);
            }

            // Dann Originalaufruf (UI-Update + API-Sync)
            try {
                return await origDeleteItem(itemId);
            } catch (err) {
                // API-Fehler: lokale Löschung bleibt erhalten
                if (window.debugLog) window.debugLog.warn('CACHE', 'API-Fehler beim Löschen, lokal bleibt gelöscht');
                // UI manuell aktualisieren wenn Original fehlschlägt
                const itemRow = document.querySelector(`[data-item-id="${itemId}"]`);
                if (itemRow) itemRow.remove();
                const itemsContainer = document.getElementById('active-trip-items');
                if (itemsContainer && itemsContainer.children.length === 0) {
                    itemsContainer.innerHTML = '<p class="text-muted">Noch keine Produkte ausgewählt.</p>';
                }
            }
        };
    }

    // --- saveSpontaneousProduct: optimistisches Erstellen VOR API-Aufruf ---
    if (window.saveSpontaneousProduct) {
        const origSaveSpontaneousProduct = window.saveSpontaneousProduct;
        window.saveSpontaneousProduct = async function() {
            const name = document.getElementById('spontNameInput').value.trim();
            const area_id = parseInt(document.getElementById('spontAreaSelect').value);
            if (!name || isNaN(area_id)) return;

            // Optimistisch: erst lokal speichern
            try {
                if (!db._db) await db.open();
                const auth = await db.getAuth();
                const localToken = localStorage.getItem('authToken');
                let accountId = auth?.account_id;
                if (!accountId && localToken) {
                    const stored = localStorage.getItem('_auth_account_id');
                    if (stored) accountId = parseInt(stored);
                }
                if (!accountId) {
                    showAlert('Keine Sitzung im Cache. Bitte online gehen.');
                    return;
                }

                if (!currentTripId) {
                    const trips = await db.getAllTrips();
                    const activeTrip = trips.find(t => !t.is_archived);
                    if (activeTrip) currentTripId = activeTrip.id;
                    else {
                        showAlert('Kein aktiver Einkauf im Cache.');
                        return;
                    }
                }

                const newItem = {
                    id: Date.now(),
                    trip_id: currentTripId,
                    name: name,
                    sort_order: 0,
                    is_checked: false,
                    area_id: area_id,
                    product_id: null,
                    account_id: accountId,
                    updated_at: new Date().toISOString(),
                };

                await db.saveItem(newItem);
                if (window.sync) {
                    window.sync.queueOperation('items', 'create', newItem, newItem.id);
                }
                if (window.debugLog) window.debugLog.info('CACHE', '✅ Item "' + name + '" lokal erstellt (optimistisch)');

                // UI vorbereiten
                document.getElementById('spontNameInput').value = '';
                const spontModalEl = document.getElementById('spontaneousModal');
                if (spontModalEl) {
                    const spontModal = bootstrap.Modal.getInstance(spontModalEl);
                    if (spontModal) {
                        spontModal.hide();
                    }
                }
            } catch (dbErr) {
                console.error('Optimistic saveSpontaneousProduct failed:', dbErr);
                showAlert('Fehler beim Erstellen im Cache: ' + dbErr.message);
                return;
            }

            // Dann Originalaufruf (für API-Sync)
            try {
                return await origSaveSpontaneousProduct();
            } catch (err) {
                // API-Fehler: lokale Erstellung bleibt, aber neu rendern aus Cache
                if (window.debugLog) window.debugLog.warn('CACHE', 'API-Fehler beim Erstellen, lokal bleibt erstellt');
                // Neu rendern mit Cache-Daten
                if (window.loadCurrentTrip) {
                    await window.loadCurrentTrip();
                }
            }
        };
    }

    // --- completeTrip: optimistisches Archivieren VOR API-Aufruf ---
    if (window.completeTrip) {
        const origCompleteTrip = window.completeTrip;
        window.completeTrip = async function() {
            if (!confirm('Einkauf abschließen und archivieren?')) return;

            // Optimistisch: erst lokal archivieren
            try {
                if (!db._db) await db.open();
                const auth = await db.getAuth();
                const localToken = localStorage.getItem('authToken');
                let accountId = auth?.account_id;
                if (!accountId && localToken) {
                    const stored = localStorage.getItem('_auth_account_id');
                    if (stored) accountId = parseInt(stored);
                }
                if (!accountId) {
                    showAlert('Keine Sitzung im Cache. Bitte online gehen.');
                    return;
                }

                // Verwende window.currentTripId, da currentTripId im Modul nicht definiert ist
                let ctId = window.currentTripId !== undefined ? window.currentTripId : null;
                if (!ctId) {
                    const trips = await db.getAllTrips();
                    const activeTrip = trips.find(t => !t.is_archived);
                    if (activeTrip) {
                        ctId = activeTrip.id;
                        window.currentTripId = ctId;
                    } else {
                        showAlert('Kein aktiver Einkauf im Cache.');
                        return;
                    }
                }

                const existing = await db.get(db.STORES.TRIPS, ctId);
                if (existing) {
                    await db.saveTrip({ ...existing, is_archived: true, updated_at: new Date().toISOString() });
                    window.currentTripId = null;
                    if (window.sync) {
                        window.sync.queueOperation('trips', 'patch', { is_archived: true }, existing.id);
                    }
                    if (window.debugLog) window.debugLog.info('CACHE', '✅ Trip ' + existing.id + ' lokal archiviert (optimistisch)');
                } else {
                    showAlert('Trip nicht im Cache gefunden.');
                    return;
                }
            } catch (dbErr) {
                console.error('Optimistic completeTrip failed:', dbErr);
                showAlert('Fehler beim Abschließen im Cache: ' + dbErr.message);
                return;
            }

            // Dann Originalaufruf (für API-Sync)
            try {
                return await origCompleteTrip();
            } catch (err) {
                // API-Fehler: lokale Archivierung bleibt erhalten
                if (window.debugLog) window.debugLog.warn('CACHE', 'API-Fehler beim Archivieren, lokal bleibt archiviert');
               // Zur Verlauf-Seite wechseln
                showPage('trip-history');
            }
        };
    }
}

// Apply patches immediately - all modules are already imported
applyPatches();

// --- Auth persistence ---
async function setAuth(authData) {
    try {
        await db.open();
        const accountId = authData.user?.account_id;
        // Speichert Auth mit account_id in IndexedDB UND localStorage (wichtig für Cache-Filterung)
        const auth = {
            id: 'session',
            token: authData.token,
            user: authData.user,
            account_id: accountId,
            updated_at: new Date().toISOString(),
        };
        await db.saveAuth(auth);
        // Speichere account_id auch im localStorage für schnellen Zugriff
        if (accountId) {
            localStorage.setItem('_auth_account_id', String(accountId));
        }
        if (window.debugLog) window.debugLog.info('CACHE', '✅ Auth in IndexedDB gespeichert (account_id: ' + accountId + ')');
    } catch (err) {
        console.error('Failed to save auth to IndexedDB:', err);
    }
}

// --- State restoration ---
async function loadCachedData() {
    try {
        await db.open();
        const auth = await db.getAuth();
        // Fallback: Wenn keine Auth in IndexedDB, verwende localStorage-Token
        if (!auth) {
            const localToken = localStorage.getItem('authToken');
            if (!localToken) return {};
            // Erstelle eine Dummy-Auth, damit getAllTrips etc. funktionieren
            // (account_id ist für Trips/Items nicht nötig, da wir nach trip_id filtern)
        }

        const [areas, products, trips] = await Promise.all([
            db.getAllAreas(),
            db.getAllProducts(),
            db.getAllTrips(),
        ]);

        const activeTrip = trips.find(t => !t.is_archived);

        return { areas, products, trips, currentTripId: activeTrip?.id || null };
    } catch (err) {
        console.error('Failed to load cached data:', err);
        return {};
    }
}

async function restoreState() {
    // Zuerst Auth laden und _auth_account_id speichern (brauchen wir für loadCachedData)
    const auth = await db.getAuth();
    if (auth?.token) {
        window.authToken = auth.token;
        localStorage.setItem('authToken', auth.token);
        // Wichtig: account_id auch im localStorage speichern für alle Offline-Fallbacks
        if (auth.account_id) {
            localStorage.setItem('_auth_account_id', String(auth.account_id));
        }
    }

    // Jetzt erst die gecachten Daten laden (benötigen _auth_account_id)
    const cached = await loadCachedData();

    if (cached.currentTripId) {
        window.currentTripId = cached.currentTripId;
    }

    return cached;
}

// --- Expose globally ---
window.cacheLayer = {
    loadCachedData,
    restoreState,
    loadFromCache,
    setAuth,
};

// Auto-initialize
db.open().then(() => {
    restoreState().catch(console.error);
}).catch(console.error);
