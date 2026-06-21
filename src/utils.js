/**
 * Pure helpers — no SDK / DOM dependencies so the Node harness can test them directly.
 */

/**
 * S16LE PCM bytes → base64 (loop-based: avoids spread stack-overflow on large chunks).
 * @param {Uint8Array} pcm
 * @returns {string}
 */
export function pcmToB64(pcm) {
  if (typeof btoa !== 'function') {
    // Node (harness) path
    return Buffer.from(pcm).toString('base64')
  }
  let bin = ''
  for (let i = 0; i < pcm.length; i++) bin += String.fromCharCode(pcm[i])
  return btoa(bin)
}

/**
 * Upsample mono S16LE PCM from inRate to outRate (linear interpolation) → base64.
 * The G2 glasses emit 16kHz, but OpenAI realtime audio/pcm requires rate >= 24000.
 * @param {Uint8Array} pcm  S16LE little-endian bytes
 * @param {number} inRate
 * @param {number} outRate
 * @returns {string} base64 of S16LE at outRate
 */
export function resamplePcm16ToB64(pcm, inRate, outRate) {
  if (inRate === outRate) return pcmToB64(pcm)
  const inSamples = pcm.length >> 1
  const src = new Int16Array(inSamples)
  for (let i = 0; i < inSamples; i++) {
    src[i] = ((pcm[2 * i] | (pcm[2 * i + 1] << 8)) << 16) >> 16 // LE → signed 16-bit
  }
  const ratio = outRate / inRate
  const outLen = Math.floor(inSamples * ratio)
  const out = new Uint8Array(outLen * 2)
  for (let j = 0; j < outLen; j++) {
    const pos = j / ratio
    const idx = Math.floor(pos)
    const frac = pos - idx
    const s0 = src[idx] ?? 0
    const s1 = src[idx + 1] ?? s0
    let v = Math.round(s0 + (s1 - s0) * frac)
    if (v > 32767) v = 32767
    else if (v < -32768) v = -32768
    out[2 * j] = v & 0xff
    out[2 * j + 1] = (v >> 8) & 0xff
  }
  return pcmToB64(out)
}

/**
 * Clip text to fit a glasses row, keeping the most recent tail.
 * @param {string} s
 * @param {number} max
 * @returns {string}
 */
export function clip(s, max = 160) {
  return s.length > max ? '…' + s.slice(-max) : s
}

/**
 * Safely parse JSON; returns null instead of throwing.
 * @param {string} raw
 * @returns {any|null}
 */
export function safeJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

/**
 * Minimal API-key sanity check (never log the key itself).
 * @param {string} key
 * @returns {boolean}
 */
export function looksLikeOpenAiKey(key) {
  return /^sk-[A-Za-z0-9_-]{20,}$/.test(key)
}
