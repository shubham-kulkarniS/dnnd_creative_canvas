/**
 * Central application state — single source of truth.
 *
 * Nodes are stored in a Map for O(1) lookup. View transform values are
 * plain numbers; subscribers use a tiny pub/sub for cross-module
 * notifications without coupling.
 */

import { INITIAL_NODES, INITIAL_CONNECTIONS } from './data.js';

class Store {
    constructor() {
        this.nodes = new Map(INITIAL_NODES.map(n => [n.id, n]));
        this.connections = [...INITIAL_CONNECTIONS];
        this._upstreamByNode = new Map();   // nodeId -> Set<upstreamNodeId>
        this._downstreamByNode = new Map(); // nodeId -> Set<downstreamNodeId>
        this.view = { panX: 50, panY: 50, zoom: 1.0 };
        this.activeNodeId = null;
        this._subs = new Map();

        // Build traversal indexes once; maintained incrementally afterwards.
        this._rebuildAdjacency();
    }

    /* ── Pub/Sub ── */
    on(event, fn) {
        if (!this._subs.has(event)) this._subs.set(event, new Set());
        this._subs.get(event).add(fn);
        return () => this._subs.get(event).delete(fn);
    }

    emit(event, payload) {
        const set = this._subs.get(event);
        if (set) set.forEach(fn => fn(payload));
    }

    /* ── Selectors ── */
    getNode(id) { return this.nodes.get(id); }
    get activeNode() { return this.activeNodeId ? this.nodes.get(this.activeNodeId) : null; }
    getUpstreamNodeIds(id) { return this._upstreamByNode.get(id) || EMPTY_SET; }
    getDownstreamNodeIds(id) { return this._downstreamByNode.get(id) || EMPTY_SET; }

    /* ── Mutations ── */
    setActive(id) {
        if (this.activeNodeId === id) return;
        this.activeNodeId = id;
        this.emit('selection:changed', id);
    }

    clearActive() { this.setActive(null); }

    updateNode(id, key, value) {
        const node = this.nodes.get(id);
        if (!node) return;
        node[key] = value;
        // Private fields (prefixed with `_`) are UI-only metadata such as
        // an upload filename — no need to invalidate the canvas DOM.
        if (key.startsWith('_')) return;
        this.emit('node:updated', { id, key, value });
    }

    updateNodeParam(id, key, value) {
        const node = this.nodes.get(id);
        if (!node || !node.params) return;
        node.params[key] = value;
        this.emit('node:updated', { id, key: `params.${key}`, value });
    }

    setNodePosition(id, x, y) {
        const node = this.nodes.get(id);
        if (!node) return;
        node.x = x;
        node.y = y;
        this.emit('node:moved', id);
    }

    setView(panX, panY, zoom) {
        this.view.panX = panX;
        this.view.panY = panY;
        this.view.zoom = zoom;
        this.emit('view:changed', this.view);
    }

    /* ── Graph mutations ── */
    addNode(node) {
        this.nodes.set(node.id, node);
        this._ensureAdjNode(node.id);
        this.emit('node:added', node);
        return node;
    }

    removeNode(id) {
        if (!this.nodes.delete(id)) return;
        // Drop any connections that reference this node's slots.
        const prefix = `${id}-`;
        const keep = [];
        for (const c of this.connections) {
            if (c.from.startsWith(prefix) || c.to.startsWith(prefix)) {
                this._unlinkAdj(c);
            } else {
                keep.push(c);
            }
        }
        this.connections = keep;
        this._upstreamByNode.delete(id);
        this._downstreamByNode.delete(id);
        if (this.activeNodeId === id) {
            this.activeNodeId = null;
            this.emit('selection:changed', null);
        }
        this.emit('node:removed', id);
    }

    addConnection(from, to) {
        if (!from || !to || from === to) return false;
        // Topology rules:
        //   * `from` must be an output slot, `to` must be an input slot.
        //   * No self-loops.
        //   * No duplicate edges.
        //   * Each input slot accepts only one upstream connection
        //     (keeps the data-flow deterministic).
        if (!isOutputSlot(from) || !isInputSlot(to)) return false;
        if (nodeIdOf(from) === nodeIdOf(to)) return false;
        if (this.connections.some(c => c.from === from && c.to === to)) return false;
        if (this.connections.some(c => c.to === to)) return false;
        const conn = { from, to };
        this.connections.push(conn);
        this._linkAdj(conn);
        this.emit('connection:added', { from, to });
        return true;
    }

    removeConnection(from, to) {
        const idx = this.connections.findIndex(c => c.from === from && c.to === to);
        if (idx < 0) return false;
        const [conn] = this.connections.splice(idx, 1);
        this._unlinkAdj(conn);
        this.emit('connection:removed', { from, to });
        return true;
    }

    /** Replace the entire graph atomically. Used by session restore. */
    replaceGraph({ nodes, connections }) {
        // Tear down through mutation methods so observers can clear old DOM.
        for (const id of Array.from(this.nodes.keys())) this.removeNode(id);

        // Re-create nodes (deep-clone so callers can keep their snapshot).
        for (const n of nodes) this.addNode(JSON.parse(JSON.stringify(n)));

        // Re-wire — snapshot is assumed valid, so bypass validation.
        for (const c of connections) {
            const conn = { from: c.from, to: c.to };
            this.connections.push(conn);
            this._linkAdj(conn);
            this.emit('connection:added', { from: c.from, to: c.to });
        }
    }

    nextNodeId() {
        let n = this.nodes.size + 1;
        while (this.nodes.has(`node_${n}`)) n++;
        return `node_${n}`;
    }

    _ensureAdjNode(id) {
        if (!this._upstreamByNode.has(id)) this._upstreamByNode.set(id, new Set());
        if (!this._downstreamByNode.has(id)) this._downstreamByNode.set(id, new Set());
    }

    _rebuildAdjacency() {
        this._upstreamByNode.clear();
        this._downstreamByNode.clear();
        for (const id of this.nodes.keys()) this._ensureAdjNode(id);
        for (const conn of this.connections) this._linkAdj(conn);
    }

    _linkAdj(conn) {
        const fromNode = nodeIdOf(conn.from);
        const toNode = nodeIdOf(conn.to);
        this._ensureAdjNode(fromNode);
        this._ensureAdjNode(toNode);
        this._downstreamByNode.get(fromNode).add(toNode);
        this._upstreamByNode.get(toNode).add(fromNode);
    }

    _unlinkAdj(conn) {
        const fromNode = nodeIdOf(conn.from);
        const toNode = nodeIdOf(conn.to);
        this._downstreamByNode.get(fromNode)?.delete(toNode);
        this._upstreamByNode.get(toNode)?.delete(fromNode);
    }
}

const EMPTY_SET = new Set();

// ── Slot-id helpers (single source of truth for the convention) ──
// Slot id format:  `<nodeId>-<slotName>` where slotName starts with
// `in_` (input) or `out_` (output). nodeIds are `node_<n>` (no hyphens),
// so the suffix after the first `-` is the slot name.
function slotNameOf(slotId) { const i = slotId.indexOf('-'); return i < 0 ? '' : slotId.slice(i + 1); }
function nodeIdOf(slotId)   { const i = slotId.indexOf('-'); return i < 0 ? slotId : slotId.slice(0, i); }
function isInputSlot(slotId)  { return slotNameOf(slotId).startsWith('in_'); }
function isOutputSlot(slotId) { return slotNameOf(slotId).startsWith('out_'); }

export const store = new Store();
