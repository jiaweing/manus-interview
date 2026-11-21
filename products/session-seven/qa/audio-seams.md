# Audio seam review — analytical only

This is an analytical waveform/construction check, **not human listening**. No human-ear audition or perceptual certification is claimed. The issue's listening requirement is represented by the requested analytical checks; human listening remains unverified.

Mastered WAV SHA-256: `a161af7bea664c35690b308000f2253fad79f5d0aa6aed2ea3133f391fb92d7b`. Exactly 2,880,000 samples/channel, stereo 48 kHz, 60 seconds.

The soundtrack is one continuous frozen fallback PCM buffer plus exactly six enveloped illustrative sine blips. No scene-boundary splice, concatenation, loop edit or reset occurs in mixing/mastering. The fallback score's oscillator/envelope events and tonic-only thinning outro are preserved. A C1-continuous soft knee avoids abrupt hard clipping. Vocals/voiceover are absent by construction: code-authored percussion, bass, melody, chords and six sine cues only.

The boundary window is ±480 samples (±10 ms). Max sample-to-sample step and isolated-impulse residual are measured across both channels. The click detector flags a sign-reversing pair of adjacent steps both >0.3 full scale with a residual >0.3. The exact cut step must be ≤0.01. These thresholds detect gross waveform cut/impulse faults, not every perceptible artifact. Larger window steps from intentional seeded percussion are reported, not concealed or mistaken for a splice.

- Frame 0, 0.000000 s, sample 0: **PASS analytical cut/click check**; exact boundary step 0.000000000, window max sample step 0.065002441, max impulse residual 0.052062988, detected clicks 0.
- Frame 180, 6.000000 s, sample 288000: **PASS analytical cut/click check**; exact boundary step 0.000000000, window max sample step 0.247985840, max impulse residual 0.208221436, detected clicks 0.
- Frame 420, 14.000000 s, sample 672000: **PASS analytical cut/click check**; exact boundary step 0.000000000, window max sample step 0.254089355, max impulse residual 0.245285034, detected clicks 0.
- Frame 660, 22.000000 s, sample 1056000: **PASS analytical cut/click check**; exact boundary step 0.000000000, window max sample step 0.225219727, max impulse residual 0.178909302, detected clicks 0.
- Frame 900, 30.000000 s, sample 1440000: **PASS analytical cut/click check**; exact boundary step 0.000000000, window max sample step 0.262359619, max impulse residual 0.243408203, detected clicks 0.
- Frame 1140, 38.000000 s, sample 1824000: **PASS analytical cut/click check**; exact boundary step 0.000000000, window max sample step 0.211761475, max impulse residual 0.196014404, detected clicks 0.
- Frame 1380, 46.000000 s, sample 2208000: **PASS analytical cut/click check**; exact boundary step 0.000000000, window max sample step 0.317779541, max impulse residual 0.273452759, detected clicks 0.
- Frame 1620, 54.000000 s, sample 2592000: **PASS analytical cut/click check**; exact boundary step 0.000000000, window max sample step 0.221984863, max impulse residual 0.208175659, detected clicks 0.
- Frame 1799, 59.966667 s, sample 2878400: **PASS analytical cut/click check**; exact boundary step 0.000000000, window max sample step 0.000000000, max impulse residual 0.000000000, detected clicks 0.

Start/end zero PCM: **PASS** (all channels' first/last samples). Frame 1799 is the requested final-frame checkpoint at 59.966667 s; the separate endpoint check includes sample 2,879,999.

No abrupt *edited* musical seams: **PASS by continuous-buffer/envelope construction**, not a human judgment about musical transitions. Scene-boundary continuity/click detector: results above. No vocal content: **PASS by source construction**. Human listening and post-AAC subjective playback remain **not run**.

Cue frames: 300, 540, 780, 1020, 1260, 1500; each begins exactly at scene-local frame 120, sample=frame×1600. They are illustrative action blips, **not native product sounds**.
