/**
 * Initial node graph definition. Kept separate from runtime state so it
 * can be swapped (e.g. loaded from the backend) without touching logic.
 *
 * Node taxonomy:
 *   - 'data'     : a text / image / video payload. Source can be
 *                  'manual' (typed text), 'upload' (file) or 'input'
 *                  (fed by an upstream connection). Has both inputs and
 *                  outputs so it can sit anywhere in the graph.
 *   - 'generate' : produces media via an AI model. Output only.
 *   - 'modify'   : transforms upstream input. Input + output.
 */

export const INITIAL_NODES = [
    {
        id: 'node_1',
        type: 'data',
        title: 'Prompt',
        x: 120, y: 160,
        dataType: 'text',
        source: 'manual',
        value: 'A futuristic cyberpunk neon city marketplace, cinematic lighting, 8k resolution',
        inputs: ['in_1'],
        outputs: ['out_1'],
    },
    {
        id: 'node_2',
        type: 'generate',
        title: 'AI Generation Core',
        x: 470, y: 130,
        inputs: ['in_1', 'in_2'],
        outputs: ['out_1'],
        params: {
            output_type: 'image',
            image_provider: 'nanobanana',
            image_aspect_ratio: '16:9',
            seed: null,
            image_size: null,
            person_generation: null,
            output_mime_type: null,
            output_compression_quality: null,
            temperature: null,
            system_instruction: '',
            duration_seconds: 8,
            aspect_ratio: '16:9',
            video_seed: null,
            number_of_videos: 1,
            resolution: null,
            fps: null,
            negative_prompt: '',
            enhance_prompt: null,
            generate_audio: null,
            video_person_generation: null,
            compression_quality: null,
            caption_prompt: 'Describe this in vivid, prompt-style detail.',
        },
    },
    {
        id: 'node_3',
        type: 'data',
        title: 'Image Preview',
        x: 820, y: 180,
        dataType: 'image',
        source: 'input',
        value: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?auto=format&fit=crop&w=300&q=80',
        inputs: ['in_1'],
        outputs: ['out_1'],
    },
];

export const INITIAL_CONNECTIONS = [
    { from: 'node_1-out_1', to: 'node_2-in_1' },
    { from: 'node_2-out_1', to: 'node_3-in_1' },
];
