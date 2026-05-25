/**
 * Sync engine for offline-first shopping list app.
 * Combines IndexedDB, SSE push notifications, and operation queue.
 */

import db from './db.js';

// --- State ---
let isConnected = false;
let eventSource = null;
let operationQueue = [];
let isSyncing = false;
let lastSyncTimestamp = null;
let pendingConflicts = [];

// --- Event listeners ---
const listeners = new Map();

function emit(event, data) {
    const handlers = listeners.get(event) || [];
    handlers.forEach(handler => handler(data));
}

function on(event, handler) {
    if (!listeners.has(event)) listeners.set(event, []);
    listeners.get(event).push(handler);
}

// --- Sync Status UI ---
function updateOnlineStatus(online) {
    const wasOnline = isConnected;
    isConnected = online;
    emit('sync:status', { online, connecting: !online && !eventSource });

    // Debug logging
    if (window.debugLog) {
        if (wasOnline && !online) {
            window.debugLog.warn('SYNC', '🔴 Verbindung getrennt (Backend nicht erreichbar?)');
        } else if (!wasOnline && online) {
            window.debugLog.success('SYNC', '🟢 Verbindung wiederhergestellt');
        } else {
            // Same state, just update
        }
    }

    // Update badge
    const badge = document.getElementById('sync-badge');
    if (badge) {
        if (!online) {
            badge.className = 'badge bg-danger ms-2';
            badge.textContent = 'Offline';
        } else if (operationQueue.length > 0) {
            badge.className = 'badge bg-warning ms-2';
            badge.textContent = `Sync: ${operationQueue.length}`;
        } else {
            badge.className = 'badge bg-success ms-2';
            badge.textContent = 'Online';
        }
    }

    // Status-Änderungen nur im Log, keine Toasts
    if (!online) {
        if (window.debugLog) window.debugLog.warn('SYNC', 'Verbindung getrennt. Änderungen werden lokal gespeichert.');
    } else if (eventSource) {
        if (window.debugLog) window.debugLog.info('SYNC', 'Wieder online. Synchronisiere...');
    }
}

// --- Operation Queue ---
function queueOperation(entity, operation, data, entityId) {
    const op = {
        op_id: crypto.randomUUID(),
        entity,
        operation,
        entity_id: entityId,
        data: { ...data, _client_updated_at: new Date().toISOString() },
        timestamp: Date.now(),
    };
    operationQueue.push(op);
    emit('sync:queue-changed', { queueLength: operationQueue.length });

    // Debug logging
    if (window.debugLog) {
        window.debugLog.info('SYNC', 'Queue: ' + operation + ' ' + entity + ' (id: ' + (entityId || 'n/a') + ') [' + operationQueue.length + ' in Warteschlange]');
    }

    // Try to sync immediately if online
    if (isConnected && !isSyncing) {
        flushQueue();
    }

    return op;
}

async function flushQueue() {
    if (isSyncing || operationQueue.length === 0 || !isConnected) return;

    isSyncing = true;
    emit('sync:flush-started', {});

    const batch = operationQueue.splice(0, 50); // Process in batches

    // Debug logging
    if (window.debugLog) {
        window.debugLog.info('SYNC', '🔄 Sende ' + batch.length + ' Operationen an Server...');
    }

    try {
        const operations = batch.map(op => ({
            op_id: op.op_id,
            entity: op.entity,
            operation: op.operation,
            entity_id: op.entity_id,
            data: op.data,
        }));

        const auth = await db.getAuth();
        const token = auth?.token;

        if (!token) {
            // Put operations back if no token
            operationQueue.unshift(...batch);
            if (window.debugLog) {
                window.debugLog.error('SYNC', 'Kein Auth-Token');
            }
            return;
        }

        const response = await fetch(`${CONFIG.API_BASE}/sync/operations`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ operations }),
        });

        if (!response.ok) {
            throw new Error(`Sync failed: ${response.status}`);
        }

        const result = await response.json();

        // Handle conflicts
        result.results.forEach((resultItem) => {
            if (resultItem.status === 'conflict') {
                emit('sync:conflict', {
                    entity: resultItem.entity,
                    entityId: resultItem.entity_id,
                    serverData: resultItem.server_data,
                    clientData: batch.find(b => b.op_id === resultItem.op_id)?.data,
                });
            }
        });

        if (window.debugLog) {
            window.debugLog.success('SYNC', '✅ ' + batch.length + ' Operationen erfolgreich synchronisiert');
        }
        emit('sync:flush-complete', { processed: batch.length });
    } catch (error) {
        if (window.debugLog) {
            window.debugLog.error('SYNC', '❌ Sync fehlgeschlagen: ' + error.message + ' - Operationen zurück in Warteschlange');
        }
        console.error('Queue flush failed:', error);
        // Put operations back in queue
        operationQueue.unshift(...batch);
        emit('sync:flush-error', { error: error.message });
    } finally {
        isSyncing = false;
        emit('sync:status', { online: isConnected, queueLength: operationQueue.length });

        // Try to sync again if there are more operations
        if (operationQueue.length > 0) {
            setTimeout(flushQueue, 2000);
        }
    }
}

// --- SSE Connection ---
function connectSSE() {
    if (eventSource) {
        eventSource.close();
    }

    const auth = db.getAuth();
    if (!auth?.token) {
        console.warn('No auth token for SSE');
        if (window.debugLog) window.debugLog.warn('SSE', 'Kein Auth-Token vorhanden');
        return;
    }

    const token = auth.token;
    const sseUrl = `${CONFIG.API_BASE}/sync/stream?token=${encodeURIComponent(token)}`;

    if (window.debugLog) {
        window.debugLog.info('SSE', '🔗 Verbinde zu SSE-Stream: ' + sseUrl.substring(0, 60) + '...');
    }
    eventSource = new EventSource(sseUrl);

    eventSource.onopen = () => {
        if (window.debugLog) window.debugLog.success('SSE', '✅ SSE-Stream verbunden');
        updateOnlineStatus(true);
    };

    eventSource.addEventListener('sync_update', (event) => {
        try {
            const data = JSON.parse(event.data);
            handleSSEChange(data);
        } catch (error) {
            console.error('Failed to parse SSE event:', error);
            if (window.debugLog) window.debugLog.error('SSE', 'Fehler beim Parsen: ' + error.message);
        }
    });

    eventSource.onerror = (error) => {
        console.error('SSE connection error:', error);
        if (window.debugLog) window.debugLog.error('SSE', '❌ SSE-Verbindungsfehler');
        updateOnlineStatus(false);
        eventSource.close();
        eventSource = null;

        // Reconnect after delay (EventSource does this automatically, but we handle UI)
        setTimeout(() => {
            if (!isConnected) {
                if (window.debugLog) window.debugLog.info('SSE', '🔄 Versuche SSE-Neuverbindung...');
                connectSSE();
            }
        }, 5000);
    };
}

function handleSSEChange(data) {
    const { entity, operation, entity_id, data: changeData } = data;
    if (window.debugLog) window.debugLog.info('SSE', '📨 ' + operation + ' ' + entity + ' (id: ' + entity_id + ')');

    // Update local database immediately
    handleLocalChange(entity, operation, entity_id, changeData);

    emit('sync:push-update', { entity, operation, entity_id });
}

async function handleLocalChange(entity, operation, entityId, changeData) {
    try {
        switch (entity) {
            case 'areas':
                if (operation === 'delete') {
                    await db.deleteArea(entityId);
                } else if (changeData) {
                    const existing = await db.getArea(entityId);
                    if (existing) {
                        await db.saveArea({ ...existing, ...changeData, updated_at: changeData.updated_at || existing.updated_at });
                    } else {
                        // New area from another client
                        await db.saveArea(changeData);
                    }
                }
                break;

            case 'products':
                if (operation === 'delete') {
                    await db.deleteProduct(entityId);
                } else if (changeData) {
                    const existing = await db.get(db.STORES.PRODUCTS, entityId);
                    if (existing) {
                        await db.put(db.STORES.PRODUCTS, { ...existing, ...changeData, updated_at: changeData.updated_at || existing.updated_at });
                    } else {
                        await db.put(db.STORES.PRODUCTS, changeData);
                    }
                }
                break;

            case 'items':
                if (operation === 'delete') {
                    await db.deleteItem(entityId);
                } else if (changeData) {
                    const existing = await db.get(db.STORES.ITEMS, entityId);
                    if (existing) {
                        await db.put(db.STORES.ITEMS, { ...existing, ...changeData, updated_at: changeData.updated_at || existing.updated_at });
                    } else {
                        await db.put(db.STORES.ITEMS, changeData);
                    }
                }
                break;

            case 'trips':
                if (changeData) {
                    const existing = await db.getTrip(entityId);
                    if (existing) {
                        await db.saveTrip({ ...existing, ...changeData, updated_at: changeData.updated_at || existing.updated_at });
                    } else {
                        await db.saveTrip(changeData);
                    }
                }
                break;
        }

        // Refresh UI if on relevant page
        emit('sync:ui-refresh', { entity });
    } catch (error) {
        console.error('Error handling local change:', error);
    }
}

// --- Polling Sync (fallback when SSE not available) ---
async function pollForChanges() {
    if (!isConnected) return;

    const auth = await db.getAuth();
    if (!auth?.token) return;

    try {
        const params = new URLSearchParams();
        if (lastSyncTimestamp) {
            params.set('since', lastSyncTimestamp);
        }

        const response = await fetch(`${CONFIG.API_BASE}/sync/changes?${params}`, {
            headers: {
                'Authorization': `Bearer ${auth.token}`,
            },
        });

        if (!response.ok) return;

        const data = await response.json();

        // Update local database with server changes
        await applyServerChanges(data);

        lastSyncTimestamp = new Date().toISOString();
    } catch (error) {
        console.error('Polling failed:', error);
    }
}

async function applyServerChanges(data) {
    // Apply areas
    if (data.areas?.length > 0) {
        await db.bulkPut(db.STORES.AREAS, data.areas);
    }

    // Apply products
    if (data.products?.length > 0) {
        await db.bulkPut(db.STORES.PRODUCTS, data.products);
    }

    // Apply trips
    if (data.trips?.length > 0) {
        await db.bulkPut(db.STORES.TRIPS, data.trips);
    }

    // Apply items
    if (data.items?.length > 0) {
        await db.bulkPut(db.STORES.ITEMS, data.items);
    }

    emit('sync:poll-complete', {
        areas: data.areas?.length || 0,
        products: data.products?.length || 0,
        trips: data.trips?.length || 0,
        items: data.items?.length || 0,
    });
}

// --- Full Sync ---
async function fullSync() {
    if (!isConnected) {
        if (window.debugLog) window.debugLog.warn('SYNC', '⏸ FullSync abgelehnt - nicht verbunden');
        emit('sync:error', { message: 'Nicht verbunden' });
        return;
    }

    if (window.debugLog) window.debugLog.info('SYNC', '🔄 FullSync gestartet...');
    emit('sync:started', {});

    try {
        // First, flush local queue
        await flushQueue();

        // Then, pull server changes
        await pollForChanges();

        if (window.debugLog) window.debugLog.success('SYNC', '✅ FullSync abgeschlossen');
        emit('sync:complete', {});
    } catch (error) {
        if (window.debugLog) window.debugLog.error('SYNC', '❌ FullSync fehlgeschlagen: ' + error.message);
        console.error('Full sync failed:', error);
        emit('sync:error', { message: `Sync fehlgeschlagen: ${error.message}` });
    }
}

// --- Initialization ---
async function initSync() {
    if (window.debugLog) window.debugLog.info('SYNC', '🚀 Synchronisation wird initialisiert...');

    await db.open();

    // Listen for online/offline events (from cache-layer)
    window.addEventListener('online', () => {
        if (window.debugLog) window.debugLog.info('SYNC', '🌐 System-Event: online');
        updateOnlineStatus(true);
        if (!eventSource) connectSSE();
        fullSync();
    });

    window.addEventListener('offline', () => {
        if (window.debugLog) window.debugLog.info('SYNC', '📴 System-Event: offline');
        updateOnlineStatus(false);
        if (eventSource) {
            eventSource.close();
            eventSource = null;
        }
    });

    // Expose sync API globally
    window.sync = {
        queueOperation,
        fullSync,
        flushQueue,
        on,
        updateBadge(online) {
            updateOnlineStatus(online);
        },
        get isConnected() { return isConnected; },
        get queueLength() { return operationQueue.length; },
        // Expose pending operations for a specific entity (for offline-first rendering)
        getPendingOperations(entity) {
            return operationQueue.filter(op => op.entity === entity);
        },
        // Get the last pending operation for an entity ID
        getPendingOperationForEntity(entity, entityId) {
            return operationQueue.find(op => op.entity === entity && op.entity_id === entityId);
        },
    };

    // Initial sync
    if (navigator.onLine) {
        if (window.debugLog) window.debugLog.success('SYNC', 'System initial: Online');
        updateOnlineStatus(true);
        connectSSE();

        // Initial poll
        await pollForChanges();

        // Start periodic polling as backup
        setInterval(pollForChanges, 60000); // Every minute
    } else {
        if (window.debugLog) window.debugLog.warn('SYNC', 'System initial: Offline');
        updateOnlineStatus(false);
    }

    if (window.debugLog) window.debugLog.success('SYNC', '✅ Synchronisation initialisiert');
}

// Start sync engine
initSync().catch(console.error);
