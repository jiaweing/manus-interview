// Code-authored PCM only. All accumulation uses Float64 before WAV quantization.
// Math.sin is repeatable in the pinned Bun runtime; cross-engine/libm byte identity
// is not promised. Fixed event order and seeded noise guarantee repeated-run identity.
export const GENERATOR_VERSION = '1.0.0';
export const DEFAULT_SEED = 164120;
export const MUSIC_PROMPT = '60-second instrumental, 120 BPM, 4/4, playful cartoon chiptune, clear downbeats, sparse melody, resolve over final three bars; no vocals or artist imitation.';
export const GRID = Object.freeze({
  bpm: 120, timeSignature: '4/4', bars: 30, sampleRate: 48000,
  channels: 2, samplesPerBeat: 24000, samplesPerBar: 96000,
  framesPerBeat: 15, samplesPerChannel: 2880000, durationSeconds: 60,
});
export const ENVELOPES = Object.freeze({
  kick: Object.freeze({attackSamples: 96, decaySamples: 2400, sustainLevel: 0.55, releaseFraction: 0.7}),
  snare: Object.freeze({attackSamples: 96, decaySamples: 1440, sustainLevel: 0.35, releaseFraction: 0.7}),
  hat: Object.freeze({attackSamples: 48, decaySamples: 480, sustainLevel: 0.22, releaseFraction: 0.65}),
  bass: Object.freeze({attackSamples: 240, decaySamples: 2400, sustainLevel: 0.7, releaseFraction: 0.3}),
  melody: Object.freeze({attackSamples: 384, decaySamples: 2400, sustainLevel: 0.55, releaseFraction: 0.4}),
  chord: Object.freeze({attackSamples: 2400, decaySamples: 7200, sustainLevel: 0.65, releaseFraction: 0.4}),
});
export const VOICES = Object.freeze({
  kick: Object.freeze({family: 'percussion', waveform: 'sine pitch sweep', envelope: ENVELOPES.kick}),
  snare: Object.freeze({family: 'percussion', waveform: 'seeded high-pass noise + sine', envelope: ENVELOPES.snare}),
  hat: Object.freeze({family: 'percussion', waveform: 'seeded high-pass noise', envelope: ENVELOPES.hat}),
  bass: Object.freeze({family: 'bass', waveform: 'triangle', envelope: ENVELOPES.bass}),
  melody: Object.freeze({family: 'melody', waveform: 'square (polyBLEP)', envelope: ENVELOPES.melody}),
  chord: Object.freeze({family: 'chord', waveform: 'triangle/sine pad', envelope: ENVELOPES.chord}),
});
export const CHORDS = Object.freeze({
  C: Object.freeze([60, 64, 67]), Am: Object.freeze([57, 60, 64]),
  F: Object.freeze([53, 57, 60]), G: Object.freeze([55, 59, 62]),
});
const PROGRESSION = ['C', 'Am', 'F', 'G'];
const ROOTS = {C: 36, Am: 33, F: 29, G: 31};
const MOTIFS = {
  C: [72, 76, 79], Am: [76, 72, 69], F: [72, 77, 76], G: [74, 79, 71],
};

export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

// Raised-cosine attack/release gives exact zero endpoints and soft note seams.
export function envelopeAt(index, length, definition) {
  if (index <= 0 || index >= length - 1) return 0;
  const attack = Math.min(definition.attackSamples, Math.floor(length / 4));
  const decay = Math.min(definition.decaySamples, Math.floor(length / 4));
  const release = Math.max(1, Math.floor(length * definition.releaseFraction));
  let level = definition.sustainLevel;
  if (index < attack) level = 0.5 - 0.5 * Math.cos(Math.PI * index / attack);
  else if (index < attack + decay) {
    level = 1 - (1 - definition.sustainLevel) * (index - attack) / decay;
  }
  if (index > length - 1 - release) {
    level *= 0.5 - 0.5 * Math.cos(Math.PI * (length - 1 - index) / release);
  }
  return level;
}

export function createScore() {
  const events = [];
  let order = 0;
  function add(voice, bar, beat, beats, amplitude, midi = null, pan = 0, chord = null) {
    const startSample = (bar - 1) * GRID.samplesPerBar + beat * GRID.samplesPerBeat;
    const lengthSamples = Math.min(Math.round(beats * GRID.samplesPerBeat), GRID.samplesPerChannel - startSample);
    events.push({voice, bar, beat, startSample, lengthSamples, amplitude, midi, pan, chord, order: order++});
  }
  for (let bar = 1; bar <= GRID.bars; bar++) {
    const resolving = bar >= 28;
    const chord = resolving ? 'C' : PROGRESSION[(bar - 1) % 4];
    const introGain = bar === 1 ? 0.6 : bar === 2 ? 0.8 : 1;
    const outroGain = bar === 28 ? 0.85 : bar === 29 ? 0.55 : bar === 30 ? 0.4 : 1;
    const gain = introGain * outroGain;
    CHORDS[chord].forEach((midi, index) => add('chord', bar, 0, 4, 0.075 * gain, midi, (index - 1) * 0.6, chord));

    if (bar < 30) {
      // All downbeats lie exactly on bar boundaries; beat 3 is the other kick.
      add('kick', bar, 0, 0.6, 0.58 * gain * (bar === 1 || (bar - 1) % 4 === 0 ? 1.12 : 1));
      if (bar < 29) add('kick', bar, 2, 0.55, 0.48 * gain);
    }
    if (bar >= 2 && bar <= 28) {
      add('snare', bar, 1, 0.42, 0.22 * gain, null, -0.05);
      add('snare', bar, 3, 0.42, 0.22 * gain, null, 0.05);
    } else if (bar === 29) add('snare', bar, 1, 0.35, 0.07, null, 0.05);
    if (bar < 30) {
      const hatStep = bar <= 2 || resolving ? 1 : 0.5;
      const hatLimit = bar === 1 ? 2 : bar === 29 ? 2 : 4;
      for (let beat = 0; beat < hatLimit; beat += hatStep) {
        add('hat', bar, beat, 0.18, (beat % 1 === 0 ? 0.095 : 0.06) * gain, null, beat % 1 === 0 ? -0.3 : 0.3);
      }
    }

    const root = ROOTS[chord];
    if (bar <= 28) {
      add('bass', bar, 0, 1.75, 0.24 * gain, root, -0.1, chord);
      add('bass', bar, 2, 1.65, 0.2 * gain, root + 7, -0.1, chord);
    } else add('bass', bar, 0, 4, 0.2 * gain, root, -0.1, chord);

    // Leave rests for captions/actions; two or three short notes, never a busy lead.
    if (bar >= 3 && bar <= 27) {
      const motif = MOTIFS[chord];
      add('melody', bar, 0.5, 0.65, 0.12 * gain, motif[0], 0.2, chord);
      add('melody', bar, 2, 0.9, 0.11 * gain, motif[1], 0.2, chord);
      if (bar % 4 === 3) add('melody', bar, 3.25, 0.6, 0.09 * gain, motif[2], 0.2, chord);
    } else if (bar === 28) {
      add('melody', bar, 0.5, 1.1, 0.095, 79, 0.2, 'C');
      add('melody', bar, 2, 1.5, 0.085, 76, 0.2, 'C');
    } else if (bar === 29) {
      // Final long C spans the last three seconds; no new lead note in bar 30.
      add('melody', bar, 2, 6, 0.08, 72, 0.2, 'C');
    }
  }
  return events.sort((a, b) => a.startSample - b.startSample || a.order - b.order);
}

function polyBlep(phase, step) {
  if (phase < step) {
    const t = phase / step;
    return t + t - t * t - 1;
  }
  if (phase > 1 - step) {
    const t = (phase - 1) / step;
    return t * t + t + t + 1;
  }
  return 0;
}

function waveform(voice, index, frequency, random, noiseState) {
  const seconds = index / GRID.sampleRate;
  const phase = (frequency * seconds) % 1;
  if (voice === 'kick') {
    // Integrated 150 -> 48 Hz exponential sweep, with a low fundamental tail.
    const sweepPhase = 2 * Math.PI * (48 * seconds + 102 * 0.025 * (1 - Math.exp(-seconds / 0.025)));
    return Math.sin(sweepPhase) * Math.exp(-seconds * 9);
  }
  if (voice === 'snare' || voice === 'hat') {
    const noise = random() * 2 - 1;
    const highPass = (noise - noiseState.previous) * 0.5;
    noiseState.previous = noise;
    return voice === 'hat'
      ? highPass * Math.exp(-seconds * 45)
      : (0.82 * highPass + 0.18 * Math.sin(2 * Math.PI * 185 * seconds)) * Math.exp(-seconds * 17);
  }
  const triangle = 1 - 4 * Math.abs(phase - 0.5);
  if (voice === 'bass') return triangle;
  if (voice === 'chord') return 0.55 * triangle + 0.45 * Math.sin(2 * Math.PI * phase);
  const step = frequency / GRID.sampleRate;
  return (phase < 0.5 ? 1 : -1) + polyBlep(phase, step) - polyBlep((phase + 0.5) % 1, step);
}

export function synthesize({seed = DEFAULT_SEED} = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('seed must be a uint32');
  const channels = [new Float64Array(GRID.samplesPerChannel), new Float64Array(GRID.samplesPerChannel)];
  const events = createScore();
  const random = mulberry32(seed);
  for (const event of events) {
    const frequency = event.midi === null ? 0 : 440 * 2 ** ((event.midi - 69) / 12);
    const left = Math.sqrt((1 - event.pan) / 2);
    const right = Math.sqrt((1 + event.pan) / 2);
    const noiseState = {previous: 0};
    for (let index = 0; index < event.lengthSamples; index++) {
      const oscillator = waveform(event.voice, index, frequency, random, noiseState);
      const value = oscillator * event.amplitude * envelopeAt(index, event.lengthSamples, ENVELOPES[event.voice]);
      const position = event.startSample + index;
      channels[0][position] += value * left;
      channels[1][position] += value * right;
    }
  }
  let rawPeak = 0;
  const fadeStart = 29 * GRID.samplesPerBar;
  for (let index = 0; index < GRID.samplesPerChannel; index++) {
    const intro = index < 240 ? 0.5 - 0.5 * Math.cos(Math.PI * index / 240) : 1;
    const tail = index >= fadeStart
      ? (0.5 - 0.5 * Math.cos(Math.PI * (GRID.samplesPerChannel - 1 - index) / (GRID.samplesPerBar - 1))) ** 2
      : 1;
    for (const channel of channels) {
      channel[index] *= intro * tail;
      rawPeak = Math.max(rawPeak, Math.abs(channel[index]));
    }
  }
  // Preserve dynamics, never raise level, and leave >3 dBFS headroom for #166.
  const gain = rawPeak > 0.68 ? 0.68 / rawPeak : 1;
  if (gain < 1) for (const channel of channels) for (let index = 0; index < channel.length; index++) channel[index] *= gain;
  return {channels, events, seed, rawPeak, gain, peak: rawPeak * gain};
}
