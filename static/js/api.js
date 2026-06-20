/**
 * Thin wrapper around fetch for the backend JSON API.
 *
 * Keeps callers from repeating headers / error parsing logic.
 * Auth uses HttpOnly cookies — set `credentials: 'same-origin'` so
 * the browser actually sends them; the server reads from cookies, not
 * Authorization headers.
 */

async function _send(method, url, body) {
    const init = {
        method,
        headers: {},
        credentials: 'same-origin',
    };
    if (body !== undefined) {
        init.headers['Content-Type'] = 'application/json';
        init.body = JSON.stringify(body);
    }
    const resp = await fetch(url, init);
    if (!resp.ok) {
        let detail = `HTTP ${resp.status}`;
        try {
            const data = await resp.json();
            if (data && data.detail) detail = data.detail;
        } catch (_) { /* non-JSON error body */ }
        const err = new Error(detail);
        err.status = resp.status;
        throw err;
    }
    // 204 → no body
    if (resp.status === 204) return null;
    return resp.json();
}

const postJson  = (url, body) => _send('POST',   url, body);
const getJson   = (url)       => _send('GET',    url);
const patchJson = (url, body) => _send('PATCH', url, body);
const delJson   = (url)       => _send('DELETE', url);

export const api = {
    status:        ()    => fetch('/api/config/status', { credentials: 'same-origin' }).then(r => r.json()),
    generateImage: (req) => postJson('/api/generate/image', req),
    modifyImage:   (req) => postJson('/api/modify/image',   req),
    generateVideo: (req) => postJson('/api/generate/video', req),
    caption:       (req) => postJson('/api/caption',        req),

    auth: {
        signup:  (payload) => postJson('/api/auth/signup',  payload),
        login:   (payload) => postJson('/api/auth/login',   payload),
        logout:  ()        => postJson('/api/auth/logout'),
        refresh: ()        => postJson('/api/auth/refresh'),
        me:      ()        => getJson ('/api/auth/me'),
    },

    admin: {
        usage: ()  => getJson('/api/admin/usage'),
        users: ()  => getJson('/api/admin/users'),
    },

    users: {
        lookup: (email) => getJson(`/api/users/lookup?email=${encodeURIComponent(email)}`),
    },

    assets: {
        list:   (kind)        => {
            const q = kind ? `?kind=${encodeURIComponent(kind)}` : '';
            return getJson(`/api/assets${q}`);
        },
        create: (payload)     => postJson('/api/assets', payload),
        update: (id, payload) => patchJson(`/api/assets/${encodeURIComponent(id)}`, payload),
        remove: (id)          => delJson(`/api/assets/${encodeURIComponent(id)}`),
    },

    notes: {
        list:   (nodeId)      => {
            const q = nodeId ? `?node_id=${encodeURIComponent(nodeId)}` : '';
            return getJson(`/api/notes${q}`);
        },
        create: (payload)     => postJson('/api/notes', payload),
        update: (id, payload) => patchJson(`/api/notes/${encodeURIComponent(id)}`, payload),
        remove: (id)          => delJson(`/api/notes/${encodeURIComponent(id)}`),
    },

    sessions: {
        list:    ()            => getJson('/api/sessions'),
        get:     (id)          => getJson(`/api/sessions/${encodeURIComponent(id)}`),
        save:    (payload)     => postJson('/api/sessions', payload),
        remove:  (id)          => delJson(`/api/sessions/${encodeURIComponent(id)}`),
        shares:  (id)          => getJson(`/api/sessions/${encodeURIComponent(id)}/shares`),
        share:   (id, email)   => postJson(`/api/sessions/${encodeURIComponent(id)}/share`, { email }),
        unshare: (id, userId)  => delJson(`/api/sessions/${encodeURIComponent(id)}/share/${userId}`),
    },
};
