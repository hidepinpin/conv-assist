import test from 'node:test'
import assert from 'node:assert/strict'
import { pcmToB64, clip, safeJson, looksLikeOpenAiKey } from '../src/utils.js'

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
  assert.equal(out.length, 161) // ellipsis + 160 — well under textContainerUpgrade 2000-char cap
  assert.ok(out.startsWith('…'))
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
