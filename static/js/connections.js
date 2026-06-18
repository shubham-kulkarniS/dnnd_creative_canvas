/**
 * SVG connection renderer.
 *
 * - Creates each <path> once and updates only the `d` attribute on
 *   transform / drag changes (avoids innerHTML thrash).
 * - Slot positions are computed in canvas space using the node's stored
 *   coordinates + slot offset, which is far cheaper than calling
 *   getBoundingClientRect during drag.
 */

import { store } from './state.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export class ConnectionRenderer {
    constructor(svg) {
        this.svg = svg;
        this.paths = new Map(); // "from→to" -> <path>
        this._rafPending = false;

        this._syncPathsFromStore();
        this.render();

        store.on('view:changed',        this.scheduleRender);
        store.on('node:moved',          this.scheduleRender);
        // Topology events update path DOM incrementally.
        store.on('node:removed',        this._onNodeRemoved);
        store.on('connection:added',    this._onConnectionAdded);
        store.on('connection:removed',  this._onConnectionRemoved);
    }

    _onConnectionAdded = ({ from, to }) => {
        this._ensurePath(`${from}→${to}`);
        this.scheduleRender();
    };

    _onConnectionRemoved = ({ from, to }) => {
        this._dropPath(`${from}→${to}`);
        this.scheduleRender();
    };

    _onNodeRemoved = (nodeId) => {
        for (const key of Array.from(this.paths.keys())) {
            const [from, to] = key.split('→');
            if (nodeIdOfSlot(from) === nodeId || nodeIdOfSlot(to) === nodeId) {
                this._dropPath(key);
            }
        }
        this.scheduleRender();
    };

    _syncPathsFromStore() {
        for (const conn of store.connections) {
            this._ensurePath(`${conn.from}→${conn.to}`);
        }
    }

    _ensurePath(key) {
        if (this.paths.has(key)) return;
        const path = document.createElementNS(SVG_NS, 'path');
        path.setAttribute('stroke', '#007acc');
        path.setAttribute('stroke-width', '3');
        path.setAttribute('fill', 'none');
        this.svg.appendChild(path);
        this.paths.set(key, path);
    }

    _dropPath(key) {
        const path = this.paths.get(key);
        if (!path) return;
        path.remove();
        this.paths.delete(key);
    }

    _pathKey(conn) {
        return `${conn.from}→${conn.to}`;
    }

    _pathFor(conn) {
        return this.paths.get(this._pathKey(conn));
    }

    _pruneStalePaths() {
        const live = new Set(store.connections.map(c => this._pathKey(c)));
        for (const key of Array.from(this.paths.keys())) {
            if (!live.has(key)) this._dropPath(key);
        }
    }

    scheduleRender = () => {
        if (this._rafPending) return;
        this._rafPending = true;
        requestAnimationFrame(() => {
            this._rafPending = false;
            this.render();
        });
    };

    render() {
        // Defensive cleanup for any stale path keys left by batched graph changes.
        this._pruneStalePaths();

        for (const conn of store.connections) {
            const a = this._slotPoint(conn.from);
            const b = this._slotPoint(conn.to);
            if (!a || !b) continue;
            const path = this._pathFor(conn);
            if (!path) continue;
            const c = Math.abs(b.x - a.x) * 0.5;
            path.setAttribute(
                'd',
                `M ${a.x} ${a.y} C ${a.x + c} ${a.y}, ${b.x - c} ${b.y}, ${b.x} ${b.y}`
            );
        }
    }

    /**
     * Compute slot center in *canvas-local* coordinates (pre-transform)
     * by walking up the offsetParent chain from the slot to the node.
     * Necessary because the slot sits inside `.slots-container`
     * (`position: relative`), so `slot.offsetLeft/Top` alone would be
     * relative to that wrapper, not to the node.
     */
    _slotPoint(slotId) {
        const el = document.getElementById(slotId);
        if (!el) return null;
        const nodeEl = el.closest('.node');
        if (!nodeEl) return null;
        const node = store.getNode(nodeEl.id);
        if (!node) return null;

        let sx = el.offsetWidth  / 2;
        let sy = el.offsetHeight / 2;
        for (let cur = el; cur && cur !== nodeEl; cur = cur.offsetParent) {
            sx += cur.offsetLeft;
            sy += cur.offsetTop;
        }
        return { x: node.x + sx, y: node.y + sy };
    }
}

function nodeIdOfSlot(slotId) {
    const i = slotId.indexOf('-');
    return i < 0 ? slotId : slotId.slice(0, i);
}
