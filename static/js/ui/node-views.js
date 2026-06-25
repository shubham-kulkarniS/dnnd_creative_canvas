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
    if (node.type === 'embed') {
        return embedView(node);
    }
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
        const hasVariants = node._generatedAssets && node._generatedAssets.length > 1;
        const activeIndex = node._activeAssetIndex ?? 0;
        const totalVariants = node._generatedAssets?.length ?? 1;
        
        let variantUI = '';
        if (hasVariants) {
            // Prev/Next buttons
            variantUI += `
                <div class="preview-nav">
                    <button type="button" class="preview-nav-btn" 
                            data-variant-prev 
                            title="Previous variant (←)"
                            aria-label="Previous video variant">◄</button>
                    <span class="preview-variant-info">${activeIndex + 1} / ${totalVariants}</span>
                    <button type="button" class="preview-nav-btn" 
                            data-variant-next 
                            title="Next variant (→)"
                            aria-label="Next video variant">►</button>
                </div>
            `;
        }
        
        // Main video
        variantUI += `<video src="${esc(node.value)}" controls muted loop
                       playsinline preload="metadata"
                       aria-label="${altLabel}"></video>`;
        
        // Seed rings (indicators for all variants)
        if (hasVariants) {
            const rings = node._generatedAssets
                .map((_, i) => {
                    const isActive = i === activeIndex ? ' active' : '';
                    return `<button type="button" class="seed-ring${isActive}" 
                                    data-variant-index="${i}"
                                    title="Variant ${i + 1}"
                                    aria-label="Variant ${i + 1} (${i === activeIndex ? 'current' : 'available'})"
                                    ${i === activeIndex ? 'aria-current="true"' : ''}></button>`;
                }).join('');
            variantUI += `<div class="seed-rings">${rings}</div>`;
        }
        
        return variantUI;
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

/* ──────────────────────────────────────────────────────────────────
 *  Embed node — iframe-wrapping a remote web app (e.g. a locally
 *  running Gradio space). Pipeline-inert; the user drives it directly.
 * ─────────────────────────────────────────────────────────────── */

/**
 * Whitelist scheme + host shape so we never inject ``javascript:`` /
 * ``data:`` / ``vbscript:`` etc. as an iframe ``src``. Returns the
 * canonicalised URL string, or ``''`` if the input cannot be made into
 * a safe absolute http(s) URL.
 *
 * Accepts shortcut forms commonly printed by Gradio at boot time:
 *   - ``127.0.0.1:7860``          → ``http://127.0.0.1:7860``
 *   - ``localhost:7860/foo``      → ``http://localhost:7860/foo``
 *   - ``https://x.hf.space``      → unchanged
 */
export function sanitiseEmbedUrl(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return '';
    const withScheme = /^https?:\/\//i.test(s) ? s : `http://${s}`;
    try {
        const u = new URL(withScheme);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        if (!u.host) return '';
        return u.toString();
    } catch {
        return '';
    }
}

/** Render the iframe body for an ``embed`` node. */
export function embedView(node) {
    const url    = sanitiseEmbedUrl(node.embedUrl);
    const height = Math.max(160, Math.min(1200, parseInt(node.embedHeight, 10) || 480));

    // Empty / invalid URL → placeholder with a nudge to the sidebar.
    if (!url) {
        return `
            <div class="node-embed node-embed--empty"
                 style="--embed-h: ${height}px;">
                <div class="node-embed-placeholder">
                    <strong>No URL set.</strong>
                    <span>Open this node's settings and paste the Gradio
                    app's address (e.g. <code>127.0.0.1:7860</code>).</span>
                </div>
            </div>
        `;
    }

    // ``sandbox`` keeps the embed isolated from the parent document
    // (its scripts cannot reach our DOM, cookies, or storage), while
    // ``allow-same-origin`` is required for Gradio's own SSE/fetch
    // calls to its own origin to succeed. ``allow-forms`` /
    // ``allow-popups`` cover the most common interactions inside the
    // embedded app (file picker, "open in new tab" affordances, etc.).
    //
    // ``referrerpolicy="no-referrer"`` avoids leaking the parent URL
    // to the embedded server.
    const sandbox = 'allow-scripts allow-same-origin allow-forms ' +
                    'allow-popups allow-popups-to-escape-sandbox ' +
                    'allow-downloads';

    return `
        <div class="node-embed" style="--embed-h: ${height}px;">
            <div class="node-embed-bar">
                <span class="node-embed-url" title="${esc(url)}">${esc(url)}</span>
                <a class="node-embed-open" href="${esc(url)}"
                   target="_blank" rel="noopener noreferrer"
                   title="Open in a new browser tab">↗</a>
                <button type="button" class="node-embed-reload"
                        data-embed-reload
                        title="Reload the embedded app">⟳</button>
            </div>
            <iframe class="node-embed-frame"
                    src="${esc(url)}"
                    sandbox="${sandbox}"
                    referrerpolicy="no-referrer"
                    loading="lazy"
                    title="${esc(node.title)}"></iframe>
        </div>
    `;
}
