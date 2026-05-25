/**
 * Debug-Log-Panel: Fixiertes Debug-Panel am unteren Bildschirmrand.
 * Loggt alle Netzwerkereignisse, Sync-Events, API-Aufrufe und Fehler.
 */

(function () {
    'use strict';

    // ─── Config ───
    const MAX_ENTRIES = 500;
    let _isOnline = navigator.onLine;
    let _entryCount = 0;

    // ─── DOM refs (lazy) ───
    function getPanel() { return document.getElementById('debug-log-panel'); }
    function getEntries() { return document.getElementById('debug-log-entries'); }
    function getStatus() { return document.getElementById('debug-log-status'); }
    function getCount() { return document.getElementById('debug-log-entry-count'); }

    // ─── Helpers ───
    function _time() {
        const d = new Date();
        return d.toLocaleTimeString('de-DE', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
            + '.' + String(d.getMilliseconds()).padStart(3, '0');
    }

    function _escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str);
        return div.innerHTML;
    }

    // ─── Public API ───
    const debugLog = {
        /**
         * Log a message
         * @param {'info'|'success'|'error'|'warn'} level - Log level
         * @param {'INFO'|'SYNC'|'FETCH'|'APP'|'CACHE'|'SSE'|'EVENT'} tag - Event category
         * @param {string} message - Message (can use {{code}} for syntax-highlighted code)
         * @param {...*} args - Optional values to append
         */
        log(level, tag, message, ...args) {
            const entries = getEntries();
            if (!entries) return;

            const entry = document.createElement('div');
            entry.className = 'debug-entry';

            let msgHtml = '';
            if (message) {
                msgHtml = message
                    .replace(/\{\{([^}]+)\}\}/g, '<span class="debug-code">$1</span>')
                    .replace(/(https?:\/\/[^\s,)]+)/g, '<span class="debug-url">$1</span>');
            }
            if (args && args.length > 0) {
                msgHtml += ' ' + args.map(a => {
                    if (typeof a === 'object' && a !== null) {
                        try { return '<span class="debug-code">' + _escapeHtml(JSON.stringify(a).substring(0, 200)) + '</span>'; }
                        catch { return String(a); }
                    }
                    return String(a);
                }).join(' ');
            }

            entry.innerHTML =
                '<span class="debug-time">' + _time() + '</span>' +
                '<span class="debug-tag tag-' + level.toLowerCase() + '">' + _escapeHtml(tag) + '</span>' +
                '<span class="debug-msg">' + msgHtml + '</span>';

            entries.appendChild(entry);
            _entryCount++;

            // Scroll to bottom
            const panel = getPanel();
            if (panel) panel.scrollTop = panel.scrollHeight;

            // Trim old entries
            while (entries.children.length > MAX_ENTRIES) {
                entries.removeChild(entries.firstChild);
            }

            getCount().textContent = _entryCount;
        },

        info(tag, msg, ...args) { this.log('info', tag, msg, ...args); },
        success(tag, msg, ...args) { this.log('success', tag, msg, ...args); },
        error(tag, msg, ...args) { this.log('error', tag, msg, ...args); },
        warn(tag, msg, ...args) { this.log('warn', tag, msg, ...args); },

        /** Toggle panel expanded/collapsed */
        toggle() {
            getPanel().classList.toggle('collapsed');
        },

        /** Clear all log entries */
        clear() {
            const entries = getEntries();
            if (entries) entries.innerHTML = '';
            _entryCount = 0;
            getCount().textContent = '0';
        },

        /** Export log to a text file */
        export() {
            const entries = getEntries();
            if (!entries) return;
            const text = entries.innerText || entries.textContent;
            const blob = new Blob([text], { type: 'text/plain' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'einkaufsliste-debug-' + new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-') + '.log';
            a.click();
            URL.revokeObjectURL(url);
        },

        /** Update online/offline status indicator */
        setOnline(online) {
            _isOnline = online;
            const statusEl = getStatus();
            if (!statusEl) return;
            if (online) {
                statusEl.className = 'status-online';
                statusEl.textContent = 'Online';
            } else {
                statusEl.className = 'status-offline';
                statusEl.textContent = 'Offline';
            }
        },

        get isOnline() { return _isOnline; },

        /** Expand panel */
        expand() { getPanel() && getPanel().classList.remove('collapsed'); },

        /** Collapse panel */
        collapse() { getPanel() && getPanel().classList.add('collapsed'); },
    };

    // Expose globally
    window.debugLog = debugLog;

    // ─── Silent error wrapper (replaces alert() with debugLog) ───
    window.showAlert = function(message, level = 'error') {
        if (level === 'error') {
            debugLog.error('APP', '❌ ' + message);
        } else if (level === 'warn') {
            debugLog.warn('APP', '⚠️ ' + message);
        } else if (level === 'success') {
            debugLog.success('APP', '✅ ' + message);
        } else {
            debugLog.info('APP', message);
        }
    };

    // ─── Auto-Initialize ───

    // Network event listeners
    window.addEventListener('online', () => {
        _isOnline = true;
        debugLog.setOnline(true);
        debugLog.info('EVENT', '🌐 Browser: online');
    });

    window.addEventListener('offline', () => {
        _isOnline = false;
        debugLog.setOnline(false);
        debugLog.warn('EVENT', '📴 Browser: offline');
    });

    // Patch window.fetch to log all HTTP requests
    (function patchFetch() {
        const originalFetch = window.fetch;
        if (!originalFetch) return;

        window.fetch = async function (...args) {
            const [input, init] = args;
            const url = input instanceof URL ? input.toString() : String(input);
            const method = (init && init.method) || 'GET';
            const startTime = Date.now();

            debugLog.info('FETCH', '>> ' + method + ' ' + url);

            try {
                const response = await originalFetch.apply(this, args);
                const duration = Date.now() - startTime;
                const statusColor = response.ok ? 'success' : 'error';
                debugLog[statusColor](
                    'FETCH',
                    method + ' → ' + response.status + ' (' + duration + 'ms) - ' + url
                );
                return response;
            } catch (error) {
                const duration = Date.now() - startTime;
                debugLog.error(
                    'FETCH',
                    '❌ ' + method + ' nach ' + duration + 'ms - ' + _escapeHtml(error.message) + ' - ' + url
                );
                throw error;
            }
        };

        // Copy over properties
        window.fetch.bind = originalFetch.bind;
        window.fetch.toString = originalFetch.toString;
    })();

    // Patch console.error / console.warn to also appear in debug log
    // (only if not already patched by apiRequest)
    (function patchConsole() {
        const origError = console.error;
        const origWarn = console.warn;

        console.error = function (...args) {
            // Only log non-API errors (API errors are logged in apiRequest)
            const msg = String(args[0] || '');
            if (!msg.includes('API Request Error')) {
                debugLog.error('APP', '❌ ' + args.map(a => {
                    if (typeof a === 'string') return a;
                    if (typeof a === 'object' && a !== null) {
                        try { return JSON.stringify(a); } catch { return String(a); }
                    }
                    return String(a);
                }).join(' '));
            }
            origError.apply(console, args);
        };

        console.warn = function (...args) {
            const msg = String(args[0] || '');
            if (!msg.includes('API request failed')) {
                debugLog.warn('APP', '⚠️ ' + args.map(a => {
                    if (typeof a === 'string') return a;
                    if (typeof a === 'object' && a !== null) {
                        try { return JSON.stringify(a); } catch { return String(a); }
                    }
                    return String(a);
                }).join(' '));
            }
            origWarn.apply(console, args);
        };
    })();

    // Log initial state
    debugLog.setOnline(_isOnline);
    debugLog.info('APP', '🚀 Debug-Log initialisiert (Online: ' + _isOnline + ')');

})();
