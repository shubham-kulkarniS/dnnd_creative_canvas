/**
 * Auth — current-user state + login/signup/logout coordination.
 *
 * The HttpOnly auth cookies are the source of truth on the wire; this
 * module hydrates a *cache* of the current user's public profile in
 * memory and in `localStorage` (only the public projection, never the
 * tokens) so the UI can render an avatar before the `/api/auth/me`
 * round-trip completes.
 *
 * Events emitted on the global `store`:
 *   - `auth:changed`  -> payload is the new user (or `null`)
 *
 * Public surface:
 *   auth.user           → current user object or `null`
 *   auth.isAuthenticated
 *   auth.isAdmin
 *   auth.refresh()      → hits /api/auth/me, updates cache
 *   auth.signup({ email, password, display_name })
 *   auth.login ({ email, password })
 *   auth.logout()
 *   auth.on(handler)    → fires immediately + on changes; returns unsub
 */

import { api }   from './api.js';
import { store } from './state.js';

const CACHE_KEY = 'greenhouse:auth:user';

function _loadCache() {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function _saveCache(user) {
    try {
        if (user) localStorage.setItem(CACHE_KEY, JSON.stringify(user));
        else      localStorage.removeItem(CACHE_KEY);
    } catch (_) { /* quota — ignore */ }
}

class Auth {
    constructor() {
        // Optimistic cache — replaced by refresh() against /me. Useful
        // so the user-tab can render synchronously on reload before
        // the network round-trip completes.
        this.user = _loadCache();
    }

    get isAuthenticated() { return !!this.user; }
    get isAdmin()         { return !!(this.user && this.user.is_admin); }

    _set(user) {
        const before = this.user ? this.user.id : null;
        const after  = user      ? user.id      : null;
        this.user = user || null;
        _saveCache(this.user);
        // Always emit so admin-flag flips are observed even if id is unchanged.
        if (before !== after || JSON.stringify(this.user) !== JSON.stringify({ ...(this.user || {}) })) {
            store.emit('auth:changed', this.user);
        } else {
            store.emit('auth:changed', this.user);
        }
    }

    /** Hit `/api/auth/me`. Returns the user object or `null`. */
    async refresh() {
        try {
            const me = await api.auth.me();
            this._set(me);
            return me;
        } catch (e) {
            // 401 — try a refresh once, in case the access token expired
            // but the refresh cookie is still valid.
            if (e.status === 401 && !this._refreshing) {
                this._refreshing = true;
                try {
                    const me2 = await api.auth.refresh();
                    this._set(me2);
                    return me2;
                } catch (_) {
                    this._set(null);
                    return null;
                } finally {
                    this._refreshing = false;
                }
            }
            // Network errors leave the cache untouched so a flaky
            // connection doesn't log the user out.
            if (e.status === 401) this._set(null);
            return null;
        }
    }

    async signup(payload) {
        const me = await api.auth.signup(payload);
        this._set(me);
        return me;
    }

    async login(payload) {
        const me = await api.auth.login(payload);
        this._set(me);
        return me;
    }

    async logout() {
        try { await api.auth.logout(); }
        catch (_) { /* even if revoke fails, drop the local cache */ }
        this._set(null);
    }

    /** Subscribe to auth changes; handler fires immediately with the current value. */
    on(handler) {
        const off = store.on('auth:changed', handler);
        // Fire once with the current value so consumers don't have to special-case boot.
        queueMicrotask(() => handler(this.user));
        return off;
    }
}

export const auth = new Auth();
