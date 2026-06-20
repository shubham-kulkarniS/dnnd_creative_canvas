/**
 * Sidebar configuration panel.
 *
 * Owns: open/close, focus, event delegation, file uploads, run-status,
 * connection-panel patching, object-URL lifecycle.
 *
 * Delegates: every form HTML string to `ui/forms.js`. The form module
 * is the single source of truth for which controls exist per node
 * type and how their labels associate to inputs.
 */

import { store }    from './state.js';
import { runNode }  from './runner.js';
import {
    formHTML,
    connectionsHTML,
    cast,
} from './ui/forms.js';

export class Sidebar {
    constructor(root, titleEl, fieldsEl, closeBtn) {
        this.root = root;
        this.titleEl = titleEl;
        this.fieldsEl = fieldsEl;
        this._objectUrls = new Map(); // nodeId -> last blob URL (revoke on replace)

        closeBtn.addEventListener('click', () => this.close());
        // Single delegated listener for all form controls.
        this.fieldsEl.addEventListener('input',  this._onChange);
        this.fieldsEl.addEventListener('change', this._onChange);
        this.fieldsEl.addEventListener('click',  this._onClick);
        window.addEventListener('keydown', this._onKey);

        store.on('selection:changed', (id) => id ? this.openFor(id) : this.close());
        // Topology changes only affect the connections group; avoid
        // rebuilding the entire form on every add/remove event.
        store.on('connection:added',   () => this._refreshConnectionsIfOpen());
        store.on('connection:removed', () => this._refreshConnectionsIfOpen());
        store.on('node:added',         () => this._refreshConnectionsIfOpen());
        store.on('node:removed',       (id) => {
            this._revokeObjectUrl(id);
            this._refreshConnectionsIfOpen();
        });
        // Catch up once the session-restore batch finishes (per-event
        // refreshes are skipped while ``store.isBatching`` is true).
        store.on('batch:end', () => this._refreshConnectionsIfOpen());

        // Toolbar dispatches this after adding a node so the most
        // relevant control (e.g. the model selector) is flashed.
        window.addEventListener('sidebar:highlight', this._onHighlight);
        window.addEventListener('beforeunload', this._onBeforeUnload);
    }

    _refreshConnectionsIfOpen() {
        // During a session-restore batch the topology mutates rapidly;
        // every connection-add fires once, which would have us
        // rebuilding the panel N times. Defer to ``batch:end``.
        if (store.isBatching) return;
        const id = store.activeNodeId;
        if (!id || !this.root.classList.contains('open')) return;
        const node = store.getNode(id);
        if (!node) return;
        const existing = this.fieldsEl.querySelector('.connections-group');
        if (!existing) return;
        existing.outerHTML = connectionsHTML(node);
    }

    _revokeObjectUrl(nodeId) {
        const url = this._objectUrls.get(nodeId);
        if (!url) return;
        URL.revokeObjectURL(url);
        this._objectUrls.delete(nodeId);
    }

    _revokeAllObjectUrls() {
        for (const url of this._objectUrls.values()) {
            URL.revokeObjectURL(url);
        }
        this._objectUrls.clear();
    }

    /**
     * Flash a specific control to draw the user's attention.
     * Triggered by the toolbar after adding a node from a typed dropdown.
     */
    _onHighlight = (evt) => {
        const { nodeId, type, name } = evt.detail || {};
        if (!nodeId || nodeId !== store.activeNodeId) return;
        // The sidebar may still be rendering — wait a frame.
        requestAnimationFrame(() => {
            const selector = type === 'field'
                ? `[data-field="${name}"]`
                : `[data-param="${name}"]`;
            const el = this.fieldsEl.querySelector(selector);
            if (!el) return;
            const wrap = el.closest('.menu-group') || el;
            wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
            // Restart the animation by toggling the class.
            wrap.classList.remove('flash-highlight');
            // Force reflow so re-adding the class restarts the keyframes.
            void wrap.offsetWidth;
            wrap.classList.add('flash-highlight');
            // Focus the control after the scroll settles so the user can
            // immediately open the dropdown with the keyboard.
            setTimeout(() => { try { el.focus({ preventScroll: true }); } catch {} }, 250);
        });
    };

    openFor(id) {
        const node = store.getNode(id);
        if (!node) return;
        const firstOpen = !this.root.classList.contains('open');
        this.titleEl.textContent = `${node.title} Settings`;
        this.fieldsEl.innerHTML = formHTML(node);
        this.root.classList.add('open');
        this.root.setAttribute('aria-hidden', 'false');
        // Focus the first editable control — but only on the initial open
        // so re-renders triggered by typing don't disrupt the cursor.
        if (firstOpen) {
            const first = this.fieldsEl.querySelector(
                'input:not([type="file"]), textarea, select');
            if (first) {
                requestAnimationFrame(() => {
                    try { first.focus({ preventScroll: true }); } catch (_) {}
                });
            }
        }
    }

    close() {
        this.root.classList.remove('open');
        this.root.setAttribute('aria-hidden', 'true');
        store.clearActive();
    }

    _onChange = (e) => {
        const t = e.target;
        const node = store.activeNode;
        if (!node) return;

        if (t.matches('[data-upload]')) {
            this._handleUpload(t, node);
            return;
        }
        if (!t.matches('[data-field], [data-param]')) return;

        const value = cast(t);
        if (t.dataset.field) {
            store.updateNode(node.id, t.dataset.field, value);
            if (t.dataset.field === 'title') {
                this.titleEl.textContent = `${value} Settings`;
            }
            // Changing data type or source invalidates the existing payload
            // and reshapes the form itself.
            if (t.dataset.field === 'dataType' || t.dataset.field === 'source') {
                this._revokeObjectUrl(node.id);
                store.updateNode(node.id, 'value', '');
                store.updateNode(node.id, '_uploadName', '');
                this._rerender(node);
            }
        } else {
            store.updateNodeParam(node.id, t.dataset.param, value);
            // Some params reshape the form itself — re-render the panel.
            if (t.dataset.param === 'output_type'
                || t.dataset.param === 'image_provider'
                || t.dataset.param === 'video_provider') {
                this._rerender(node);
            }
        }
    };

    _handleUpload(input, node) {
        const file = input.files && input.files[0];
        if (!file) return;
        // Revoke any prior blob URL we issued for this node to free memory.
        this._revokeObjectUrl(node.id);

        if (node.dataType === 'text') {
            file.text().then(txt => store.updateNode(node.id, 'value', txt));
            this._objectUrls.delete(node.id);
            return;
        }
        const url = URL.createObjectURL(file);
        this._objectUrls.set(node.id, url);
        store.updateNode(node.id, 'value', url);
        // Re-render so the "Loaded: filename" hint appears.
        store.updateNode(node.id, '_uploadName', file.name);
        this._rerender(node);
    }

    _rerender(node) {
        // Cheap: rebuild this panel only — much smaller than the canvas.
        this.openFor(node.id);
    }

    _onKey = (e) => {
        if (e.key !== 'Escape') return;
        if (!this.root.classList.contains('open')) return;
        e.preventDefault();
        this.close();
    };

    _onBeforeUnload = () => {
        this._revokeAllObjectUrls();
    };

    _onClick = async (e) => {
        // Seed quick-action buttons.
        const seedRand = e.target.closest('[data-seed-random]');
        if (seedRand) {
            const node = store.activeNode;
            if (!node) return;
            const target = seedRand.dataset.seedTarget || 'seed';
            const value  = Math.floor(Math.random() * 2_147_483_647);
            store.updateNodeParam(node.id, target, value);
            const input = this.fieldsEl.querySelector(`[data-param="${target}"]`);
            if (input) input.value = value;
            return;
        }
        const seedClear = e.target.closest('[data-seed-clear]');
        if (seedClear) {
            const node = store.activeNode;
            if (!node) return;
            const target = seedClear.dataset.seedTarget || 'seed';
            store.updateNodeParam(node.id, target, null);
            const input = this.fieldsEl.querySelector(`[data-param="${target}"]`);
            if (input) input.value = '';
            return;
        }

        // Connection management buttons (no active-node guard needed for these).
        const disc = e.target.closest('[data-disconnect]');
        if (disc) {
            store.removeConnection(disc.dataset.from, disc.dataset.to);
            return;
        }
        const conn = e.target.closest('[data-connect]');
        if (conn) {
            const select = conn.parentElement.querySelector('[data-conn-target]');
            const target = select && select.value;
            if (!target) return;
            const kind = conn.dataset.kind;
            const from = kind === 'out' ? conn.dataset.slot : target;
            const to   = kind === 'in'  ? conn.dataset.slot : target;
            store.addConnection(from, to);
            return;
        }

        // Run button.
        const btn = e.target.closest('[data-run]');
        if (!btn) return;
        const node = store.activeNode;
        if (!node) return;
        const status = this.fieldsEl.querySelector('[data-run-status]');
        btn.disabled = true;
        if (status) { status.textContent = 'Running…'; status.dataset.kind = 'pending'; }
        try {
            const url = await runNode(node.id);
            if (status) {
                status.textContent = `✔ Done — ${url}`;
                status.dataset.kind = 'ok';
            }
        } catch (err) {
            if (status) {
                status.textContent = `✗ ${err.message || err}`;
                status.dataset.kind = 'err';
            }
        } finally {
            btn.disabled = false;
        }
    };
}
