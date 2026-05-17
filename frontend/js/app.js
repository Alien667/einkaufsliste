const API_BASE_URL = './proxy.php';
//const API_BASE_URL = 'http://localhost:8000';

// State management
let currentTripId = null;
let areas = [];
let products = [];
let trips = [];
let authToken = localStorage.getItem('authToken');
let isSuperuser = localStorage.getItem('isSuperuser') === 'true';

// Bootstrap Modals
let areaModal, productModal, spontaneousModal, accountModal;

document.addEventListener('DOMContentLoaded', () => {
    areaModal = new bootstrap.Modal(document.getElementById('areaModal'));
    productModal = new bootstrap.Modal(document.getElementById('productModal'));
    spontaneousModal = new bootstrap.Modal(document.getElementById('spontaneousModal'));
    accountModal = new bootstrap.Modal(document.getElementById('accountModal'));

    initApp();
});

function initApp() {
    if (authToken) {
        showApp();
    } else {
        showAuth();
    }

    // Setup form submissions
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    const registerForm = document.getElementById('register-form');
    if (registerForm) {
        registerForm.addEventListener('submit', handleRegister);
    }
}

function showApp() {
    document.getElementById('auth-section').style.display = 'none';
    document.getElementById('main-navbar').style.display = 'block';
    document.getElementById('main-app-container').style.display = 'block';
    showPage('current-trip');
}

function showAuth() {
    document.getElementById('auth-section').style.display = 'block';
    document.getElementById('main-navbar').style.display = 'none';
    document.getElementById('main-app-container').style.display = 'none';
}

function toggleAuthMode() {
    const loginContainer = document.getElementById('login-form-container');
    const registerContainer = document.getElementById('register-form-container');
    loginContainer.classList.toggle('d-none');
    registerContainer.classList.toggle('d-none');
}

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    try {
        const formData = new FormData();
        formData.append('username', email);
        formData.append('password', password);

        const response = await fetch(`${API_BASE_URL}/login`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.detail || 'Login fehlgeschlagen');
        }

        const data = await response.json();
        authToken = data.access_token;
        localStorage.setItem('authToken', authToken);
        showApp();
    } catch (err) {
        alert(err.message);
    }
}

async function handleRegister(e) {
    e.preventDefault();
    const firstname = document.getElementById('reg-firstname').value;
    const lastname = document.getElementById('reg-lastname').value;
    const email = document.getElementById('reg-email').value;
    const password = document.getElementById('reg-password').value;

    try {
        await apiRequest('/register', 'POST', {
            first_name: firstname,
            last_name: lastname,
            email: email,
            password: password
        });
        alert('Registrierung erfolgreich! Bitte jetzt anmelden.');
        toggleAuthMode();
    } catch (err) {
        alert('Registrierung fehlgeschlagen: ' + err.message);
    }
}

function logout() {
    authToken = null;
    localStorage.removeItem('authToken');
    location.reload();
}

// --- Navigation ---

function showPage(pageId) {
    document.querySelectorAll('.page-section').forEach(section => {
        section.classList.add('d-none');
    });

    const section = document.getElementById(pageId);
    if (section) {
        section.classList.remove('d-none');
    }

    // Update navigation highlighting
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active-page');
        if (link.dataset.pageId === pageId) {
            link.classList.add('active-page');
        }
    });

    switch(pageId) {
        case 'config-areas':
            loadAreas();
            break;
        case 'config-products':
            loadProductsAndAreas();
            break;
        case 'create-trip':
            prepareTripCreation();
            break;
        case 'current-trip':
            loadCurrentTrip();
            break;
        case 'trip-history':
            loadTripHistory();
            break;
    }
}

// --- API Helpers ---

async function apiRequest(endpoint, method = 'GET', body = null) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        }
    };

    if (authToken) {
        options.headers['Authorization'] = `Bearer ${authToken}`;
    }

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);
        if (!response.ok) {
            const errorData = await response.json();
            // If unauthorized, clear token and redirect to login
            if (response.status === 401) {
                authToken = null;
                localStorage.removeItem('authToken');
                showAuth();
                throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
            }
            throw new Error(errorData.detail || 'API Error');
        }
        return await response.json();
    } catch (error) {
        console.error(`API Request Error (${endpoint}):`, error);
        throw error;
    }
}

// --- Page 1: Areas ---

async function loadAreas() {
    try {
        areas = await apiRequest('/areas');
        const list = document.getElementById('areas-list');
        list.innerHTML = '';
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

        // Initialize SortableJS
        new Sortable(list, {
            animation: 150,
            onEnd: async () => {
                const newOrder = Array.from(list.children).map(el => parseInt(el.getAttribute('data-id')));
                try {
                    await apiRequest('/areas/reorder', 'PATCH', { area_ids: newOrder });
                } catch (err) {
                    alert('Fehler beim Speichern der neuen Reihenfolge.');
                    loadAreas(); // Reload to revert
                }
            }
        });
    } catch (err) {
        alert('Fehler beim Laden der Bereiche.');
    }
}

async function startEditArea(id, iconElement) {
    const container = iconElement.parentElement;
    const nameSpan = container.querySelector('.area-name');
    const oldName = nameSpan.innerText;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control edit-input';
    input.value = oldName;

    container.innerHTML = `
        <input type="text" class="form-control edit-input" value="${oldName}">
        <span class="edit-icon" onclick="cancelEditArea(${id}, this, '${oldName}')">&#10006;</span>
    `;
    const inputEl = container.querySelector('input');
    inputEl.focus();

    const save = async () => {
        const newName = inputEl.value.trim();
        if (newName && newName !== oldName) {
            try {
                await apiRequest(`/areas/${id}`, 'PUT', { name: newName });
                loadAreas();
            } catch (err) {
                alert('Fehler beim Speichern.');
                loadAreas();
            }
        } else {
            loadAreas();
        }
    };

    inputEl.addEventListener('blur', save);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') loadAreas();
    });
}

async function cancelEditArea(id, iconElement, oldName) {
    loadAreas();
}

function openAreaModal() {
    document.getElementById('areaNameInput').value = '';
    areaModal.show();
}

async function saveArea() {
    const name = document.getElementById('areaNameInput').value.trim();
    if (!name) return;
    try {
        await apiRequest('/areas', 'POST', { name });
        areaModal.hide();
        loadAreas();
    } catch (err) {
        alert('Bereich konnte nicht erstellt werden.');
    }
}

async function deleteArea(id) {
    if (!confirm('Bereich wirklich löschen? Alle zugeordneten Waren gehen verloren.')) return;
    try {
        await apiRequest(`/areas/${id}`, 'DELETE');
        loadAreas();
    } catch (err) {
        alert('Bereich konnte nicht gelöscht werden.');
    }
}

// --- Page 2: Products ---

async function loadProductsAndAreas() {
    try {
        const [fetchedAreas, fetchedProducts] = await Promise.all([
            apiRequest('/areas'),
            apiRequest('/products')
        ]);
        areas = fetchedAreas;
        products = fetchedProducts;

        renderProductsList();
        updateProductAreaSelect();
    } catch (err) {
        alert('Fehler beim Laden der Waren/Bereiche.');
    }
}

function renderProductsList() {
    const list = document.getElementById('products-list');
    list.innerHTML = '';

    const grouped = {};
    areas.forEach(area => grouped[area.id] = []);
    products.forEach(product => {
        if (grouped[product.area_id]) {
            grouped[product.area_id].push(product);
        }
    });

    areas.forEach(area => {
        const areaProducts = grouped[area.id];

        const areaHeader = document.createElement('div');
        areaHeader.className = 'fw-bold mt-3 mb-1 text-primary';
        areaHeader.innerText = area.name;
        list.appendChild(areaHeader);

        areaProducts.forEach(product => {
            const item = document.createElement('div');
            item.className = 'list-group-item d-flex justify-content-between align-items-center';
            item.innerHTML = `
                <div class="d-flex align-items-center flex-grow-1">
                    <span class="product-name">${product.name}</span>
                    <span class="edit-icon" onclick="startEditProduct(${product.id}, this)">&#9998;</span>
                </div>
                <button class="btn btn-sm btn-outline-danger" onclick="deleteProduct(${product.id})">Löschen</button>
            `;
            list.appendChild(item);
        });
    });
}

async function startEditProduct(id, iconElement) {
    const container = iconElement.parentElement;
    const nameSpan = container.querySelector('.product-name');
    const oldName = nameSpan.innerText;

    // Find the product object
    const product = products.find(p => p.id === id);
    if (!product) return;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'form-control edit-input';
    input.value = oldName;

    container.innerHTML = `
        <input type="text" class="form-control edit-input" value="${oldName}">
        <span class="edit-icon" onclick="cancelEditProduct(${id}, this, '${oldName}')">&#10006;</span>
    `;
    const inputEl = container.querySelector('input');
    inputEl.focus();

    const save = async () => {
        const newName = inputEl.value.trim();
        if (newName && newName !== oldName) {
            try {
                await apiRequest(`/products/${id}`, 'PUT', {
                    name: newName,
                    area_id: product.area_id
                });
                loadProductsAndAreas();
            } catch (err) {
                alert('Fehler beim Speichern.');
                loadProductsAndAreas();
            }
        } else {
            loadProductsAndAreas();
        }
    };

    inputEl.addEventListener('blur', save);
    inputEl.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        if (e.key === 'Escape') loadProductsAndAreas();
    });
}

async function cancelEditProduct(id, iconElement, oldName) {
    loadProductsAndAreas();
}
function updateProductAreaSelect() {
    const select = document.getElementById('productAreaSelect');
    select.innerHTML = '';
    areas.forEach(area => {
        const option = document.createElement('option');
        option.value = area.id;
        option.text = area.name;
        select.appendChild(option);
    });
}

function openProductModal() {
    document.getElementById('productNameInput').value = '';
    updateProductAreaSelect();
    productModal.show();
}

async function saveProduct() {
    const name = document.getElementById('productNameInput').value.trim();
    const area_id = parseInt(document.getElementById('productAreaSelect').value);
    if (!name || isNaN(area_id)) return;
    try {
        await apiRequest('/products', 'POST', { name, area_id });
        productModal.hide();
        loadProductsAndAreas();
    } catch (err) {
        alert('Ware konnte nicht gespeichert werden.');
    }
}

async function deleteProduct(id) {
    if (!confirm('Ware wirklich löschen?')) return;
    try {
        await apiRequest(`/products/${id}`, 'DELETE');
        loadProductsAndAreas();
    } catch (err) {
        alert('Ware konnte nicht gelöscht werden.');
    }
}

// --- Page 3: Create Trip ---

async function prepareTripCreation() {
    try {
        const [fetchedAreas, fetchedProducts] = await Promise.all([
            apiRequest('/areas'),
            apiRequest('/products')
        ]);
        areas = fetchedAreas;
        products = fetchedProducts;

        renderTripCreationForm();
    } catch (err) {
        alert('Fehler beim Vorbereiten des Einkaufs.');
    }
}

function renderTripCreationForm() {
    const productContainer = document.getElementById('selection-products');

    productContainer.innerHTML = '<h5 class="mb-3">Waren auswählen</h</h5>';

    areas.forEach(area => {
        const areaProducts = products.filter(p => p.area_id === area.id);
        if (areaProducts.length > 0) {
            const areaDiv = document.createElement('div');
            areaDiv.className = 'ms-3 mb-3';
            areaDiv.innerHTML = `<strong class="text-muted">${area.name}</strong>`;

            areaProducts.forEach(product => {
                const pDiv = document.createElement('div');
                pDiv.className = 'form-check ms-3';
                pDiv.innerHTML = `
                    <input class="form-check-input product-selector" type="checkbox" value="${product.id}" data-name="${product.name}" data-area-id="${area.id}" id="prod-sel-${product.id}">
                    <label class="form-check-label" for="prod-sel-${product.id}">${product.name}</label>
                `;
                areaDiv.appendChild(pDiv);
            });
            productContainer.appendChild(areaDiv);
        }
    });
}

async function generateTrip() {
    try {
        const newTrip = await apiRequest('/trips', 'POST');
        currentTripId = newTrip.id;

        const selectedElements = document.querySelectorAll('.product-selector:checked');

        for (const el of selectedElements) {
            const name = el.getAttribute('data-name');
            const product_id = parseInt(el.value);
            const area_id = parseInt(el.getAttribute('data-area-id'));
            await apiRequest('/items', 'POST', {
                trip_id: currentTripId,
                name: name,
                product_id: product_id,
                area_id: area_id
            });
        }

        alert('Einkaufsliste wurde erstellt!');
        showPage('current-trip');
    } catch (err) {
        alert('Fehler beim Erstellen der Einkaufsliste.');
    }
}

// --- Page 4: Current Trip ---

async function loadCurrentTrip() {
    const container = document.getElementById('active-trip-content');
    const completeBtn = document.getElementById('complete-trip-btn');

    try {
        // Find the most recent unarchived trip
        const trips = await apiRequest('/trips');
        const activeTrip = trips.find(t => !t.is_archived);

        if (!activeTrip) {
            container.innerHTML = '<div class="alert alert-info">Kein aktiver Einkauf gefunden. Erstelle einen neuen!</div>';
            completeBtn.classList.add('d-none');
            return;
        }

        currentTripId = activeTrip.id;
        completeBtn.classList.remove('d-none');

        // Re-render the dynamic parts of the container
        container.innerHTML = `
            <div class="d-flex justify-content-between align-items-center mb-3">
                <h5 class="h6">Spontane Ware hinzufügen</h5>
                <button class="btn btn-sm btn-outline-secondary" onclick="openSpontaneousProductModal()">+</button>
            </div>
            <div id="spontaneous-product-container"></div>
            <div id="active-trip-items"></div>
        `;

        const itemsContainer = document.getElementById('active-trip-items');
        const items = await apiRequest(`/items/trip/${currentTripId}`);

        // 1. Render items for each area in the order they are defined (sorted by position)
        areas.forEach(area => {
            const areaItems = items.filter(item => item.area_id === area.id);
            if (areaItems.length > 0) {
                const areaHeader = document.createElement('div');
                areaHeader.className = 'area-group-header';
                areaHeader.innerText = area.name;
                itemsContainer.appendChild(areaHeader);

                areaItems.forEach(item => {
                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'product-item-row';
                    itemDiv.innerHTML = `
                        <input class="form-check-input product-item-checkbox" type="checkbox" ${item.is_checked ? 'checked' : ''} onchange="toggleItemCheck(${item.id}, this.checked)">
                        <span class="product-item-name ${item.is_checked ? 'item-checked' : ''}">${item.name}</span>
                        <button class="btn btn-sm text-danger" onclick="deleteItem(${item.id})">&times;</button>
                    `;
                    itemsContainer.appendChild(itemDiv);
                });
            }
        });

        // 2. Render "Sonstiges" items (those without an area_id) at the end
        const unknownItems = items.filter(item => !item.area_id);
        if (unknownItems.length > 0) {
            const areaHeader = document.createElement('div');
            areaHeader.className = 'area-group-header';
            areaHeader.innerText = 'Sonstiges';
            itemsContainer.appendChild(areaHeader);

            unknownItems.forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'product-item-row';
                itemDiv.innerHTML = `
                    <input class="form-check-input product-item-checkbox" type="checkbox" ${item.is_checked ? 'checked' : ''} onchange="toggleItemCheck(${item.id}, this.checked)">
                    <span class="product-item-name ${item.is_checked ? 'item-checked' : ''}">${item.name}</span>
                    <button class="btn btn-sm text-danger" onclick="deleteItem(${item.id})">&times;</button>
                `;
                itemsContainer.appendChild(itemDiv);
            });
        }
    } catch (err) {
        console.error(err);
        container.innerHTML = '<div class="alert alert-danger">Fehler beim Laden des Einkaufs.</div>';
    }
}
async function toggleItemCheck(itemId, isChecked) {
    try {
        await apiRequest(`/items/${itemId}/check?is_checked=${isChecked}`, 'PATCH');
        loadCurrentTrip();
    } catch (err) {}
}

async function deleteItem(itemId) {
    if (!confirm('Item löschen?')) return;
    try {
        await apiRequest(`/items/${itemId}`, 'DELETE');
        loadCurrentTrip();
    } catch (err) {}
}

async function completeTrip() {
    if (!confirm('Einkauf abschließen und archivieren?')) return;
    try {
        await apiRequest(`/trips/${currentTripId}/archive`, 'POST');
        currentTripId = null;
        showPage('trip-history');
    } catch (err) {}
}

function openSpontaneousProductModal() {
    document.getElementById('spontNameInput').value = '';
    updateSpontaneousAreaSelect();
    spontaneousModal.show();
}

function updateSpontaneousAreaSelect() {
    const select = document.getElementById('spontAreaSelect');
    select.innerHTML = '';
    areas.forEach(area => {
        const option = document.createElement('option');
        option.value = area.id;
        option.text = area.name;
        select.appendChild(option);
    });
}

async function saveSpontaneousProduct() {
    const name = document.getElementById('spontNameInput').value.trim();
    const area_id = parseInt(document.getElementById('spontAreaSelect').value);
    if (!name || isNaN(area_id)) return;
    if (!currentTripId) return;

    try {
        await apiRequest('/items', 'POST', {
            trip_id: currentTripId,
            name: name,
            area_id: area_id
        });
        spontaneousModal.hide();
        loadCurrentTrip();
    } catch (err) {
        alert('Fehler beim Hinzufügen.');
    }
}

// --- Page 5: History ---

async function loadTripHistory() {
    try {
        trips = await apiRequest('/trips?archived=true');
        const list = document.getElementById('history-list');
        const detail = document.getElementById('history-detail');
        detail.classList.add('d-none');
        list.classList.remove('d-none');

        list.innerHTML = '';
        if (trips.length === 0) {
            list.innerHTML = '<p class="text-muted">Noch keine abgeschlossenen Einkäufe.</p>';
            return;
        }

        trips.forEach(trip => {
            const item = document.createElement('div');
            item.className = 'list-group-item history-item';
            const dateStr = new Date(trip.created_at).toLocaleString('de-DE');
            item.innerHTML = `
                <div class="d-flex justify-content-between">
                    <span>Einkauf vom ${dateStr}</span>
                    <span>${trip.items.length} Artikel</span>
                </div>
            `;
            item.onclick = () => viewTripDetail(trip.id);
            list.appendChild(item);
        });
    } catch (err) {
        alert('Fehler beim Laden des Verlaufs. ' + err);
    }
}

async function viewTripDetail(tripId) {
    try {
        const trip = await apiRequest(`/trips/${tripId}`);
        const list = document.getElementById('history-list');
        const detail = document.getElementById('history-detail');
        const detailsContainer = document.getElementById('history-item-details');

        list.classList.add('d-none');
        detail.classList.remove('d-none');

        detailsContainer.innerHTML = '';

        // Grouping
        const grouped = {};
        trip.items.forEach(item => {
            const key = item.area_id || 'unknown';
            if (!grouped[key]) grouped[key] = [];
            grouped[key].push(item);
        });

        for (const [areaId, tripItems] of Object.entries(grouped)) {
            let areaName = 'Sonstiges';
            if (areaId !== 'unknown') {
                const area = areas.find(a => a.id === parseInt(areaId));
                if (area) areaName = area.name;
            }

            const areaHeader = document.createElement('div');
            areaHeader.className = 'area-group-header';
            areaHeader.innerText = areaName;
            detailsContainer.appendChild(areaHeader);

            tripItems.forEach(item => {
                const itemDiv = document.createElement('div');
                itemDiv.className = 'product-item-row';
                itemDiv.innerHTML = `
                    <span class="product-item-name ${item.is_checked ? 'item-checked' : ''}">${item.name}</span>
                `;
                detailsContainer.appendChild(itemDiv);
            });
        }
    } catch (err) {
        alert('Fehler beim Laden der Details.');
    }
}

function hideHistoryDetail() {
    showPage('trip-history');
}
