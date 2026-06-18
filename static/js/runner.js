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

import { store } from './state.js';
import { api } from './api.js';
import { session } from './session.js';

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

/** Push `value` into every downstream Data node of matching dataType
 *  whose source is "input" (i.e. it's expecting upstream feed).
 *  If none exist, auto-spawn a fresh output Data node beside the
 *  producer and wire it so the result is visible. The producer
 *  remains selected so its Run-status pill stays in view. */
function pushDownstream(producer, dataTypes, value) {
    const matches = downstreamDataNodes(producer.id)
        .filter(dn => dn.source === 'input' && dataTypes.includes(dn.dataType));

    if (matches.length > 0) {
        for (const dn of matches) {
            store.updateNode(dn.id, 'value', value);
        }
        return;
    }

    // No compatible sink — create one. Stagger vertically per existing
    // downstream node so successive runs don't pile up on top of each
    // other.
    const dataType = dataTypes[0];
    const title    = `${dataType[0].toUpperCase()}${dataType.slice(1)} output`;
    const offset   = downstreamDataNodes(producer.id).length;
    const sink = store.addNode({
        id: store.nextNodeId(),
        type: 'data',
        title,
        dataType,
        source: 'input',
        value,
        inputs: ['in_1'],
        outputs: ['out_1'],
        x: producer.x + 340,
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

    const upstream = upstreamNodes(nodeId);
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
        const result = await api.generateVideo({
            mode: image ? 'image' : 'text',
            prompt,
            image: image ? image.value : undefined,
            ...videoOptions(node.params || {}),
        });
        pushDownstream(node, ['video'], result.asset.url);
        session.record({
            url: result.asset.url,
            mime: result.asset.mime_type,
            type: 'video',
            producerNodeId: node.id,
        });
        return result.asset.url;
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
