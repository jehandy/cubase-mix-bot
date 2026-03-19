/**
 * Audio Analyzer - Analyzes WAV/AIFF mixdowns for mix quality
 *
 * Performs spectral analysis, loudness measurement, dynamics analysis,
 * stereo width assessment, and generates mixing suggestions.
 * Pure JavaScript - no external audio dependencies.
 */

import { readFileSync, statSync } from 'fs';
import { createLogger } from './logger.js';

const log = createLogger('audio-analyzer');

/**
 * Parse WAV file header and extract PCM data
 */
function parseWav(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // RIFF header
  const riff = String.fromCharCode(buffer[0], buffer[1], buffer[2], buffer[3]);
  if (riff !== 'RIFF') throw new Error('Not a WAV file');

  const wave = String.fromCharCode(buffer[8], buffer[9], buffer[10], buffer[11]);
  if (wave !== 'WAVE') throw new Error('Not a WAV file');

  let offset = 12;
  let fmt = null;
  let dataStart = 0;
  let dataSize = 0;

  // Parse chunks
  while (offset < buffer.length - 8) {
    const chunkId = String.fromCharCode(buffer[offset], buffer[offset+1], buffer[offset+2], buffer[offset+3]);
    const chunkSize = view.getUint32(offset + 4, true);

    if (chunkId === 'fmt ') {
      fmt = {
        audioFormat: view.getUint16(offset + 8, true),
        numChannels: view.getUint16(offset + 10, true),
        sampleRate: view.getUint32(offset + 12, true),
        byteRate: view.getUint32(offset + 16, true),
        blockAlign: view.getUint16(offset + 20, true),
        bitsPerSample: view.getUint16(offset + 22, true),
      };
    } else if (chunkId === 'data') {
      dataStart = offset + 8;
      dataSize = chunkSize;
    }

    offset += 8 + chunkSize;
    if (chunkSize % 2 !== 0) offset++; // Padding byte
  }

  if (!fmt) throw new Error('No fmt chunk found');
  if (fmt.audioFormat !== 1 && fmt.audioFormat !== 3) {
    throw new Error(`Unsupported audio format: ${fmt.audioFormat} (only PCM supported)`);
  }

  // Extract samples as float arrays (one per channel)
  const bytesPerSample = fmt.bitsPerSample / 8;
  const numSamples = Math.floor(dataSize / (bytesPerSample * fmt.numChannels));
  const channels = Array.from({ length: fmt.numChannels }, () => new Float32Array(numSamples));

  for (let i = 0; i < numSamples; i++) {
    for (let ch = 0; ch < fmt.numChannels; ch++) {
      const pos = dataStart + (i * fmt.numChannels + ch) * bytesPerSample;

      let sample;
      if (fmt.bitsPerSample === 16) {
        sample = view.getInt16(pos, true) / 32768;
      } else if (fmt.bitsPerSample === 24) {
        const b0 = buffer[pos], b1 = buffer[pos+1], b2 = buffer[pos+2];
        let val = (b2 << 16) | (b1 << 8) | b0;
        if (val >= 0x800000) val -= 0x1000000;
        sample = val / 8388608;
      } else if (fmt.bitsPerSample === 32 && fmt.audioFormat === 3) {
        sample = view.getFloat32(pos, true);
      } else if (fmt.bitsPerSample === 32) {
        sample = view.getInt32(pos, true) / 2147483648;
      } else {
        throw new Error(`Unsupported bit depth: ${fmt.bitsPerSample}`);
      }

      channels[ch][i] = sample;
    }
  }

  return { fmt, channels, numSamples };
}

/**
 * Compute RMS level in dB
 */
function rmsDb(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    sum += samples[i] * samples[i];
  }
  const rms = Math.sqrt(sum / samples.length);
  return 20 * Math.log10(Math.max(rms, 1e-10));
}

/**
 * Compute peak level in dB
 */
function peakDb(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const abs = Math.abs(samples[i]);
    if (abs > peak) peak = abs;
  }
  return 20 * Math.log10(Math.max(peak, 1e-10));
}

/**
 * Simple FFT implementation (Cooley-Tukey radix-2)
 */
function fft(real, imag) {
  const n = real.length;
  if (n <= 1) return;

  // Bit-reversal permutation
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) {
      j ^= bit;
    }
    j ^= bit;
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }

  // FFT butterfly
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wReal = Math.cos(angle);
    const wImag = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let curReal = 1, curImag = 0;
      for (let j = 0; j < len / 2; j++) {
        const uR = real[i + j];
        const uI = imag[i + j];
        const vR = real[i + j + len/2] * curReal - imag[i + j + len/2] * curImag;
        const vI = real[i + j + len/2] * curImag + imag[i + j + len/2] * curReal;
        real[i + j] = uR + vR;
        imag[i + j] = uI + vI;
        real[i + j + len/2] = uR - vR;
        imag[i + j + len/2] = uI - vI;
        const newCurR = curReal * wReal - curImag * wImag;
        curImag = curReal * wImag + curImag * wReal;
        curReal = newCurR;
      }
    }
  }
}

/**
 * Compute frequency spectrum using FFT
 */
function computeSpectrum(samples, sampleRate, fftSize = 4096) {
  const numFrames = Math.floor(samples.length / fftSize);
  const spectrum = new Float32Array(fftSize / 2);

  // Average multiple FFT frames for stability
  const framesToAnalyze = Math.min(numFrames, 100);
  const step = Math.max(1, Math.floor(numFrames / framesToAnalyze));

  for (let frame = 0; frame < framesToAnalyze; frame++) {
    const start = frame * step * fftSize;
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);

    // Apply Hanning window
    for (let i = 0; i < fftSize && (start + i) < samples.length; i++) {
      const window = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
      real[i] = samples[start + i] * window;
    }

    fft(real, imag);

    for (let i = 0; i < fftSize / 2; i++) {
      spectrum[i] += Math.sqrt(real[i] * real[i] + imag[i] * imag[i]) / fftSize;
    }
  }

  // Average and convert to dB
  const freqResolution = sampleRate / fftSize;
  const bands = [];

  // Standard frequency bands for analysis
  const bandEdges = [20, 60, 250, 500, 1000, 2000, 4000, 8000, 16000, 20000];
  const bandNames = ['Sub', 'Bass', 'Low Mid', 'Mid', 'Upper Mid', 'Presence', 'Brilliance', 'Air', 'Ultra High'];

  for (let b = 0; b < bandNames.length; b++) {
    const loFreq = bandEdges[b];
    const hiFreq = bandEdges[b + 1];
    const loBin = Math.max(1, Math.round(loFreq / freqResolution));
    const hiBin = Math.min(fftSize / 2 - 1, Math.round(hiFreq / freqResolution));

    let energy = 0;
    let count = 0;
    for (let i = loBin; i <= hiBin; i++) {
      energy += spectrum[i] * spectrum[i];
      count++;
    }

    const avgMag = count > 0 ? Math.sqrt(energy / count) / framesToAnalyze : 0;
    const db = 20 * Math.log10(Math.max(avgMag, 1e-10));

    bands.push({
      name: bandNames[b],
      range: `${loFreq}-${hiFreq}Hz`,
      level_dB: Math.round(db * 10) / 10,
    });
  }

  return bands;
}

/**
 * Compute stereo width metrics
 */
function analyzeStereoWidth(left, right) {
  const numSamples = Math.min(left.length, right.length);
  let correlation = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  let midEnergy = 0;
  let sideEnergy = 0;

  for (let i = 0; i < numSamples; i++) {
    const l = left[i], r = right[i];
    const mid = (l + r) / 2;
    const side = (l - r) / 2;

    correlation += l * r;
    leftEnergy += l * l;
    rightEnergy += r * r;
    midEnergy += mid * mid;
    sideEnergy += side * side;
  }

  const denom = Math.sqrt(leftEnergy * rightEnergy);
  const stereoCorrelation = denom > 0 ? correlation / denom : 1;

  const midRms = Math.sqrt(midEnergy / numSamples);
  const sideRms = Math.sqrt(sideEnergy / numSamples);
  const widthRatio = midRms > 0 ? sideRms / midRms : 0;

  // Balance: compare left vs right energy
  const leftDb = 20 * Math.log10(Math.max(Math.sqrt(leftEnergy / numSamples), 1e-10));
  const rightDb = 20 * Math.log10(Math.max(Math.sqrt(rightEnergy / numSamples), 1e-10));
  const balance = Math.round((rightDb - leftDb) * 10) / 10;

  return {
    correlation: Math.round(stereoCorrelation * 1000) / 1000,
    widthRatio: Math.round(widthRatio * 1000) / 1000,
    balance_dB: balance,
    midLevel_dB: Math.round(20 * Math.log10(Math.max(midRms, 1e-10)) * 10) / 10,
    sideLevel_dB: Math.round(20 * Math.log10(Math.max(sideRms, 1e-10)) * 10) / 10,
  };
}

/**
 * Compute dynamics metrics
 */
function analyzeDynamics(samples, sampleRate) {
  const blockSize = Math.round(sampleRate * 0.4); // 400ms blocks (LUFS-ish)
  const numBlocks = Math.floor(samples.length / blockSize);
  const blockLevels = [];

  for (let b = 0; b < numBlocks; b++) {
    const start = b * blockSize;
    let sum = 0;
    for (let i = 0; i < blockSize; i++) {
      sum += samples[start + i] * samples[start + i];
    }
    const rms = Math.sqrt(sum / blockSize);
    const db = 20 * Math.log10(Math.max(rms, 1e-10));
    blockLevels.push(db);
  }

  // Sort for percentile analysis
  const sorted = [...blockLevels].sort((a, b) => a - b);
  const validBlocks = sorted.filter(db => db > -60); // Ignore silence

  if (validBlocks.length === 0) {
    return {
      dynamicRange_dB: 0,
      loudestBlock_dB: -Infinity,
      quietestBlock_dB: -Infinity,
      avgLevel_dB: -Infinity,
      crestFactor_dB: 0,
      estimatedLUFS: -Infinity,
    };
  }

  const peak = peakDb(samples);
  const rms = rmsDb(samples);
  const crest = peak - rms;

  // Estimate integrated loudness (simplified LUFS approximation)
  const gatedBlocks = validBlocks.filter(db => db > validBlocks[validBlocks.length - 1] - 20);
  const avgGated = gatedBlocks.reduce((a, b) => a + b, 0) / gatedBlocks.length;

  return {
    peakLevel_dB: Math.round(peak * 10) / 10,
    rmsLevel_dB: Math.round(rms * 10) / 10,
    dynamicRange_dB: Math.round((validBlocks[validBlocks.length - 1] - validBlocks[0]) * 10) / 10,
    crestFactor_dB: Math.round(crest * 10) / 10,
    estimatedLUFS: Math.round((avgGated - 0.691) * 10) / 10, // Rough LUFS approximation
    loudestBlock_dB: Math.round(validBlocks[validBlocks.length - 1] * 10) / 10,
    quietestBlock_dB: Math.round(validBlocks[0] * 10) / 10,
  };
}

/**
 * Detect potential clipping
 */
function detectClipping(samples, threshold = 0.99) {
  let clipCount = 0;
  let consecutiveClips = 0;
  let maxConsecutive = 0;

  for (let i = 0; i < samples.length; i++) {
    if (Math.abs(samples[i]) >= threshold) {
      clipCount++;
      consecutiveClips++;
      maxConsecutive = Math.max(maxConsecutive, consecutiveClips);
    } else {
      consecutiveClips = 0;
    }
  }

  return {
    clippedSamples: clipCount,
    clippedPercent: Math.round((clipCount / samples.length) * 10000) / 100,
    maxConsecutiveClips: maxConsecutive,
    hasClipping: clipCount > 10,
  };
}

/**
 * Generate mixing suggestions based on analysis
 */
function generateSuggestions(spectrum, dynamics, stereo, clipping) {
  const suggestions = [];

  // Frequency balance suggestions
  const subLevel = spectrum.find(b => b.name === 'Sub')?.level_dB ?? -60;
  const bassLevel = spectrum.find(b => b.name === 'Bass')?.level_dB ?? -60;
  const lowMidLevel = spectrum.find(b => b.name === 'Low Mid')?.level_dB ?? -60;
  const midLevel = spectrum.find(b => b.name === 'Mid')?.level_dB ?? -60;
  const presenceLevel = spectrum.find(b => b.name === 'Presence')?.level_dB ?? -60;
  const airLevel = spectrum.find(b => b.name === 'Air')?.level_dB ?? -60;

  if (lowMidLevel - midLevel > 6) {
    suggestions.push({
      category: 'EQ',
      severity: 'warning',
      message: 'Potential muddiness detected: Low-mid energy (250-500Hz) is significantly higher than mids. Consider cutting 200-400Hz on instruments competing in this range.'
    });
  }

  if (bassLevel - presenceLevel > 12) {
    suggestions.push({
      category: 'EQ',
      severity: 'warning',
      message: 'Mix may sound boomy/dark: Bass energy dominates over presence. Consider reducing low end or boosting 2-5kHz for clarity.'
    });
  }

  if (presenceLevel - midLevel > 8) {
    suggestions.push({
      category: 'EQ',
      severity: 'info',
      message: 'Presence range is prominent. This adds clarity but check for harshness, especially on vocals around 3-4kHz.'
    });
  }

  if (airLevel < -50) {
    suggestions.push({
      category: 'EQ',
      severity: 'info',
      message: 'Limited high-frequency content above 8kHz. If the mix sounds dull, consider a gentle high shelf boost for "air."'
    });
  }

  if (subLevel > bassLevel) {
    suggestions.push({
      category: 'EQ',
      severity: 'warning',
      message: 'Sub-bass (20-60Hz) is louder than bass (60-250Hz). This can cause problems on small speakers. Consider a high-pass filter around 30-40Hz.'
    });
  }

  // Dynamics suggestions
  if (dynamics.crestFactor_dB < 6) {
    suggestions.push({
      category: 'Dynamics',
      severity: 'warning',
      message: `Crest factor is only ${dynamics.crestFactor_dB}dB — the mix may be over-compressed. Consider reducing compression ratios or using parallel compression to restore dynamics.`
    });
  }

  if (dynamics.crestFactor_dB > 20) {
    suggestions.push({
      category: 'Dynamics',
      severity: 'info',
      message: `Very high crest factor (${dynamics.crestFactor_dB}dB). The mix has wide dynamics, which is great for classical/jazz but may need more compression for pop/rock genres.`
    });
  }

  if (dynamics.estimatedLUFS > -10) {
    suggestions.push({
      category: 'Loudness',
      severity: 'warning',
      message: `Estimated loudness (~${dynamics.estimatedLUFS} LUFS) is very high. Streaming platforms will turn this down. Target -14 LUFS (Spotify) or -13 LUFS (YouTube) for optimal playback.`
    });
  }

  if (dynamics.estimatedLUFS < -20) {
    suggestions.push({
      category: 'Loudness',
      severity: 'info',
      message: `Estimated loudness (~${dynamics.estimatedLUFS} LUFS) is quite low. Streaming platforms will turn this up, but it may sound quiet compared to other tracks. Consider if this is intentional.`
    });
  }

  // Clipping
  if (clipping.hasClipping) {
    suggestions.push({
      category: 'Clipping',
      severity: 'error',
      message: `Detected ${clipping.clippedSamples} clipped samples (${clipping.clippedPercent}%). Reduce master fader or individual track levels to maintain headroom.`
    });
  }

  // Stereo suggestions
  if (stereo.correlation < 0.3) {
    suggestions.push({
      category: 'Stereo',
      severity: 'warning',
      message: `Low stereo correlation (${stereo.correlation}). This may cause phase cancellation issues in mono playback. Check wide-panned stereo sources for mono compatibility.`
    });
  }

  if (stereo.correlation > 0.95) {
    suggestions.push({
      category: 'Stereo',
      severity: 'info',
      message: `Very high stereo correlation (${stereo.correlation}) — the mix is nearly mono. Consider wider panning on supporting instruments or subtle stereo widening.`
    });
  }

  if (Math.abs(stereo.balance_dB) > 2) {
    const side = stereo.balance_dB > 0 ? 'right' : 'left';
    suggestions.push({
      category: 'Stereo',
      severity: 'warning',
      message: `Stereo balance is off by ${Math.abs(stereo.balance_dB)}dB toward the ${side}. Review panning decisions for unintended imbalance.`
    });
  }

  // Headroom
  if (dynamics.peakLevel_dB > -1) {
    suggestions.push({
      category: 'Headroom',
      severity: 'warning',
      message: `Peak level is ${dynamics.peakLevel_dB}dB — very close to 0dBFS. Leave at least -6dB of headroom for mastering. Reduce the master fader.`
    });
  } else if (dynamics.peakLevel_dB > -3) {
    suggestions.push({
      category: 'Headroom',
      severity: 'info',
      message: `Peak level is ${dynamics.peakLevel_dB}dB. For mastering, -6dB headroom is recommended. Consider lowering levels slightly.`
    });
  }

  if (suggestions.length === 0) {
    suggestions.push({
      category: 'General',
      severity: 'info',
      message: 'No obvious issues detected. The mix appears well-balanced. Always verify on multiple playback systems.'
    });
  }

  return suggestions;
}

/**
 * Main analysis function - analyzes a WAV file and returns comprehensive report
 */
export function analyzeAudioFile(filePath) {
  const fileSize = statSync(filePath).size;
  log.info(`Analyzing ${filePath} (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);
  const start = Date.now();

  const buffer = readFileSync(filePath);
  const { fmt, channels, numSamples } = parseWav(buffer);
  log.info(`Parsed WAV: ${fmt.bitsPerSample}-bit/${fmt.sampleRate}Hz/${fmt.numChannels}ch, ${numSamples} samples`);

  const duration = numSamples / fmt.sampleRate;

  // Create mono sum for overall analysis
  const mono = new Float32Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    let sum = 0;
    for (let ch = 0; ch < fmt.numChannels; ch++) {
      sum += channels[ch][i];
    }
    mono[i] = sum / fmt.numChannels;
  }

  const format = {
    sampleRate: fmt.sampleRate,
    bitDepth: fmt.bitsPerSample,
    channels: fmt.numChannels,
    duration_seconds: Math.round(duration * 100) / 100,
    duration_display: `${Math.floor(duration / 60)}:${String(Math.floor(duration % 60)).padStart(2, '0')}`,
  };

  const spectrum = computeSpectrum(mono, fmt.sampleRate);
  const dynamics = analyzeDynamics(mono, fmt.sampleRate);
  const clipping = detectClipping(mono);

  let stereo = null;
  if (fmt.numChannels >= 2) {
    stereo = analyzeStereoWidth(channels[0], channels[1]);
  }

  const suggestions = generateSuggestions(spectrum, dynamics, stereo, clipping);

  log.info(`Analysis complete in ${Date.now() - start}ms — ${suggestions.length} suggestion(s)`);

  return {
    format,
    spectrum,
    dynamics,
    clipping,
    stereo,
    suggestions,
  };
}
