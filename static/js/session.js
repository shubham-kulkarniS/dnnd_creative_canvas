/**
 * Session log — persists a list of "shots" (generated assets) plus the
 * full node-graph snapshot at the moment each was produced.
 *
 * Stored in `localStorage` so the strip survives page reloads. One
 * session per browser; call `session.reset()` to start a fresh one.
 *
 * Shot shape:
 *   {
 *     id, ts, url, mime,
 *     type: 'image' | 'video' | 'caption',
 *     producerNodeId,
 *     text,              // only for captions
 *     graph: { nodes, connections }
 *   }
 */

import { store } from './state.js';

const KEY = 'greenhouse:session';

function snapshotGraph() {
    // Shallow copy is fine — node objects are JSON-serializable plain data.
    return {
        nodes: Array.from(store.nodes.values()).map(n => JSON.parse(JSON.stringify(n))),
        connections: store.connections.map(c => ({ ...c })),
    };
}

class Session {
    constructor() {
        const saved = this._load();
        this.id        = saved?.id        || `sess_${Date.now().toString(36)}`;
        this.startedAt = saved?.startedAt || new Date().toISOString();
        this.shots     = Array.isArray(saved?.shots) ? saved.shots : [];
    }

    _load() {
        try { return JSON.parse(localStorage.getItem(KEY) || 'null'); }
        catch { return null; }
    }

    _save() {
        try {
            localStorage.setItem(KEY, JSON.stringify({
                id: this.id,
                startedAt: this.startedAt,
                shots: this.shots,
            }));
        } catch (_) {
            // Quota exceeded — drop oldest half and retry once.
            this.shots = this.shots.slice(-Math.ceil(this.shots.length / 2));
            try { localStorage.setItem(KEY, JSON.stringify({
                id: this.id, startedAt: this.startedAt, shots: this.shots,
            })); } catch (_) { /* give up */ }
        }
    }

    /** Append a new shot and notify listeners. */
    record({ url, mime, type, producerNodeId, text }) {
        const shot = {
            id: `shot_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
            ts: new Date().toISOString(),
            url: url || null,
            mime: mime || null,
            type,
            producerNodeId,
            text: text || null,
            graph: snapshotGraph(),
        };
        this.shots.push(shot);
        this._save();
        store.emit('shot:added', shot);
        return shot;
    }

    /** Drop a single shot by id. */
    remove(shotId) {
        const before = this.shots.length;
        this.shots = this.shots.filter(s => s.id !== shotId);
        if (this.shots.length !== before) {
            this._save();
            store.emit('shots:changed', this.shots);
        }
    }

    /** Wipe all shots in the current session. */
    clear() {
        this.shots = [];
        this._save();
        store.emit('shots:changed', this.shots);
    }

    /** Start a brand-new session (new id + timestamp, empty shots). */
    reset() {
        this.id        = `sess_${Date.now().toString(36)}`;
        this.startedAt = new Date().toISOString();
        this.shots     = [];
        this._save();
        store.emit('shots:changed', this.shots);
    }
}

export const session = new Session();
