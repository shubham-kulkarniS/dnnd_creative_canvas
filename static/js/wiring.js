/**
 * Click-to-connect: click an output slot, then click a compatible input
 * slot (on another node) to wire them up. Esc cancels.
 *
 * Visual feedback:
 *   * The first-picked slot pulses.
 *   * All compatible target slots highlight; incompatible ones dim.
 *   * A small status banner explains the state.
 */

import { store } from './state.js';

export class Wiring {
    constructor(canvas, banner) {
        this.canvas = canvas;
        this.banner = banner;
        this._first = null;            // slotId we picked first
        this._firstKind = null;        // 'out' | 'in'

        // Event delegation — works for nodes added later too.
        this.canvas.addEventListener('click', this._onClick, true);
        window.addEventListener('keydown', this._onKey);
    }

    _onClick = (e) => {
        const slot = e.target.closest('.slot');
        if (!slot) return;
        e.stopPropagation();          // don't deselect node / start pan
        const id = slot.id;
        const kind = slot.classList.contains('output-slot') ? 'out' : 'in';

        if (!this._first) {
            this._first = id;
            this._firstKind = kind;
            this._showCompatible();
            this._showBanner(`Click ${kind === 'out' ? 'an input' : 'an output'} slot on another node · Esc to cancel`);
            return;
        }
        // Clicking the same slot cancels.
        if (id === this._first) return this._cancel();

        // Need opposite direction.
        if (kind === this._firstKind) {
            // Allow user to "switch" the source instead of erroring out.
            this._first = id;
            this._firstKind = kind;
            this._showCompatible();
            return;
        }
        const from = kind === 'out' ? id : this._first;
        const to   = kind === 'in'  ? id : this._first;
        const ok = store.addConnection(from, to);
        this._showBanner(ok ? '✔ Connected' : '✗ Could not connect (already exists, or same node)', !ok);
        this._cancel();
        if (ok) setTimeout(() => this._hideBanner(), 1200);
    };

    _onKey = (e) => {
        if (e.key === 'Escape' && this._first) {
            e.preventDefault();
            this._cancel();
        }
    };

    _cancel() {
        this._first = null;
        this._firstKind = null;
        this._clearCompatible();
        this._hideBanner();
    }

    _showCompatible() {
        this._clearCompatible();
        const firstNodeId = this._first.split('-')[0];
        const wantClass = this._firstKind === 'out' ? 'input-slot' : 'output-slot';
        this.canvas.querySelectorAll('.slot').forEach(s => {
            if (s.id === this._first) { s.classList.add('slot-source'); return; }
            const sameNode = s.id.startsWith(firstNodeId + '-');
            if (sameNode || !s.classList.contains(wantClass)) {
                s.classList.add('slot-disabled');
            } else {
                s.classList.add('slot-target');
            }
        });
    }

    _clearCompatible() {
        this.canvas.querySelectorAll('.slot').forEach(s => {
            s.classList.remove('slot-source', 'slot-target', 'slot-disabled');
        });
    }

    _showBanner(text, isError = false) {
        this.banner.textContent = text;
        this.banner.dataset.kind = isError ? 'err' : 'info';
        this.banner.hidden = false;
    }
    _hideBanner() { this.banner.hidden = true; }
}
