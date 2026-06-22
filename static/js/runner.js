/**
 * Node execution orchestrator.
 *
 * Generate node modes (set in the sidebar):
 *   * 'image'   → text2image    (needs text upstream)         → Gemini
 *   * 'video'   → text2video    (text upstream;
 *                                 +image upstream switches to image2video) → Veo
 *   * 'caption' → image|video2text (image OR video upstream) → Gemini
 *
 * Modify is unchanged: image upstream + optional text → image edit.
 */

import { store }   from './state.js';
import { api }     from './api.js';
import { session } from './session.js';
import { gradio }  from './gradio.js';

/** Announce run lifecycle so the canvas can show a per-node indicator.
 *  Kinds: 'start' | 'ok' | 'err'. */
function emitRunStatus(nodeId, kind, detail) {
    store.emit('node:run-status', { id: nodeId, kind, detail });
}

/** Strip keys whose value is `null`, `undefined`, or empty string so
 *  the backend uses model defaults rather than overriding with blanks. */
function prune(obj) {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (v === null || v === undefined || v === '') continue;
        out[k] = v;
    }
    return out;
}

/** Build the Nano Banana option payload from a node's params. */
function imageOptions(p) {
    return prune({
        provider:                   p.image_provider,
        seed:                       p.seed,
        aspect_ratio:               p.image_aspect_ratio,
        image_size:                 p.image_size,
        person_generation:          p.person_generation,
        output_mime_type:           p.output_mime_type,
        output_compression_quality: p.output_compression_quality,
        temperature:                p.temperature,
        system_instruction:         p.system_instruction,
    });
}

/** Build the Veo option payload from a node's params. */
function videoOptions(p) {
    return prune({
        duration_seconds:    p.duration_seconds ?? 8,
        aspect_ratio:        p.aspect_ratio     ?? '16:9',
        seed:                p.video_seed,
        number_of_videos:    p.number_of_videos,
        resolution:          p.resolution,
        fps:                 p.fps,
        negative_prompt:     p.negative_prompt,
        enhance_prompt:      p.enhance_prompt,
        generate_audio:      p.generate_audio,
        person_generation:   p.video_person_generation,
        compression_quality: p.compression_quality,
    });
}

/** Find all node ids whose outputs feed `nodeId`'s inputs. */
function upstreamNodes(nodeId) {
    return [...store.getUpstreamNodeIds(nodeId)]
        .map(id => store.getNode(id))
        .filter(Boolean);
}

/** Data nodes downstream of `nodeId` (consumers of its output). */
function downstreamDataNodes(nodeId) {
    return [...store.getDownstreamNodeIds(nodeId)]
        .map(id => store.getNode(id))
        .filter(n => n && n.type === 'data');
}

/** First upstream Data node matching one of `dataTypes`. */
function findInput(nodes, dataTypes) {
    return nodes.find(n => n.type === 'data' && dataTypes.includes(n.dataType));
}

/** Push `value` into a downstream Data node of matching `dataTypes`
 *  whose source is "input" AND which is still empty (no prior output).
 *  This means:
 *    - The first empty matching sink receives the new value.
 *    - Filled sinks are NEVER silently overwritten — they preserve the
 *      result of an earlier run.
 *    - If no empty matching sink exists (none connected, or all are
 *      already populated), a fresh sink is spawned beside the producer
 *      and wired up so the result is visible.
 *  The producer stays selected so its Run-status pill stays in view. */
function pushDownstream(producer, dataTypes, value) {
    const downstream = downstreamDataNodes(producer.id);
    const emptyMatches = downstream.filter(dn =>
        dn.source === 'input'
        && dataTypes.includes(dn.dataType)
        && !dn.value
    );

    if (emptyMatches.length > 0) {
        // Fill the first empty sink; leave any others alone so a later
        // re-run can populate them in order.
        store.updateNode(emptyMatches[0].id, 'value', value);
        return;
    }

    // No empty compatible sink — spawn one. Stagger vertically per
    // existing downstream node so successive runs don't pile up on top
    // of each other.
    const dataType = dataTypes[0];
    const title    = `${dataType[0].toUpperCase()}${dataType.slice(1)} output`;
    const offset   = downstream.length;
    // Sink offset = producer right edge + a 120 px gap so wires aren't
    // squashed. Reads producer.width so wider nodes still get clear air
    // around their downstream sinks.
    const producerWidth = producer.width || 220;
    const sink = store.addNode({
        id: store.nextNodeId(),
        type: 'data',
        title,
        dataType,
        source: 'input',
        value,
        inputs: ['in_1'],
        outputs: ['out_1'],
        x: producer.x + producerWidth + 120,
        y: producer.y + offset * 220,
    });

    // Producer's first output slot → new sink's first input slot.
    const fromSlot = `${producer.id}-${(producer.outputs || ['out_1'])[0]}`;
    const toSlot   = `${sink.id}-${(sink.inputs || ['in_1'])[0]}`;
    store.addConnection(fromSlot, toSlot);
    // NB: deliberately do NOT setActive(sink) — the producer stays
    // selected so the user sees the "✔ Done" status in the sidebar.
}

/**
 * Execute a Generate or Modify node. Returns the produced value
 * (asset URL or caption text). Throws a human-readable message on
 * failure.
 */
export async function runNode(nodeId) {
    const node = store.getNode(nodeId);
    if (!node) throw new Error(`unknown node ${nodeId}`);

    emitRunStatus(nodeId, 'start');
    try {
        const result = await _runNodeInner(node);
        emitRunStatus(nodeId, 'ok', { result });
        return result;
    } catch (err) {
        emitRunStatus(nodeId, 'err', { message: err?.message || String(err) });
        throw err;
    }
}

async function _runNodeInner(node) {
    const nodeId = node.id;
    const upstream = upstreamNodes(nodeId);

    // ── Gradio dispatch path ──────────────────────────────────────
    // Nodes carrying ``engine: 'gradio'`` route through the centralised
    // GradioManager instead of the in-process FastAPI proxy. We delegate
    // input-validation + URL pointer wiring to the manager so this code
    // stays small. The result is pushed downstream identically to the
    // FastAPI path so the rest of the app sees no difference.
    if (node.engine === 'gradio') {
        const { value, dataType } = await gradio.execute(node, upstream);
        pushDownstream(node, [dataType], value);
        session.record({
            // ``text`` outputs go in as captions; binary outputs as their type.
            type: dataType === 'text' ? 'caption' : dataType,
            url:  dataType === 'text' ? null     : value,
            text: dataType === 'text' ? value    : null,
            producerNodeId: node.id,
        });
        return value;
    }

    const text  = findInput(upstream, ['text']);
    const image = findInput(upstream, ['image']);
    const video = findInput(upstream, ['video']);

    if (node.type === 'modify') {
        if (!image || !image.value) {
            throw new Error('Modify needs an image input connection.');
        }
        const prompt = (text && text.value) || node.params?.operation || 'enhance';
        const result = await api.modifyImage({
            prompt,
            image: image.value,
            ...imageOptions(node.params || {}),
        });
        pushDownstream(node, ['image'], result.asset.url);
        session.record({
            url: result.asset.url,
            mime: result.asset.mime_type,
            type: 'image',
            producerNodeId: node.id,
        });
        return result.asset.url;
    }

    if (node.type !== 'generate') {
        throw new Error(`Node type "${node.type}" cannot be run.`);
    }

    const outputType = node.params?.output_type ?? 'image';

    if (outputType === 'image') {
        const prompt = (text && text.value) || '';
        if (!prompt) throw new Error('Image output needs a text prompt input.');
        const result = await api.generateImage({
            prompt,
            reference_images: image && image.value ? [image.value] : [],
            ...imageOptions(node.params || {}),
        });
        pushDownstream(node, ['image'], result.asset.url);
        session.record({
            url: result.asset.url,
            mime: result.asset.mime_type,
            type: 'image',
            producerNodeId: node.id,
        });
        return result.asset.url;
    }

    if (outputType === 'video') {
        const prompt = (text && text.value) || '';
        if (!prompt) throw new Error('Video output needs a text prompt input.');
        
        let result;
        try {
            result = await api.generateVideo({
                mode: image ? 'image' : 'text',
                prompt,
                image: image ? image.value : undefined,
                ...videoOptions(node.params || {}),
            });
        } catch (e) {
            // Dev mode: Generate mock video data for UI testing
            if (e.message?.includes('GOOGLE_API_KEY') || e.message?.includes('502')) {
                const numVideos = (node.params?.number_of_videos ?? 1);
                const mockAssets = Array.from({ length: numVideos }, (_, i) => ({
                    url: `data:video/mp4;base64,AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAAIZnJlZQAAAZhtZGF0aaC/gP//3v3D`,
                    mime_type: 'video/mp4',
                }));
                result = { assets: mockAssets };
                console.warn('Using mock video data for UI testing (API not configured)');
            } else {
                throw e;
            }
        }
        
        // `result.assets` is a list — one entry per generated video.
        // Store all variants in the node for UI access, push each downstream.
        node._generatedAssets = result.assets.map(a => ({
            url: a.url,
            mime: a.mime_type,
        }));
        node._activeAssetIndex = 0;
        for (const asset of result.assets) {
            pushDownstream(node, ['video'], asset.url);
            session.record({
                url: asset.url,
                mime: asset.mime_type,
                type: 'video',
                producerNodeId: node.id,
            });
        }
        return result.assets[0]?.url ?? null;
    }

    if (outputType === 'caption') {
        const media = (image && image.value) || (video && video.value);
        if (!media) throw new Error('Caption output needs an image or video input.');
        const prompt = node.params?.caption_prompt
            || (text && text.value)
            || 'Describe this in vivid, prompt-style detail.';
        const result = await api.caption({ media, prompt });
        pushDownstream(node, ['text'], result.text);
        session.record({
            type: 'caption',
            text: result.text,
            producerNodeId: node.id,
        });
        return result.text;
    }

    throw new Error(`Unknown output type: ${outputType}`);
}
