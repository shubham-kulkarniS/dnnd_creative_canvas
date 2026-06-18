/**
 * Toolbar: add new nodes and delete the active one.
 *
 * Newly created nodes are positioned at the centre of the current
 * viewport (accounting for pan/zoom) and immediately selected so the
 * sidebar opens for tweaking.
 */

import { store } from './state.js';

const TEMPLATES = {
    data: (variant = 'text') => ({
        type: 'data',
        title: `Data · ${cap(variant)}`,
        dataType: variant,                       // 'text' | 'image' | 'video'
        source: 'manual',
        value: '',
        inputs: ['in_1'],
        outputs: ['out_1'],
    }),
    generate: (variant = 'image') => {
        // Toolbar exposes text/image/video; "text" maps to the existing
        // caption mode (image/video → text) in the backend schema.
        const output_type = variant === 'text' ? 'caption' : variant;
        const titleSuffix = variant === 'text' ? 'Text' : cap(variant);
        return {
            type: 'generate',
            title: `Generate · ${titleSuffix}`,
            inputs: ['in_1', 'in_2'],
            outputs: ['out_1'],
            params: {
                output_type,
                // —— Image provider
                image_provider: 'nanobanana',        // 'nanobanana' | 'gpt_image'
                // —— Image (T2I) controls
                image_aspect_ratio: '16:9',
                seed: null,                          // null = random each run
                image_size: null,                    // null = model default; '1K'|'2K'
                person_generation: null,             // null = default; DONT_ALLOW|ALLOW_ADULT|ALLOW_ALL
                output_mime_type: null,              // null = default; image/png|jpeg|webp
                output_compression_quality: null,    // 1-100 (JPEG/WEBP only)
                temperature: null,                   // 0-2 creativity
                system_instruction: '',              // optional style/system text
                // —— Video provider (UI-only for now — backend always uses Veo).
                video_provider: 'veo',               // 'veo' | 'gpt_video' | 'ltx'
                // —— Video (T2V / I2V) controls
                duration_seconds: 8,
                aspect_ratio: '16:9',
                video_seed: null,
                number_of_videos: 1,
                resolution: null,                    // '720p'|'1080p'
                fps: null,                           // 1-60
                negative_prompt: '',
                enhance_prompt: null,                // tri-state: null|true|false
                generate_audio: null,
                video_person_generation: null,
                compression_quality: null,           // 'OPTIMIZED'|'LOSSLESS'
                // —— Caption (I2T / V2T) controls
                caption_prompt: 'Describe this in vivid, prompt-style detail.',
            },
        };
    },
    modify: () => ({
        type: 'modify',
        title: 'Modify',
        inputs: ['in_1'],
        outputs: ['out_1'],
        params: {
            operation: 'Enhance',
            // Same Nano Banana knobs as Generate → Image.
            image_provider: 'nanobanana',
            image_aspect_ratio: null,
            seed: null,
            image_size: null,
            person_generation: null,
            output_mime_type: null,
            output_compression_quality: null,
            temperature: null,
            system_instruction: '',
        },
    }),
};

export class Toolbar {
    constructor(toolbarEl, containerEl, deleteBtn) {
        this.container = containerEl;
        this.deleteBtn = deleteBtn;

        toolbarEl.addEventListener('click', this._onClick);
        deleteBtn.addEventListener('click', () => this._deleteActive());
        window.addEventListener('keydown', this._onKey);
        store.on('selection:changed', (id) => {
            deleteBtn.disabled = !id;
        });
    }

    _onClick = (e) => {
        const btn = e.target.closest('[data-add-node]');
        if (!btn) return;
        this._addNode(btn.dataset.addNode);
    };

    _onKey = (e) => {
        // Don't hijack keys while typing in the sidebar.
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && store.activeNodeId) {
            e.preventDefault();
            this._deleteActive();
        }
    };

    _variantFor(kind) {
        const sel = document.getElementById(`${kind}-variant`);
        return sel ? sel.value : undefined;
    }

    /** Which field in the freshly-opened sidebar should be flashed to
     *  draw the user's attention. */
    _highlightFor(kind, variant) {
        if (kind === 'generate') {
            if (variant === 'image') return { type: 'param', name: 'image_provider' };
            if (variant === 'video') return { type: 'param', name: 'video_provider' };
            // 'text' → caption: no provider selector, nudge the prompt.
            if (variant === 'text')  return { type: 'param', name: 'caption_prompt' };
        }
        if (kind === 'data') {
            // No model to pick; nudge the source selector instead.
            return { type: 'field', name: 'source' };
        }
        return null;
    }

    _addNode(kind) {
        const factory = TEMPLATES[kind];
        if (!factory) return;
        const variant = this._variantFor(kind);
        const { x, y } = this._viewportCenter();
        const node = {
            id: store.nextNodeId(),
            x: x - 110, // half of node min-width
            y: y - 40,
            ...factory(variant),
        };
        store.addNode(node);
        store.setActive(node.id);

        // After the sidebar renders, flash the most relevant control.
        const hl = this._highlightFor(kind, variant);
        if (hl) {
            requestAnimationFrame(() => {
                window.dispatchEvent(new CustomEvent('sidebar:highlight', {
                    detail: { nodeId: node.id, ...hl },
                }));
            });
        }
    }

    _deleteActive() {
        const id = store.activeNodeId;
        if (id) store.removeNode(id);
    }

    _viewportCenter() {
        const rect = this.container.getBoundingClientRect();
        const { panX, panY, zoom } = store.view;
        return {
            x: (rect.width  / 2 - panX) / zoom,
            y: (rect.height / 2 - panY) / zoom,
        };
    }
}

function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
