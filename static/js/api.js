/**
 * Thin wrapper around fetch for the backend JSON API.
 *
 * Keeps callers from repeating headers / error parsing logic.
 */

async function postJson(url, body) {
    const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        let detail = `HTTP ${resp.status}`;
        try {
            const data = await resp.json();
            if (data && data.detail) detail = data.detail;
        } catch (_) { /* non-JSON error body */ }
        throw new Error(detail);
    }
    return resp.json();
}

export const api = {
    status:        ()    => fetch('/api/config/status').then(r => r.json()),
    generateImage: (req) => postJson('/api/generate/image', req),
    modifyImage:   (req) => postJson('/api/modify/image',   req),
    generateVideo: (req) => postJson('/api/generate/video', req),
    caption:       (req) => postJson('/api/caption',        req),
};
