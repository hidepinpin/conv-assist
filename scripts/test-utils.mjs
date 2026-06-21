import test from 'node:test'
import assert from 'node:assert/strict'
import { pcmToB64, resamplePcm16ToB64, clip, safeJson, looksLikeOpenAiKey } from '../src/utils.js'

// helpers for PCM resampling tests
function pcmFromSamples(samples) {
  const b = new Uint8Array(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    b[2 * i] = samples[i] & 0xff
    b[2 * i + 1] = (samples[i] >> 8) & 0xff
  }
  return b
}
function samplesFromB64(b64) {
  const buf = Buffer.from(b64, 'base64')
  const out = new Int16Array(buf.length >> 1)
  for (let i = 0; i < out.length; i++) out[i] = buf.readInt16LE(2 * i)
  return out
}

test('pcmToB64 encodes S16LE bytes correctly', () => {
  assert.equal(pcmToB64(new Uint8Array([0, 1, 2, 3])), Buffer.from([0, 1, 2, 3]).toString('base64'))
})

test('pcmToB64 handles a realistic 100ms chunk (3200 bytes) without throwing', () => {
  const pcm = new Uint8Array(3200).fill(127)
  const b64 = pcmToB64(pcm)
  assert.equal(Buffer.from(b64, 'base64').length, 3200)
})

test('pcmToB64 handles large buffers (no spread stack overflow)', () => {
  const pcm = new Uint8Array(1_000_000)
  assert.equal(Buffer.from(pcmToB64(pcm), 'base64').length, 1_000_000)
})

test('clip keeps short text intact', () => {
  assert.equal(clip('hello', 160), 'hello')
})

test('clip keeps the tail and stays within glasses limits', () => {
  const long = 'a'.repeat(500)
  const out = clip(long, 160)
  assert.equal(out.length, 161) // ellipsis char + 160, under the 2000-char cap
  assert.equal(out.charCodeAt(0), 0x2026) // clip() prepends a horizontal ellipsis (U+2026)
})

test('safeJson returns null on malformed input instead of throwing', () => {
  assert.equal(safeJson('{nope'), null)
  assert.deepEqual(safeJson('{"a":1}'), { a: 1 })
})

test('looksLikeOpenAiKey accepts plausible keys and rejects junk', () => {
  assert.ok(looksLikeOpenAiKey('sk-' + 'A1b2'.repeat(8)))
  assert.equal(looksLikeOpenAiKey(''), false)
  assert.equal(looksLikeOpenAiKey('my password'), false)
  assert.equal(looksLikeOpenAiKey('sk-short'), false)
})

test('resamplePcm16ToB64 is a no-op (identity) when in/out rates match', () => {
  const pcm = pcmFromSamples([0, 100, -100, 32767, -32768])
  assert.equal(resamplePcm16ToB64(pcm, 16000, 16000), Buffer.from(pcm).toString('base64'))
})

test('resamplePcm16ToB64 upsamples 16k to 24k at 1.5x the sample count', () => {
  const n = 160
  const out = samplesFromB64(resamplePcm16ToB64(pcmFromSamples(new Array(n).fill(0)), 16000, 24000))
  assert.equal(out.length, Math.floor(n * 1.5))
})

test('resamplePcm16ToB64 preserves a constant (DC) signal', () => {
  const out = samplesFromB64(resamplePcm16ToB64(pcmFromSamples(new Array(100).fill(1234)), 16000, 24000))
  for (const s of out) assert.equal(s, 1234)
})

test('resamplePcm16ToB64 keeps every sample within signed 16-bit range', () => {
  const out = samplesFromB64(resamplePcm16ToB64(pcmFromSamples(new Array(50).fill(32767)), 16000, 24000))
  for (const s of out) assert.ok(s <= 32767 && s >= -32768)
})
