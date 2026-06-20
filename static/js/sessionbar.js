/**
 * Bottom strip listing every shot produced this session.
 * Hover a thumbnail for a tooltip; click to open the asset full-size
 * in a new tab. Each tile also shows a tiny × to delete that shot.
 */

import { store }          from './state.js';
import { session }        from './session.js';
import { esc }            from './ui/dom.js';
import { confirmDialog }  from './ui/dialog.js';

export class SessionBar {
    constructor(root) {
        this.root = root;
        this.root.innerHTML = `
            <div class="session-head">
                <span class="session-title">Session shots</span>
                <span class="session-count" data-count>0</span>
                <span class="session-sid" title="Session id"></span>
                <span class="session-spacer"></span>
                <button type="button" class="session-btn" data-export
                        title="Download session JSON">Export</button>
                <button type="button" class="session-btn" data-clear
                        title="Remove all shots from this session">Clear</button>
            </div>
            <div class="session-shots" data-shots></div>
        `;
        this.shotsEl = this.root.querySelector('[data-shots]');
        this.countEl = this.root.querySelector('[data-count]');
        this.sidEl   = this.root.querySelector('.session-sid');
        this.sidEl.textContent = `#${session.id.slice(-6)}`;

        this.root.addEventListener('click', this._onClick);
        store.on('shot:added',    () => this._render());
        store.on('shots:changed', () => this._render());
        this._render();
    }

    _render() {
        this.countEl.textContent = String(session.shots.length);
        if (!session.shots.length) {
            this.shotsEl.innerHTML = `<div class="session-empty">No shots yet — Run a Generate or Modify node to see results here.</div>`;
            return;
        }
        // Newest first.
        const html = [...session.shots].reverse().map(s => {
            const ts = new Date(s.ts).toLocaleTimeString();
            const title = `${s.type.toUpperCase()} · ${ts}${s.url ? ` · ${s.url}` : ''}`;
            let inner = '';
            if (s.type === 'image' && s.url) {
                inner = `<img src="${esc(s.url)}" loading="lazy" alt="">`;
            } else if (s.type === 'video' && s.url) {
                inner = `<video src="${esc(s.url)}" preload="metadata" muted playsinline></video>
                         <span class="shot-badge">▶</span>`;
            } else if (s.type === 'caption') {
                const snippet = (s.text || '').replace(/\s+/g, ' ').slice(0, 80);
                inner = `<span class="shot-caption">${esc(snippet || '(text)')}</span>`;
            } else {
                inner = `<span class="shot-caption">?</span>`;
            }
            return `
                <div class="shot" data-shot-id="${esc(s.id)}" title="${esc(title)}">
                    ${inner}
                    <button type="button" class="shot-restore" data-restore="${esc(s.id)}"
                            title="Restore canvas to this shot's graph">⤺</button>
                    <button type="button" class="shot-x" data-remove="${esc(s.id)}"
                            title="Remove from session">×</button>
                </div>`;
        }).join('');
        this.shotsEl.innerHTML = html;
    }

    _onClick = async (e) => {
        const rm = e.target.closest('[data-remove]');
        if (rm) {
            e.stopPropagation();
            session.remove(rm.dataset.remove);
            return;
        }
        const restore = e.target.closest('[data-restore]');
        if (restore) {
            e.stopPropagation();
            const s = session.shots.find(x => x.id === restore.dataset.restore);
            if (!s || !s.graph) return;
            const ok = await confirmDialog(
                'Replace the current canvas with this shot’s graph?',
                { confirmLabel: 'Replace' });
            if (!ok) return;
            store.replaceGraph(s.graph);
            return;
        }
        if (e.target.closest('[data-clear]')) {
            if (!session.shots.length) return;
            const ok = await confirmDialog('Clear all shots in this session?',
                { kind: 'danger', confirmLabel: 'Clear' });
            if (ok) session.clear();
            return;
        }
        if (e.target.closest('[data-export]')) {
            this._export();
            return;
        }
        const shot = e.target.closest('.shot');
        if (shot) {
            const id = shot.dataset.shotId;
            const s = session.shots.find(x => x.id === id);
            if (s && s.url) window.open(s.url, '_blank', 'noopener');
        }
    };

    _export() {
        const blob = new Blob(
            [JSON.stringify({ id: session.id, startedAt: session.startedAt, shots: session.shots }, null, 2)],
            { type: 'application/json' }
        );
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${session.id}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
