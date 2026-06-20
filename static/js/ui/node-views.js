/**
 * Node body renderers.
 *
 * Extracted from `nodes.js::_bodyHTML/_paramsHTML/_previewHTML` so each
 * node type (data | generate | modify) lives in a focused function.
 * Every function returns an HTML string — the caller assigns it to
 * `.node-body`'s `innerHTML`. Strings (not DOM) keep the existing
 * patch-in-place path in `nodes.js::_patchNode` working unchanged.
 */

import { esc } from './dom.js';
import { icon } from './icons.js';

const SOURCE_LABEL = {
    manual: 'Typed',
    upload: 'Uploaded file',
    input:  'From input',
};

/** Top-level dispatch. */
export function nodeBodyHTML(node) {
    if (node.type === 'generate' || node.type === 'modify') {
        return paramsHTML(node);
    }
    return dataView(node);
}

/** Data node — type + source + preview + Save-as-Asset CTA. */
export function dataView(node) {
    const sourceLabel = SOURCE_LABEL[node.source] || node.source;
    const meta = `
        <dl class="node-meta">
            <dt>Type</dt>   <dd>${esc((node.dataType || '').toUpperCase())}</dd>
            <dt>Source</dt> <dd>${esc(sourceLabel)}</dd>
        </dl>
    `;
    const preview = previewHTML(node);
    const save    = saveAssetHTML(node);
    const note    = noteHTML(node);
    return `${meta}<div class="preview-box">${preview}</div>
            <div class="node-actions">${save}${note}</div>`;
}

/** Generate / modify — short parameter summary + role badge. */
export function paramsHTML(node) {
    const p = node.params || {};
    if (node.type === 'generate') {
        const ot = p.output_type ?? 'image';
        const detail = ot === 'video'
            ? `${esc(p.duration_seconds ?? 8)}s · ${esc(p.aspect_ratio ?? '16:9')}`
            : ot === 'caption'
                ? 'image/video → text'
                : 'text → image';
        return `
            <dl class="node-meta">
                <dt>Mode</dt>   <dd>${esc(ot)}</dd>
                <dt>Detail</dt> <dd>${detail}</dd>
            </dl>
            <div class="node-badge">Generator</div>
        `;
    }
    return `
        <dl class="node-meta">
            <dt>Op</dt> <dd>${esc(p.operation ?? 'Enhance')}</dd>
        </dl>
        <div class="node-badge node-badge--modify">Modifier</div>
    `;
}

/** Inline preview (image / video / text) for a node body. */
export function previewHTML(node) {
    // "input"-sourced data nodes show a placeholder until an upstream
    // node feeds them a value.
    if (node.source === 'input' && !node.value) {
        return `<pre class="empty">awaiting input…</pre>`;
    }
    if (node.dataType === 'text') {
        return `<pre>${esc(node.value || '(empty)')}</pre>`;
    }
    if (!node.value) {
        return `<pre class="empty">no ${esc(node.dataType)} loaded</pre>`;
    }
    const altLabel = esc(node.title || 'Preview');
    if (node.dataType === 'image') {
        return `<img src="${esc(node.value)}" alt="${altLabel}" loading="lazy">`;
    }
    if (node.dataType === 'video') {
        return `<video src="${esc(node.value)}" controls muted loop
                       playsinline preload="metadata"
                       aria-label="${altLabel}"></video>`;
    }
    return '';
}

/** Save-as-Asset button, only when a data node has a value to save. */
export function saveAssetHTML(node) {
    if (node.type !== 'data') return '';
    if (!node.value) return '';
    const saved = !!node._savedAssetId;
    const label = saved ? 'Saved to Library' : 'Save to Library';
    const cls   = saved ? 'node-save-asset is-saved' : 'node-save-asset';
    const ic    = saved ? icon('check') : icon('bookmark');
    return `<button type="button" class="${cls}" data-save-asset
                    ${saved ? 'disabled' : ''}>
                ${ic}<span>${label}</span>
            </button>`;
}

/**
 * Director Note CTA + inline editor.
 *
 * - Collapsed by default: a small "Add note" button.
 * - When `node._noteOpen` is true, render a textarea + Save/Cancel.
 * - When a note has been saved this session, show "Note saved" state
 *   with an Edit affordance. The editor only re-opens on explicit click.
 *
 * The button has no value-gate (unlike Save-as-Asset) because a
 * director may want to note "still waiting on output" on an empty node.
 */
export function noteHTML(node) {
    if (node.type !== 'data') return '';
    const open    = !!node._noteOpen;
    const hasNote = !!node._noteId;
    const draft   = esc(node._noteDraft ?? node._noteText ?? '');

    if (open) {
        return `
            <div class="node-note-editor" data-note-editor>
                <textarea class="node-note-input" data-note-input
                          rows="3" maxlength="4000"
                          placeholder="Director note…">${draft}</textarea>
                <div class="node-note-actions">
                    <button type="button" class="node-note-cancel"
                            data-note-cancel>Cancel</button>
                    <button type="button" class="node-note-save"
                            data-note-save>${hasNote ? 'Update' : 'Save note'}</button>
                </div>
            </div>
        `;
    }

    const label = hasNote ? 'Edit note' : 'Add note';
    const cls   = hasNote ? 'node-note-btn has-note' : 'node-note-btn';
    return `<button type="button" class="${cls}" data-note-open
                    title="${hasNote ? 'Edit director note' : 'Write a director note'}">
                ${icon('note')}<span>${label}</span>
            </button>`;
}
