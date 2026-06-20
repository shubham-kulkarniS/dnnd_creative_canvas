/**
 * AdminPanel — leftbar tab visible only to admins.
 *
 * Fetches `/api/admin/usage` for the headline numbers and recent
 * activity, plus `/api/admin/users` for the user directory. Auto-
 * refreshes every 30s while visible (cheap aggregate queries) and
 * pauses when the tab is hidden.
 */

import { api }  from './api.js';
import { auth } from './auth.js';
import { esc }  from './ui/dom.js';

const REFRESH_MS = 30_000;

const fmtWhen = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
};

export class AdminPanel {
    constructor(container) {
        this.root = container;
        this.usage = null;
        this.users = [];
        this._timer = null;

        this.root.innerHTML = `
            <h3 class="lb-section-title">Studio usage</h3>
            <div class="ap-stats" data-field="stats"></div>

            <h3 class="lb-section-title">Recent sessions</h3>
            <ul class="ap-list" data-field="recent-sessions"></ul>

            <h3 class="lb-section-title">Recent notes</h3>
            <ul class="ap-list" data-field="recent-notes"></ul>

            <h3 class="lb-section-title">Users</h3>
            <ul class="ap-users" data-field="users"></ul>

            <div class="lb-status" data-field="status"></div>
        `;

        this.statsEl    = this.root.querySelector('[data-field="stats"]');
        this.recentSEl  = this.root.querySelector('[data-field="recent-sessions"]');
        this.recentNEl  = this.root.querySelector('[data-field="recent-notes"]');
        this.usersEl    = this.root.querySelector('[data-field="users"]');
        this.statusEl   = this.root.querySelector('[data-field="status"]');

        this.refresh();
        this._timer = setInterval(() => this.refresh(), REFRESH_MS);
    }

    destroy() {
        if (this._timer) { clearInterval(this._timer); this._timer = null; }
    }

    async refresh() {
        if (!auth.isAdmin) {
            this._status('Admin privileges required.', 'err');
            return;
        }
        try {
            const [usage, users] = await Promise.all([
                api.admin.usage(),
                api.admin.users(),
            ]);
            this.usage = usage;
            this.users = users;
            this._render();
            this._status('');
        } catch (e) {
            this._status(`Could not load admin data: ${e.message}`, 'err');
        }
    }

    _render() {
        if (!this.usage) return;
        const u = this.usage;
        const stat = (label, value, sub) => `
            <div class="ap-stat">
                <div class="ap-stat-value">${esc(String(value))}</div>
                <div class="ap-stat-label">${esc(label)}</div>
                ${sub ? `<div class="ap-stat-sub">${esc(sub)}</div>` : ''}
            </div>
        `;
        this.statsEl.innerHTML = [
            stat('Users',    u.users,    `${u.admins} admin${u.admins === 1 ? '' : 's'}`),
            stat('Sessions', u.sessions, u.sessions_legacy ? `${u.sessions_legacy} legacy` : ''),
            stat('Shares',   u.shares),
            stat('Assets',   u.assets),
            stat('Notes',    u.notes),
        ].join('');

        this.recentSEl.innerHTML = u.recent_sessions.length
            ? u.recent_sessions.map(s => `
                <li class="ap-row">
                    <span class="ap-row-main">${esc(s.display_name)}</span>
                    <span class="ap-row-meta">
                        ${s.node_count}n · ${s.edge_count}e ·
                        ${s.owner_user_id ? `user #${s.owner_user_id}` : '<em>legacy</em>'} ·
                        ${esc(fmtWhen(s.updated_at))}
                    </span>
                </li>`).join('')
            : `<li class="lb-empty">No sessions yet.</li>`;

        this.recentNEl.innerHTML = u.recent_notes.length
            ? u.recent_notes.map(n => `
                <li class="ap-row">
                    <span class="ap-row-main">${esc(n.text)}</span>
                    <span class="ap-row-meta">
                        ${n.node_kind ? esc(n.node_kind) + ' · ' : ''}
                        ${esc(n.node_title || 'untitled')} ·
                        ${esc(fmtWhen(n.created_at))}
                    </span>
                </li>`).join('')
            : `<li class="lb-empty">No notes yet.</li>`;

        this.usersEl.innerHTML = this.users.length
            ? this.users.map(u => `
                <li class="ap-user">
                    <div class="ap-user-avatar">${esc((u.display_name || u.email).charAt(0).toUpperCase())}</div>
                    <div class="ap-user-info">
                        <div class="ap-user-name">
                            ${esc(u.display_name || u.email)}
                            ${u.is_admin ? '<span class="up-pill up-pill--admin">Admin</span>' : ''}
                        </div>
                        <div class="ap-user-email">${esc(u.email)}</div>
                    </div>
                    <div class="ap-user-since">${esc(fmtWhen(u.created_at))}</div>
                </li>`).join('')
            : `<li class="lb-empty">No registered users.</li>`;
    }

    _status(msg, cls) {
        this.statusEl.textContent = msg || '';
        this.statusEl.className = 'lb-status' + (cls ? ` ${cls}` : '');
    }
}
