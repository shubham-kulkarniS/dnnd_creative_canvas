/**
 * AuthModal — login / signup gate shown on first run.
 *
 * One DOM root, two modes (login | signup). Opens automatically when
 * the app boots without a valid auth cookie; can be re-opened from
 * the user panel ("Switch account").
 *
 * Skippable: a "Continue without account" link sets a localStorage
 * flag so anonymous mode (legacy sessions only) keeps working.
 */

import { auth }        from './auth.js';
import { esc }         from './ui/dom.js';

const SKIP_KEY = 'greenhouse:auth:skipped';

export class AuthModal {
    constructor(root) {
        this.root = root;
        this.mode = 'login';            // 'login' | 'signup'
        this.busy = false;

        this.root.innerHTML = `
            <div class="auth-backdrop" data-act="backdrop">
                <div class="auth-card" role="dialog" aria-modal="true"
                     aria-labelledby="auth-title" aria-describedby="auth-desc">
                    <header class="auth-head">
                        <h2 id="auth-title">Welcome to Greenhouse</h2>
                        <p id="auth-desc" class="auth-sub">
                            Sign in to save sessions, collaborate, and access your library.
                        </p>
                    </header>

                    <nav class="auth-tabs" role="tablist">
                        <button type="button" class="auth-tab" data-mode="login"  role="tab">Sign in</button>
                        <button type="button" class="auth-tab" data-mode="signup" role="tab">Create account</button>
                    </nav>

                    <form class="auth-form" data-act="submit" novalidate>
                        <label class="auth-field" data-field="display-name" hidden>
                            <span>Display name <em class="auth-optional">(optional)</em></span>
                            <input type="text" name="display_name" maxlength="120"
                                   autocomplete="name" placeholder="What should we call you?">
                        </label>
                        <label class="auth-field">
                            <span>Email</span>
                            <input type="email" name="email" required autocomplete="email"
                                   placeholder="you@studio.com" autocapitalize="none">
                        </label>
                        <label class="auth-field">
                            <span>Password</span>
                            <input type="password" name="password" required minlength="10"
                                   autocomplete="current-password"
                                   placeholder="At least 10 characters">
                            <em class="auth-hint" data-field="password-hint">
                                Tip: include letters and digits.
                            </em>
                        </label>

                        <div class="auth-status" data-field="status" role="alert"></div>

                        <button type="submit" class="auth-submit">Sign in</button>
                    </form>

                    <footer class="auth-foot">
                        <button type="button" class="auth-skip" data-act="skip">
                            Continue without an account
                        </button>
                    </footer>
                </div>
            </div>
        `;

        this.form       = this.root.querySelector('form');
        this.statusEl   = this.root.querySelector('[data-field="status"]');
        this.submitBtn  = this.root.querySelector('.auth-submit');
        this.displayRow = this.root.querySelector('[data-field="display-name"]');
        this.pwdHint    = this.root.querySelector('[data-field="password-hint"]');
        this.pwdInput   = this.root.querySelector('input[name="password"]');

        this.root.querySelectorAll('.auth-tab').forEach(btn => {
            btn.addEventListener('click', () => this._setMode(btn.dataset.mode));
        });
        this.root.querySelector('[data-act="skip"]').addEventListener('click', () => {
            try { localStorage.setItem(SKIP_KEY, '1'); } catch (_) {}
            // Skipping releases the gate too — the user wants the canvas.
            releaseAuthLock();
            this.close();
        });
        this.root.querySelector('[data-act="backdrop"]').addEventListener('click', (e) => {
            // Don't dismiss on inner clicks; only when the backdrop itself is the target.
            // And only when the user is already authenticated — during the
            // initial gate the modal must be a dead-end until they pick a path.
            if (e.target.dataset.act === 'backdrop' && auth.isAuthenticated) this.close();
        });
        // Block Escape from closing the modal during the gate — there is
        // no canvas to fall back to. After auth, Escape behaves as expected.
        this.root.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && auth.isAuthenticated) this.close();
        });
        this.form.addEventListener('submit', (e) => { e.preventDefault(); this._submit(); });

        this._setMode('login');
        this.close();
    }

    open(mode = 'login') {
        this._setMode(mode);
        this.root.hidden = false;
        // Engage the gate: hide all canvas chrome while the modal is up.
        document.documentElement.classList.add('auth-locked');
        // Defer focus so the modal is visible first.
        requestAnimationFrame(() => {
            const target = mode === 'signup'
                ? this.root.querySelector('input[name="display_name"]')
                : this.root.querySelector('input[name="email"]');
            target?.focus();
        });
        // Lock scroll while open.
        document.body.classList.add('modal-open');
    }

    close() {
        this.root.hidden = true;
        document.body.classList.remove('modal-open');
        this._setStatus('');
    }

    _setMode(mode) {
        this.mode = mode === 'signup' ? 'signup' : 'login';
        this.root.querySelectorAll('.auth-tab').forEach(b => {
            b.classList.toggle('active', b.dataset.mode === this.mode);
            b.setAttribute('aria-selected', b.dataset.mode === this.mode ? 'true' : 'false');
        });
        const isSignup = this.mode === 'signup';
        this.displayRow.hidden = !isSignup;
        this.pwdHint.hidden    = !isSignup;
        this.pwdInput.autocomplete = isSignup ? 'new-password' : 'current-password';
        this.submitBtn.textContent = isSignup ? 'Create account' : 'Sign in';
        this._setStatus('');
    }

    async _submit() {
        if (this.busy) return;
        const data = Object.fromEntries(new FormData(this.form).entries());
        const email    = (data.email    || '').trim();
        const password = (data.password || '');
        const display  = (data.display_name || '').trim() || null;
        if (!email || !password) {
            this._setStatus('Email and password are required.', 'err');
            return;
        }
        this.busy = true;
        this.submitBtn.disabled = true;
        const original = this.submitBtn.textContent;
        this.submitBtn.textContent = this.mode === 'signup' ? 'Creating…' : 'Signing in…';
        try {
            if (this.mode === 'signup') {
                await auth.signup({ email, password, display_name: display });
                this._setStatus('Account created — welcome!', 'ok');
            } else {
                await auth.login({ email, password });
                this._setStatus('Signed in.', 'ok');
            }
            try { localStorage.removeItem(SKIP_KEY); } catch (_) {}
            // Authentication succeeded — drop the gate and reveal the canvas.
            releaseAuthLock();
            setTimeout(() => this.close(), 350);
        } catch (e) {
            this._setStatus(esc(e.message || 'Could not authenticate.'), 'err');
        } finally {
            this.busy = false;
            this.submitBtn.disabled = false;
            this.submitBtn.textContent = original;
        }
    }

    _setStatus(msg, cls) {
        this.statusEl.textContent = msg || '';
        this.statusEl.className = 'auth-status' + (cls ? ` ${cls}` : '');
    }
}

export function userSkippedAuth() {
    try { return localStorage.getItem(SKIP_KEY) === '1'; }
    catch { return false; }
}

export function clearAuthSkip() {
    try { localStorage.removeItem(SKIP_KEY); } catch (_) {}
}

/**
 * Release the boot-time auth gate. Set on <html> by an inline script
 * in index.html so the canvas chrome never paints before login is
 * resolved. Calling this reveals everything behind the modal.
 */
export function releaseAuthLock() {
    document.documentElement.classList.remove('auth-locked');
}

/** Re-engage the gate (used on sign-out). */
export function engageAuthLock() {
    document.documentElement.classList.add('auth-locked');
}
