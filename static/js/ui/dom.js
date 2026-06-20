/**
 * Shared DOM utilities.
 *
 * Replaces four duplicated `ESC_DIV` definitions that previously lived
 * in `nodes.js`, `sidebar.js`, `sessionbar.js`, `assets_panel.js`.
 *
 * `escapeHTML(v)` — safely interpolate untrusted strings into HTML.
 * `h(tag, attrs, children)` — tiny createElement wrapper.
 * `frag(...nodes)` — wrap a list of nodes into a DocumentFragment.
 */

const ESC = document.createElement('div');

export function escapeHTML(value) {
    ESC.textContent = String(value ?? '');
    return ESC.innerHTML;
}

// Re-export under the legacy name so each module can be migrated with
// a single import-rename diff.
export const esc = escapeHTML;

export function h(tag, attrs = null, children = null) {
    const el = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            if (v == null || v === false) continue;
            if (k === 'class' || k === 'className') {
                el.className = v;
            } else if (k === 'style' && typeof v === 'object') {
                Object.assign(el.style, v);
            } else if (k === 'dataset' && typeof v === 'object') {
                for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
            } else if (k.startsWith('on') && typeof v === 'function') {
                el.addEventListener(k.slice(2).toLowerCase(), v);
            } else if (v === true) {
                el.setAttribute(k, '');
            } else {
                el.setAttribute(k, String(v));
            }
        }
    }
    if (children != null) {
        if (typeof children === 'string') {
            el.textContent = children;
        } else if (Array.isArray(children)) {
            for (const c of children) {
                if (c == null) continue;
                el.append(c instanceof Node ? c : document.createTextNode(String(c)));
            }
        } else if (children instanceof Node) {
            el.append(children);
        } else {
            el.textContent = String(children);
        }
    }
    return el;
}

export function frag(...nodes) {
    const f = document.createDocumentFragment();
    for (const n of nodes) {
        if (n == null) continue;
        f.append(n instanceof Node ? n : document.createTextNode(String(n)));
    }
    return f;
}
