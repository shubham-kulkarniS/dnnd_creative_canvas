/**
 * node-actions.js — Save-as-Asset + Director Notes lifecycle for a node.
 *
 * Extracted from ``nodes.js`` so the renderer stays focused on DOM
 * lifecycle (build, drag, resize, status). The action handlers below
 * mutate node fields (``_savedAssetId``, ``_noteOpen``, ``_noteDraft``,
 * ``_noteText``, ``_noteId``), call the API client, fire store events,
 * and ask the renderer to repaint via a single ``refreshBody`` callback.
 *
 * Public surface:
 *   - ``saveAsset({ node, btn, api, store, refreshBody })``
 *   - ``openNote ({ node, store, refreshBody, getEl })``
 *   - ``cancelNote({ node, store, refreshBody })``
 *   - ``saveNote ({ node, api, store, refreshBody, getEl })``
 *
 * Each function is async-safe and idempotent — callers can wire them
 * directly to click handlers.
 */

import { nodeBodyHTML } from './node-views.js';
import { alertDialog }  from './dialog.js';

/* ── Save-as-Asset ──────────────────────────────────────────────── */

export async function saveAsset({ node, btn, api, store, refreshBody }) {
    if (!node?.value || btn.disabled) return;
    const labelEl  = btn.querySelector('span');
    const original = labelEl ? labelEl.textContent : btn.textContent;
    btn.disabled = true;
    if (labelEl) labelEl.textContent = 'saving…'; else btn.textContent = 'saving…';
    try {
        const payload = {
            kind:  node.dataType,                 // 'text' | 'image' | 'video'
            value: String(node.value),
            label: node.title || null,
            mime:  node._mime  || null,
            bytes: node._bytes || null,
            source_node_id:    node.id,
            source_session_id: null,              // canvas session is client-only
        };
        const saved = await api.assets.create(payload);
        node._savedAssetId = saved.id;
        refreshBody(node);
        store.emit('asset:added', saved);
    } catch (e) {
        btn.disabled = false;
        if (labelEl) labelEl.textContent = original; else btn.textContent = original;
        alertDialog(`Could not save asset: ${e.message}`, { kind: 'err' });
    }
}

/* ── Director notes ─────────────────────────────────────────────── */

export function openNote({ node, refreshBody, getEl }) {
    node._noteOpen = true;
    if (node._noteDraft === undefined) node._noteDraft = node._noteText || '';
    refreshBody(node);
    // Focus textarea + caret-to-end.
    const ta = getEl(node.id)?.querySelector('[data-note-input]');
    if (ta) {
        ta.focus();
        const v = ta.value;
        ta.setSelectionRange(v.length, v.length);
    }
}

export function cancelNote({ node, refreshBody }) {
    node._noteOpen = false;
    delete node._noteDraft;
    refreshBody(node);
}

export async function saveNote({ node, api, store, refreshBody, getEl }) {
    const draft = (node._noteDraft ?? '').trim();
    if (!draft) {
        // Empty draft on save → treat as cancel rather than a 400.
        cancelNote({ node, refreshBody });
        return;
    }
    const saveBtn = getEl(node.id)?.querySelector('[data-note-save]');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'saving…'; }
    try {
        if (node._noteId) {
            const updated = await api.notes.update(node._noteId, { text: draft });
            node._noteText = updated.text;
            store.emit('note:updated', updated);
        } else {
            const payload = {
                text:          draft,
                node_id:       node.id,
                node_title:    node.title || null,
                node_kind:     node.dataType || null,
                preview_value: node.value ? String(node.value) : null,
                asset_id:      node._savedAssetId || null,
            };
            const created = await api.notes.create(payload);
            node._noteId   = created.id;
            node._noteText = created.text;
            store.emit('note:added', created);
        }
        node._noteOpen = false;
        delete node._noteDraft;
        refreshBody(node);
    } catch (e) {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = node._noteId ? 'Update' : 'Save note';
        }
        alertDialog(`Could not save note: ${e.message}`, { kind: 'err' });
    }
}

/* ── Body repaint helper (single source of truth) ───────────────── */

/**
 * Re-render only the body of the given node's root element. Used by
 * every action above so callers don't all need to know how to find
 * ``.node-body``.
 */
export function makeBodyRefresher(getEl) {
    return function refreshBody(node) {
        const el = getEl(node.id);
        if (el) el.querySelector('.node-body').innerHTML = nodeBodyHTML(node);
    };
}
