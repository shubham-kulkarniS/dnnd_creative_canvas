/**
 * Sidebar form builders.
 *
 * Every function returns an HTML string the caller will paste into
 * `#sidebar-fields`. The `group()` helper now generates a unique id
 * per control and emits a properly associated `<label for>` pair —
 * fixing the historical a11y gap where labels lived next to (but were
 * not bound to) their inputs.
 *
 * Pure presentation: no `store` mutations, no event wiring. The
 * sidebar controller owns delegation via `data-field`/`data-param`.
 */

import { store } from '../state.js';
import { esc }   from './dom.js';

const OPERATIONS    = ['Enhance', 'Upscale 2x', 'Denoise', 'Inpaint', 'Restyle', 'Remove background'];
const ASPECTS       = ['16:9', '9:16', '1:1'];
const IMAGE_ASPECTS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];

const IMAGE_PROVIDERS = [
    ['nanobanana', 'Nano Banana · Gemini 2.5 Flash Image'],
    ['gpt_image',  'GPT Image · Azure OpenAI gpt-image-1'],
];

const VIDEO_PROVIDERS = [
    ['veo',       'Veo · Google'],
    ['gpt_video', 'GPT Video · OpenAI (coming soon)'],
    ['ltx',       'LTX · Lightricks (coming soon)'],
];

const IMAGE_SIZES       = [['', 'Default'], ['1K', '1K'], ['2K', '2K']];
const PERSON_GEN        = [['', 'Default'], ['DONT_ALLOW', 'Don\u2019t allow'],
                           ['ALLOW_ADULT', 'Allow adults'], ['ALLOW_ALL', 'Allow all']];
const IMAGE_MIME        = [['', 'Default'], ['image/png', 'PNG'],
                           ['image/jpeg', 'JPEG'], ['image/webp', 'WebP']];

const VIDEO_RESOLUTIONS = [['', 'Default'], ['720p', '720p'], ['1080p', '1080p']];
const VIDEO_COMPRESSION = [['', 'Default'], ['OPTIMIZED', 'Optimized'], ['LOSSLESS', 'Lossless']];
const TRISTATE          = [['', 'Default'], ['true', 'On'], ['false', 'Off']];

const OUTPUT_TYPES = [
    ['image',   'Image  ·  text → image'],
    ['video',   'Video  ·  text → video, or image → video'],
    ['caption', 'Caption  ·  image / video → text'],
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

/* ── small helpers ── */

let _uid = 0;
function uid(prefix) { return `${prefix}-${++_uid}`; }

const opt = (val, label, selected) =>
    `<option value="${val}"${selected ? ' selected' : ''}>${label}</option>`;

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

const triString = (v) => (v === true ? 'true' : v === false ? 'false' : '');

/**
 * Build a `.menu-group` with a label correctly associated to its
 * primary control via `for`/`id`. The caller may pass a raw HTML
 * fragment as `body`; if it contains an element with `data-field` or
 * `data-param` we'll set an id on it via string-rewrite so the label
 * binds. For multi-control bodies (e.g. seed-row) the caller can pass
 * an explicit `inputId`.
 */
export function group(label, body, { hint, inputId } = {}) {
    let html = body;
    let forId = inputId;

    if (!forId) {
        // Find the first data-field / data-param element and inject an id.
        const m = html.match(/data-(field|param|upload)="([^"]+)"/);
        if (m) {
            forId = uid(m[1] + '-' + m[2].replace(/[^a-z0-9_-]/gi, ''));
            html = html.replace(
                m[0],
                `${m[0]} id="${forId}"`,
            );
        }
    } else {
        // Caller-supplied id — make sure exactly one input carries it.
        html = html.replace(
            /data-(field|param|upload)="[^"]+"/,
            (s) => `${s} id="${forId}"`,
        );
    }

    const labelTag = forId
        ? `<label for="${forId}">${label}</label>`
        : `<label>${label}</label>`;
    const hintTag = hint ? `<div class="hint">${hint}</div>` : '';
    return `<div class="menu-group">${labelTag}${html}${hintTag}</div>`;
}

/* ──────────────────────────────────────────────────────────────────
 *  Top-level form HTML
 * ─────────────────────────────────────────────────────────────── */

export function formHTML(node) {
    const groups = [
        group('Node Display Name',
            `<input type="text" data-field="title" value="${esc(node.title)}">`),
    ];

    if (node.type === 'data') {
        groups.push(...dataNodeForm(node));
    } else if (node.type === 'generate') {
        groups.push(...generateForm(node));
        groups.push(runForm());
    } else if (node.type === 'modify') {
        groups.push(...modifyForm(node));
        groups.push(runForm());
    } else if (node.type === 'embed') {
        groups.push(...embedForm(node));
        // Embed nodes have no slots, so skip the Connections panel.
        return groups.join('');
    }
    groups.push(connectionsHTML(node));
    return groups.join('');
}

/* ── Embed ── */

export function embedForm(node) {
    const url = esc(node.embedUrl ?? '');
    const h   = parseInt(node.embedHeight, 10) || 480;
    return [
        group('App URL',
            `<input type="url" data-field="embedUrl"
                    placeholder="127.0.0.1:7860 or https://…"
                    value="${url}" autocomplete="off" spellcheck="false">`,
            { hint: 'IP:port shortcut works — <code>http://</code> is filled in for you.' }),
        group('Frame Height',
            `<input type="number" data-field="embedHeight" min="160" max="1200"
                    step="20" value="${h}">`,
            { hint: 'Pixels. The iframe scrolls if the app needs more.' }),
        `<div class="menu-group"><div class="hint">
            The embedded app runs sandboxed: it can't read this canvas's
            cookies, storage, or DOM. Copy any output URLs from inside
            the app and paste them into a Data node to flow them
            through the pipeline.
        </div></div>`,
    ];
}

/* ── Data node ── */

export function dataNodeForm(node) {
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
        out.push(`<div class="menu-group"><div class="hint">
            Value will be supplied by an upstream node connected to the input slot.
        </div></div>`);
    }
    return out;
}

/* ── Generate ── */

export function generateForm(node) {
    const out = node.params.output_type ?? 'image';
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
    if (out === 'image') groups.push(...imageOptionGroups(node));
    if (out === 'video') groups.push(...videoOptionGroups(node));
    return groups;
}

/* ── Modify ── */

export function modifyForm(node) {
    return [
        `<div class="menu-group"><div class="hint">
            Edits the upstream image with <b>Gemini</b> using the prompt below
            (or any connected text input).
        </div></div>`,
        group('Default Operation / Prompt',
            `<select data-param="operation">${
                OPERATIONS.map(o => opt(o, o, node.params.operation === o)).join('')
            }</select>`),
        ...imageOptionGroups(node, { advancedOnly: true }),
    ];
}

/* ── Image (Nano Banana / GPT Image) shared block ── */

export function imageOptionGroups(node, { advancedOnly = false } = {}) {
    const provider = node.params.image_provider ?? 'nanobanana';
    const iar      = node.params.image_aspect_ratio ?? '';
    const seed     = node.params.seed;
    const sz       = node.params.image_size ?? '';
    const pg       = node.params.person_generation ?? '';
    const mime     = node.params.output_mime_type ?? '';
    const cq       = node.params.output_compression_quality;
    const temp     = node.params.temperature;
    const sys      = node.params.system_instruction ?? '';

    const providerGroup = group('Image Model',
        `<select data-param="image_provider">
            ${IMAGE_PROVIDERS.map(([v, l]) => {
                const info = (window.__providers || {})[v];
                const unavail = info && info.available === false;
                const labelText = unavail ? `${l}  \u2014 not configured` : l;
                return `<option value="${v}"${provider === v ? ' selected' : ''}${unavail ? ' disabled' : ''}>${labelText}</option>`;
            }).join('')}
        </select>`,
        { hint: provider === 'gpt_image'
            ? 'Routes to your Azure OpenAI <code>gpt-image-1</code> deployment. Sizes are mapped to 1024×1024, 1536×1024, or 1024×1536.'
            : 'Routes to Google Gemini 2.5 Flash Image (“Nano Banana”).' });

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
        </div>`,
        { hint: 'Leave blank for a random seed each run; set a value to make results reproducible.' });

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
                        value="${temp == null ? '' : temp}">`,
                { hint: 'Higher = more creative variation. Empty = model default.' })}
            ${group('System Instruction',
                `<textarea rows="2" data-param="system_instruction"
                    placeholder="e.g. Always render in flat vector style.">${esc(sys)}</textarea>`)}
        </details>
    `;

    return advancedOnly
        ? [providerGroup, `<div class="menu-group">${advanced}</div>`]
        : [providerGroup, aspectGroup, seedGroup, `<div class="menu-group">${advanced}</div>`];
}

/* ── Video (Veo) ── */

export function videoOptionGroups(node) {
    const provider = node.params.video_provider ?? 'veo';
    const dur      = node.params.duration_seconds ?? 8;
    const ar       = node.params.aspect_ratio ?? '16:9';
    const seed     = node.params.video_seed;
    const n        = node.params.number_of_videos ?? 1;
    const res      = node.params.resolution ?? '';
    const fps      = node.params.fps;
    const neg      = node.params.negative_prompt ?? '';
    const enh      = triString(node.params.enhance_prompt);
    const aud      = triString(node.params.generate_audio);
    const pg       = node.params.video_person_generation ?? '';
    const cq       = node.params.compression_quality ?? '';

    const providerGroup = group('Video Model',
        `<select data-param="video_provider">
            ${VIDEO_PROVIDERS.map(([v, l]) => {
                const info = (window.__providers || {})[v];
                const unavail = info && info.available === false;
                const labelText = unavail ? `${l}  \u2014 not configured` : l;
                return `<option value="${v}"${provider === v ? ' selected' : ''}${unavail ? ' disabled' : ''}>${labelText}</option>`;
            }).join('')}
        </select>`,
        { hint: provider === 'veo'
            ? 'Routes to Google Veo for text-to-video and image-to-video.'
            : 'This provider isn\u2019t wired up yet — keep Veo selected to run generations.' });

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
                    </select>`,
                    { hint: 'Let Veo rewrite your prompt for better results.' })}
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

/* ── Run CTA ── */

export function runForm() {
    return `
        <div class="menu-group run-group">
            <button type="button" class="run-btn" data-run>Run</button>
            <div class="hint" data-run-status></div>
        </div>
    `;
}

/* ── Connections panel ── */

export function connectionsHTML(node) {
    const outs = (node.outputs || []).map(s => slotRowHTML(node, s, 'out'));
    const ins  = (node.inputs  || []).map(s => slotRowHTML(node, s, 'in'));
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

function slotRowHTML(node, slotName, kind) {
    const slotId = `${node.id}-${slotName}`;
    const isOut = kind === 'out';
    const existing = store.connections.filter(c =>
        isOut ? c.from === slotId : c.to === slotId,
    );
    const peerOf = c => isOut ? c.to : c.from;
    const chips = existing.map(c => {
        const peerId = peerOf(c);
        const [peerNodeId] = peerId.split('-');
        const peerNode = store.getNode(peerNodeId);
        const labelText = peerNode
            ? `${esc(peerNode.title)} · ${esc(peerId.slice(peerNodeId.length + 1))}`
            : esc(peerId);
        return `<span class="conn-chip">
            ${labelText}
            <button type="button" class="conn-x"
                    data-disconnect data-from="${esc(c.from)}" data-to="${esc(c.to)}"
                    aria-label="Disconnect" title="Disconnect">×</button>
        </span>`;
    }).join('');

    const want = isOut ? 'inputs' : 'outputs';
    const candidates = [];
    for (const other of store.nodes.values()) {
        if (other.id === node.id) continue;
        for (const s of (other[want] || [])) {
            const otherSlotId = `${other.id}-${s}`;
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
                <select data-conn-target aria-label="Pick a compatible slot">
                    <option value="">Connect ${isOut ? 'to…' : 'from…'}</option>
                    ${options}
                </select>
                <button type="button" class="conn-go"
                        data-connect data-slot="${esc(slotId)}" data-kind="${kind}"
                        aria-label="Add connection"
                        ${candidates.length ? '' : 'disabled'}>+</button>
            </div>
        </div>
    `;
}

/* ── Input casting (used by sidebar controller via re-export). ── */

export function cast(input) {
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
