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

async function cacheApiResponse(url, data) {
    try {
        const auth = await db.getAuth();
        if (!auth?.account_id) return;

        const now = new Date().toISOString();

        if (url.includes('/areas') && !url.includes('with-products') && Array.isArray(data)) {
            for (const area of data) {
                await db.saveArea({ ...area, account_id: auth.account_id, updated_at: now });
            }
        }

        if (url.includes('/products') && Array.isArray(data)) {
            for (const product of data) {
                await db.saveProduct({ ...product, account_id: auth.account_id, updated_at: now });
            }
        }

        if (url.includes('/trips') && !url.includes('/archive') && Array.isArray(data)) {
            for (const trip of data) {
                await db.saveTrip({ ...trip, account_id: auth.account_id, updated_at: now });
            }
        }

        if (url.includes('/items/trip/') && Array.isArray(data)) {
            const tripId = url.match(/\/items\/trip\/(\d+)/)?.[1];
            if (tripId) {
                for (const item of data) {
                    await db.saveItem({
                        ...item,
                        trip_id: parseInt(tripId),
                        account_id: auth.account_id,
                        updated_at: now,
                    });
                }
            }
        }

        if (url.includes('/trips/') && !url.includes('/archive') && !url.includes('/archived') && typeof data === 'object' && data.id) {
            await db.saveTrip({ ...data, account_id: auth.account_id, updated_at: now });
        }

        if (url.match(/\/areas\/\d+$/) && typeof data === 'object' && data.id) {
            await db.saveArea({ ...data, account_id: auth.account_id, updated_at: now });
        }

        if (url.match(/\/products\/\d+$/) && typeof data === 'object' && data.id) {
            await db.saveProduct({ ...data, account_id: auth.account_id, updated_at: now });
        }

        if (url.match(/\/items\/\d+$/) && typeof data === 'object' && data.id) {
            await db.saveItem({ ...data, account_id: auth.account_id, updated_at: now });
        }

    } catch (err) {
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
            return await db.getAllAreas();
        }

        if (endpoint === '/products') {
            return await db.getAllProducts();
        }

        if (endpoint.includes('/items/trip/')) {
            const tripId = endpoint.match(/\/items\/trip\/(\d+)/)?.[1];
            if (tripId) {
                return await db.getItemsByTrip(parseInt(tripId));
            }
        }

        if (endpoint === '/trips') {
            return await db.getAllTrips();
        }

        if (endpoint.includes('/trips?archived=true')) {
            const allTrips = await db.getAllTrips();
            return allTrips.filter(t => t.is_archived);
        }

        return [];
    } catch (err) {
        console.error('Cache load failed:', err);
        return [];
    }
}

// --- Patch functions after all modules are loaded ---
function applyPatches() {
    // --- Intercept apiRequest for offline fallback ---
    const originalApiRequest = window.apiRequest;

    if (originalApiRequest) {
        window.apiRequest = async function(endpoint, method = 'GET', body = null) {
            try {
                return await originalApiRequest(endpoint, method, body);
            } catch (error) {
                console.warn(`API request failed (${endpoint}):`, error.message);
                onApiFailure();

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
                    return null;
                }

                // GET operations: fallback to cache silently
                showOfflineBanner();
                const cached = await loadFromCache(endpoint);
                return cached;
            }
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

    if (window.loadCurrentTrip) {
        const origLoadCurrentTrip = window.loadCurrentTrip;
        window.loadCurrentTrip = async function() {
            try {
                return await origLoadCurrentTrip();
            } catch (err) {
                console.error('loadCurrentTrip failed, using cache:', err);
                if (!currentTripId) return;
                try {
                    const items = await loadFromCache(`/items/trip/${currentTripId}`);
                    const container = document.getElementById('current-trip-items');
                    if (!container) return;
                    container.innerHTML = '';

                    const groupedByArea = {};
                    const uncategorizedItems = [];

                    items.forEach(item => {
                        if (item.area_id) {
                            if (!groupedByArea[item.area_id]) groupedByArea[item.area_id] = [];
                            groupedByArea[item.area_id].push(item);
                        } else {
                            uncategorizedItems.push(item);
                        }
                    });

                    areas.forEach(area => {
                        const areaItems = groupedByArea[area.id] || [];
                        if (areaItems.length > 0) {
                            const areaSection = document.createElement('div');
                            areaSection.className = 'mb-4';
                            areaSection.innerHTML = `
                                <h5 class="border-bottom pb-2 mb-3">${area.name}</h5>
                                ${areaItems.map(item => createItemHTML(item)).join('')}
                            `;
                            container.appendChild(areaSection);
                        }
                    });

                    if (uncategorizedItems.length > 0) {
                        const otherSection = document.createElement('div');
                        otherSection.className = 'mb-4';
                        otherSection.innerHTML = `
                            <h5 class="border-bottom pb-2 mb-3">Sonstige</h5>
                            ${uncategorizedItems.map(item => createItemHTML(item)).join('')}
                        `;
                        container.appendChild(otherSection);
                    }

                    if (items.length === 0) {
                        container.innerHTML = '<p class="text-muted">Noch keine Produkte ausgewählt.</p>';
                    }
                } catch (cacheErr) {
                    console.error('Cache fallback failed:', cacheErr);
                }
            }
        };
    }

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
                        alert('Keine Sitzung im Cache. Bitte online anmelden.');
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

                    localStorage.removeItem('selected_trip_products');
                    showPage('current-trip');
                    if (window.sync) {
                        window.sync.fullSync();
                    }
                    return;
                } catch (err) {
                    console.error('Offline trip creation failed:', err);
                    alert('Fehler beim Erstellen des Trips im Offline-Modus: ' + err.message);
                    return;
                }
            }

            // Online: use original function
            return await origGenerateTrip();
        };
    }
}

// Apply patches immediately - all modules are already imported
applyPatches();

// --- State restoration ---
async function loadCachedData() {
    try {
        await db.open();
        const auth = await db.getAuth();
        if (!auth) return {};

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
    const cached = await loadCachedData();

    const auth = await db.getAuth();
    if (auth?.token) {
        window.authToken = auth.token;
        localStorage.setItem('authToken', auth.token);
    }

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
};

// Auto-initialize
db.open().then(() => {
    restoreState().catch(console.error);
}).catch(console.error);
