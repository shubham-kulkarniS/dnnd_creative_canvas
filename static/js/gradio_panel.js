/**
 * GradioPanel — manage the GradioManager registry from the leftbar.
 *
 * Surfaces:
 *   • A card per registered node-kind (e.g. ``TextGenNode``) showing
 *     the URL, api_name, and a coloured dot for liveness.
 *   • An "Add server" form to register new entries.
 *   • Edit / Remove on each card.
 *
 * Liveness is polled by GET-ing ``{url}/info`` (the same call the
 * ``GradioClient`` does anyway to resolve fn_indexes); we just look at
 * the HTTP status to decide green / red. Probes are throttled to once
 * per panel-open so flipping back and forth doesn't hammer the servers.
 *
 * Registry edits go through ``gradio.upsert(kind, entry)`` /
 * ``gradio.remove(kind)``; those mutate ``localStorage`` and emit
 * ``gradio:registry-changed`` so any other observer (none yet)
 * can react.
 */

import { gradio }          from './gradio.js';
import { store }           from './state.js';
import { esc }             from './ui/dom.js';
import { confirmDialog }   from './ui/dialog.js';

/** Default schema used when adding a brand-new server entry. */
const BLANK_ENTRY = () => ({
    url:      'http://localhost:7860',
    api_name: '/predict',
    inputs:   [{ from: 'text', required: true }],
    output:   { dataType: 'text' },
});

const DATA_TYPES = ['text', 'image', 'video'];

export class GradioPanel {
    constructor(container) {
        this.root      = container;
        this._liveness = new Map();   // url -> 'ok' | 'err' | 'checking'
        this._editing  = null;        // kind being edited, or null
        this._adding   = false;       // "add new" form visible?

        this.root.innerHTML = `
            <header class="gp-head">
                <h3 class="lb-section-title">Gradio servers</h3>
                <button type="button" class="lb-btn tiny" data-act="add">
                    + Add server
                </button>
            </header>
            <div class="lb-status" id="gp-status" role="status" aria-live="polite">
                Map node kinds to running Gradio servers. Set <code>engine: 'gradio'</code>
                on a node and the canvas dispatches through these endpoints.
            </div>
            <ul class="gp-list" id="gp-list"></ul>
        `;
        this.listEl   = this.root.querySelector('#gp-list');
        this.statusEl = this.root.querySelector('#gp-status');

        // Delegated click handler for cards + form buttons.
        this.root.addEventListener('click', this._onClick);
        // Auto-refresh on cross-tab registry edits (other tabs writing
        // to localStorage), or when DevTools calls ``__gradio.upsert``.
        this._off = store.on('gradio:registry-changed', () => this.refresh());

        this.refresh();
    }

    /** Called by Leftbar when the tab is re-activated. */
    refresh() {
        this._render();
        // Kick off liveness probes for any URL we don't already know about.
        this._probeAll();
    }

    /* ── Render ───────────────────────────────────────────────── */

    _render() {
        const registry = gradio.list();
        const kinds    = Object.keys(registry).sort();

        const cards = kinds.map(k => this._renderCard(k, registry[k])).join('');
        const adder = this._adding ? this._renderForm(null, BLANK_ENTRY()) : '';
        this.listEl.innerHTML = adder + (cards || `
            <li class="lb-empty">
                No servers registered yet. Click <strong>Add server</strong> to map
                a node kind to a Gradio endpoint.
            </li>
        `);
    }

    _renderCard(kind, entry) {
        if (this._editing === kind) {
            return this._renderForm(kind, entry);
        }
        const live = this._liveness.get(entry.url) || 'unknown';
        const inputs = (entry.inputs || [])
            .map(s => `${s.from}${s.required ? '' : '?'}`)
            .join(', ') || '—';
        return `
            <li class="gp-card" data-kind="${esc(kind)}">
                <header class="gp-card-head">
                    <span class="gp-dot gp-dot--${esc(live)}"
                          title="${live === 'ok' ? 'Reachable'
                                 : live === 'err' ? 'Unreachable'
                                 : live === 'checking' ? 'Probing\u2026'
                                 : 'Not probed yet'}"></span>
                    <span class="gp-card-title">${esc(kind)}</span>
                    <span class="gp-card-actions">
                        <button type="button" class="lb-btn tiny ghost"
                                data-act="recheck" data-url="${esc(entry.url)}">Probe</button>
                        <button type="button" class="lb-btn tiny ghost"
                                data-act="edit" data-kind="${esc(kind)}">Edit</button>
                        <button type="button" class="lb-btn tiny danger"
                                data-act="remove" data-kind="${esc(kind)}">Remove</button>
                    </span>
                </header>
                <dl class="gp-card-meta">
                    <dt>URL</dt>      <dd><code>${esc(entry.url)}</code></dd>
                    <dt>Endpoint</dt> <dd><code>${esc(entry.api_name)}</code></dd>
                    <dt>Inputs</dt>   <dd>${esc(inputs)}</dd>
                    <dt>Output</dt>   <dd>${esc(entry.output?.dataType ?? '?')}</dd>
                </dl>
            </li>
        `;
    }

    _renderForm(existingKind, entry) {
        const isNew = !existingKind;
        const inputsJson = JSON.stringify(entry.inputs || [], null, 2);
        return `
            <li class="gp-card gp-card--edit" data-form="${esc(existingKind || '')}">
                <header class="gp-card-head">
                    <span class="gp-card-title">
                        ${isNew ? 'New server' : `Edit \u201c${esc(existingKind)}\u201d`}
                    </span>
                </header>
                <div class="gp-form">
                    <label class="gp-field">
                        <span>Node kind</span>
                        <input type="text" name="kind"
                               value="${esc(existingKind || '')}"
                               ${existingKind ? 'readonly' : ''}
                               placeholder="e.g. ImageGenNode" maxlength="64">
                    </label>
                    <label class="gp-field">
                        <span>Server URL</span>
                        <input type="url" name="url"
                               value="${esc(entry.url)}"
                               placeholder="http://localhost:7861" required>
                    </label>
                    <label class="gp-field">
                        <span>Endpoint (api_name)</span>
                        <input type="text" name="api_name"
                               value="${esc(entry.api_name)}"
                               placeholder="/predict" required>
                    </label>
                    <label class="gp-field">
                        <span>Output dataType</span>
                        <select name="output_dataType">
                            ${DATA_TYPES.map(t =>
                                `<option value="${t}" ${entry.output?.dataType === t ? 'selected' : ''}>${t}</option>`
                            ).join('')}
                        </select>
                    </label>
                    <label class="gp-field gp-field--full">
                        <span>Inputs schema (JSON)</span>
                        <textarea name="inputs" rows="4"
                                  spellcheck="false">${esc(inputsJson)}</textarea>
                        <em class="gp-hint">
                            Array of <code>{from: "text"|"image"|"video", required: boolean}</code>
                            ordered to match the Gradio fn's positional inputs.
                        </em>
                    </label>
                    <div class="gp-form-actions">
                        <button type="button" class="lb-btn ghost tiny" data-act="cancel">Cancel</button>
                        <button type="button" class="lb-btn tiny"       data-act="save">Save</button>
                    </div>
                </div>
            </li>
        `;
    }

    /* ── Events ───────────────────────────────────────────────── */

    _onClick = (e) => {
        const btn = e.target.closest('[data-act]');
        if (!btn) return;
        const act = btn.dataset.act;

        if (act === 'add')      { this._adding = true; this._editing = null; this._render(); return; }
        if (act === 'cancel')   { this._adding = false; this._editing = null; this._render(); return; }
        if (act === 'edit')     { this._editing = btn.dataset.kind; this._adding = false; this._render(); return; }
        if (act === 'remove')   { this._handleRemove(btn.dataset.kind); return; }
        if (act === 'recheck')  { this._probeOne(btn.dataset.url, /*force=*/true); return; }
        if (act === 'save')     { this._handleSave(); return; }
    };

    async _handleRemove(kind) {
        const ok = await confirmDialog(
            `Remove the registry entry for "${kind}"?`,
            { kind: 'danger', confirmLabel: 'Remove' });
        if (!ok) return;
        gradio.remove(kind);
        if (this._editing === kind) this._editing = null;
        this._setStatus(`Removed “${kind}”.`, 'ok');
        this.refresh();
    }

    _handleSave() {
        const form = this.root.querySelector('.gp-form');
        if (!form) return;
        const data = Object.fromEntries(
            ['kind', 'url', 'api_name', 'output_dataType', 'inputs']
                .map(k => [k, form.querySelector(`[name="${k}"]`)?.value ?? ''])
        );

        // ── Field validation ─────────────────────────────────────
        const kind = data.kind.trim();
        if (!kind || !/^[A-Za-z_][\w]*$/.test(kind)) {
            this._setStatus('Kind must be a valid identifier (letters / digits / underscore).', 'err');
            return;
        }
        if (!data.url.trim() || !/^https?:\/\//.test(data.url.trim())) {
            this._setStatus('URL must start with http:// or https://', 'err');
            return;
        }
        let inputs;
        try {
            inputs = JSON.parse(data.inputs);
            if (!Array.isArray(inputs)) throw new Error('not an array');
            for (const slot of inputs) {
                if (!DATA_TYPES.includes(slot.from)) {
                    throw new Error(`unknown input type "${slot.from}"`);
                }
            }
        } catch (err) {
            this._setStatus(`Inputs JSON: ${err.message}`, 'err');
            return;
        }

        // ── Persist ──────────────────────────────────────────────
        // Reuse the previous extractor if we're editing an existing
        // entry so callers don't have to re-author it. New entries
        // get a sensible default per output type.
        const prev = gradio.get(kind) || {};
        gradio.upsert(kind, {
            url:      data.url.trim().replace(/\/$/, ''),
            api_name: data.api_name.trim() || '/predict',
            inputs,
            output:   {
                dataType: data.output_dataType,
                extract:  prev.output?.extract || _defaultExtract(data.output_dataType),
            },
        });
        this._adding  = false;
        this._editing = null;
        this._setStatus(`Saved “${kind}”.`, 'ok');
        this.refresh();
    }

    /* ── Liveness probes ──────────────────────────────────────── */

    _probeAll() {
        const seen = new Set();
        for (const entry of Object.values(gradio.list())) {
            if (seen.has(entry.url)) continue;
            seen.add(entry.url);
            this._probeOne(entry.url, /*force=*/false);
        }
    }

    async _probeOne(url, force) {
        if (!url) return;
        if (!force && this._liveness.get(url) === 'ok') return;
        if (this._liveness.get(url) === 'checking') return;
        this._liveness.set(url, 'checking');
        // Re-render only the matching dots; the cards re-read from the
        // map on next ``_render``.
        this._paintDot(url);
        let ok = false;
        try {
            // ``credentials: 'omit'`` so our auth cookie doesn't leak
            // cross-origin. ``no-cors`` would give us an opaque
            // response we can't inspect — we need ``response.ok``.
            const resp = await fetch(`${url}/info`, {
                method: 'GET',
                credentials: 'omit',
                cache: 'no-store',
            });
            ok = resp.ok;
        } catch {
            ok = false;
        }
        this._liveness.set(url, ok ? 'ok' : 'err');
        this._paintDot(url);
    }

    _paintDot(url) {
        const live = this._liveness.get(url) || 'unknown';
        for (const card of this.listEl.querySelectorAll('.gp-card')) {
            const code = card.querySelector('.gp-card-meta code');
            if (!code || code.textContent !== url) continue;
            const dot = card.querySelector('.gp-dot');
            if (!dot) continue;
            dot.className = `gp-dot gp-dot--${live}`;
            dot.title = live === 'ok'       ? 'Reachable'
                      : live === 'err'      ? 'Unreachable'
                      : live === 'checking' ? 'Probing…'
                      : 'Not probed yet';
        }
    }

    /* ── Status helper ────────────────────────────────────────── */

    _setStatus(msg, cls) {
        this.statusEl.textContent = msg || '';
        this.statusEl.className   = 'lb-status' + (cls ? ` ${cls}` : '');
        if (cls === 'ok') {
            clearTimeout(this._statusT);
            this._statusT = setTimeout(() => {
                if (this.statusEl.textContent === msg) {
                    this.statusEl.textContent = '';
                    this.statusEl.className = 'lb-status';
                }
            }, 2500);
        }
    }
}

/* ── Helpers ──────────────────────────────────────────────────── */

/** Default ``output.extract`` for a freshly-added entry. */
function _defaultExtract(dataType) {
    if (dataType === 'text') {
        return (r) => String(r.data?.[0] ?? '');
    }
    // image / video / file → pluck URL out of Gradio's polymorphic shape
    return (r) => {
        const item = r.data?.[0];
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (item.url)  return item.url;
        if (item.path) return item.path;
        return '';
    };
}
