/**
 * Local-first data layer for app.js.
 * Intercepts CRUD operations to use IndexedDB + sync queue.
 */

import db from './db.js';

// --- Cached state (mirrors app.js globals) ---
let state = {
    areas: [],
    products: [],
    trips: [],
    currentTripId: null,
};

// --- Load all master data from IndexedDB ---
async function loadLocalAreas() {
    state.areas = await db.getAllAreas();
    return state.areas;
}

async function loadLocalProducts() {
    state.products = await db.getAllProducts();
    return state.products;
}

async function loadLocalTrips() {
    state.trips = await db.getAllTrips();
    return state.trips;
}

async function loadLocalItems(tripId) {
    return await db.getItemsByTrip(tripId);
}

async function loadLocalCurrentTripId() {
    const trips = await loadLocalTrips();
    const active = trips.find(t => !t.is_archived);
    state.currentTripId = active ? active.id : null;
    return state.currentTripId;
}

// --- Save data to IndexedDB (called after API operations) ---
async function saveAreaToDB(areaData) {
    const area = {
        id: areaData.id,
        name: areaData.name,
        account_id: areaData.account_id,
        updated_at: areaData.updated_at || new Date().toISOString(),
    };
    await db.saveArea(area);
    state.areas = await loadLocalAreas();
    return area;
}

async function saveProductToDB(productData) {
    const product = {
        id: productData.id,
        name: productData.name,
        area_id: productData.area_id,
        account_id: productData.account_id,
        updated_at: productData.updated_at || new Date().toISOString(),
    };
    await db.saveProduct(product);
    state.products = await loadLocalProducts();
    return product;
}

async function saveTripToDB(tripData) {
    const trip = {
        id: tripData.id,
        name: tripData.name,
        account_id: tripData.account_id,
        created_at: tripData.created_at,
        is_archived: tripData.is_archived || false,
        updated_at: tripData.updated_at || new Date().toISOString(),
    };
    await db.saveTrip(trip);
    state.trips = await loadLocalTrips();
    return trip;
}

async function saveItemToDB(itemData) {
    const item = {
        id: itemData.id,
        trip_id: itemData.trip_id,
        name: itemData.name,
        is_checked: itemData.is_checked || false,
        product_id: itemData.product_id || null,
        area_id: itemData.area_id || null,
        account_id: itemData.account_id,
        updated_at: itemData.updated_at || new Date().toISOString(),
    };
    await db.saveItem(item);
    return item;
}

// --- Sync-aware CRUD wrappers ---

// These functions wrap the existing app.js CRUD calls to:
// 1. Write to IndexedDB immediately (optimistic UI)
// 2. Queue operation for server sync
// 3. Call original API for persistence
// 4. Update local state on success

async function createArea(name) {
    // Optimistic update
    const tempArea = {
        id: Date.now(), // Temporary ID
        name,
        updated_at: new Date().toISOString(),
    };
    state.areas.push(tempArea);
    renderAreasList(state.areas);

    // Queue for sync
    if (window.sync) {
        window.sync.queueOperation('areas', 'create', { name }, tempArea.id);
    }

    // Sync with server
    try {
        const response = await fetch(`${window.APP_CONFIG.API_BASE_URL}/areas`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.authToken}`,
            },
            body: JSON.stringify({ name }),
        });
        if (!response.ok) throw new Error('API Error');
        const savedArea = await response.json();
        await saveAreaToDB(savedArea);
    } catch (err) {
        console.error('Failed to sync area:', err);
        showAlert('Fehler beim Erstellen des Bereichs: ' + err.message);
        await loadLocalAreas(); // Reload from server
    }
}

async function updateArea(id, name) {
    // Optimistic update
    const area = state.areas.find(a => a.id === id);
    if (area) {
        area.name = name;
        area.updated_at = new Date().toISOString();
        renderAreasList(state.areas);
    }

    // Queue for sync
    if (window.sync) {
        window.sync.queueOperation('areas', 'patch', { name }, id);
    }

    // Sync with server
    try {
        await fetch(`${window.APP_CONFIG.API_BASE_URL}/areas/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${window.authToken}`,
            },
            body: JSON.stringify({ name }),
        });
        await saveAreaToDB({ id, name, updated_at: area.updated_at });
    } catch (err) {
        console.error('Failed to update area:', err);
        showAlert('Fehler beim Aktualisieren des Bereichs: ' + err.message);
        await loadLocalAreas();
    }
}

async function deleteArea(id) {
    if (!confirm('Bereich wirklich löschen?')) return;

    // Optimistic delete
    state.areas = state.areas.filter(a => a.id !== id);
    renderAreasList(state.areas);

    // Queue for sync
    if (window.sync) {
        window.sync.queueOperation('areas', 'delete', null, id);
    }

    // Sync with server
    try {
        await fetch(`${window.APP_CONFIG.API_BASE_URL}/areas/${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${window.authToken}`,
            },
        });
        await db.deleteArea(id);
    } catch (err) {
        console.error('Failed to delete area:', err);
        showAlert('Fehler beim Löschen des Bereichs: ' + err.message);
        await loadLocalAreas();
    }
}

// --- Expose for app.js ---
window.localData = {
    state,
    loadLocalAreas,
    loadLocalProducts,
    loadLocalTrips,
    loadLocalItems,
    loadLocalCurrentTripId,
    saveAreaToDB,
    saveProductToDB,
    saveTripToDB,
    saveItemToDB,
    createArea,
    updateArea,
    deleteArea,
};
