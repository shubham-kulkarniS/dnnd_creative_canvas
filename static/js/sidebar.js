/**
 * Sidebar configuration panel.
 *
 * Builds form controls reactive to the active node. Uses event
 * delegation on the form container — a single listener handles all
 * inputs instead of one per element.
 */

import { store } from './state.js';
import { runNode } from './runner.js';

const OPERATIONS = ['Enhance', 'Upscale 2x', 'Denoise', 'Inpaint', 'Restyle', 'Remove background'];
const ASPECTS    = ['16:9', '9:16', '1:1'];
// Gemini 2.5 Flash Image supports a wider set than Veo.
const IMAGE_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

// Image-generation provider — wired to `provider` in the backend schemas.
const IMAGE_PROVIDERS = [
    ['nanobanana', 'Nano Banana · Gemini 2.5 Flash Image'],
    ['gpt_image',  'GPT Image · Azure OpenAI gpt-image-1'],
];

// Video-generation provider — only Veo is wired up in the backend today;
// the others are surfaced so users can see what's planned. Availability
// is reported by /api/config/status (see `window.__providers`).
const VIDEO_PROVIDERS = [
    ['veo',       'Veo · Google'],
    ['gpt_video', 'GPT Video · OpenAI (coming soon)'],
    ['ltx',       'LTX · Lightricks (coming soon)'],
];

// Optional dropdowns shared by image generate + modify.
const IMAGE_SIZES        = [['', 'Default'], ['1K', '1K'], ['2K', '2K']];
const PERSON_GEN         = [['', 'Default'], ['DONT_ALLOW', 'Don\u2019t allow'],
                            ['ALLOW_ADULT', 'Allow adults'], ['ALLOW_ALL', 'Allow all']];
const IMAGE_MIME         = [['', 'Default'], ['image/png', 'PNG'],
                            ['image/jpeg', 'JPEG'], ['image/webp', 'WebP']];

// Veo-only dropdowns.
const VIDEO_RESOLUTIONS  = [['', 'Default'], ['720p', '720p'], ['1080p', '1080p']];
const VIDEO_COMPRESSION  = [['', 'Default'], ['OPTIMIZED', 'Optimized'], ['LOSSLESS', 'Lossless']];
const TRISTATE           = [['', 'Default'], ['true', 'On'], ['false', 'Off']];
const OUTPUT_TYPES = [
    ['image',   'Image   (text → image)'],
    ['video',   'Video   (text → video, +image for I2V)'],
    ['caption', 'Caption (image/video → text)'],
];
const DATA_TYPES = [
    ['text',  'Text'],
    ['image', 'Image'],
    ['video', 'Video'],
];
const DATA_SOURCES = [
    ['manual', 'Type manually'],
    ['upload', 'Upload file'],
    ['input',  'From input connection'],
];
const ACCEPT_FOR_TYPE = { image: 'image/*', video: 'video/*', text: 'text/plain' };

const opt = (val, label, selected) =>
    `<option value="${val}"${selected ? ' selected' : ''}>${label}</option>`;

export class Sidebar {
    constructor(root, titleEl, fieldsEl, closeBtn) {
        this.root = root;
        this.titleEl = titleEl;
        this.fieldsEl = fieldsEl;
        this._objectUrls = new Map(); // nodeId -> last blob URL (revoke on replace)

        closeBtn.addEventListener('click', () => this.close());
        // Single delegated listener for all form controls.
        this.fieldsEl.addEventListener('input',  this._onChange);
        this.fieldsEl.addEventListener('change', this._onChange);
        this.fieldsEl.addEventListener('click',  this._onClick);
        window.addEventListener('keydown', this._onKey);

        store.on('selection:changed', (id) => id ? this.openFor(id) : this.close());
        // Topology changes only affect the connections group; avoid
        // rebuilding the entire form on every add/remove event.
        store.on('connection:added',   () => this._refreshConnectionsIfOpen());
        store.on('connection:removed', () => this._refreshConnectionsIfOpen());
        store.on('node:added',         () => this._refreshConnectionsIfOpen());
        store.on('node:removed',       (id) => {
            this._revokeObjectUrl(id);
            this._refreshConnectionsIfOpen();
        });

        // Toolbar dispatches this after adding a node so the most
        // relevant control (e.g. the model selector) is flashed.
        window.addEventListener('sidebar:highlight', this._onHighlight);
        window.addEventListener('beforeunload', this._onBeforeUnload);
    }

    _refreshConnectionsIfOpen() {
        const id = store.activeNodeId;
        if (!id || !this.root.classList.contains('open')) return;
        const node = store.getNode(id);
        if (!node) return;
        const existing = this.fieldsEl.querySelector('.connections-group');
        if (!existing) return;
        existing.outerHTML = this._connectionsHTML(node);
    }

    _revokeObjectUrl(nodeId) {
        const url = this._objectUrls.get(nodeId);
        if (!url) return;
        URL.revokeObjectURL(url);
        this._objectUrls.delete(nodeId);
    }

    _revokeAllObjectUrls() {
        for (const url of this._objectUrls.values()) {
            URL.revokeObjectURL(url);
        }
        this._objectUrls.clear();
    }

    /**
     * Flash a specific control to draw the user's attention.
     * Triggered by the toolbar after adding a node from a typed dropdown.
     */
    _onHighlight = (evt) => {
        const { nodeId, type, name } = evt.detail || {};
        if (!nodeId || nodeId !== store.activeNodeId) return;
        // The sidebar may still be rendering — wait a frame.
        requestAnimationFrame(() => {
            const selector = type === 'field'
                ? `[data-field="${name}"]`
                : `[data-param="${name}"]`;
            const el = this.fieldsEl.querySelector(selector);
            if (!el) return;
            const wrap = el.closest('.menu-group') || el;
            wrap.scrollIntoView({ block: 'center', behavior: 'smooth' });
            // Restart the animation by toggling the class.
            wrap.classList.remove('flash-highlight');
            // Force reflow so re-adding the class restarts the keyframes.
            void wrap.offsetWidth;
            wrap.classList.add('flash-highlight');
            // Focus the control after the scroll settles so the user can
            // immediately open the dropdown with the keyboard.
            setTimeout(() => { try { el.focus({ preventScroll: true }); } catch {} }, 250);
        });
    };

    openFor(id) {
        const node = store.getNode(id);
        if (!node) return;
        this.titleEl.textContent = `${node.title} Settings`;
        this.fieldsEl.innerHTML = this._formHTML(node);
        this.root.classList.add('open');
        this.root.setAttribute('aria-hidden', 'false');
    }

    close() {
        this.root.classList.remove('open');
        this.root.setAttribute('aria-hidden', 'true');
        store.clearActive();
    }

    _formHTML(node) {
        const groups = [
            group('Node Display Name',
                `<input type="text" data-field="title" value="${esc(node.title)}">`),
        ];

        if (node.type === 'data') {
            groups.push(...this._dataNodeForm(node));
        } else if (node.type === 'generate') {
            groups.push(...this._generateForm(node));
            groups.push(this._runForm(node));
        } else if (node.type === 'modify') {
            groups.push(...this._modifyForm(node));
            groups.push(this._runForm(node));
        }
        groups.push(this._connectionsHTML(node));
        return groups.join('');
    }

    _dataNodeForm(node) {
        const out = [];
        out.push(group('Data Type',
            `<select data-field="dataType">${
                DATA_TYPES.map(([v, l]) => opt(v, l, node.dataType === v)).join('')
            }</select>`));
        out.push(group('Source',
            `<select data-field="source">${
                DATA_SOURCES.map(([v, l]) => opt(v, l, node.source === v)).join('')
            }</select>`));

        if (node.source === 'manual') {
            if (node.dataType === 'text') {
                out.push(group('Text Value',
                    `<textarea rows="5" data-field="value">${esc(node.value)}</textarea>`));
            } else {
                out.push(group(`${cap(node.dataType)} URL`,
                    `<input type="url" data-field="value" placeholder="https://..." value="${esc(node.value)}">`));
            }
        } else if (node.source === 'upload') {
            const accept = ACCEPT_FOR_TYPE[node.dataType] || '*/*';
            const loaded = node._uploadName
                ? `<div class="hint">Loaded: ${esc(node._uploadName)}</div>`
                : node.value
                    ? `<div class="hint">Current value loaded.</div>`
                    : '';
            out.push(group(`Upload ${cap(node.dataType)} File`,
                `<input type="file" data-upload accept="${accept}">${loaded}`));
        } else if (node.source === 'input') {
            out.push(group('Input Connection',
                `<div class="hint">Value will be supplied by an upstream node connected to the input slot.</div>`));
        }
        return out;
    }

    _generateForm(node) {
        const out  = node.params.output_type ?? 'image';

        const hints = {
            image:   '<b>Text → Image</b> via Gemini. Connect a text Data node to feed the prompt.',
            video:   '<b>Text → Video</b> via Veo. Optionally connect an image input to switch to <b>Image → Video</b>.',
            caption: '<b>Image/Video → Text</b> via Gemini. Connect an image or video input; the prompt below guides the caption.',
        };

        const groups = [
            group('Output Type',
                `<select data-param="output_type">${
                    OUTPUT_TYPES.map(([v, l]) => opt(v, l, out === v)).join('')
                }</select>`),
            `<div class="menu-group"><div class="hint">${hints[out]}</div></div>`,
        ];

        if (out === 'caption') {
            const p = node.params.caption_prompt ?? 'Describe this in vivid, prompt-style detail.';
            groups.push(group('Caption Instruction',
                `<textarea rows="3" data-param="caption_prompt">${esc(p)}</textarea>`));
        }
        if (out === 'image') {
            groups.push(...this._imageOptionGroups(node));
        }
        if (out === 'video') {
            groups.push(...this._videoOptionGroups(node));
        }
        return groups;
    }

    _modifyForm(node) {
        return [
            `<div class="menu-group">
                <div class="hint">Edits the upstream image with <b>Gemini</b> using the prompt below
                (or any connected text input).</div>
            </div>`,
            group('Default Operation / Prompt',
                `<select data-param="operation">${
                    OPERATIONS.map(o => opt(o, o, node.params.operation === o)).join('')
                }</select>`),
            ...this._imageOptionGroups(node, { advancedOnly: true }),
        ];
    }

    /** Nano Banana (Gemini 2.5 Flash Image) controls — shared by
     *  Generate→Image and Modify. When ``advancedOnly`` is true the
     *  aspect-ratio + seed are folded into the advanced block. */
    _imageOptionGroups(node, { advancedOnly = false } = {}) {
        const provider = node.params.image_provider ?? 'nanobanana';
        const iar    = node.params.image_aspect_ratio ?? '';
        const seed   = node.params.seed;
        const sz     = node.params.image_size ?? '';
        const pg     = node.params.person_generation ?? '';
        const mime   = node.params.output_mime_type ?? '';
        const cq     = node.params.output_compression_quality;
        const temp   = node.params.temperature;
        const sys    = node.params.system_instruction ?? '';

        const providerGroup = group('Image Model',
            `<select data-param="image_provider">
                ${IMAGE_PROVIDERS.map(([v, l]) => {
                    const info = (window.__providers || {})[v];
                    const unavail = info && info.available === false;
                    const label = unavail ? `${l}  \u2014 not configured` : l;
                    return `<option value="${v}"${provider === v ? ' selected' : ''}${unavail ? ' disabled' : ''}>${label}</option>`;
                }).join('')}
            </select>
            <div class="hint">
                ${provider === 'gpt_image'
                    ? 'Routes to your Azure OpenAI <code>gpt-image-1</code> deployment. Sizes are mapped to 1024×1024, 1536×1024, or 1024×1536.'
                    : 'Routes to Google Gemini 2.5 Flash Image (“Nano Banana”).'}
            </div>`);

        const aspectGroup = group('Aspect Ratio',
            `<select data-param="image_aspect_ratio">
                <option value=""${iar === '' ? ' selected' : ''}>Default</option>
                ${IMAGE_ASPECTS.map(a => opt(a, a, iar === a)).join('')}
            </select>`);

        const seedGroup = group('Seed',
            `<div class="seed-row">
                <input type="number" data-param="seed" data-cast="int_or_null"
                       min="0" max="2147483647" placeholder="random"
                       value="${seed == null ? '' : seed}">
                <button type="button" class="seed-btn" data-seed-random
                        data-seed-target="seed" title="Generate a random seed">Random</button>
                <button type="button" class="seed-btn" data-seed-clear
                        data-seed-target="seed" title="Clear (use random each run)">Clear</button>
            </div>
            <div class="hint">Leave blank for a random seed each run; set a value to make results reproducible.</div>`);

        const advanced = `
            <details class="adv-details">
                <summary>Advanced (Nano Banana)</summary>
                ${advancedOnly ? aspectGroup + seedGroup : ''}
                ${group('Image Size',
                    `<select data-param="image_size">
                        ${IMAGE_SIZES.map(([v, l]) => opt(v, l, sz === v)).join('')}
                    </select>`)}
                ${group('People in Output',
                    `<select data-param="person_generation">
                        ${PERSON_GEN.map(([v, l]) => opt(v, l, pg === v)).join('')}
                    </select>`)}
                ${group('Output Format',
                    `<select data-param="output_mime_type">
                        ${IMAGE_MIME.map(([v, l]) => opt(v, l, mime === v)).join('')}
                    </select>`)}
                ${group('Compression Quality (JPEG/WebP)',
                    `<input type="number" data-param="output_compression_quality" data-cast="int_or_null"
                            min="1" max="100" placeholder="default"
                            value="${cq == null ? '' : cq}">`)}
                ${group('Temperature',
                    `<input type="number" data-param="temperature" data-cast="float_or_null"
                            min="0" max="2" step="0.1" placeholder="default"
                            value="${temp == null ? '' : temp}">
                     <div class="hint">Higher = more creative variation. Empty = model default.</div>`)}
                ${group('System Instruction',
                    `<textarea rows="2" data-param="system_instruction"
                        placeholder="e.g. Always render in flat vector style.">${esc(sys)}</textarea>`)}
            </details>
        `;

        return advancedOnly
            ? [providerGroup, `<div class="menu-group">${advanced}</div>`]
            : [providerGroup, aspectGroup, seedGroup, `<div class="menu-group">${advanced}</div>`];
    }

    /** Veo controls. */
    _videoOptionGroups(node) {
        const provider = node.params.video_provider ?? 'veo';
        const dur   = node.params.duration_seconds ?? 8;
        const ar    = node.params.aspect_ratio ?? '16:9';
        const seed  = node.params.video_seed;
        const n     = node.params.number_of_videos ?? 1;
        const res   = node.params.resolution ?? '';
        const fps   = node.params.fps;
        const neg   = node.params.negative_prompt ?? '';
        const enh   = triString(node.params.enhance_prompt);
        const aud   = triString(node.params.generate_audio);
        const pg    = node.params.video_person_generation ?? '';
        const cq    = node.params.compression_quality ?? '';

        const providerGroup = group('Video Model',
            `<select data-param="video_provider">
                ${VIDEO_PROVIDERS.map(([v, l]) => {
                    const info = (window.__providers || {})[v];
                    const unavail = info && info.available === false;
                    const label = unavail ? `${l}  \u2014 not configured` : l;
                    return `<option value="${v}"${provider === v ? ' selected' : ''}${unavail ? ' disabled' : ''}>${label}</option>`;
                }).join('')}
            </select>
            <div class="hint">
                ${provider === 'veo'
                    ? 'Routes to Google Veo for text-to-video and image-to-video.'
                    : 'This provider isn\u2019t wired up yet — keep Veo selected to run generations.'}
            </div>`);

        return [
            providerGroup,
            group('Duration (seconds)',
                `<input type="number" data-param="duration_seconds" data-cast="int"
                        min="2" max="60" value="${dur}">`),
            group('Aspect Ratio',
                `<select data-param="aspect_ratio">${
                    ASPECTS.map(a => opt(a, a, ar === a)).join('')
                }</select>`),
            group('Number of Videos',
                `<input type="number" data-param="number_of_videos" data-cast="int"
                        min="1" max="4" value="${n}">`),
            group('Seed',
                `<div class="seed-row">
                    <input type="number" data-param="video_seed" data-cast="int_or_null"
                           min="0" max="2147483647" placeholder="random"
                           value="${seed == null ? '' : seed}">
                    <button type="button" class="seed-btn" data-seed-random
                            data-seed-target="video_seed" title="Generate a random seed">Random</button>
                    <button type="button" class="seed-btn" data-seed-clear
                            data-seed-target="video_seed" title="Clear">Clear</button>
                </div>`),
            `<div class="menu-group">
                <details class="adv-details">
                    <summary>Advanced (Veo)</summary>
                    ${group('Resolution',
                        `<select data-param="resolution">
                            ${VIDEO_RESOLUTIONS.map(([v, l]) => opt(v, l, res === v)).join('')}
                        </select>`)}
                    ${group('Frames per Second',
                        `<input type="number" data-param="fps" data-cast="int_or_null"
                                min="1" max="60" placeholder="default"
                                value="${fps == null ? '' : fps}">`)}
                    ${group('Negative Prompt',
                        `<textarea rows="2" data-param="negative_prompt"
                            placeholder="things to avoid">${esc(neg)}</textarea>`)}
                    ${group('Enhance Prompt',
                        `<select data-param="enhance_prompt" data-cast="tristate">
                            ${TRISTATE.map(([v, l]) => opt(v, l, enh === v)).join('')}
                        </select>
                         <div class="hint">Let Veo rewrite your prompt for better results.</div>`)}
                    ${group('Generate Audio',
                        `<select data-param="generate_audio" data-cast="tristate">
                            ${TRISTATE.map(([v, l]) => opt(v, l, aud === v)).join('')}
                        </select>`)}
                    ${group('People in Output',
                        `<select data-param="video_person_generation">
                            ${PERSON_GEN.map(([v, l]) => opt(v, l, pg === v)).join('')}
                        </select>`)}
                    ${group('Compression Quality',
                        `<select data-param="compression_quality">
                            ${VIDEO_COMPRESSION.map(([v, l]) => opt(v, l, cq === v)).join('')}
                        </select>`)}
                </details>
            </div>`,
        ];
    }

    _runForm(_node) {
        return `
            <div class="menu-group run-group">
                <button type="button" class="run-btn" data-run>▶ Run</button>
                <div class="hint" data-run-status></div>
            </div>
        `;
    }

    /**
     * Button-based connection panel. Lists every input/output slot on the
     * selected node together with its existing connections (× to remove)
     * and a dropdown of compatible slots on other nodes (+ to add).
     */
    _connectionsHTML(node) {
        const outs = (node.outputs || []).map(s => this._slotRowHTML(node, s, 'out'));
        const ins  = (node.inputs  || []).map(s => this._slotRowHTML(node, s, 'in'));
        const body = [...outs, ...ins].join('') ||
            '<div class="hint">This node has no slots.</div>';
        return `
            <div class="menu-group connections-group">
                <label>Connections</label>
                <div class="hint" style="margin-bottom:8px;">
                    Tip: click any slot on a node, then click a compatible slot on another node to wire them up.
                </div>
                ${body}
            </div>
        `;
    }

    _slotRowHTML(node, slotName, kind) {
        const slotId = `${node.id}-${slotName}`;
        const isOut = kind === 'out';
        // Existing connections on this slot.
        const existing = store.connections.filter(c =>
            isOut ? c.from === slotId : c.to === slotId
        );
        const peerOf = c => isOut ? c.to : c.from;
        const chips = existing.map(c => {
            const peerId = peerOf(c);
            const [peerNodeId] = peerId.split('-');
            const peerNode = store.getNode(peerNodeId);
            const label = peerNode
                ? `${esc(peerNode.title)} · ${esc(peerId.slice(peerNodeId.length + 1))}`
                : esc(peerId);
            return `<span class="conn-chip">
                ${label}
                <button type="button" class="conn-x"
                        data-disconnect data-from="${esc(c.from)}" data-to="${esc(c.to)}"
                        title="Disconnect">×</button>
            </span>`;
        }).join('');

        // Compatible candidate slots on other nodes.
        const want = isOut ? 'inputs' : 'outputs';
        const candidates = [];
        for (const other of store.nodes.values()) {
            if (other.id === node.id) continue;
            for (const s of (other[want] || [])) {
                const otherSlotId = `${other.id}-${s}`;
                // Skip if a connection in the same direction already exists.
                const exists = store.connections.some(c =>
                    isOut ? (c.from === slotId && c.to === otherSlotId)
                          : (c.to === slotId && c.from === otherSlotId));
                if (exists) continue;
                candidates.push({ value: otherSlotId, label: `${other.title} · ${s}` });
            }
        }
        const options = candidates.length
            ? candidates.map(c => `<option value="${esc(c.value)}">${esc(c.label)}</option>`).join('')
            : '<option value="" disabled>No compatible slots</option>';

        return `
            <div class="conn-row">
                <div class="conn-label">
                    <span class="conn-kind ${isOut ? 'out' : 'in'}">${isOut ? 'OUT' : 'IN'}</span>
                    <span>${esc(slotName)}</span>
                </div>
                ${chips ? `<div class="conn-chips">${chips}</div>` : ''}
                <div class="conn-add">
                    <select data-conn-target>
                        <option value="">Connect ${isOut ? 'to…' : 'from…'}</option>
                        ${options}
                    </select>
                    <button type="button" class="conn-go"
                            data-connect data-slot="${esc(slotId)}" data-kind="${kind}"
                            ${candidates.length ? '' : 'disabled'}>+</button>
                </div>
            </div>
        `;
    }

    _onChange = (e) => {
        const t = e.target;
        const node = store.activeNode;
        if (!node) return;

        if (t.matches('[data-upload]')) {
            this._handleUpload(t, node);
            return;
        }
        if (!t.matches('[data-field], [data-param]')) return;

        const value = cast(t);
        if (t.dataset.field) {
            store.updateNode(node.id, t.dataset.field, value);
            if (t.dataset.field === 'title') {
                this.titleEl.textContent = `${value} Settings`;
            }
            // Changing data type or source invalidates the existing payload
            // and reshapes the form itself.
            if (t.dataset.field === 'dataType' || t.dataset.field === 'source') {
                this._revokeObjectUrl(node.id);
                store.updateNode(node.id, 'value', '');
                store.updateNode(node.id, '_uploadName', '');
                this._rerender(node);
            }
        } else {
            store.updateNodeParam(node.id, t.dataset.param, value);
            // Some params reshape the form itself — re-render the panel.
            if (t.dataset.param === 'output_type'
                || t.dataset.param === 'image_provider'
                || t.dataset.param === 'video_provider') {
                this._rerender(node);
            }
        }
    };

    _handleUpload(input, node) {
        const file = input.files && input.files[0];
        if (!file) return;
        // Revoke any prior blob URL we issued for this node to free memory.
        this._revokeObjectUrl(node.id);

        if (node.dataType === 'text') {
            file.text().then(txt => store.updateNode(node.id, 'value', txt));
            this._objectUrls.delete(node.id);
            return;
        }
        const url = URL.createObjectURL(file);
        this._objectUrls.set(node.id, url);
        store.updateNode(node.id, 'value', url);
        // Re-render so the "Loaded: filename" hint appears.
        store.updateNode(node.id, '_uploadName', file.name);
        this._rerender(node);
    }

    _rerender(node) {
        // Cheap: rebuild this panel only — much smaller than the canvas.
        this.openFor(node.id);
    }

    _onKey = (e) => {
        if (e.key !== 'Escape') return;
        if (!this.root.classList.contains('open')) return;
        e.preventDefault();
        this.close();
    };

    _onBeforeUnload = () => {
        this._revokeAllObjectUrls();
    };

    _onClick = async (e) => {
        // Seed quick-action buttons.
        const seedRand = e.target.closest('[data-seed-random]');
        if (seedRand) {
            const node = store.activeNode;
            if (!node) return;
            const target = seedRand.dataset.seedTarget || 'seed';
            const value  = Math.floor(Math.random() * 2_147_483_647);
            store.updateNodeParam(node.id, target, value);
            const input = this.fieldsEl.querySelector(`[data-param="${target}"]`);
            if (input) input.value = value;
            return;
        }
        const seedClear = e.target.closest('[data-seed-clear]');
        if (seedClear) {
            const node = store.activeNode;
            if (!node) return;
            const target = seedClear.dataset.seedTarget || 'seed';
            store.updateNodeParam(node.id, target, null);
            const input = this.fieldsEl.querySelector(`[data-param="${target}"]`);
            if (input) input.value = '';
            return;
        }

        // Connection management buttons (no active-node guard needed for these).
        const disc = e.target.closest('[data-disconnect]');
        if (disc) {
            store.removeConnection(disc.dataset.from, disc.dataset.to);
            return;
        }
        const conn = e.target.closest('[data-connect]');
        if (conn) {
            const select = conn.parentElement.querySelector('[data-conn-target]');
            const target = select && select.value;
            if (!target) return;
            const kind = conn.dataset.kind;
            const from = kind === 'out' ? conn.dataset.slot : target;
            const to   = kind === 'in'  ? conn.dataset.slot : target;
            store.addConnection(from, to);
            return;
        }

        // Run button.
        const btn = e.target.closest('[data-run]');
        if (!btn) return;
        const node = store.activeNode;
        if (!node) return;
        const status = this.fieldsEl.querySelector('[data-run-status]');
        btn.disabled = true;
        if (status) { status.textContent = 'Running…'; status.dataset.kind = 'pending'; }
        try {
            const url = await runNode(node.id);
            if (status) {
                status.textContent = `✔ Done — ${url}`;
                status.dataset.kind = 'ok';
            }
        } catch (err) {
            if (status) {
                status.textContent = `✗ ${err.message || err}`;
                status.dataset.kind = 'err';
            }
        } finally {
            btn.disabled = false;
        }
    };
}

/* ── helpers ── */
const ESC = document.createElement('div');
function esc(s) { ESC.textContent = String(s ?? ''); return ESC.innerHTML; }

function group(label, html) {
    return `<div class="menu-group"><label>${label}</label>${html}</div>`;
}

function cast(input) {
    if (input.dataset.cast === 'int') return parseInt(input.value, 10) || 0;
    if (input.dataset.cast === 'int_or_null') {
        const v = input.value.trim();
        if (v === '') return null;
        const n = parseInt(v, 10);
        return Number.isFinite(n) ? n : null;
    }
    if (input.dataset.cast === 'float_or_null') {
        const v = input.value.trim();
        if (v === '') return null;
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }
    if (input.dataset.cast === 'tristate') {
        if (input.value === '')      return null;
        if (input.value === 'true')  return true;
        if (input.value === 'false') return false;
        return null;
    }
    if (input.dataset.cast === 'float') return parseFloat(input.value) || 0;
    return input.value;
}

function triString(v) {
    if (v === true)  return 'true';
    if (v === false) return 'false';
    return '';
}

function cap(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
}
