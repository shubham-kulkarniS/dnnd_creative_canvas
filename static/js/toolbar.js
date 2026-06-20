/**
 * Toolbar: add new nodes and delete the active one.
 *
 * Newly created nodes are positioned at the centre of the current
 * viewport (accounting for pan/zoom) and immediately selected so the
 * sidebar opens for tweaking.
 */

import { store }       from './state.js';
import { runPipeline } from './pipeline.js';
import { alertDialog } from './ui/dialog.js';

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
    modify: (variant = 'image') => ({
        type: 'modify',
        title: `Modify · ${cap(variant)}`,
        // Carry the media kind so downstream code (and the sidebar)
        // can specialise behaviour per variant even though the
        // backend modify route is currently image-only.
        dataType: variant,
        inputs: ['in_1'],
        outputs: ['out_1'],
        params: {
            // "Enhance" reads sensibly for all three variants
            // (enhance text / enhance image / enhance video).
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

/**
 * Maps the new (group, action) toolbar selection to a concrete
 * `(kind, variant)` pair that ``_addNode`` understands.
 *
 *   group=text   action=input    → data(text)
 *   group=text   action=enhance  → modify(text)
 *   group=text   action=caption  → generate(text)   ← backend caption mode
 *   group=image  action=data     → data(image)
 *   group=image  action=generate → generate(image)
 *   group=image  action=modify   → modify(image)
 *   group=video  action=data     → data(video)
 *   group=video  action=generate → generate(video)
 *   group=video  action=modify   → modify(video)
 */
const GROUP_ACTIONS = {
    text: {
        input:    { kind: 'data',     variant: 'text'  },
        enhance:  { kind: 'modify',   variant: 'text'  },
        caption:  { kind: 'generate', variant: 'text'  },
    },
    image: {
        data:     { kind: 'data',     variant: 'image' },
        generate: { kind: 'generate', variant: 'image' },
        modify:   { kind: 'modify',   variant: 'image' },
    },
    video: {
        data:     { kind: 'data',     variant: 'video' },
        generate: { kind: 'generate', variant: 'video' },
        modify:   { kind: 'modify',   variant: 'video' },
    },
};

export class Toolbar {
    constructor(toolbarEl, containerEl, deleteBtn, runBtn = null) {
        this.toolbar   = toolbarEl;
        this.container = containerEl;
        this.deleteBtn = deleteBtn;
        this.runBtn    = runBtn;
        this._openMenu = null;     // currently-open <div class="tb-menu">
        this._running  = false;    // pipeline in flight?

        toolbarEl.addEventListener('click', this._onClick);
        deleteBtn.addEventListener('click', () => this._deleteActive());
        runBtn?.addEventListener('click', () => this._executePipeline());
        window.addEventListener('keydown', this._onKey);
        // Close any open popover when the user clicks elsewhere or
        // scrolls/zooms the canvas.
        document.addEventListener('pointerdown', this._onDocPointer, true);
        window.addEventListener('blur', () => this._closeMenu());
        store.on('selection:changed', (id) => {
            deleteBtn.disabled = !id;
        });
        // Reflect pipeline state on the Run button so the user gets a
        // clear visual signal that work is in flight.
        store.on('pipeline:started', () => this._setRunningUI(true));
        store.on('pipeline:settled', () => this._setRunningUI(false));
    }

    _onClick = (e) => {
        // 1) Group `+` chip → toggle the matching popover.
        const groupBtn = e.target.closest('[data-group-add]');
        if (groupBtn && this.toolbar.contains(groupBtn)) {
            e.preventDefault();
            this._toggleMenu(groupBtn.dataset.groupAdd, groupBtn);
            return;
        }
        // 2) Menu item → resolve group:action and add the node.
        const item = e.target.closest('[data-add]');
        if (item && this.toolbar.contains(item)) {
            e.preventDefault();
            const [group, action] = (item.dataset.add || '').split(':');
            this._addFromMenu(group, action);
            return;
        }
        // 3) Legacy data-add-node path (kept for back-compat callers).
        const legacy = e.target.closest('[data-add-node]');
        if (legacy && this.toolbar.contains(legacy)) {
            this._addNode(legacy.dataset.addNode);
        }
    };

    _onKey = (e) => {
        // Esc closes any open Add-node popover first.
        if (e.key === 'Escape' && this._openMenu) {
            e.preventDefault();
            this._closeMenu();
            return;
        }
        // Don't hijack keys while typing in the sidebar.
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && store.activeNodeId) {
            e.preventDefault();
            this._deleteActive();
            return;
        }
        // Cmd/Ctrl + Enter — execute the pipeline (matches Run-in-REPL
        // / Run-cell shortcuts in most ML notebook tools).
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            this._executePipeline();
            return;
        }
        // Ctrl/Cmd + +/− or =/− resizes the active node. We deliberately
        // require the modifier so plain "+" remains free for typing.
        if (store.activeNodeId && (e.ctrlKey || e.metaKey)) {
            if (e.key === '+' || e.key === '=') { e.preventDefault(); this._resizeActive(+1); return; }
            if (e.key === '-' || e.key === '_') { e.preventDefault(); this._resizeActive(-1); return; }
        }
    };

    /**
     * Step the active node's width by ±60px. Bounds are enforced in
     * the store/renderer; this just emits the intent.
     */
    _resizeActive(direction) {
        const id = store.activeNodeId;
        if (!id) return;
        const node = store.getNode(id);
        if (!node) return;
        const NODE_W_MIN = 200;
        const NODE_W_MAX = 800;
        const NODE_W_STEP = 60;
        const NODE_W_DEFAULT = 220;
        const cur = node.width || NODE_W_DEFAULT;
        const next = Math.max(NODE_W_MIN, Math.min(NODE_W_MAX, cur + direction * NODE_W_STEP));
        if (next !== cur) store.updateNode(id, 'width', next);
    }

    _variantFor(kind) {
        // Legacy hook: older callers used the now-removed <select>
        // controls. Return undefined so the templates fall back to
        // their default variants.
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
        if (kind === 'modify') {
            return { type: 'param', name: 'operation' };
        }
        return null;
    }

    /** Entry point used by the new group-action popover items. */
    _addFromMenu(group, action) {
        const mapping = GROUP_ACTIONS[group]?.[action];
        this._closeMenu();
        if (!mapping) return;
        this._addNode(mapping.kind, mapping.variant);
    }

    _addNode(kind, variant) {
        const factory = TEMPLATES[kind];
        if (!factory) return;
        // ``variant`` from the new menu wins; otherwise fall back to
        // any legacy <select> the page might still expose, and finally
        // to the template's own default.
        const v = variant ?? this._variantFor(kind);
        const { x, y } = this._viewportCenter();
        const node = {
            id: store.nextNodeId(),
            x: x - 110, // half of node min-width
            y: y - 40,
            ...factory(v),
        };
        store.addNode(node);
        store.setActive(node.id);

        // After the sidebar renders, flash the most relevant control.
        const hl = this._highlightFor(kind, v);
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

    /* ── Pipeline execution ─────────────────────────────────────── */

    /**
     * Run every runnable (generate / modify) node in topological order.
     * Re-entrancy guard via ``this._running`` so an accidental double
     * click (or shortcut spam) never overlaps two pipelines.
     */
    async _executePipeline() {
        if (this._running) return;
        this._running = true;
        try {
            const result = await runPipeline({ continueOnError: false });
            if (result.failed.length) {
                const first = result.failed[0];
                alertDialog(
                    `Pipeline halted: ${first.error}\n\n` +
                    `${result.succeeded.length} succeeded, ` +
                    `${result.failed.length} failed, ` +
                    `${result.skipped.length} skipped.`,
                    { kind: 'err' },
                );
            }
        } finally {
            this._running = false;
        }
    }

    /**
     * Reflect pipeline lifecycle on the Run button so the user gets
     * a clear "work in flight" signal. Disables the button so a
     * second click can't queue an overlapping run.
     */
    _setRunningUI(running) {
        if (!this.runBtn) return;
        this.runBtn.classList.toggle('is-running', running);
        this.runBtn.disabled = running;
        this.runBtn.setAttribute('aria-busy', running ? 'true' : 'false');
    }

    _viewportCenter() {
        const rect = this.container.getBoundingClientRect();
        const { panX, panY, zoom } = store.view;
        return {
            x: (rect.width  / 2 - panX) / zoom,
            y: (rect.height / 2 - panY) / zoom,
        };
    }

    /* ── Add-node popover plumbing ──────────────────────────────── */

    _toggleMenu(group, anchor) {
        const menu = this.toolbar.querySelector(`[data-group-menu="${group}"]`);
        if (!menu) return;
        if (this._openMenu === menu) { this._closeMenu(); return; }
        this._closeMenu();
        menu.hidden = false;
        anchor.setAttribute('aria-expanded', 'true');
        anchor.classList.add('is-open');
        this._openMenu = menu;
        this._openAnchor = anchor;
        // Focus the first menuitem for keyboard users.
        requestAnimationFrame(() => menu.querySelector('[role="menuitem"]')?.focus?.());
    }

    _closeMenu() {
        if (!this._openMenu) return;
        this._openMenu.hidden = true;
        this._openMenu = null;
        if (this._openAnchor) {
            this._openAnchor.setAttribute('aria-expanded', 'false');
            this._openAnchor.classList.remove('is-open');
            this._openAnchor = null;
        }
    }

    _onDocPointer = (e) => {
        if (!this._openMenu) return;
        // Clicks inside the toolbar are handled by the delegated click
        // listener (which closes the menu on item-select); only react
        // to clicks elsewhere on the page.
        if (this.toolbar.contains(e.target)) return;
        this._closeMenu();
    };
}

function cap(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
