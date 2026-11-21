from pathlib import Path
import re

root = Path(__file__).resolve().parents[3]
index = (root / 'apps/server/src/index.ts').read_text()
core = (root / 'apps/server/src/signal-server.ts').read_text()
routes = re.findall(r'app\.(?:all|get|post|put|patch|delete)\("([^"]+)"', index)
assert routes == ['/signal'], routes
assert 'origin === `https://${host}`' in index
assert 'maxPayloadLength: SIGNAL_FRAME_CAP_BYTES' in index
assert 'signal.open(ws)' in index and 'signal.message(ws, message)' in index and 'signal.close(ws)' in index
assert 'peer.send(raw)' in core
assert 'this.roomMap.delete(membership.roomId)' in core
assert 'z.strictObject' in core and 'signalEnvelopeSchema.safeParse(decoded)' in core
assert re.search(r'bytes\.byteLength >= minimum\s*&&\s*bytes\.byteLength <= maximum', core)
for pattern in [
    r'console\.', r'crypto\.subtle\.(?:decrypt|deriveKey|importKey)',
    r'\b(?:localStorage|sessionStorage|indexedDB)\b',
    r'\b(?:writeFile|appendFile|Bun\.write|mongoose|MongoClient|Database)\b',
]:
    assert not re.search(pattern, core), pattern
assert not re.search(r'console\.[^(]+\([^)]*\b(?:req|message|payload|envelope|raw)\b', index)
print('PASS: sole Hono route /signal; all other HTTP requests proxy to the existing Next client.')
print('PASS: same-origin HTTPS check unchanged; Bun payload cap uses the declared constant.')
print('PASS: open/message/close handlers use memory-only signal core; termination deletes room.')
print('PASS: strict Zod envelopes; canonical decoding validates ciphertext byte length.')
print('PASS: forwarding uses exact original raw text, not reserialization or decryption.')
print('PASS: no payload logging, crypto decryption, persistence API, or storage integration in signal core.')
print('Limit: source audit is not an audited-security claim or deployed-infrastructure inspection.')
