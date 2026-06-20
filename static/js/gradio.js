/**
 * GradioManager — centralised Gradio-client pool + node-type registry.
 *
 * Design goals (per the orchestrator brief):
 *
 *  1. Pointer pattern. Inputs and outputs are URL strings, not bytes.
 *     File inputs are wrapped as Gradio file-ref objects (``{path}``
 *     for same-origin /file= URLs, or ``{url}`` for arbitrary http(s)).
 *     Outputs are read out as ``data[i].url`` so the canvas can hand a
 *     stable URL to the next node without round-tripping the bytes.
 *
 *  2. Connection pool. One client per Gradio origin, lazy-created and
 *     cached for the page's lifetime. Each client owns a stable
 *     ``session_hash`` and reuses HTTP keep-alive via the browser's
 *     native fetch connection pool.
 *
 *  3. Type-safe execution. Every registry entry declares its input
 *     schema (which upstream dataType feeds which position). The
 *     manager validates ``upstream.dataType === schema.from`` BEFORE
 *     firing the network request, so mismatched wiring fails fast
 *     with a readable error.
 *
 * The manager is engine-agnostic for the rest of the app: the runner
 * just calls ``gradio.execute(node, upstream)`` and gets a URL back.
 */

import { store } from './state.js';

/* ── Registry persistence ──────────────────────────────────────────
 * The registry maps node "kinds" (e.g. "TextGenNode", "UpscalerNode")
 * to a Gradio endpoint. Persisted to localStorage so an operator can
 * point the same canvas at different server pools without code edits.
 */

const REGISTRY_KEY = 'greenhouse:gradio:registry';

/**
 * Default registry — one entry per node kind we ship Gradio support
 * for. Each entry MUST declare:
 *   - ``url``      : base URL of the running Gradio server
 *   - ``api_name`` : the named endpoint (Gradio exposes ``/run/{name}``
 *                    AND ``/api/predict/{fn_index}``; ``api_name`` is the
 *                    Python ``api_name="..."`` argument given to a Block)
 *   - ``inputs``   : ordered schema. Each item describes which upstream
 *                    dataType feeds that input slot; ``required: false``
 *                    means a missing upstream is OK (omit from payload).
 *   - ``output``   : { dataType, extract } — dataType is what we push
 *                    to downstream nodes; extract receives the raw
 *                    Gradio response ``{ data: [...] }`` and returns a
 *                    plain string (URL for media, text for captions).
 *
 * Adjust at runtime via ``gradio.upsert(kind, entry)`` or by writing
 * directly to localStorage.
 */
const DEFAULT_REGISTRY = {
    TextGenNode: {
        url: 'http://localhost:7860',
        api_name: '/predict',
        inputs: [
            { from: 'text', required: true },
        ],
        output: {
            dataType: 'text',
            extract: (r) => String(r.data?.[0] ?? ''),
        },
    },
    ImageGenNode: {
        url: 'http://localhost:7861',
        api_name: '/predict',
        inputs: [
            { from: 'text', required: true },
        ],
        output: {
            dataType: 'image',
            extract: (r) => _firstUrl(r.data?.[0]),
        },
    },
    UpscalerNode: {
        url: 'http://localhost:7862',
        api_name: '/predict',
        inputs: [
            { from: 'image', required: true },
            { from: 'text',  required: false },
        ],
        output: {
            dataType: 'image',
            extract: (r) => _firstUrl(r.data?.[0]),
        },
    },
    VideoGenNode: {
        url: 'http://localhost:7863',
        api_name: '/predict',
        inputs: [
            { from: 'text',  required: true },
            { from: 'image', required: false },
        ],
        output: {
            dataType: 'video',
            extract: (r) => _firstUrl(r.data?.[0]),
        },
    },
};

function _loadRegistry() {
    try {
        const raw = localStorage.getItem(REGISTRY_KEY);
        if (!raw) return { ...DEFAULT_REGISTRY };
        return { ...DEFAULT_REGISTRY, ...JSON.parse(raw) };
    } catch {
        return { ...DEFAULT_REGISTRY };
    }
}

function _saveRegistry(reg) {
    try { localStorage.setItem(REGISTRY_KEY, JSON.stringify(reg)); }
    catch { /* quota — ignore */ }
}

/* ── Lightweight Gradio HTTP client ───────────────────────────────
 * Implements the modern ``/gradio_api/queue/join`` + SSE ``/queue/data``
 * round-trip. Falls back to the legacy ``/run/{name}`` synchronous
 * endpoint if the server isn't a queued Gradio (e.g. an interface with
 * ``queue=False``).
 */

class GradioClient {
    /**
     * @param {string} origin  Gradio base URL (``http://host:port``).
     */
    constructor(origin) {
        this.origin = origin.replace(/\/$/, '');
        // Stable id per browser session — Gradio scopes queue messages by it.
        this.sessionHash = _randomHash();
        // Connection-info probe is amortised so the first call pays
        // for it and every subsequent call reuses the cached schema.
        this._infoPromise = null;
    }

    /** Lazily fetch and cache the server's API schema (``/info``). */
    async info() {
        if (!this._infoPromise) {
            this._infoPromise = fetch(`${this.origin}/info`, {
                credentials: 'omit',
            }).then(async (r) => {
                if (!r.ok) throw new Error(`Gradio /info ${r.status}`);
                return r.json();
            });
        }
        return this._infoPromise;
    }

    /**
     * Resolve a registry ``api_name`` (string like ``"/predict"``) to
     * a numeric ``fn_index`` understood by ``/run/predict``. Falls
     * back to ``0`` if /info cannot be reached (lets the user point
     * at a non-queued single-fn Interface without ceremony).
     */
    async fnIndexFor(apiName) {
        try {
            const info = await this.info();
            const named = info?.named_endpoints || {};
            const entry = named[apiName];
            // Some Gradio versions expose ``fn_index``, others expose ``id``.
            return entry?.fn_index ?? entry?.id ?? 0;
        } catch {
            return 0;
        }
    }

    /**
     * Run a prediction. ``data`` is the positional input array the
     * Gradio function expects. Resolves with the parsed
     * ``{ data, duration, ... }`` response object.
     *
     * Strategy: try the queue path first (``/queue/join`` + SSE), and
     * fall back to the synchronous ``/run/predict`` if no progress
     * message arrives within ``QUEUE_PROBE_MS``. This works against
     * both queued (default since Gradio 4) and non-queued endpoints.
     */
    async predict(apiName, data) {
        const fnIndex = await this.fnIndexFor(apiName);
        try {
            return await this._predictViaQueue(apiName, fnIndex, data);
        } catch (e) {
            // Fall back to the legacy synchronous endpoint.
            return this._predictDirect(fnIndex, data);
        }
    }

    /* ── Queue (SSE) path ── */
    async _predictViaQueue(apiName, fnIndex, data) {
        // 1) POST the request to /queue/join — the server returns an
        //    ``event_id`` that we listen for on the SSE stream.
        const joinResp = await fetch(`${this.origin}/queue/join`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'omit',
            body: JSON.stringify({
                data,
                event_data: null,
                fn_index: fnIndex,
                trigger_id: null,
                session_hash: this.sessionHash,
            }),
        });
        if (!joinResp.ok) throw new Error(`queue/join ${joinResp.status}`);

        // 2) Open the SSE stream and wait for the ``process_completed``
        //    message that carries our output.
        return new Promise((resolve, reject) => {
            const es = new EventSource(
                `${this.origin}/queue/data?session_hash=${encodeURIComponent(this.sessionHash)}`,
            );
            const timer = setTimeout(() => {
                es.close();
                reject(new Error('Gradio queue: no progress within timeout'));
            }, 5 * 60 * 1000);    // 5 min cap; long enough for slow models.

            es.onmessage = (evt) => {
                let msg;
                try { msg = JSON.parse(evt.data); } catch { return; }
                if (msg.msg === 'process_completed') {
                    clearTimeout(timer);
                    es.close();
                    if (msg.success === false) {
                        reject(new Error(msg.output?.error || 'Gradio task failed'));
                    } else {
                        resolve(msg.output);
                    }
                } else if (msg.msg === 'unexpected_error') {
                    clearTimeout(timer);
                    es.close();
                    reject(new Error(msg.message || 'Gradio unexpected error'));
                }
            };
            es.onerror = () => {
                clearTimeout(timer);
                es.close();
                reject(new Error('Gradio SSE stream error'));
            };
        });
    }

    /* ── Synchronous fallback ── */
    async _predictDirect(fnIndex, data) {
        const resp = await fetch(`${this.origin}/run/predict`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'omit',
            body: JSON.stringify({ data, fn_index: fnIndex, session_hash: this.sessionHash }),
        });
        if (!resp.ok) throw new Error(`run/predict ${resp.status}`);
        return resp.json();
    }
}

/* ── Public manager singleton ─────────────────────────────────── */

class GradioManagerImpl {
    constructor() {
        this._clients  = new Map();        // origin -> GradioClient (pool)
        this._registry = _loadRegistry();   // kind -> entry
    }

    /* Registry surface */
    list()                { return { ...this._registry }; }
    get(kind)             { return this._registry[kind] || null; }
    upsert(kind, entry)   { this._registry[kind] = entry; _saveRegistry(this._registry); }
    remove(kind)          { delete this._registry[kind]; _saveRegistry(this._registry); }

    /** Lazily obtain (or create) the pooled client for ``url``. */
    clientFor(url) {
        const origin = (url || '').replace(/\/$/, '');
        if (!origin) throw new Error('GradioManager: empty server URL');
        let c = this._clients.get(origin);
        if (!c) {
            c = new GradioClient(origin);
            this._clients.set(origin, c);
        }
        return c;
    }

    /**
     * Execute a node against its mapped Gradio endpoint.
     *
     * @param {object} node       The node from the store. Must have
     *                            ``node.kind`` (registry key).
     * @param {object[]} upstream Upstream nodes feeding this one (caller
     *                            already filtered to the producers).
     * @returns {Promise<{ value: string, dataType: string }>}
     */
    async execute(node, upstream) {
        const entry = this.get(node.kind);
        if (!entry) {
            throw new Error(`No Gradio mapping for node kind "${node.kind}"`);
        }

        // ─── Type-safe input assembly ───
        // Walk the declared input schema in order; for each slot find
        // an upstream of the matching dataType and convert its URL/text
        // payload into the Gradio wire format. Missing required inputs
        // fail loudly BEFORE the network round-trip.
        const inputData = [];
        for (const slot of entry.inputs || []) {
            const src = upstream.find(u => u.dataType === slot.from && u.value);
            if (!src) {
                if (slot.required) {
                    throw new Error(
                        `Node "${node.title}" missing required ${slot.from} input`);
                }
                inputData.push(null);
                continue;
            }
            inputData.push(_toGradioInput(src.dataType, src.value, entry.url));
        }

        // ─── Fire the call through the pooled client ───
        const client = this.clientFor(entry.url);
        const response = await client.predict(entry.api_name, inputData);

        // ─── Normalise output back to a URL string ───
        const value = entry.output.extract(response);
        if (!value) {
            throw new Error(`Gradio "${node.kind}" returned no usable output`);
        }
        return { value, dataType: entry.output.dataType };
    }
}

export const gradio = new GradioManagerImpl();

/* Useful for power users + tests. */
if (typeof window !== 'undefined') {
    window.__gradio = gradio;
}

/* ── Helpers ──────────────────────────────────────────────────── */

/**
 * Convert a frontend value (URL string / text) into the wire format
 * Gradio's HTTP API accepts. Per the pointer pattern, we never base64
 * a file — we always send it by reference.
 *
 * - text  → bare string
 * - image / video → ``{path}`` for same-origin or ``{url}`` for remote.
 *   Either form works with Gradio 4+'s file inputs; ``path`` is faster
 *   when the file is already on the Gradio server's local disk.
 */
function _toGradioInput(dataType, value, serverUrl) {
    if (dataType === 'text') return value;
    if (!value) return null;
    // Same-origin /media/ URL from our own backend → expose as a full
    // URL so the Gradio server fetches it via HTTP. We deliberately do
    // not pretend it's on the Gradio server's disk.
    if (value.startsWith('/media/')) {
        const here = `${window.location.protocol}//${window.location.host}`;
        return { url: `${here}${value}`, meta: { _type: 'gradio.FileData' } };
    }
    return { url: value, meta: { _type: 'gradio.FileData' } };
}

/**
 * Pluck a URL out of Gradio's polymorphic output shape. Image/video
 * outputs come back either as a bare URL string, ``{ url }``, or
 * ``{ path, url }``. Audio/file outputs follow the same pattern.
 */
function _firstUrl(item) {
    if (!item) return '';
    if (typeof item === 'string') return item;
    if (item.url)  return item.url;
    if (item.path) return item.path;
    if (Array.isArray(item)) return _firstUrl(item[0]);
    return '';
}

/** Cryptographically-random hex string, 11 chars (Gradio's own format). */
function _randomHash() {
    const a = new Uint8Array(11);
    (globalThis.crypto || window.crypto).getRandomValues(a);
    return Array.from(a, (b) => (b & 0xf).toString(16)).join('').slice(0, 11);
}

/* Re-emit ``gradio:registry-changed`` so a future settings panel can
   listen and re-render its rows when ``upsert`` happens. */
const _origUpsert = GradioManagerImpl.prototype.upsert;
GradioManagerImpl.prototype.upsert = function (kind, entry) {
    _origUpsert.call(this, kind, entry);
    store.emit('gradio:registry-changed', { kind, entry });
};
