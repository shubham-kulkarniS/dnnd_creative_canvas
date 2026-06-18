/**
 * Node rendering & drag.
 *
 * - Builds each node once and tracks its DOM element by id.
 * - Positions via `transform: translate3d` (GPU compositing, no layout).
 * - Drag is rAF-batched, uses pointer capture, and only updates the
 *   single moving node + its connections (not the whole graph).
 * - Body content is patched in-place on update events instead of being
 *   fully recreated.
 */

import { store } from './state.js';

const ESC_DIV = document.createElement('div');
const escape = (s) => { ESC_DIV.textContent = String(s ?? ''); return ESC_DIV.innerHTML; };

const SOURCE_LABEL = {
    manual: 'Typed',
    upload: 'Uploaded file',
    input:  'From input',
};

export class NodeRenderer {
    constructor(canvas, onSelect, onDragMove) {
        this.canvas = canvas;
        this.onSelect = onSelect;
        this.onDragMove = onDragMove;       // notify connection renderer
        this.elements = new Map();          // nodeId -> root element
        this._drag = null;
        this._dragRaf = false;

        this.renderAll();

        store.on('selection:changed', this._syncSelection);
        store.on('node:updated', this._patchNode);
        store.on('node:added',   this._addNode);
        store.on('node:removed', this._removeNode);
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
        root.style.transform = `translate3d(${node.x}px, ${node.y}px, 0)`;

        const header = document.createElement('div');
        header.className = 'node-header';
        header.textContent = node.title;
        root.appendChild(header);

        const body = document.createElement('div');
        body.className = 'node-body';
        body.innerHTML = this._bodyHTML(node);
        root.appendChild(body);

        root.appendChild(this._buildSlots(node));

        // Drag from header.
        header.addEventListener('pointerdown', (e) => this._beginDrag(e, node, root));

        // Click anywhere to select.
        root.addEventListener('click', (e) => {
            e.stopPropagation();
            this.onSelect(node.id);
        });

        return root;
    }

    _buildSlots(node) {
        const wrap = document.createElement('div');
        wrap.className = 'slots-container';
        const add = (ids, cls) => ids?.forEach(id => {
            const s = document.createElement('div');
            s.className = `slot ${cls}`;
            s.id = `${node.id}-${id}`;
            wrap.appendChild(s);
        });
        add(node.inputs,  'input-slot');
        add(node.outputs, 'output-slot');
        return wrap;
    }

    _bodyHTML(node) {
        if (node.type === 'generate' || node.type === 'modify') {
            return this._paramsHTML(node);
        }
        // 'data' node
        const sourceLabel = SOURCE_LABEL[node.source] || node.source;
        const header = `
            <div><strong>Type:</strong> ${escape(node.dataType.toUpperCase())}</div>
            <div><strong>Source:</strong> ${escape(sourceLabel)}</div>
        `;
        const preview = this._previewHTML(node);
        return `${header}<div class="preview-box">${preview}</div>`;
    }

    _paramsHTML(node) {
        const p = node.params || {};
        if (node.type === 'generate') {
            const ot = p.output_type ?? 'image';
            const detail = ot === 'video'
                ? `${escape(p.duration_seconds ?? 8)}s · ${escape(p.aspect_ratio ?? '16:9')}`
                : ot === 'caption'
                    ? 'image/video → text'
                    : 'text → image';
            return `
                <div><strong>Mode:</strong> ${escape(ot)}</div>
                <div><strong>Detail:</strong> ${detail}</div>
                <div class="node-badge">● Generator</div>
            `;
        }
        // 'modify'
        return `
            <div><strong>Op:</strong> ${escape(p.operation ?? 'Enhance')}</div>
            <div class="node-badge">● Modifier</div>
        `;
    }

    _previewHTML(node) {
        // When source is "input" and nothing has flowed in yet, show a placeholder.
        if (node.source === 'input' && !node.value) {
            return `<pre class="empty">← awaiting input</pre>`;
        }
        if (node.dataType === 'text') {
            return `<pre>${escape(node.value || '(empty)')}</pre>`;
        }
        if (!node.value) return `<pre class="empty">no ${node.dataType} loaded</pre>`;
        if (node.dataType === 'image') {
            return `<img src="${escape(node.value)}" alt="Preview" loading="lazy">`;
        }
        if (node.dataType === 'video') {
            return `<video src="${escape(node.value)}" controls muted loop playsinline preload="metadata"></video>`;
        }
        return '';
    }

    /* ── Drag ── */
    _beginDrag(e, node, el) {
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

    _patchNode = ({ id, key }) => {
        const node = store.getNode(id);
        const el = this.elements.get(id);
        if (!node || !el) return;
        if (key === 'title') {
            el.querySelector('.node-header').textContent = node.title;
        } else {
            // Any value/dataType/param change → refresh body markup only.
            el.querySelector('.node-body').innerHTML = this._bodyHTML(node);
        }
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
}
