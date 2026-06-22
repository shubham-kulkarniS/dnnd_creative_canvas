/**
 * Notes panel — director review notes across all canvas outputs.
 *
 * Each note carries a snapshot of the source node (title, kind,
 * preview value) so the panel keeps working even when the original
 * node is gone. Notes are grouped newest-first; each card supports
 * inline edit + delete.
 *
 * Listens for `note:added` / `note:updated` / `note:removed` store
 * events so saving a note from a data node auto-refreshes the list.
 */

import { api }            from './api.js';
import { store }          from './state.js';
import { esc }            from './ui/dom.js';
import { confirmDialog }  from './ui/dialog.js';

export class NotesPanel {
    constructor(container) {
        this.root = container;
        this.notes = [];
        this.editingId = null;     // note id currently in edit-mode

        this.root.innerHTML = `
            <h3 class="lb-section-title">Director notes</h3>
            <div class="lb-status" id="np-status" role="status" aria-live="polite">
                Notes you write on data nodes show up here.
            </div>
            <ul class="lb-notes-list" id="np-list"></ul>
        `;
        this.statusEl = this.root.querySelector('#np-status');
        this.listEl   = this.root.querySelector('#np-list');

        // Delegated click handler for the whole list — cards are
        // re-rendered on every refresh so we can't bind per-button.
        this.listEl.addEventListener('click', (e) => this._onClick(e));

        this._off = [
            store.on('note:added',   () => this.refresh()),
            store.on('note:updated', () => this.refresh()),
            store.on('note:removed', () => this.refresh()),
        ];

        this.refresh();
    }

    async refresh() {
        try {
            this.notes = await api.notes.list();
            this._render();
        } catch (e) {
            this._status(`Could not load notes: ${e.message}`, 'err');
        }
    }

    _render() {
        if (!this.notes.length) {
            this.listEl.innerHTML =
                `<li class="lb-empty">No director notes yet.<br>
                 Click <strong>Add note</strong> on a data node.</li>`;
            return;
        }
        this.listEl.innerHTML = this.notes.map(n => this._card(n)).join('');
    }

    _card(n) {
        const when    = _fmtWhen(n.created_at);
        const title   = esc(n.node_title || 'Untitled output');
        const kindTag = n.node_kind
            ? `<span class="lb-note-kind">${esc(n.node_kind)}</span>` : '';
        const preview = _previewMarkup(n);
        const editing = this.editingId === n.id;

        const body = editing
            ? `
                <textarea class="lb-note-input" data-note-id="${esc(n.id)}"
                          rows="3" maxlength="4000">${esc(n.text)}</textarea>
                <div class="lb-note-actions">
                    <button type="button" class="lb-btn ghost tiny"
                            data-act="cancel" data-note-id="${esc(n.id)}">Cancel</button>
                    <button type="button" class="lb-btn tiny"
                            data-act="save"   data-note-id="${esc(n.id)}">Save</button>
                </div>
              `
            : `
                <p class="lb-note-text">${esc(n.text)}</p>
                <div class="lb-note-actions">
                    <button type="button" class="lb-btn ghost tiny"
                            data-act="edit"   data-note-id="${esc(n.id)}">Edit</button>
                    <button type="button" class="lb-btn danger tiny"
                            data-act="delete" data-note-id="${esc(n.id)}">Delete</button>
                </div>
              `;

        return `
            <li class="lb-note-card">
                <header class="lb-note-head">
                    <span class="lb-note-title">${title}</span>
                    ${kindTag}
                    <time class="lb-note-when" datetime="${esc(n.created_at)}">${esc(when)}</time>
                </header>
                ${preview}
                ${body}
            </li>
        `;
    }

    async _onClick(e) {
        const btn = e.target.closest('button[data-act]');
        if (!btn) return;
        const id  = btn.dataset.noteId;
        const act = btn.dataset.act;
        const note = this.notes.find(n => n.id === id);
        if (!note) return;

        if (act === 'edit')   { this.editingId = id;   this._render(); return; }
        if (act === 'cancel') { this.editingId = null; this._render(); return; }

        if (act === 'save') {
            const ta = this.listEl.querySelector(`textarea[data-note-id="${CSS.escape(id)}"]`);
            const text = (ta?.value ?? '').trim();
            if (!text) { this._status('Note text cannot be empty.', 'err'); return; }
            btn.disabled = true;
            btn.textContent = 'saving…';
            try {
                const updated = await api.notes.update(id, { text });
                this.editingId = null;
                store.emit('note:updated', updated);    // triggers refresh
            } catch (err) {
                const msg = err.status === 401
                    ? 'You must be logged in to update notes.'
                    : `Save failed: ${err.message}`;
                this._status(msg, 'err');
                btn.disabled = false; btn.textContent = 'Save';
            }
            return;
        }

        if (act === 'delete') {
            if (!(await confirmDialog('Delete this note?',
                  { kind: 'danger', confirmLabel: 'Delete' }))) return;
            try {
                await api.notes.remove(id);
                store.emit('note:removed', { noteId: id, nodeId: note.node_id });
            } catch (err) {
                const msg = err.status === 401
                    ? 'You must be logged in to delete notes.'
                    : `Delete failed: ${err.message}`;
                this._status(msg, 'err');
            }
            return;
        }
    }

    _status(msg, cls) {
        this.statusEl.textContent = msg || '';
        this.statusEl.className = 'lb-status' + (cls ? ` ${cls}` : '');
    }
}

/* ── helpers ──────────────────────────────────────────────────────── */

function _previewMarkup(n) {
    const v = n.preview_value;
    if (!v) return '';
    const alt = esc(n.node_title || 'Output preview');
    if (n.node_kind === 'image') {
        return `<div class="lb-note-preview">
                    <img src="${esc(v)}" alt="${alt}" loading="lazy">
                </div>`;
    }
    if (n.node_kind === 'video') {
        return `<div class="lb-note-preview">
                    <video src="${esc(v)}" muted loop playsinline
                           preload="metadata" aria-label="${alt}"></video>
                </div>`;
    }
    // text / caption / unknown — show the snippet.
    return `<div class="lb-note-preview lb-note-preview--text">${esc(v)}</div>`;
}

function _fmtWhen(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    // Locale-aware short date+time. Browsers handle the user's locale
    // here; no need for a fmt library.
    return d.toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
    });
}
