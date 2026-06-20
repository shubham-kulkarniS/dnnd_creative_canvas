/**
 * Assets panel — session-agnostic library of reusable inputs.
 *
 * Tiles are draggable onto the canvas: the dragstart payload uses
 * MIME `application/x-greenhouse-asset` so the canvas-side drop
 * handler can recognise it without conflicting with regular files.
 *
 * Listens for the `asset:added` store event so saving an asset from
 * elsewhere (e.g. a node's Save-as-Asset button) auto-refreshes the
 * grid.
 */

import { api }           from './api.js';
import { store }         from './state.js';
import { esc }           from './ui/dom.js';
import { confirmDialog } from './ui/dialog.js';

const KINDS = [
    { key: '',        label: 'All'     },
    { key: 'image',   label: 'Images'  },
    { key: 'video',   label: 'Videos'  },
    { key: 'text',    label: 'Text'    },
    { key: 'caption', label: 'Captions'},
];

export const ASSET_DT_MIME = 'application/x-greenhouse-asset';

export class AssetsPanel {
    constructor(container) {
        this.root = container;
        this.filter = '';
        // id -> { wrap, asset } cell cache so we only mutate the DOM
        // delta on refresh rather than tearing the whole grid down and
        // re-decoding every image.
        this._cells = new Map();

        this.root.innerHTML = `
            <h3 class="lb-section-title">Library</h3>
            <div class="lb-asset-filter" id="ap-filter" role="tablist"
                 aria-label="Filter assets by kind"></div>
            <div class="lb-status" id="ap-status" role="status" aria-live="polite">
                Drag a tile onto the canvas to add it.
            </div>
            <div class="lb-asset-grid" id="ap-grid"></div>
        `;
        this.filterEl = this.root.querySelector('#ap-filter');
        this.statusEl = this.root.querySelector('#ap-status');
        this.gridEl   = this.root.querySelector('#ap-grid');

        this._renderFilter();

        // Auto-refresh when any other component adds/removes assets.
        this._off = [
            store.on('asset:added',   () => this.refresh()),
            store.on('asset:removed', () => this.refresh()),
        ];

        this.refresh();
    }

    _renderFilter() {
        this.filterEl.innerHTML = '';
        for (const k of KINDS) {
            const b = document.createElement('button');
            b.type = 'button';
            b.setAttribute('role', 'tab');
            b.setAttribute('aria-selected', k.key === this.filter ? 'true' : 'false');
            b.textContent = k.label;
            if (k.key === this.filter) b.classList.add('active');
            b.addEventListener('click', () => {
                if (this.filter === k.key) return;
                this.filter = k.key;
                this._renderFilter();
                this.refresh();
            });
            this.filterEl.appendChild(b);
        }
    }

    async refresh() {
        try {
            const items = await api.assets.list(this.filter || undefined);
            this._renderGrid(items);
        } catch (e) {
            this._status(`Could not load assets: ${e.message}`, 'err');
        }
    }

    _renderGrid(items) {
        // Empty-state shortcut: drop cache and show the placeholder.
        if (!items.length) {
            this._cells.clear();
            this.gridEl.innerHTML = `<div class="lb-empty">No assets yet.<br>Save outputs from canvas nodes.</div>`;
            return;
        }

        // If we still have the empty-state placeholder, clear it so the
        // grid can host real children.
        if (this.gridEl.querySelector('.lb-empty')) this.gridEl.innerHTML = '';

        // Build a diff: keep cells for ids that are still present, drop
        // those that disappeared, and create new ones lazily. Image and
        // video elements stay live so the browser doesn't re-decode.
        const seen = new Set();
        const fragOrder = [];
        for (const a of items) {
            seen.add(a.id);
            let entry = this._cells.get(a.id);
            if (!entry) {
                entry = { wrap: this._tile(a), asset: a };
                this._cells.set(a.id, entry);
            } else if (entry.asset.label !== a.label) {
                // Label changed: patch the visible text in place. We don't
                // bother diffing the preview node because asset bodies are
                // immutable in this app — a re-uploaded image gets a new id.
                const lbl = entry.wrap.querySelector('.lb-asset-label');
                if (lbl) lbl.textContent = a.label || '';
                entry.asset = a;
            }
            fragOrder.push(entry.wrap);
        }

        // Remove stale cells.
        for (const [id, entry] of this._cells) {
            if (!seen.has(id)) {
                entry.wrap.remove();
                this._cells.delete(id);
            }
        }

        // Reorder by appending in-order. ``appendChild`` on an
        // already-attached node moves it, so this is a single in-place
        // shuffle without recreating elements.
        for (const wrap of fragOrder) this.gridEl.appendChild(wrap);
    }

    _tile(asset) {
        const wrap = document.createElement('div');
        wrap.className = 'lb-asset-cell';

        const tile = document.createElement('div');
        tile.className = 'lb-asset-tile';
        tile.draggable = true;
        tile.title = asset.label || `${asset.kind} · ${asset.id.slice(0, 8)}`;

        let preview;
        const altLabel = esc(asset.label || `${asset.kind} asset`);
        if (asset.kind === 'image') {
            preview = `<img src="${esc(asset.value)}" alt="${altLabel}" loading="lazy">`;
        } else if (asset.kind === 'video') {
            preview = `<video src="${esc(asset.value)}" muted loop playsinline
                              preload="metadata" aria-label="${altLabel}"></video>`;
        } else {
            // text / caption
            preview = `<div class="lb-asset-text">${esc(asset.value)}</div>`;
        }
        tile.innerHTML = `
            <span class="lb-asset-kind-tag">${esc(asset.kind)}</span>
            ${preview}
            <button type="button" class="lb-asset-del"
                    aria-label="Delete asset" title="Delete asset">×</button>
        `;

        tile.addEventListener('dragstart', (e) => {
            // Minimal payload — recipient looks up extra data via the id if needed.
            const payload = {
                id:    asset.id,
                kind:  asset.kind,
                value: asset.value,
                mime:  asset.mime || null,
                label: asset.label || null,
            };
            const json = JSON.stringify(payload);
            e.dataTransfer.setData(ASSET_DT_MIME, json);
            // Fallback: also expose as plain text in case a browser strips
            // custom MIME types (some older Safaris do).
            e.dataTransfer.setData('text/plain', json);
            e.dataTransfer.effectAllowed = 'copy';
            // Use the tile itself as the drag image so the user sees what they're moving.
            try { e.dataTransfer.setDragImage(tile, 24, 24); } catch (_) {}
            document.body.classList.add('asset-dragging');
        });
        tile.addEventListener('dragend', () => {
            document.body.classList.remove('asset-dragging');
            document.getElementById('canvas-container')
                ?.classList.remove('asset-drop-active');
        });

        tile.querySelector('.lb-asset-del').addEventListener('click', async (e) => {
            e.stopPropagation();
            const ok = await confirmDialog(
                `Delete this ${asset.kind} asset?`,
                { kind: 'danger', confirmLabel: 'Delete' });
            if (!ok) return;
            try {
                await api.assets.remove(asset.id);
                store.emit('asset:removed', asset.id);
            } catch (err) {
                this._status(`Delete failed: ${err.message}`, 'err');
            }
        });

        wrap.appendChild(tile);

        if (asset.label) {
            const label = document.createElement('div');
            label.className = 'lb-asset-label';
            label.textContent = asset.label;
            wrap.appendChild(label);
        }
        return wrap;
    }

    _status(msg, cls) {
        this.statusEl.textContent = msg || '';
        this.statusEl.className = 'lb-status' + (cls ? ` ${cls}` : '');
    }
}
