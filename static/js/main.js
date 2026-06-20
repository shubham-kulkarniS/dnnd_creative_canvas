/**
 * Application bootstrap — wires DOM, state, and controllers together.
 */

import { store }              from './state.js';
import { CanvasController }   from './canvas.js';
import { NodeRenderer }       from './nodes.js';
import { ConnectionRenderer } from './connections.js';
import { Sidebar }            from './sidebar.js';
import { Toolbar }            from './toolbar.js';
import { Wiring }             from './wiring.js';
import { SessionBar }         from './sessionbar.js';
import { Leftbar }            from './leftbar.js';
import { session }            from './session.js';
import { api }                from './api.js';
import { auth }               from './auth.js';
import { AuthModal, userSkippedAuth, releaseAuthLock } from './auth_modal.js';
import { mountShortcuts }     from './ui/shortcuts.js';

const $ = (id) => document.getElementById(id);

function boot() {
    const container = $('canvas-container');
    const canvas    = $('canvas');
    const svg       = $('svg-canvas');

    const connections = new ConnectionRenderer(svg);
    const nodes = new NodeRenderer(
        canvas,
        (id) => store.setActive(id),
        ()   => connections.scheduleRender(),
    );
    new CanvasController(container, canvas);
    new Sidebar($('sidebar'), $('menu-node-title'), $('sidebar-fields'), $('sidebar-close'));
    new Toolbar($('toolbar'), container, $('delete-node-btn'), $('run-pipeline-btn'));
    new Wiring(canvas, $('wire-banner'));
    new SessionBar($('session-bar'));

    // Auth modal mounts hidden; opens automatically on first run or
    // when the cached user fails to validate.
    const authModal = new AuthModal($('auth-modal'));
    const leftbar = new Leftbar($('leftbar'), {
        onOpenAuth: (mode) => authModal.open(mode),
    });

    mountShortcuts($('topbar'));

    // Re-render connections after layout becomes available.
    requestAnimationFrame(() => connections.render());
    window.addEventListener('resize', connections.scheduleRender);

    // Probe the backend so users see immediately whether their API key is set.
    refreshApiStatus();

    // Auth bootstrap: validate the cached user against `/me`. If there's
    // no cached user AND the user hasn't explicitly skipped auth, open
    // the modal so the very first run prompts for login. The
    // `auth-locked` class set in index.html hides the canvas behind
    // the modal until one of these branches releases it.
    auth.refresh().then((me) => {
        if (me) {
            releaseAuthLock();
        } else if (userSkippedAuth()) {
            // User previously chose "Continue without account" — honour that.
            releaseAuthLock();
        } else {
            authModal.open('login');
        }
    });

    // Convenience for debugging from devtools.
    if (typeof window !== 'undefined') {
        window.__app = { store, nodes, connections, session, leftbar, auth, authModal };
    }
}

async function refreshApiStatus() {
    const el = document.getElementById('api-status');
    if (!el) return;
    const label = el.querySelector('.label');
    try {
        const s = await api.status();
        // Stash provider availability for the sidebar to consult.
        window.__providers = s.providers || null;
        if (s.configured) {
            el.dataset.state = 'ok';
            const extras = [];
            if (s.providers?.gpt_image?.available) extras.push('gpt-image');
            const tail = extras.length ? ` · ${extras.join(', ')}` : '';
            label.textContent = `API: ready (${s.mode})${tail}`;
            el.title = `Image: ${s.image_model} · Video: ${s.video_model}`;
        } else {
            el.dataset.state = 'err';
            label.textContent = 'API: not configured';
            el.title = 'Set GOOGLE_API_KEY (or USE_VERTEX) in .env — see .env.example';
        }
    } catch (e) {
        el.dataset.state = 'err';
        label.textContent = 'API: unreachable';
        el.title = String(e);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
    boot();
}
