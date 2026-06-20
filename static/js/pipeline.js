/**
 * pipeline.js — graph traversal executor.
 *
 * ``runPipeline()`` is the user-facing "Execute Pipeline" entry point.
 * It schedules every runnable node (``generate`` / ``modify``) in
 * dependency order using Kahn's algorithm, then dispatches each one
 * via the existing ``runner.runNode`` once all of its upstream nodes
 * have completed.
 *
 * Key properties:
 *
 *  • Pointer pattern preserved end-to-end. ``runNode`` already mutates
 *    the store so downstream ``data`` nodes pick up their producer's
 *    output URL automatically — we don't pass payloads around here.
 *
 *  • Parallel branches. The scheduler keeps a running set of in-flight
 *    promises; whenever any node finishes we re-scan for nodes whose
 *    pending-input count just dropped to zero, then fire all of them
 *    at once via ``Promise.all``-style fan-out. Two independent
 *    subgraphs never block each other.
 *
 *  • Fail-fast with partial progress. By default a single node error
 *    aborts the rest of the pipeline; callers can opt into
 *    ``continueOnError: true`` for "best effort" runs. Either way the
 *    final return shape is the same — caller inspects per-node status.
 *
 *  • UI feedback. ``runNode`` already emits ``node:run-status`` events
 *    that ``nodes.js`` paints with the sweep animation. The pipeline
 *    additionally emits ``pipeline:started`` / ``pipeline:settled`` so
 *    the toolbar can disable / re-enable its "Execute" button.
 */

import { store }   from './state.js';
import { runNode } from './runner.js';

/**
 * Execute every runnable node in the current graph in dependency order.
 *
 * @param {object} [opts]
 * @param {Iterable<string>} [opts.targets]      Only run these node ids
 *                                               (and their ancestors).
 *                                               Defaults to ALL runnable
 *                                               nodes in the graph.
 * @param {boolean} [opts.continueOnError=false] Keep running independent
 *                                               branches after a node
 *                                               fails. Default: abort.
 * @returns {Promise<{
 *   succeeded: string[],
 *   failed:    Array<{ id: string, error: string }>,
 *   skipped:   string[],
 * }>}
 */
export async function runPipeline(opts = {}) {
    const continueOnError = !!opts.continueOnError;
    const targets = opts.targets ? new Set(opts.targets) : null;

    // ── 1) Pick the candidate set ──────────────────────────────────
    // Runnable = produces output via the runner (generate / modify).
    // Data nodes are inert — they just hold values.
    const runnable = new Set();
    for (const node of store.nodes.values()) {
        if (node.type === 'generate' || node.type === 'modify') {
            runnable.add(node.id);
        }
    }

    // Trim to the ancestors of the requested targets if one was given.
    const scope = targets ? _ancestorClosure(targets, runnable) : runnable;
    if (!scope.size) {
        return { succeeded: [], failed: [], skipped: [] };
    }

    // ── 2) Build per-node "pending upstream" counters ─────────────
    //     Only upstream nodes that are themselves in scope count;
    //     pre-filled data nodes contribute zero work.
    const pending = new Map();           // nodeId -> int
    const downstreams = new Map();       // nodeId -> Set<runnable nodeId>
    for (const id of scope) {
        pending.set(id, 0);
        downstreams.set(id, new Set());
    }
    for (const id of scope) {
        for (const upId of store.getUpstreamNodeIds(id)) {
            // Walk further up — any indirect runnable ancestor in scope
            // is a blocker for ``id``.
            for (const blocker of _runnableAncestors(upId, scope)) {
                pending.set(id, pending.get(id) + 1);
                downstreams.get(blocker).add(id);
            }
        }
    }

    // ── 3) Kahn-style fan-out scheduler ───────────────────────────
    const succeeded = [];
    const failed    = [];
    const skipped   = [];
    let aborted = false;

    store.emit('pipeline:started', { size: scope.size });

    const inFlight = new Map();          // nodeId -> Promise
    const ready    = [...scope].filter(id => pending.get(id) === 0);

    const launch = (id) => {
        const p = runNode(id)
            .then((value) => {
                succeeded.push(id);
                return { id, ok: true, value };
            })
            .catch((err) => {
                failed.push({ id, error: err?.message || String(err) });
                if (!continueOnError) aborted = true;
                return { id, ok: false };
            })
            .finally(() => {
                // Whether success or failure, decrement downstream counters.
                // On failure with abort-mode, we still decrement so the
                // promise loop drains; ``skipped`` is computed at the end.
                for (const dn of downstreams.get(id)) {
                    pending.set(dn, pending.get(dn) - 1);
                }
                inFlight.delete(id);
            });
        inFlight.set(id, p);
    };

    for (const id of ready) launch(id);

    // Main loop: as each in-flight node finishes, fan out any newly-
    // ready nodes. We deliberately await Promise.race rather than
    // Promise.all so a single slow node doesn't stall sibling branches.
    while (inFlight.size > 0) {
        await Promise.race(inFlight.values());
        if (aborted) break;
        for (const id of scope) {
            if (pending.get(id) === 0 && !inFlight.has(id)
                && !succeeded.includes(id) && !failed.find(f => f.id === id)) {
                launch(id);
            }
        }
    }

    // ── 4) Wait for any straggling in-flight ──────────────────────
    if (inFlight.size) {
        await Promise.allSettled(inFlight.values());
    }

    // Anything in scope that we never ran is "skipped" — typically the
    // descendants of a failed node in abort mode.
    for (const id of scope) {
        if (!succeeded.includes(id) && !failed.find(f => f.id === id)) {
            skipped.push(id);
        }
    }

    store.emit('pipeline:settled', {
        succeeded: succeeded.length,
        failed:    failed.length,
        skipped:   skipped.length,
    });

    return { succeeded, failed, skipped };
}

/* ── Helpers ──────────────────────────────────────────────────── */

/**
 * Return the set of runnable nodes that are ``id`` itself OR any of
 * its runnable ancestors (transitive). ``id`` may be a data node; we
 * skip up through data nodes to find their upstream producers.
 */
function _runnableAncestors(id, scope) {
    const out = new Set();
    const node = store.getNode(id);
    if (!node) return out;
    if (scope.has(id)) { out.add(id); return out; }
    // Skip past inert data nodes to find their producers.
    for (const upId of store.getUpstreamNodeIds(id)) {
        for (const a of _runnableAncestors(upId, scope)) out.add(a);
    }
    return out;
}

/** Closure of ``targets`` under "ancestor that is itself runnable". */
function _ancestorClosure(targets, runnable) {
    const out = new Set();
    const visit = (id) => {
        if (out.has(id)) return;
        if (!runnable.has(id)) {
            // walk past data nodes to find their producers
            for (const up of store.getUpstreamNodeIds(id)) visit(up);
            return;
        }
        out.add(id);
        for (const up of store.getUpstreamNodeIds(id)) visit(up);
    };
    for (const t of targets) visit(t);
    return out;
}
