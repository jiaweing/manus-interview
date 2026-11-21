/**
 * Issue #165 replaces this body with cache validation and freezing.
 * Bytes are untrusted candidates, never accepted solely because generation succeeded.
 * @param {{bytes: Uint8Array, mimeType: string, model: string, prompt: string,
 * usage: object|null, requestMeta: object}} candidate
 * @returns {Promise<{accepted: boolean, reason: string}>}
 */
export async function acceptCandidate({bytes, mimeType, model, prompt, usage, requestMeta}) {
  // No writes, decode assumptions, network, or fabricated acceptance before #165.
  void [bytes, mimeType, model, prompt, usage, requestMeta];
  return {accepted: false, reason: 'cache layer not implemented'};
}
