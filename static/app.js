// Shared application utilities

const TOKEN_KEY = 'remote_browser_token';

/**
 * Get current session token from URL or client storage
 */
function getAuthToken() {
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token') || params.get('session');
    if (urlToken) {
        setAuthToken(urlToken);
        return urlToken;
    }
    try {
        return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || '';
    } catch {
        return '';
    }
}

/**
 * Store session token in client storage
 */
function setAuthToken(token) {
    if (!token) return;
    try {
        sessionStorage.setItem(TOKEN_KEY, token);
        localStorage.setItem(TOKEN_KEY, token);
    } catch {
        // Storage not available
    }
}

/**
 * Clear session token from client storage
 */
function clearAuthToken() {
    try {
        sessionStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(TOKEN_KEY);
    } catch {
        // Storage not available
    }
}

/**
 * API helper for making authenticated requests
 */
async function apiCall(endpoint, options = {}) {
    const token = getAuthToken();
    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
        ...options.headers,
    };

    const response = await fetch(endpoint, {
        credentials: 'same-origin',
        ...options,
        headers,
    });
    return response;
}

/**
 * Check if user is authenticated
 */
async function isAuthenticated() {
    try {
        const token = getAuthToken();
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};
        const response = await fetch('/api/list?path=/', {
            method: 'GET',
            credentials: 'same-origin',
            headers,
        });
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * HTML escape for XSS prevention
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}
