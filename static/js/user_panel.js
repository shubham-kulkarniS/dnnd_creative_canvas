/**
 * UserPanel — leftbar "Account" tab.
 *
 * Anonymous: shows a sign-in CTA that opens the auth modal.
 * Authenticated: profile card + admin badge + sign-out button +
 *                "Switch account" affordance.
 *
 * Subscribes to `auth:changed` so it re-renders the moment login or
 * logout completes.
 */

import { auth }       from './auth.js';
import { esc }        from './ui/dom.js';
import { store }      from './state.js';
import { engageAuthLock, clearAuthSkip } from './auth_modal.js';

export class UserPanel {
    constructor(container, { onOpenAuth } = {}) {
        this.root = container;
        this.onOpenAuth = onOpenAuth || (() => {});
        this._off = store.on('auth:changed', () => this._render());
        this._render();
    }

    refresh() { auth.refresh().then(() => this._render()); }

    _render() {
        const u = auth.user;
        if (!u) {
            this.root.innerHTML = `
                <h3 class="lb-section-title">Account</h3>
                <div class="up-anon">
                    <div class="up-avatar up-avatar--anon" aria-hidden="true">?</div>
                    <p class="up-anon-msg">
                        You're browsing as a guest. Sign in to save your work, share
                        sessions, and access the admin tools.
                    </p>
                    <button type="button" class="lb-btn primary" data-act="signin">
                        Sign in / Create account
                    </button>
                </div>
            `;
            this.root.querySelector('[data-act="signin"]')
                .addEventListener('click', () => this.onOpenAuth('login'));
            return;
        }

        const name    = u.display_name || u.email;
        const initial = (name || '?').trim().charAt(0).toUpperCase();
        const adminPill = u.is_admin
            ? `<span class="up-pill up-pill--admin" title="Admin user">Admin</span>` : '';
        const memberSince = (() => {
            const d = new Date(u.created_at);
            return Number.isNaN(d.getTime())
                ? ''
                : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
        })();

        this.root.innerHTML = `
            <h3 class="lb-section-title">Account</h3>
            <div class="up-card">
                <div class="up-avatar" aria-hidden="true">${esc(initial)}</div>
                <div class="up-info">
                    <div class="up-name">${esc(name)} ${adminPill}</div>
                    <div class="up-email">${esc(u.email)}</div>
                    ${memberSince ? `<div class="up-since">Member since ${esc(memberSince)}</div>` : ''}
                </div>
            </div>
            <div class="up-actions">
                <button type="button" class="lb-btn ghost" data-act="switch">Switch account</button>
                <button type="button" class="lb-btn danger" data-act="signout">Sign out</button>
            </div>
            <div class="lb-status" data-field="status"></div>
        `;
        this.root.querySelector('[data-act="switch"]')
            .addEventListener('click', () => this.onOpenAuth('login'));
        this.root.querySelector('[data-act="signout"]')
            .addEventListener('click', () => this._signOut());
    }

    async _signOut() {
        const status = this.root.querySelector('[data-field="status"]');
        if (status) { status.textContent = 'Signing out…'; status.className = 'lb-status'; }
        await auth.logout();
        // Clear any prior "skip auth" flag so the next session prompts
        // for login again, then re-engage the gate and surface the modal.
        clearAuthSkip();
        engageAuthLock();
        this.onOpenAuth('login');
        // `auth:changed` triggers a re-render which wipes `status`.
    }
}
