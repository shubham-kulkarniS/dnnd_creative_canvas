/**
 * Sessions panel — save / load / delete / share named canvas snapshots.
 *
 * A "session" here is a full graph snapshot ({nodes, connections, view})
 * stored server-side under a user-chosen name. Save is upsert: typing
 * the name of an existing session updates it.
 *
 * Sharing: the owner can grant another registered user read access by
 * email. Sharees see the session in their list with a "shared" pill
 * and can load it (read-only re-save into their own namespace).
 */

import { api }           from './api.js';
import { auth }          from './auth.js';
import { store }         from './state.js';
import { esc }           from './ui/dom.js';
import { confirmDialog } from './ui/dialog.js';

const CUR_KEY = 'greenhouse:current_session';

const fmtTime = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
};

export class SessionsPanel {
    constructor(container) {
        this.root = container;
        this.root.innerHTML = `
            <h3 class="lb-section-title">Save current canvas</h3>
            <div class="lb-row">
                <input type="text" class="lb-input" id="sp-name"
                       placeholder="Session name" maxlength="120" autocomplete="off" />
                <button type="button" class="lb-btn" id="sp-save">Save</button>
            </div>
            <div class="lb-status" id="sp-status" role="status" aria-live="polite"></div>

            <h3 class="lb-section-title">Saved sessions</h3>
            <ul class="lb-session-list" id="sp-list"></ul>
        `;
        this.nameInput = this.root.querySelector('#sp-name');
        this.saveBtn   = this.root.querySelector('#sp-save');
        this.statusEl  = this.root.querySelector('#sp-status');
        this.listEl    = this.root.querySelector('#sp-list');

        // Restore last-loaded session name for convenience.
        const cur = this._loadCurrent();
        if (cur?.name) this.nameInput.value = cur.name;

        this.saveBtn.addEventListener('click', () => this._save());
        this.nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); this._save(); }
        });

        // Refresh when the user logs in / out so the ownership pills
        // and the visible session set both stay accurate.
        this._offAuth = store.on('auth:changed', () => {
            this._closeShare();
            this.refresh();
        });

        this.refresh();
    }

    async refresh() {
        try {
            const items = await api.sessions.list();
            this._render(items);
        } catch (e) {
            this._status(`Could not load sessions: ${e.message}`, 'err');
        }
    }

    _render(items) {
        const cur = this._loadCurrent();
        if (!items.length) {
            this.listEl.innerHTML = `<div class="lb-empty">No saved sessions yet.</div>`;
            return;
        }
        this.listEl.innerHTML = '';
        for (const s of items) {
            const li = document.createElement('li');
            li.className = 'lb-session-item';
            if (cur?.id === s.id) li.classList.add('current');

            // Ownership pill — drives whether the Share / Delete buttons render.
            let pill = '';
            if (s.shared_with_me)  pill = `<span class="lb-session-pill shared">Shared</span>`;
            else if (s.is_owner)   pill = `<span class="lb-session-pill owner">Owner</span>`;
            else if (s.owner_user_id == null) pill = `<span class="lb-session-pill legacy">Legacy</span>`;

            const canShare  = !!s.is_owner;
            const canDelete = !!s.is_owner || (s.owner_user_id == null && !auth.isAuthenticated);

            li.innerHTML = `
                <div class="lb-session-name"></div>
                <div class="lb-session-meta"></div>
                <div class="lb-session-actions">
                    <button type="button" class="lb-btn tiny"        data-act="load">Load</button>
                    ${canShare  ? `<button type="button" class="lb-btn tiny ghost"   data-act="share">Share…</button>` : ''}
                    ${canDelete ? `<button type="button" class="lb-btn tiny danger"  data-act="del">Delete</button>` : ''}
                </div>
            `;
            const nameEl = li.querySelector('.lb-session-name');
            nameEl.innerHTML = `<span class="lb-session-title"></span>${pill}`;
            nameEl.querySelector('.lb-session-title').textContent = s.display_name;
            li.querySelector('.lb-session-meta').textContent =
                `${s.node_count} node${s.node_count === 1 ? '' : 's'} · ` +
                `${s.edge_count} edge${s.edge_count === 1 ? '' : 's'} · ` +
                `updated ${fmtTime(s.updated_at)}`;

            li.querySelector('[data-act="load"]').addEventListener('click', () => this._load(s));
            li.querySelector('[data-act="share"]')?.addEventListener('click', () => this._openShare(s));
            li.querySelector('[data-act="del"]')?.addEventListener('click',  () => this._delete(s));
            this.listEl.appendChild(li);
        }
    }

    async _save() {
        const name = this.nameInput.value.trim();
        if (!name) {
            this._status('Enter a name first.', 'err');
            this.nameInput.focus();
            return;
        }
        const graph = this._snapshotGraph();
        this.saveBtn.disabled = true;
        try {
            const saved = await api.sessions.save({ name, graph });
            this._saveCurrent({ id: saved.id, name: saved.display_name });
            this._status(`Saved “${saved.display_name}”.`, 'ok');
            await this.refresh();
        } catch (e) {
            this._status(`Save failed: ${e.message}`, 'err');
        } finally {
            this.saveBtn.disabled = false;
        }
    }

    async _load(summary) {
        const ok = await confirmDialog(
            `Replace the current canvas with “${summary.display_name}”?`,
            { confirmLabel: 'Load' });
        if (!ok) return;
        try {
            const full = await api.sessions.get(summary.id);
            store.replaceGraph({
                nodes: full.graph.nodes || [],
                connections: full.graph.connections || [],
            });
            if (full.graph.view) {
                const v = full.graph.view;
                store.setView(v.panX ?? 50, v.panY ?? 50, v.zoom ?? 1);
            }
            this.nameInput.value = summary.display_name;
            this._saveCurrent({ id: summary.id, name: summary.display_name });
            this._status(`Loaded “${summary.display_name}”.`, 'ok');
            this.refresh();
        } catch (e) {
            this._status(`Load failed: ${e.message}`, 'err');
        }
    }

    async _delete(summary) {
        const ok = await confirmDialog(
            `Delete “${summary.display_name}”? This cannot be undone.`,
            { kind: 'danger', confirmLabel: 'Delete' });
        if (!ok) return;
        try {
            await api.sessions.remove(summary.id);
            const cur = this._loadCurrent();
            if (cur?.id === summary.id) this._saveCurrent(null);
            this._status(`Deleted “${summary.display_name}”.`, 'ok');
            this.refresh();
        } catch (e) {
            this._status(`Delete failed: ${e.message}`, 'err');
        }
    }

    /**
     * Open an inline share dialog. We use a small in-panel popover
     * rather than a top-level modal so the user keeps the session
     * list in view while granting access.
     */
    async _openShare(summary) {
        if (!auth.isAuthenticated) {
            this._status('Sign in to share sessions.', 'err');
            return;
        }
        // Lazy-create container.
        if (!this._shareEl) {
            this._shareEl = document.createElement('div');
            this._shareEl.className = 'sp-share-popover';
            this.root.appendChild(this._shareEl);
        }
        await this._renderSharePopover(summary);
    }

    async _renderSharePopover(summary) {
        const el = this._shareEl;
        el.dataset.sessionId = summary.id;
        el.innerHTML = `
            <header class="sp-share-head">
                <strong>Share “${esc(summary.display_name)}”</strong>
                <button type="button" class="close-btn" data-act="close" aria-label="Close">✕</button>
            </header>
            <div class="sp-share-row">
                <input type="email" class="lb-input" data-field="email"
                       placeholder="teammate@studio.com" autocomplete="off" />
                <button type="button" class="lb-btn"  data-act="grant">Share</button>
            </div>
            <div class="lb-status" data-field="status"></div>
            <h4 class="sp-share-sub">Shared with</h4>
            <ul class="sp-share-list" data-field="list"></ul>
        `;
        const emailInput = el.querySelector('[data-field="email"]');
        const statusEl   = el.querySelector('[data-field="status"]');
        const listEl     = el.querySelector('[data-field="list"]');
        const setStatus = (msg, cls) => {
            statusEl.textContent = msg || '';
            statusEl.className   = 'lb-status' + (cls ? ` ${cls}` : '');
        };

        const reloadShares = async () => {
            try {
                const shares = await api.sessions.shares(summary.id);
                listEl.innerHTML = shares.length
                    ? shares.map(s => `
                        <li class="sp-share-item">
                            <span class="sp-share-name">${esc(s.display_name || s.email || `user #${s.user_id}`)}</span>
                            <span class="sp-share-email">${esc(s.email || '')}</span>
                            <button type="button" class="lb-btn tiny danger"
                                    data-act="revoke" data-user-id="${esc(String(s.user_id))}">Revoke</button>
                        </li>`).join('')
                    : `<li class="lb-empty">Not shared with anyone yet.</li>`;
                listEl.querySelectorAll('[data-act="revoke"]').forEach(btn => {
                    btn.addEventListener('click', async () => {
                        const userId = Number(btn.dataset.userId);
                        try {
                            await api.sessions.unshare(summary.id, userId);
                            await reloadShares();
                            setStatus('Access removed.', 'ok');
                        } catch (e) { setStatus(`Could not revoke: ${e.message}`, 'err'); }
                    });
                });
            } catch (e) {
                setStatus(`Could not load shares: ${e.message}`, 'err');
            }
        };

        el.querySelector('[data-act="close"]').addEventListener('click', () => this._closeShare());
        el.querySelector('[data-act="grant"]').addEventListener('click', async () => {
            const email = (emailInput.value || '').trim();
            if (!email) { setStatus('Enter an email address.', 'err'); emailInput.focus(); return; }
            try {
                await api.sessions.share(summary.id, email);
                emailInput.value = '';
                await reloadShares();
                setStatus(`Shared with ${email}.`, 'ok');
            } catch (e) {
                setStatus(`Could not share: ${e.message}`, 'err');
            }
        });
        emailInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); el.querySelector('[data-act="grant"]').click(); }
            if (e.key === 'Escape') this._closeShare();
        });

        el.hidden = false;
        await reloadShares();
        emailInput.focus();
    }

    _closeShare() {
        if (this._shareEl) this._shareEl.hidden = true;
    }

    _snapshotGraph() {
        return {
            nodes: Array.from(store.nodes.values()).map(n => JSON.parse(JSON.stringify(n))),
            connections: store.connections.map(c => ({ ...c })),
            view: { ...store.view },
        };
    }

    _status(msg, cls) {
        this.statusEl.textContent = msg || '';
        this.statusEl.className = 'lb-status' + (cls ? ` ${cls}` : '');
        if (cls === 'ok') {
            clearTimeout(this._statusT);
            this._statusT = setTimeout(() => {
                if (this.statusEl.textContent === msg) {
                    this.statusEl.textContent = '';
                    this.statusEl.className = 'lb-status';
                }
            }, 2500);
        }
    }

    _loadCurrent() {
        try { return JSON.parse(localStorage.getItem(CUR_KEY) || 'null'); }
        catch { return null; }
    }
    _saveCurrent(v) {
        try {
            if (v) localStorage.setItem(CUR_KEY, JSON.stringify(v));
            else   localStorage.removeItem(CUR_KEY);
        } catch (_) {}
    }
}
