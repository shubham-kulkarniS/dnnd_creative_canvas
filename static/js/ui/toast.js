/**
 * Lightweight wrapper around the existing #wire-banner element so
 * `wiring.js` (and future callers) don't poke its DOM directly.
 *
 * Single instance; safe to call before the banner has been mounted —
 * lookups happen on demand.
 */

let _banner = null;
let _autoHideTimer = null;

function el() {
    if (_banner && document.body.contains(_banner)) return _banner;
    _banner = document.getElementById('wire-banner');
    return _banner;
}

/**
 * Show a transient toast on the wire-banner element.
 * @param {string} text                  - banner text
 * @param {object} [opts]
 * @param {string} [opts.kind='info']    - 'info' | 'ok' | 'err'
 * @param {number} [opts.timeout=0]      - auto-hide in ms (0 = sticky)
 */
export function toast(text, { kind = 'info', timeout = 0 } = {}) {
    const node = el();
    if (!node) return;
    clearTimeout(_autoHideTimer);
    node.textContent = text;
    node.dataset.kind = kind;
    node.hidden = false;
    if (timeout > 0) {
        _autoHideTimer = setTimeout(() => hide(), timeout);
    }
}

export function hide() {
    const node = el();
    if (!node) return;
    clearTimeout(_autoHideTimer);
    node.hidden = true;
}
