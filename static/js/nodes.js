/**
 * Node rendering & drag.
 *
 * - Builds each node once and tracks its DOM element by id.
 * - Positions via `transform: translate3d` (GPU compositing, no layout).
 * - Drag is rAF-batched, uses pointer capture, and only updates the
 *   single moving node + its connections (not the whole graph).
 * - Body content is patched in-place on update events instead of being
 *   fully recreated.
 *
 * Body markup (data / generate / modify variants) is delegated to
 * `ui/node-views.js`, keeping this file focused on DOM lifecycle.
 */

import { store }           from './state.js';
import { api }             from './api.js';
import { nodeBodyHTML }    from './ui/node-views.js';
import {
    saveAsset,
    openNote,
    cancelNote,
    saveNote,
    switchVideoVariant,
    makeBodyRefresher,
}                          from './ui/node-actions.js';

// Bounds for the user-resizable node width. Keeps slot geometry sane
// at the low end and the canvas usable at the high end.
const NODE_W_MIN  = 200;
const NODE_W_MAX  = 800;
const NODE_W_STEP = 60;
const NODE_W_DEFAULT = 220;

const clampWidth = (w) => Math.max(NODE_W_MIN, Math.min(NODE_W_MAX, Math.round(w)));

export class NodeRenderer {
    constructor(canvas, onSelect, onDragMove) {
        this.canvas = canvas;
        this.onSelect = onSelect;
        this.onDragMove = onDragMove;       // notify connection renderer
        this.elements = new Map();          // nodeId -> root element
        this._drag = null;
        this._dragRaf = false;

        // Bound body-refresh function: the action helpers in
        // ``ui/node-actions.js`` call this to repaint just the body of
        // a node after a save / note edit. Sharing the same function
        // identity keeps it easy to pass into callbacks.
        this._refreshBody = makeBodyRefresher((id) => this.elements.get(id));

        this.renderAll();

        store.on('selection:changed', this._syncSelection);
        store.on('node:updated', this._patchNode);
        store.on('node:added',   this._addNode);
        store.on('node:removed', this._removeNode);
        store.on('node:run-status', this._onRunStatus);
        // Clear the per-node note marker if the panel deletes the note,
        // so the data node falls back to "Add note".
        store.on('note:removed', this._onNoteRemoved);
    }

    renderAll() {
        const frag = document.createDocumentFragment();
        for (const node of store.nodes.values()) {
            const el = this._buildNode(node);
            this.elements.set(node.id, el);
            frag.appendChild(el);
        }
        this.canvas.appendChild(frag);
    }

    _buildNode(node) {
        const root = document.createElement('div');
        root.id = node.id;
        root.className = 'node';
        root.setAttribute('role', 'group');
        root.setAttribute('aria-label', `${node.title} node`);
        root.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;
        this._applySize(node, root);

        const header = document.createElement('div');
        header.className = 'node-header';

        const titleEl = document.createElement('span');
        titleEl.className = 'node-title';
        titleEl.textContent = node.title;
        header.appendChild(titleEl);

        // Size stepper — minus / plus. Pinned to the right edge of the
        // header, hidden until the node is hovered/selected (see CSS).
        const sizeCtrl = document.createElement('span');
        sizeCtrl.className = 'node-size-controls';
        sizeCtrl.innerHTML = `
            <button type="button" class="node-size-btn" data-resize="dec"
                    title="Shrink (Ctrl+−)" aria-label="Shrink node">−</button>
            <button type="button" class="node-size-btn" data-resize="inc"
                    title="Enlarge (Ctrl++)" aria-label="Enlarge node">+</button>
        `;
        header.appendChild(sizeCtrl);
        root.appendChild(header);

        const body = document.createElement('div');
        body.className = 'node-body';
        body.innerHTML = nodeBodyHTML(node);
        root.appendChild(body);

        root.appendChild(this._buildSlots(node));

        // SE corner free-resize handle. Pointer-driven; bounded by
        // ``NODE_W_MIN``/``NODE_W_MAX``. Exposed as a focusable
        // ``role="separator"`` so keyboard users can resize via the
        // header `−`/`+` buttons OR by focusing the handle and
        // pressing the arrow keys.
        const handle = document.createElement('div');
        handle.className = 'node-resize-handle';
        handle.setAttribute('role', 'separator');
        handle.setAttribute('aria-orientation', 'vertical');
        handle.setAttribute('aria-label', `Resize ${node.title} node`);
        handle.setAttribute('aria-valuemin', String(NODE_W_MIN));
        handle.setAttribute('aria-valuemax', String(NODE_W_MAX));
        handle.setAttribute('aria-valuenow', String(node.width || NODE_W_DEFAULT));
        handle.tabIndex = -1;     // pointer-first; tab order owned by buttons
        handle.title = 'Drag (or arrow keys) to resize';
        handle.addEventListener('pointerdown', (e) => this._beginResize(e, node, root));
        handle.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowUp')   { e.preventDefault(); this._stepSize(node, +NODE_W_STEP); }
            if (e.key === 'ArrowLeft'  || e.key === 'ArrowDown') { e.preventDefault(); this._stepSize(node, -NODE_W_STEP); }
        });
        root.appendChild(handle);

        // Drag from header.
        header.addEventListener('pointerdown', (e) => this._beginDrag(e, node, root));

        // Click anywhere to select.
        root.addEventListener('click', (e) => {
            e.stopPropagation();
            // Delegated: size stepper buttons in the header.
            const sizeBtn = e.target.closest('[data-resize]');
            if (sizeBtn && root.contains(sizeBtn)) {
                e.preventDefault();
                this._stepSize(node, sizeBtn.dataset.resize === 'inc' ? +NODE_W_STEP : -NODE_W_STEP);
                return;
            }
            // Delegated: Save-as-Asset button on data nodes.
            const saveBtn = e.target.closest('[data-save-asset]');
            if (saveBtn && root.contains(saveBtn)) {
                e.preventDefault();
                saveAsset({ node, btn: saveBtn, api, store, refreshBody: this._refreshBody });
                return;
            }
            // Delegated: Video variant navigation (prev/next/ring click).
            const variantPrev = e.target.closest('[data-variant-prev]');
            const variantNext = e.target.closest('[data-variant-next]');
            const variantRing = e.target.closest('[data-variant-index]');
            if (variantPrev && root.contains(variantPrev)) {
                e.preventDefault();
                const idx = (node._activeAssetIndex ?? 0) - 1;
                if (idx >= 0) switchVideoVariant({ node, index: idx, refreshBody: this._refreshBody });
                return;
            }
            if (variantNext && root.contains(variantNext)) {
                e.preventDefault();
                const total = node._generatedAssets?.length ?? 1;
                const idx = (node._activeAssetIndex ?? 0) + 1;
                if (idx < total) switchVideoVariant({ node, index: idx, refreshBody: this._refreshBody });
                return;
            }
            if (variantRing && root.contains(variantRing)) {
                e.preventDefault();
                const idx = parseInt(variantRing.dataset.variantIndex, 10);
                switchVideoVariant({ node, index: idx, refreshBody: this._refreshBody });
                return;
            }
            // Delegated: Note editor lifecycle on data nodes.
            const refreshBody = this._refreshBody;
            const getEl = (id) => this.elements.get(id);
            if (e.target.closest('[data-note-open]'))   { e.preventDefault(); openNote({ node, refreshBody, getEl }); return; }
            if (e.target.closest('[data-note-cancel]')) { e.preventDefault(); cancelNote({ node, refreshBody });      return; }
            if (e.target.closest('[data-note-save]'))   { e.preventDefault(); saveNote({ node, api, store, refreshBody, getEl }); return; }
            // Typing inside the textarea shouldn't bubble up to select.
            if (e.target.matches('[data-note-input]'))  { return; }
            // Delegated: Embed-node reload button. Reload the iframe in
            // place (assigning ``src`` to itself is the cheapest reload
            // path without tearing down the element).
            const reloadBtn = e.target.closest('[data-embed-reload]');
            if (reloadBtn && root.contains(reloadBtn)) {
                e.preventDefault();
                const frame = root.querySelector('.node-embed-frame');
                if (frame) frame.src = frame.src;
                return;
            }
            // Clicks inside the embed iframe shell (link / reload) should
            // not bubble into "select node" since the user is interacting
            // with the embedded app, not the canvas chrome.
            if (e.target.closest('.node-embed-bar a')) return;
            this.onSelect(node.id);
        });

        // Keep the in-progress note text in sync with node state so
        // re-renders (from an upstream value change, say) don't drop it.
        root.addEventListener('input', (e) => {
            const ta = e.target.closest('[data-note-input]');
            if (ta && root.contains(ta)) node._noteDraft = ta.value;
        });

        // Drag from header is bound below at the original site. The
        // header pointerdown is attached above so order doesn't matter.
        return root;
    }

    _buildSlots(node) {
        const wrap = document.createElement('div');
        wrap.className = 'slots-container';
        const add = (ids, cls, kind) => ids?.forEach(id => {
            const s = document.createElement('div');
            s.className = `slot ${cls}`;
            s.id = `${node.id}-${id}`;
            s.setAttribute('role', 'button');
            s.setAttribute('tabindex', '0');
            s.setAttribute('aria-label',
                `${kind === 'in' ? 'Input' : 'Output'} slot ${id} on ${node.title}`);
            wrap.appendChild(s);
        });
        add(node.inputs,  'input-slot',  'in');
        add(node.outputs, 'output-slot', 'out');
        return wrap;
    }

    /* ── Drag ── */
    _beginDrag(e, node, el) {
        // Header is also home to the size stepper — let those buttons
        // handle their own click instead of starting a drag.
        if (e.target.closest('[data-resize]')) return;
        e.stopPropagation();
        const { zoom, panX, panY } = store.view;
        this._drag = {
            node, el,
            offsetX: e.clientX - (node.x * zoom + panX),
            offsetY: e.clientY - (node.y * zoom + panY),
            pointerId: e.pointerId,
            lastX: e.clientX, lastY: e.clientY,
        };
        el.setPointerCapture(e.pointerId);
        el.addEventListener('pointermove', this._onDragMove);
        el.addEventListener('pointerup',   this._endDrag);
        el.addEventListener('pointercancel', this._endDrag);
        this.onSelect(node.id);
    }

    _onDragMove = (e) => {
        if (!this._drag) return;
        this._drag.lastX = e.clientX;
        this._drag.lastY = e.clientY;
        if (this._dragRaf) return;
        this._dragRaf = true;
        requestAnimationFrame(this._flushDrag);
    };

    _flushDrag = () => {
        this._dragRaf = false;
        if (!this._drag) return;
        const { node, el, offsetX, offsetY, lastX, lastY } = this._drag;
        const { zoom, panX, panY } = store.view;
        const x = (lastX - offsetX - panX) / zoom;
        const y = (lastY - offsetY - panY) / zoom;
        node.x = x;
        node.y = y;
        el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
        this.onDragMove?.(node.id);
    };

    _endDrag = (e) => {
        if (!this._drag) return;
        const { el, pointerId, node } = this._drag;
        el.removeEventListener('pointermove', this._onDragMove);
        el.removeEventListener('pointerup',   this._endDrag);
        el.removeEventListener('pointercancel', this._endDrag);
        try { el.releasePointerCapture(pointerId); } catch (_) {}
        store.setNodePosition(node.id, node.x, node.y);
        this._drag = null;
    };

    /* ── Reactive updates ── */
    _syncSelection = (id) => {
        this.elements.forEach((el, nid) => {
            el.classList.toggle('selected', nid === id);
        });
    };

    _onRunStatus = ({ id, kind }) => {
        const el = this.elements.get(id);
        if (!el) return;
        // Clear any pending flash timer so rapid re-runs don't leave
        // stale state behind.
        if (this._flashTimers?.has(id)) {
            clearTimeout(this._flashTimers.get(id));
            this._flashTimers.delete(id);
        }
        el.classList.remove('running', 'run-ok', 'run-err');
        if (kind === 'start') {
            el.classList.add('running');
            return;
        }
        // Brief success/error flash, then clear.
        el.classList.add(kind === 'ok' ? 'run-ok' : 'run-err');
        if (!this._flashTimers) this._flashTimers = new Map();
        const t = setTimeout(() => {
            el.classList.remove('run-ok', 'run-err');
            this._flashTimers.delete(id);
        }, kind === 'ok' ? 1600 : 2400);
        this._flashTimers.set(id, t);
    };

    _patchNode = ({ id, key }) => {
        const node = store.getNode(id);
        const el = this.elements.get(id);
        if (!node || !el) return;
        if (key === 'title') {
            const titleEl = el.querySelector('.node-title');
            if (titleEl) titleEl.textContent = node.title;
            el.setAttribute('aria-label', `${node.title} node`);
            return;
        }
        if (key === 'width') {
            // Size-only change: tweak the CSS var, leave body intact.
            // Connections must re-route because the right-edge output
            // slot has moved with the new width.
            this._applySize(node, el);
            this.onDragMove?.(node.id);
            return;
        }
        // ── Embed nodes ──────────────────────────────────────────
        // The iframe lives inside .node-body, and any innerHTML rewrite
        // tears it down (losing whatever state the user has built up
        // inside the remote app). So we patch surgically:
        //   - embedHeight  → adjust the CSS variable, keep the iframe.
        //   - embedUrl     → only re-render when the URL actually
        //                    changed and is non-empty; that's an
        //                    intentional "load a different app" action.
        if (node.type === 'embed') {
            if (key === 'embedHeight') {
                const wrap = el.querySelector('.node-embed');
                if (wrap) {
                    const h = Math.max(160, Math.min(1200,
                        parseInt(node.embedHeight, 10) || 480));
                    wrap.style.setProperty('--embed-h', `${h}px`);
                }
                return;
            }
            if (key === 'embedUrl') {
                el.querySelector('.node-body').innerHTML = nodeBodyHTML(node);
            }
            return;
        }
        // A new value/dataType makes any prior saved-asset stale: clear the marker
        // so the button reappears and the user can save again.
        if (key === 'value' || key === 'dataType') {
            delete node._savedAssetId;
        }
        // Any value/dataType/param change → refresh body markup only.
        el.querySelector('.node-body').innerHTML = nodeBodyHTML(node);
    };

    _addNode = (node) => {
        const el = this._buildNode(node);
        this.elements.set(node.id, el);
        this.canvas.appendChild(el);
    };

    _removeNode = (id) => {
        const el = this.elements.get(id);
        if (el) el.remove();
        this.elements.delete(id);
    };

    _onNoteRemoved = ({ noteId, nodeId } = {}) => {
        // Find any local node whose marker matches and refresh it.
        for (const node of store.nodes.values()) {
            if (nodeId && node.id !== nodeId) continue;
            if (node._noteId && node._noteId === noteId) {
                delete node._noteId;
                delete node._noteText;
                this._refreshBody(node);
            }
        }
    };

    /* ── Sizing ── */
    /**
     * Apply the node's stored width to its root element via a CSS
     * custom property (``--node-w``). The stylesheet derives the
     * preview cap from this value so images/videos/text wrap to fit
     * without any inline measurement.
     */
    _applySize(node, el) {
        const w = clampWidth(node.width || NODE_W_DEFAULT);
        el.style.setProperty('--node-w', `${w}px`);
        // Keep the resize handle's ARIA value in sync so AT users hear
        // the new size on the next focus / arrow press.
        const handle = el.querySelector('.node-resize-handle');
        if (handle) handle.setAttribute('aria-valuenow', String(w));
    }

    /** Discrete bump (+/− button or keyboard shortcut). */
    _stepSize(node, delta) {
        const current = node.width || NODE_W_DEFAULT;
        const next = clampWidth(current + delta);
        if (next === current) return;
        // Route through the store so observers (sessions / save state)
        // see the change and persist it.
        store.updateNode(node.id, 'width', next);
    }

    /**
     * Pointer-driven free resize from the SE corner. Updates the
     * node's width live (mutating ``node.width`` directly + applying
     * the CSS var) and emits a single store event on pointer-up so
     * downstream listeners aren't spammed during the gesture.
     */
    _beginResize(e, node, el) {
        e.preventDefault();
        e.stopPropagation();
        const startW = clampWidth(node.width || NODE_W_DEFAULT);
        const { zoom } = store.view;
        this._resize = {
            node, el,
            startW,
            startX: e.clientX,
            pointerId: e.pointerId,
            zoom: zoom || 1,
            lastW: startW,
            raf: false,
        };
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
        el.addEventListener('pointermove',  this._onResizeMove);
        el.addEventListener('pointerup',    this._endResize);
        el.addEventListener('pointercancel', this._endResize);
        // Select the node so the user has the context on screen.
        this.onSelect(node.id);
    }

    _onResizeMove = (e) => {
        if (!this._resize) return;
        const r = this._resize;
        // Convert screen-space dx to canvas-space (divide by zoom).
        const dx = (e.clientX - r.startX) / r.zoom;
        const w  = clampWidth(r.startW + dx);
        if (w === r.lastW) return;
        r.lastW = w;
        if (r.raf) return;
        r.raf = true;
        requestAnimationFrame(this._flushResize);
    };

    _flushResize = () => {
        if (!this._resize) return;
        this._resize.raf = false;
        const { node, el, lastW } = this._resize;
        node.width = lastW;
        el.style.setProperty('--node-w', `${lastW}px`);
        // Output slot has moved with the right edge — reroute wires.
        this.onDragMove?.(node.id);
    };

    _endResize = (e) => {
        if (!this._resize) return;
        const { el, pointerId, node, lastW, startW } = this._resize;
        el.removeEventListener('pointermove',  this._onResizeMove);
        el.removeEventListener('pointerup',    this._endResize);
        el.removeEventListener('pointercancel', this._endResize);
        try { el.releasePointerCapture(pointerId); } catch (_) {}
        this._resize = null;
        // Emit a single semantic update so the rest of the app sees
        // the new size (and session-save picks it up). Skip the noop.
        if (lastW !== startW) store.emit('node:updated', { id: node.id, key: 'width', value: lastW });
    };
}
