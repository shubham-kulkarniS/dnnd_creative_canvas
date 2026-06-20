/**
 * Pan & zoom controller for the canvas.
 *
 * - Uses Pointer Events with capture for unified mouse/touch/pen.
 * - Batches transform writes via requestAnimationFrame.
 * - Zooms toward the pointer for natural feel.
 */

import { store } from './state.js';
import { ASSET_DT_MIME } from './assets_panel.js';

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3.0;
const ZOOM_FACTOR = 1.1;

export class CanvasController {
    constructor(container, canvas) {
        this.container = container;
        this.canvas = canvas;
        this._rafPending = false;
        this._isPanning = false;
        this._didPan = false;
        this._startX = 0;
        this._startY = 0;

        this._applyTransform();
        this._bind();
    }

    _bind() {
        this.container.addEventListener('pointerdown', this._onPointerDown);
        this.container.addEventListener('pointermove', this._onPointerMove);
        this.container.addEventListener('pointerup',   this._onPointerUp);
        this.container.addEventListener('pointercancel', this._onPointerUp);
        this.container.addEventListener('wheel', this._onWheel, { passive: false });

        // Asset library drag-drop.
        this.container.addEventListener('dragenter', this._onDragEnter);
        this.container.addEventListener('dragover',  this._onDragOver);
        this.container.addEventListener('dragleave', this._onDragLeave);
        this.container.addEventListener('drop',      this._onDrop);
    }

    /** Drag-drop assets onto canvas → spawn a data node at the drop point. */
    _isAssetDrag(e) {
        // Some browsers (and Safari for cross-origin) don't expose the
        // payload during dragover — fall back to a body-level class set
        // by the dragstart handler in the assets panel.
        const types = e.dataTransfer?.types;
        if (types && (types.includes(ASSET_DT_MIME) || types.includes('text/plain'))) return true;
        return document.body.classList.contains('asset-dragging');
    }

    _onDragEnter = (e) => {
        if (!this._isAssetDrag(e)) return;
        e.preventDefault();
        this.container.classList.add('asset-drop-active');
    };

    _onDragOver = (e) => {
        if (!this._isAssetDrag(e)) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    };

    _onDragLeave = (e) => {
        // Only clear when leaving the container itself, not children.
        if (e.target === this.container) this.container.classList.remove('asset-drop-active');
    };

    _onDrop = (e) => {
        if (!this._isAssetDrag(e)) return;
        e.preventDefault();
        this.container.classList.remove('asset-drop-active');
        document.body.classList.remove('asset-dragging');

        let raw = e.dataTransfer.getData(ASSET_DT_MIME);
        if (!raw) raw = e.dataTransfer.getData('text/plain');
        if (!raw) return;
        let asset;
        try { asset = JSON.parse(raw); }
        catch { return; }
        if (!asset || !asset.kind) return;

        // Compute canvas-local coordinates from the drop point.
        const rect = this.container.getBoundingClientRect();
        const { panX, panY, zoom } = store.view;
        const x = (e.clientX - rect.left - panX) / zoom;
        const y = (e.clientY - rect.top  - panY) / zoom;

        // Captions are textual outputs — map them onto a 'text' data node.
        const dataType = asset.kind === 'caption' ? 'text' : asset.kind;
        const id = store.nextNodeId();
        store.addNode({
            id,
            type: 'data',
            title: asset.label || `${dataType[0].toUpperCase()}${dataType.slice(1)} (asset)`,
            x: Math.round(x - 90),     // centre the ~180px-wide node under the cursor
            y: Math.round(y - 30),
            dataType,
            source: dataType === 'text' ? 'manual' : 'upload',
            value: asset.value,
            inputs: ['in_1'],
            outputs: ['out_1'],
            // Mark this node as already-saved so the Library button reflects that.
            _savedAssetId: asset.id,
            _mime: asset.mime || null,
        });
        store.setActive(id);
    };

    _onPointerDown = (e) => {
        // Only pan when clicking empty space (container / canvas / svg root).
        if (e.target !== this.container && e.target !== this.canvas &&
            e.target.id !== 'svg-canvas') return;
        this._isPanning = true;
        this._didPan = false;
        this._startX = e.clientX - store.view.panX;
        this._startY = e.clientY - store.view.panY;
        this.container.classList.add('panning');
        this.container.setPointerCapture(e.pointerId);
    };

    _onPointerMove = (e) => {
        if (!this._isPanning) return;
        const panX = e.clientX - this._startX;
        const panY = e.clientY - this._startY;
        if (panX !== store.view.panX || panY !== store.view.panY) this._didPan = true;
        store.view.panX = panX;
        store.view.panY = panY;
        this._scheduleTransform();
    };

    _onPointerUp = (e) => {
        if (!this._isPanning) return;
        this._isPanning = false;
        this.container.classList.remove('panning');
        try { this.container.releasePointerCapture(e.pointerId); } catch (_) {}
        // Treat a click on empty space (no drag) as "deselect".
        if (!this._didPan) store.clearActive();
        store.emit('view:changed', store.view);
    };

    _onWheel = (e) => {
        e.preventDefault();
        const { view } = store;
        const factor = e.deltaY < 0 ? ZOOM_FACTOR : 1 / ZOOM_FACTOR;
        const newZoom = Math.min(Math.max(ZOOM_MIN, view.zoom * factor), ZOOM_MAX);
        if (newZoom === view.zoom) return;

        // Zoom about the pointer so the point under the cursor stays put.
        const rect = this.container.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const ratio = newZoom / view.zoom;
        view.panX = cx - (cx - view.panX) * ratio;
        view.panY = cy - (cy - view.panY) * ratio;
        view.zoom = newZoom;
        this._scheduleTransform();
    };

    _scheduleTransform() {
        if (this._rafPending) return;
        this._rafPending = true;
        requestAnimationFrame(() => {
            this._rafPending = false;
            this._applyTransform();
            store.emit('view:changed', store.view);
        });
    }

    _applyTransform() {
        const { panX, panY, zoom } = store.view;
        this.canvas.style.transform = `translate3d(${panX}px, ${panY}px, 0) scale(${zoom})`;
    }
}
