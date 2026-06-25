/**
 * Leftbar — collapsible left toolbar with tabs (User, Sessions, Assets,
 * Notes, Servers, Admin).
 *
 * Hosts six panels delegated to dedicated modules. The Admin tab is
 * hidden for non-admins; we still bind it so promotion takes effect
 * without a reload. Persists the open tab and collapse state in
 * localStorage so the UI feels stable across reloads.
 */

import { SessionsPanel } from './sessions_panel.js';
import { AssetsPanel }   from './assets_panel.js';
import { NotesPanel }    from './notes_panel.js';
import { UserPanel }     from './user_panel.js';
import { AdminPanel }    from './admin_panel.js';
import { GradioPanel }   from './gradio_panel.js';
import { auth }          from './auth.js';
import { store }         from './state.js';

const LS_KEY = 'greenhouse:leftbar';

export class Leftbar {
    constructor(root, { onOpenAuth } = {}) {
        this.root = root;
        this.onOpenAuth = onOpenAuth || (() => {});
        this.tabs  = Array.from(root.querySelectorAll('.lb-tab'));
        this.panels = {
            user:     root.querySelector('[data-lb-panel="user"]'),
            sessions: root.querySelector('[data-lb-panel="sessions"]'),
            assets:   root.querySelector('[data-lb-panel="assets"]'),
            notes:    root.querySelector('[data-lb-panel="notes"]'),
            servers:  root.querySelector('[data-lb-panel="servers"]'),
            admin:    root.querySelector('[data-lb-panel="admin"]'),
        };
        this.collapseBtn = root.querySelector('#lb-collapse');
        // Lazy-instantiate panels so they only fetch on first reveal.
        // Must be initialised BEFORE the first _activate() call below.
        this._panelInstances = {};

        const saved = this._loadPrefs();
        this.activeTab = saved.tab || 'sessions';
        this.collapsed = saved.collapsed !== false;     // default collapsed
        this._applyCollapsed();
        this._applyAdminVisibility();
        this._activate(this.activeTab, { skipExpand: true });

        // Tab clicks: switching to a different tab implicitly expands.
        this.tabs.forEach(btn => {
            btn.addEventListener('click', () => {
                const tab = btn.dataset.lbTab;
                if (this.collapsed) {
                    this._setCollapsed(false);
                    this._activate(tab);
                } else if (tab === this.activeTab) {
                    // Click on the active tab toggles collapse.
                    this._setCollapsed(true);
                } else {
                    this._activate(tab);
                }
            });
        });

        this.collapseBtn?.addEventListener('click', () => {
            this._setCollapsed(!this.collapsed);
        });

        // React to login / logout / admin-flag flips.
        store.on('auth:changed', () => this._applyAdminVisibility());
    }

    _activate(tab, { skipExpand = false } = {}) {
        if (!this.panels[tab]) return;
        // Don't activate the admin tab for non-admins; fall back to sessions.
        if (tab === 'admin' && !auth.isAdmin) tab = 'sessions';
        this.activeTab = tab;
        this.tabs.forEach(b => b.classList.toggle('active', b.dataset.lbTab === tab));
        for (const [k, el] of Object.entries(this.panels)) {
            el.hidden = (k !== tab);
        }
        if (!this._panelInstances[tab]) {
            this._panelInstances[tab] = this._build(tab, this.panels[tab]);
        } else {
            this._panelInstances[tab].refresh?.();
        }
        if (!skipExpand && this.collapsed) this._setCollapsed(false);
        this._savePrefs();
    }

    _setCollapsed(collapsed) {
        this.collapsed = !!collapsed;
        this._applyCollapsed();
        this._savePrefs();
    }

    _applyCollapsed() {
        this.root.classList.toggle('collapsed', this.collapsed);
    }

    /** Toggle visibility of admin-only tab and its rail button. */
    _applyAdminVisibility() {
        const adminBtn = this.tabs.find(b => b.dataset.lbTab === 'admin');
        if (adminBtn) adminBtn.hidden = !auth.isAdmin;
        // If the active tab disappears, fall back.
        if (!auth.isAdmin && this.activeTab === 'admin') {
            this._activate('sessions', { skipExpand: true });
        }
    }

    _build(tab, container) {
        if (tab === 'user')     return new UserPanel(container, { onOpenAuth: this.onOpenAuth });
        if (tab === 'sessions') return new SessionsPanel(container);
        if (tab === 'assets')   return new AssetsPanel(container);
        if (tab === 'notes')    return new NotesPanel(container);
        if (tab === 'servers')  return new GradioPanel(container);
        if (tab === 'admin')    return new AdminPanel(container);
        return null;
    }

    _loadPrefs() {
        try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); }
        catch { return {}; }
    }

    _savePrefs() {
        try {
            localStorage.setItem(LS_KEY, JSON.stringify({
                tab: this.activeTab,
                collapsed: this.collapsed,
            }));
        } catch (_) { /* quota */ }
    }
}
