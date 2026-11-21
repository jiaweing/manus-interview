// Public documentation inspected on 2026-11-21. This is evidence, not access approval.
export const MUSIC_PROMPT = '60-second instrumental, 120 BPM, 4/4, playful cartoon chiptune, clear downbeats, sparse melody, resolve over final three bars; no vocals or artist imitation.';

export const ALLOWED_MODELS = Object.freeze([
  'google/lyria-3-clip-preview',
  'google/lyria-3-pro-preview',
]);

export const musicContract = Object.freeze({
  validated: false,
  retrievedAt: '2026-11-21',
  docs: Object.freeze([
    'https://openrouter.ai/docs/guides/overview/multimodal/audio',
    'https://openrouter.ai/google/lyria-3-pro-preview/llms.txt',
    'https://openrouter.ai/collections/audio-models',
    'https://openrouter.ai/api/v1/models',
    'https://openrouter.ai/api/v1/models/google/lyria-3-pro-preview/endpoints',
    'https://openrouter.ai/docs/guides/routing/provider-selection',
  ]),
  model: 'google/lyria-3-pro-preview',
  endpoint: 'https://openrouter.ai/api/v1/chat/completions',
  method: 'POST',
  // Exact audio guide example. It documents GPT Audio, NOT Lyria music.
  documentedRequest: Object.freeze({
    model: 'openai/gpt-audio',
    messages: [{role: 'user', content: 'Say hello in a friendly tone.'}],
    modalities: ['text', 'audio'],
    audio: {voice: 'alloy', format: 'pcm16'},
    stream: true,
  }),
  // Exact SSE JSON shape from the audio guide; concatenate data strings before decoding.
  documentedResponse: Object.freeze({
    contentType: 'text/event-stream',
    chunk: {choices: [{delta: {audio: {data: '<base64-encoded audio chunk>', transcript: 'Hello'}}}]},
    audioDataPath: 'choices[0].delta.audio.data',
    encoding: 'base64',
    completion: 'data: [DONE]',
    usage: {prompt_tokens: 12, completion_tokens: 24, total_tokens: 36, cost: 0.001},
  }),
  // These MUST be documented for the selected music model before validated becomes true.
  audio: null,
  mimeType: null,
  costCeilingValidated: false,
  documentedPrice: {usdPerSong: 0.08, provider: 'Google AI Studio'},
  documentedPriceControl: 'provider.max_price.request caps per-request pricing; prompt/completion are USD per million tokens. allow_fallbacks:false disables provider retries.',
  validationGaps: Object.freeze([
    'The Lyria reference confirms model/messages/stream but gives no Lyria-specific audio format or voice configuration. The generic audio guide requires audio configuration; its alloy/pcm16 example is for GPT Audio and must not be assumed valid for Lyria.',
    'Lyria is advertised at $0.08/song, but public model/endpoint pricing exposes only zero prompt/completion rates. Applying provider.max_price.request as a hard ceiling to Lyria per-song charges is not confirmed.',
    'Public endpoint metadata reports status -5 and zero 30-minute uptime; authenticated model access and music generation were not tested: no key.',
  ]),
});
