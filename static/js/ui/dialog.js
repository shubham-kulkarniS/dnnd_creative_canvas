/**
 * dialog.js — themed replacements for `window.alert()` and
 * `window.confirm()`.
 *
 * Why: native dialogs break the Studio-Dark aesthetic, block the
 * event loop, and (in some browsers) lack proper ARIA semantics.
 * This module renders an in-app modal mounted on the body, returns
 * a Promise, and traps focus while open.
 *
 * Usage:
 *     import { confirmDialog, alertDialog } from './ui/dialog.js';
 *     if (await confirmDialog('Delete this note?')) { ... }
 *     await alertDialog('Could not save asset', { kind: 'err' });
 *
 * The API intentionally mirrors `confirm()` / `alert()` so call-site
 * migrations are mechanical.
 */

import { esc } from './dom.js';

/* ── Singleton mount ──────────────────────────────────────────────── */

let _root = null;
let _activeReject = null;     // resolve helper for the currently-open dialog
let _previousFocus = null;

function ensureRoot() {
    if (_root && document.body.contains(_root)) return _root;
    _root = document.createElement('div');
    _root.id = 'app-dialog';
    _root.hidden = true;
    _root.setAttribute('aria-hidden', 'true');
    document.body.appendChild(_root);
    return _root;
}

/* ── Public API ───────────────────────────────────────────────────── */

/**
 * Show a confirm-style modal. Resolves `true` if the user accepts,
 * `false` if they cancel (button, backdrop click, or Escape).
 *
 * @param {string} message                 - body text (rendered as text, not HTML)
 * @param {object} [opts]
 * @param {string} [opts.title]            - heading (defaults to "Are you sure?")
 * @param {string} [opts.confirmLabel='Confirm']
 * @param {string} [opts.cancelLabel='Cancel']
 * @param {'default'|'danger'} [opts.kind='default']
 */
export function confirmDialog(message, opts = {}) {
    return _open({
        kind:         opts.kind || 'default',
        title:        opts.title || 'Are you sure?',
        message,
        confirmLabel: opts.confirmLabel || 'Confirm',
        cancelLabel:  opts.cancelLabel  || 'Cancel',
        hasCancel:    true,
    });
}

/**
 * Show an alert-style modal. Resolves when the user dismisses.
 *
 * @param {string} message
 * @param {object} [opts]
 * @param {string} [opts.title]
 * @param {string} [opts.confirmLabel='OK']
 * @param {'default'|'err'|'ok'|'info'} [opts.kind='default']
 */
export function alertDialog(message, opts = {}) {
    const kind = opts.kind || 'default';
    return _open({
        kind,
        title:        opts.title || (kind === 'err' ? 'Something went wrong'
                                  : kind === 'ok'  ? 'Done'
                                  : 'Notice'),
        message,
        confirmLabel: opts.confirmLabel || 'OK',
        hasCancel:    false,
    });
}

/* ── Internals ────────────────────────────────────────────────────── */

function _open({ kind, title, message, confirmLabel, cancelLabel, hasCancel }) {
    return new Promise((resolve) => {
        // Only one dialog at a time — close any prior one as a cancellation.
        if (_activeReject) { _activeReject(false); _activeReject = null; }

        const root = ensureRoot();
        _previousFocus = document.activeElement;

        root.innerHTML = `
            <div class="dlg-backdrop" data-act="backdrop">
                <div class="dlg-card dlg-card--${esc(kind)}"
                     role="alertdialog" aria-modal="true"
                     aria-labelledby="dlg-title" aria-describedby="dlg-msg">
                    <h2 class="dlg-title" id="dlg-title">${esc(title)}</h2>
                    <p   class="dlg-msg"   id="dlg-msg">${esc(message)}</p>
                    <div class="dlg-actions">
                        ${hasCancel
                            ? `<button type="button" class="dlg-btn dlg-btn--ghost"
                                       data-act="cancel">${esc(cancelLabel)}</button>`
                            : ''}
                        <button type="button"
                                class="dlg-btn ${kind === 'danger' ? 'dlg-btn--danger' : 'dlg-btn--primary'}"
                                data-act="confirm">${esc(confirmLabel)}</button>
                    </div>
                </div>
            </div>
        `;
        root.hidden = false;
        root.setAttribute('aria-hidden', 'false');
        document.body.classList.add('modal-open');

        const card = root.querySelector('.dlg-card');
        const confirmBtn = root.querySelector('[data-act="confirm"]');
        const cancelBtn  = root.querySelector('[data-act="cancel"]');
        const backdrop   = root.querySelector('[data-act="backdrop"]');

        const close = (value) => {
            if (_activeReject !== resolveBound) return; // re-entrant guard
            _activeReject = null;
            root.hidden = true;
            root.setAttribute('aria-hidden', 'true');
            root.innerHTML = '';
            document.body.classList.remove('modal-open');
            window.removeEventListener('keydown', onKey, true);
            // Return focus to whatever had it before the modal opened.
            try { _previousFocus?.focus?.({ preventScroll: true }); } catch (_) {}
            _previousFocus = null;
            resolve(value);
        };
        const resolveBound = (v) => close(v);
        _activeReject = resolveBound;

        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                close(false);
                return;
            }
            if (e.key === 'Enter' && document.activeElement !== cancelBtn) {
                e.preventDefault();
                close(true);
                return;
            }
            if (e.key === 'Tab') {
                // Tiny focus trap: tabbing past the last button wraps to
                // the first one, and shift-tabbing past the first wraps.
                const targets = [cancelBtn, confirmBtn].filter(Boolean);
                if (!targets.length) return;
                const first = targets[0];
                const last  = targets[targets.length - 1];
                if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                } else if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                }
            }
        };
        window.addEventListener('keydown', onKey, true);

        confirmBtn.addEventListener('click', () => close(true));
        cancelBtn?.addEventListener('click', () => close(false));
        backdrop.addEventListener('click', (e) => {
            // Only dismiss on backdrop clicks, never on inner clicks.
            if (e.target.dataset.act === 'backdrop' && hasCancel) close(false);
        });

        // Defer focus until the card is painted; preserves the animation.
        requestAnimationFrame(() => {
            (hasCancel ? confirmBtn : confirmBtn).focus();
        });
        // Lightweight rise animation hook for CSS.
        requestAnimationFrame(() => card.classList.add('is-open'));
    });
}
