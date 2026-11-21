# Audio meter reference values

The meter implements ITU-R BS.1770-4 Annex 1 stereo K-weighting using the exact 48 kHz two-biquad coefficients, unit left/right channel weights, the −0.691 offset, 400 ms blocks with 75% overlap, an absolute −70 LUFS gate, and a relative gate 10 LU below the absolute-gated mean. Incomplete blocks are discarded. No fitted correction factor is used. [1]

The true-peak path uses the published Annex 2 four-phase, twelve-taps-per-phase FIR at 192 kHz (4×). Calculations are Float64, so the integer-only 12.04 dB preliminary attenuation is unnecessary. Filter delay affects neither cue samples nor the rendered WAV: this convolution is for measurement only. Zero padding flushes the measurement filter; sample peak is retained as a conservative lower bound. [1]

A 997 Hz in-phase stereo sine with **per-channel peak amplitude** 0.1 (−20 dBFS, not −20 dBFS RMS) must measure about −20.0 LUFS ±0.1. The 1 kHz, −23 dBFS, 20-second stereo calibration is EBU Tech 3341 case 1, expected −23.0 LUFS ±0.1. The 997 Hz variation is the issue's requested nearby-frequency regression, not a claim that the EBU case itself uses 997 Hz. A single active channel is 3.0103 LU lower. [1] [2]

Additional fixtures cover EBU Tech 3341 cases 3/4 (quiet or below-absolute-gate sections around a louder reference), and true-peak cases 15–19: tapered 12 kHz at phase 0° and 45°, 8 kHz at 60°, 6 kHz at 67.5°, each amplitude 0.5, expected −6.0 dBTP with +0.2/−0.4 dB tolerance; amplitude 1.41, 12 kHz at phase 45°, expected +3.0 dBTP with the same tolerance. These are algorithm fixtures, not a claim of formal certification or exhaustive EBU conformance. [2]

Sources inspected 2026-11-21. The ITU `-I` download endpoint failed; the authoritative `-S` PDF downloaded successfully and was inspected as extracted PDF text. FFmpeg is reserved for the independent final-WAV cross-check only, never audio authoring or the JavaScript meter.

## References

[1]: https://www.itu.int/dms_pubrec/itu-r/rec/bs/R-REC-BS.1770-4-201510-S!!PDF-E.pdf "ITU-R BS.1770-4, 2015"
[2]: https://tech.ebu.ch/docs/tech/tech3341.pdf "EBU Tech 3341, November 2023"
