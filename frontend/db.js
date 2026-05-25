/**
 * IndexedDB wrapper for offline-first shopping list app.
 * Provides simple CRUD operations and change tracking.
 */

const DB_NAME = 'EinkaufslisteDB';
const DB_VERSION = 1;

const STORES = {
    AUTH: 'auth',
    AREAS: 'areas',
    PRODUCTS: 'products',
    TRIPS: 'trips',
    ITEMS: 'items',
};

/**
 * Open or create the IndexedDB database with all required object stores.
 */
function openDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error || new Error('Failed to open database'));
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = event.target.result;

            // Auth store: keyPath = 'id', single entry
            if (!db.objectStoreNames.contains(STORES.AUTH)) {
                const authStore = db.createObjectStore(STORES.AUTH, { keyPath: 'id' });
                authStore.createIndex('account_id', 'account_id', { unique: false });
            }

            // Areas store
            if (!db.objectStoreNames.contains(STORES.AREAS)) {
                const areasStore = db.createObjectStore(STORES.AREAS, { keyPath: 'id' });
                areasStore.createIndex('account_id', 'account_id', { unique: false });
                areasStore.createIndex('updated_at', 'updated_at', { unique: false });
            }

            // Products store
            if (!db.objectStoreNames.contains(STORES.PRODUCTS)) {
                const productsStore = db.createObjectStore(STORES.PRODUCTS, { keyPath: 'id' });
                productsStore.createIndex('account_id', 'account_id', { unique: false });
                productsStore.createIndex('area_id', 'area_id', { unique: false });
                productsStore.createIndex('updated_at', 'updated_at', { unique: false });
            }

            // Trips store
            if (!db.objectStoreNames.contains(STORES.TRIPS)) {
                const tripsStore = db.createObjectStore(STORES.TRIPS, { keyPath: 'id' });
                tripsStore.createIndex('account_id', 'account_id', { unique: false });
                tripsStore.createIndex('updated_at', 'updated_at', { unique: false });
            }

            // Items store
            if (!db.objectStoreNames.contains(STORES.ITEMS)) {
                const itemsStore = db.createObjectStore(STORES.ITEMS, { keyPath: 'id' });
                itemsStore.createIndex('account_id', 'account_id', { unique: false });
                itemsStore.createIndex('trip_id', 'trip_id', { unique: false });
                itemsStore.createIndex('updated_at', 'updated_at', { unique: false });
            }
        };
    });
}

/**
 * Generic CRUD helpers for any store.
 */
const db = {
    STORES,

    async open() {
        this._db = await openDB();
        return this._db;
    },

    async get(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async getAll(storeName, indexName, value) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const target = indexName ? store.index(indexName).getAll(IDBKeyRange.only(value)) : store.getAll();
            target.onsuccess = () => resolve(target.result);
            target.onerror = () => reject(target.error);
        });
    },

    async put(storeName, data) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.put(data);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async delete(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.delete(id);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    async clear(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const request = store.clear();
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    },

    // --- Auth helpers ---
    async saveAuth(authData) {
        return this.put(STORES.AUTH, { id: 'session', ...authData });
    },

    async getAuth() {
        return this.get(STORES.AUTH, 'session');
    },

    async clearAuth() {
        return this.delete(STORES.AUTH, 'session');
    },

    // --- Area helpers ---
    async saveArea(area) {
        return this.put(STORES.AREAS, area);
    },

    async getAllAreas() {
        let auth = await this.getAuth();
        // Fallback: wenn keine Auth in IndexedDB, prüfe localStorage
        if (!auth?.account_id) {
            const localToken = localStorage.getItem('authToken');
            if (!localToken) return [];
            const storedAuth = localStorage.getItem('_auth_account_id');
            if (storedAuth) {
                auth = { account_id: parseInt(storedAuth) };
            } else {
                return [];
            }
        }
        return this.getAll(STORES.AREAS, 'account_id', auth.account_id);
    },

    async deleteArea(id) {
        return this.delete(STORES.AREAS, id);
    },

    // --- Product helpers ---
    async saveProduct(product) {
        return this.put(STORES.PRODUCTS, product);
    },

    async getProductsByArea(areaId) {
        let auth = await this.getAuth();
        // Fallback: wenn keine Auth in IndexedDB, prüfe localStorage
        if (!auth?.account_id) {
            const localToken = localStorage.getItem('authToken');
            if (!localToken) return [];
            const storedAuth = localStorage.getItem('_auth_account_id');
            if (storedAuth) {
                auth = { account_id: parseInt(storedAuth) };
            } else {
                return [];
            }
        }
        return this.getAll(STORES.PRODUCTS, 'area_id', areaId);
    },

    async getAllProducts() {
        let auth = await this.getAuth();
        // Fallback: wenn keine Auth in IndexedDB, prüfe localStorage
        if (!auth?.account_id) {
            const localToken = localStorage.getItem('authToken');
            if (!localToken) return [];
            const storedAuth = localStorage.getItem('_auth_account_id');
            if (storedAuth) {
                auth = { account_id: parseInt(storedAuth) };
            } else {
                return [];
            }
        }
        return this.getAll(STORES.PRODUCTS, 'account_id', auth.account_id);
    },

    async deleteProduct(id) {
        return this.delete(STORES.PRODUCTS, id);
    },

    // --- Trip helpers ---
    async saveTrip(trip) {
        return this.put(STORES.TRIPS, trip);
    },

    async getAllTrips() {
        // Hole account_id für Filterung
        let account_id = null;
        let auth = await this.getAuth();
        if (auth?.account_id) {
            account_id = auth.account_id;
        } else {
            // Fallback: wenn keine Auth in IndexedDB, prüfe localStorage
            const localToken = localStorage.getItem('authToken');
            if (!localToken) return [];
            // Hole account_id aus localStorage wenn vorhanden
            const storedAuth = localStorage.getItem('_auth_account_id');
            if (storedAuth) {
                account_id = parseInt(storedAuth);
            }
        }
        // Wenn account_id bekannt ist, filtere danach; sonst hole ALLE Trips
        const trips = account_id
            ? await this.getAll(STORES.TRIPS, 'account_id', account_id)
            : await this.getAll(STORES.TRIPS);
        return trips.sort((a, b) => {
            // Active trips first, then archived
            if (a.is_archived !== b.is_archived) return a.is_archived ? 1 : -1;
            // Then by creation date (newest first)
            const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
            const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
            return dateB - dateA;
        });
    },

    async getActiveTrips() {
        const all = await this.getAllTrips();
        return all.filter(t => !t.is_archived);
    },

    deleteTrip(id) {
        return this.delete(STORES.TRIPS, id);
    },

    // --- Item helpers ---
    async saveItem(item) {
        return this.put(STORES.ITEMS, item);
    },

    async getItemsByTrip(tripId) {
        let auth = await this.getAuth();
        // Fallback: wenn keine Auth in IndexedDB, prüfe localStorage
        if (!auth?.account_id) {
            const localToken = localStorage.getItem('authToken');
            if (!localToken) return [];
            const storedAuth = localStorage.getItem('_auth_account_id');
            if (storedAuth) {
                auth = { account_id: parseInt(storedAuth) };
            } else {
                return [];
            }
        }
        const allItems = await this.getAll(STORES.ITEMS, 'trip_id', tripId);
        // Sortierung nach sort_order (Erstellungsreihenfolge) – erfolgt jetzt in renderItems()
        return allItems;
    },

    async getAllItems() {
        let auth = await this.getAuth();
        // Fallback: wenn keine Auth in IndexedDB, prüfe localStorage
        if (!auth?.account_id) {
            const localToken = localStorage.getItem('authToken');
            if (!localToken) return [];
            const storedAuth = localStorage.getItem('_auth_account_id');
            if (storedAuth) {
                auth = { account_id: parseInt(storedAuth) };
            } else {
                return [];
            }
        }
        return this.getAll(STORES.ITEMS, 'account_id', auth.account_id);
    },

    async deleteItem(id) {
        return this.delete(STORES.ITEMS, id);
    },

    // --- Bulk operations ---
    async bulkPut(storeName, items) {
        return new Promise((resolve, reject) => {
            const tx = this._db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            items.forEach(item => store.put(item));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    },

    async clearAll() {
        await this.clear(STORES.AREAS);
        await this.clear(STORES.PRODUCTS);
        await this.clear(STORES.TRIPS);
        await this.clear(STORES.ITEMS);
    },
};

// Initialize on load
db.open().catch(err => console.error('IndexedDB initialization failed:', err));

export default db;
