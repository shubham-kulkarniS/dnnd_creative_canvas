/**
 * Keyboard-shortcuts popover.
 *
 * Adds a small `?` chip to the topbar that, when clicked or focused
 * via keyboard, opens a popover listing the canvas shortcuts that
 * the rest of the app silently honours (Del = delete, Esc = cancel
 * wiring / close sidebar, drag empty canvas = pan, scroll = zoom).
 *
 * No behaviour change to the shortcuts themselves — this is pure
 * discoverability.
 */

import { icon } from './icons.js';

const SHORTCUTS = [
    ['Drag empty canvas',     'Pan the workspace'],
    ['Scroll wheel',          'Zoom toward cursor'],
    ['Click slot → slot',     'Wire two nodes'],
    ['Drag asset tile → canvas', 'Spawn a Data node'],
    ['Click a node',          'Open settings panel'],
    ['Drag node corner',      'Resize selected node'],
    ['⌘/Ctrl + + / −',        'Resize selected node'],
    ['Delete / Backspace',    'Remove selected node'],
    ['Esc',                   'Close sidebar or cancel wiring'],
];

export function mountShortcuts(topbar) {
    if (!topbar) return;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'topbar-help';
    btn.setAttribute('aria-label', 'Keyboard shortcuts');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.innerHTML = icon('question', { size: 14, ariaLabel: 'Keyboard shortcuts' });
    topbar.appendChild(btn);

    const pop = document.createElement('div');
    pop.className = 'shortcuts-popover';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Keyboard shortcuts');
    pop.hidden = true;
    pop.innerHTML = `
        <h4 class="shortcuts-title">Keyboard &amp; mouse</h4>
        <dl class="shortcuts-list">
            ${SHORTCUTS.map(([k, v]) =>
                `<div class="shortcuts-row">
                    <dt><kbd>${k}</kbd></dt>
                    <dd>${v}</dd>
                </div>`).join('')}
        </dl>
    `;
    document.body.appendChild(pop);

    const place = () => {
        const r = btn.getBoundingClientRect();
        pop.style.top  = `${r.bottom + 6}px`;
        pop.style.left = `${r.left}px`;
    };

    const open = () => {
        place();
        pop.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
    };
    const close = () => {
        pop.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
    };

    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        pop.hidden ? open() : close();
    });

    document.addEventListener('click', (e) => {
        if (pop.hidden) return;
        if (e.target === btn || pop.contains(e.target)) return;
        close();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && !pop.hidden) {
            e.preventDefault();
            close();
            btn.focus();
        }
    });

    window.addEventListener('resize', () => { if (!pop.hidden) place(); });
}
