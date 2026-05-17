const API_BASE_URL = 'http://localhost:8000';

// State management
let authToken = localStorage.getItem('authToken');

document.addEventListener('DOMContentLoaded', () => {
    if (!authToken) {
        // window.location.href = 'index.html'; // Deaktiviert für Debugging
        return;
    }

    initUserManagement();
});

function initUserManagement() {
    const createForm = document.getElementById('user-create-form');
    if (createForm) {
        createForm.addEventListener('submit', handleCreateUser);
    }

    loadUsers();
}

async function handleCreateUser(e) {
    e.preventDefault();
    const firstname = document.getElementById('user-firstname').value.trim();
    const lastname = document.getElementById('user-lastname').value.trim();
    const email = document.getElementById('user-email').value.trim();
    const password = document.getElementById('user-password').value;

    try {
        await apiRequest('/users', 'POST', {
            first_name: firstname,
            last_name: lastname,
            email: email,
            password: password
        });
        alert('Nutzer erfolgreich angelegt!');
        document.getElementById('user-create-form').reset();
        loadUsers();
    } catch (err) {
        alert('Fehler beim Anlegen des Nutzers: ' + err.message);
    }
}

async function loadUsers() {
    const tbody = document.getElementById('user-list-body');
    const countBadge = document.getElementById('user-count');
    tbody.innerHTML = '<tr><td colspan="4" class="text-center">Lade Nutzer...</td></tr>';

    try {
        const users = await apiRequest('/users');
        tbody.innerHTML = '';
        countBadge.innerText = `${users.length} Nutzer`;

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Keine Nutzer gefunden.</td></tr>';
            return;
        }

        users.forEach(user => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${user.first_name}</td>
                <td>${user.last_name}</td>
                <td>${user.email}</td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteUser(${user.id})">Löschen</button>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-danger">Fehler beim Laden der Nutzer.</td></tr>';
        console.error(err);
    }
}

async function deleteUser(id) {
    if (!confirm('Nutzer wirklich löschen?')) return;

    try {
        await apiRequest(`/users/${id}`, 'DELETE');
        loadUsers();
    } catch (err) {
        alert('Fehler beim Löschen: ' + err.message);
    }
}

// --- API Helper ---

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
            if (response.status === 401) {
                authToken = null;
                localStorage.removeItem('authToken');
                // window.location.href = 'index.html'; // Deaktiviert für Debugging
                throw new Error('Sitzung abgelaufen.');
            }
            throw new Error(errorData.detail || 'API Error');
        }
        return await response.json();
    } catch (error) {
        console.error(`API Request Error (${endpoint}):`, error);
        throw error;
    }
}
