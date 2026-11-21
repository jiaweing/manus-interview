# Frozen audio cache (#165)

Audio selection is filesystem-only. Render preparation imports `src/audio/select-audio.js` and calls `await selectAudio({cacheDir, fallbackDir, hashes})`; the selector returns `{source, path, sha256, reason, networkRequests: 0, measurements}`. `path` points to a local PCM16 WAV (not a URL). It also returns the individual `hashes` and, on fallback after a candidate rejection, `providerMeasurements`. No audio is generated, requested, decoded by a native executable, trimmed, padded, resampled, or time-stretched by these paths. Their transitive imports contain nothing from `src/music`.

The committed selection is **`js-fallback`**, with reason **`no accepted provider cache`**. There is no real provider candidate: no `OPENROUTER_API_KEY` was available. Its frozen WAV SHA-256 is `81d19d2fd2cff0d4d9e855bd6f7d1f4721ee35e92a8b94a9744fd947536861f6`. `fallback.wav` and `fallback.meta.json` retain the synth seed, prompt-equivalent and sample metadata from #164. The selector verifies the WAV against that seed record and validates its content/timing again; it never regenerates the synth.

## Layout and audit fields

An accepted provider cache is a single atomically published directory:

```text
audio/
  audio-manifest.json
  fallback.wav
  fallback.meta.json
  cache/                       # absent until a candidate is accepted
    source.wav OR source.pcm   # exact original provider candidate bytes
    decoded.wav                # canonical, lossless interleaved PCM16 WAV
    metadata.json
  cache.rejection.json         # most recent rejected attempt, if any
```

`metadata.json` has `schemaVersion: 1`, `status: "accepted"`, `sourceFile`, `mimeType`, `pcmFormat`, `prompt`, `model`, `rights: {approvedBy, terms, ref}`, numeric allowlisted `usage`, allowlisted `requestMeta`, caller-provided `createdAt`, `sha256: {source, decodedPcm, decodedWav}`, and all measured content/timing values. `decodedPcm` hashes only the interleaved PCM data chunk; `decodedWav` hashes the full canonical WAV. Prompt/model strings identify the actual candidate, not an assertion of successful model access or guaranteed requested BPM.

The authoring-only `src/music/candidate-sink.js` keeps the existing async `acceptCandidate({bytes,mimeType,model,prompt,usage,requestMeta}) -> {accepted,reason}` interface. Audit values `createdAt`, `rights`, and `pcmFormat` may be supplied top-level, or in `requestMeta`; `cacheDir` is an optional authoring/test destination. The music script passes its caller-provided `checkedAt`, approval `rights`, and validated contract `pcmFormat` through `requestMeta`. A boolean `rightsApproved` alone is **not** a documented rights record. Missing rights/creation/model/prompt records reject even otherwise valid PCM. Arbitrary raw headers, provider responses, credentials, and unknown request fields are not persisted; known credential patterns are redacted and source-document query strings/userinfo are removed.

Publication writes all three files to a sibling temporary directory and renames the completed directory into `cache/`. A nonempty frozen cache is never overwritten: a new attempt returns `cache-already-frozen`. Archive the previous cache explicitly during authoring before approving fresh audio. Rejections are written atomically to a sibling `cache.rejection.json`, not to the approved record; a still-valid accepted cache has priority over a later rejected attempt. Incomplete staging directories are not selectable.

## Validation boundaries

Only linear PCM16 WAV and **explicitly described** interleaved little-endian raw PCM16 are feasible without a decoder dependency. Raw bytes must have `pcmFormat: {sampleRate:48000, channels:2, bitsPerSample:16, endianness:"little"}`. No provider rate/channel assumptions are invented. MP3, Ogg, FLAC, compressed WAV and other compressed candidates are rejected as `needs-decoder`, with a recorded reason. Non-16-bit PCM is unsupported. FFmpeg is not used for decoding or validation, and no dependencies were added.

RIFF signatures, exact RIFF/chunk/file lengths, duplicate required chunks, channel/rate/block alignment/byte-rate and interleaved data integrity are checked. Exactly 2,880,000 samples/channel are required: 48 kHz, stereo, exactly 60 seconds. Silence, near-constant content and excessive clipping reject. Content validation is conservative and does not purport to identify vocals, genre, or approve usage rights.

The JavaScript onset detector averages stereo energy in 160-sample blocks (0.1 video frames), uses positive energy flux, searches ±5 video frames around **every** expected downbeat (96,000 samples / 60 video frames), and backtracks the strongest connected rise to its 10%-flux foot. It consults waveform bytes, **not** the synth score or requested prompt. All 30 expected downbeats must have a detected onset, and **any** measured drift greater than one video frame (1,600 samples) rejects rather than averaging away an outlier. Detector resolution and content-dependent attack-foot uncertainty are recorded; this is a conservative timing gate, not a guarantee of musically correct arrangement. The seeded fallback measures a maximum absolute drift of 0.1 frames, including its quieter resolving last bar.

## Frozen manifest and QA

`bun run validate:audio-cache` validates the committed manifest and selection, prints sample/timing/hash evidence including `networkRequests=0`, and writes `qa/audio-cache.json`. It does not rewrite the manifest. Optional trusted pins are `hashes: {provider: {source,decodedPcm,decodedWav}, fallback: "<WAV SHA-256>"}`; mandatory cache/fallback metadata checks also run without pins. A damaged/missing/hash-invalid accepted provider cache selects the verified fallback and records the failure reason, even if the frozen manifest previously named the provider. QA then records `manifestHashMatches:false` alongside the actual verified fallback hashes, without mutating the historical manifest. If the fallback itself is invalid, selection fails rather than playing unverified bytes.

After an explicit authoring review, `bun run validate:audio-cache --freeze` writes a new manifest. CLI test overrides are `--cache-dir`, `--fallback-dir`, `--manifest`, and `--qa`. Never delete a real cache to test fallback: `audio-cache.test.js` creates, copies, corrupts and deletes only temporary caches under the OS temporary directory, with throwing transport/fetch/WebSocket guards proving zero requests. No synthetic fixture is committed as a provider success.
