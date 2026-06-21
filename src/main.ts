/**
 * Conv Assist EN→JA — Even G2 app
 *
 * Flow:
 *  tap on glasses → audioControl(true) → PCM(16kHz/mono/S16LE) arrives via audioEvent
 *  → stream to OpenAI Realtime transcription (WebSocket, browser-safe subprotocol auth)
 *  → on each finished utterance, call Chat Completions for:
 *      (a) Japanese translation  (b) suggested English reply
 *  → update glasses display flicker-free with textContainerUpgrade
 */
import {
  waitForEvenAppBridge,
  TextContainerProperty,
  CreateStartUpPageContainer,
  TextContainerUpgrade,
} from '@evenrealities/even_hub_sdk'
import { resamplePcm16ToB64, clip, safeJson, looksLikeOpenAiKey } from './utils.js'

// ---------- constants ----------
const CANVAS_W = 576
const ROW_H = 96 // 288 / 3 rows
const C_EN = { id: 1, name: 'en' }
const C_JA = { id: 2, name: 'ja' }
const C_REPLY = { id: 3, name: 'reply' }

const STT_MODEL = 'gpt-4o-mini-transcribe' // supports server_vad turn detection (whisper model does not)
const GLASSES_RATE = 16000 // G2 mic PCM sample rate
const OAI_RATE = 24000 // OpenAI realtime audio/pcm minimum rate
const LLM_MODEL = 'gpt-4o-mini'
const MAX_ROW_CHARS = 160 // keep each row comfortably inside limits

// ---------- phone-side UI ----------
const $ = (id: string) => document.getElementById(id) as HTMLElement
const setStatus = (s: string) => ($('status').textContent = 'status: ' + s)

// ---------- state ----------
let listening = false
let ws: WebSocket | null = null
let lastTapAt = 0
let enText = ''
let jaText = ''
let replyText = ''
// rolling conversation context so replies consider the whole exchange, not just the last line.
// lines are prefixed "Them:" (partner) / "You:" (suggested reply you likely said).
const dialogue: string[] = []
const MAX_CONTEXT_LINES = 12

const apiKey = () => (localStorage.getItem('openai_key') ?? '').trim()

// ---------- glasses display helpers ----------
let bridge: Awaited<ReturnType<typeof waitForEvenAppBridge>>

function textRow(c: { id: number; name: string }, row: number, content: string, capture: boolean) {
  return new TextContainerProperty({
    xPosition: 0,
    yPosition: row * ROW_H,
    width: CANVAS_W,
    height: ROW_H,
    borderWidth: 0,
    borderColor: 5,
    paddingLength: 4,
    containerID: c.id,
    containerName: c.name,
    content,
    isEventCapture: capture ? 1 : 0, // exactly one container may capture events
  })
}

async function buildPage() {
  const res = await bridge.createStartUpPageContainer(
    new CreateStartUpPageContainer({
      containerTotalNum: 3,
      textObject: [
        textRow(C_EN, 0, 'EN: [tap to listen]', true),
        textRow(C_JA, 1, 'JA: —', false),
        textRow(C_REPLY, 2, 'Reply: —', false),
      ],
    }),
  )
  // 0 = success, 1 = invalid, 2 = oversize, 3 = out of memory
  if (res !== 0) setStatus('createStartUpPageContainer failed: ' + res)
}

async function upgrade(c: { id: number; name: string }, content: string) {
  const text = clip(content, MAX_ROW_CHARS)
  // full-content replacement, flicker-free on hardware.
  // textContainerUpgrade takes a single TextContainerUpgrade object (not positional args).
  await bridge.textContainerUpgrade(
    new TextContainerUpgrade({
      containerID: c.id,
      containerName: c.name,
      content: text,
      contentOffset: 0,
      contentLength: text.length,
    }),
  )
}

async function render() {
  await upgrade(C_EN, 'EN' + (listening ? ' ●' : '') + ': ' + (enText || '—'))
  await upgrade(C_JA, 'JA: ' + (jaText || '—'))
  await upgrade(C_REPLY, 'Reply: ' + (replyText || '—'))
  $('en').textContent = enText || '—'
  $('ja').textContent = jaText || '—'
  $('reply').textContent = replyText || '—'
}

// ---------- OpenAI Realtime transcription (STT) ----------
function openStt() {
  const key = apiKey()
  if (!key) {
    setStatus('APIキー未設定(下の欄で保存してください)')
    return false
  }
  if (!looksLikeOpenAiKey(key)) {
    setStatus('APIキーの形式が不正です(sk-で始まる文字列)')
    return false
  }
  // GA Realtime interface: do NOT send the beta subprotocol ('openai-beta.realtime-v1'),
  // the server rejects the handshake if it is present.
  ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', [
    'realtime',
    'openai-insecure-api-key.' + key, // browser-safe auth subprotocol
  ])
  ws.onopen = () => {
    // GA realtime transcription session schema (was beta "transcription_session.update").
    ws!.send(
      JSON.stringify({
        type: 'session.update',
        session: {
          type: 'transcription',
          audio: {
            input: {
              // glasses deliver 16kHz mono S16LE PCM → describe the real rate
              format: { type: 'audio/pcm', rate: OAI_RATE },
              transcription: { model: STT_MODEL, language: 'en' },
              turn_detection: { type: 'server_vad', silence_duration_ms: 600 },
            },
          },
        },
      }),
    )
    setStatus('listening…')
  }
  ws.onmessage = (m) => {
    const ev = safeJson(m.data as string)
    if (!ev) return
    if (ev.type === 'conversation.item.input_audio_transcription.delta') {
      enText += ev.delta ?? ''
      void render()
    } else if (ev.type === 'conversation.item.input_audio_transcription.completed') {
      const finalText = (ev.transcript ?? '').trim()
      if (finalText) {
        enText = finalText
        void render()
        void translateAndSuggest(finalText)
      }
      enText = '' // ready for next utterance
    } else if (ev.type === 'error') {
      setStatus('STT error: ' + (ev.error?.message ?? 'unknown'))
    }
  }
  ws.onerror = () => setStatus('WebSocket error(キー/ネット権限whitelistを確認)')
  ws.onclose = () => { if (listening) setStatus('WS closed') }
  return true
}

function closeStt() {
  ws?.close()
  ws = null
}

// ---------- translation + reply suggestion ----------
async function translateAndSuggest(english: string) {
  jaText = '(翻訳中…)'
  replyText = '(生成中…)'
  void render()
  try {
    const context = dialogue.slice(-MAX_CONTEXT_LINES).join('\n')
    const userContent =
      (context ? 'Conversation so far:\n' + context + '\n\n' : '') +
      'The other person just said: "' + english + '"'
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + apiKey() },
      body: JSON.stringify({
        model: LLM_MODEL,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content:
              'You assist a Japanese speaker ("You") in a live English conversation with another person ("Them"). ' +
              'Use the running conversation context to stay coherent — track the topic, answer follow-up questions, and avoid repeating earlier replies. ' +
              'Return JSON: {"ja": "<natural Japanese translation of the latest Them line>", "reply": "<one short, natural English reply You could say next that fits the conversation>"}. ' +
              'Keep reply under 20 words, conversational. JSON only.',
          },
          { role: 'user', content: userContent },
        ],
      }),
    })
    if (!r.ok) throw new Error('HTTP ' + r.status)
    const data = await r.json()
    const parsed = safeJson(data.choices?.[0]?.message?.content ?? '') ?? {}
    jaText = typeof parsed.ja === 'string' ? parsed.ja : '(翻訳失敗)'
    replyText = typeof parsed.reply === 'string' ? parsed.reply : ''
    // append this turn to the rolling context for the next suggestion
    dialogue.push('Them: ' + english)
    if (replyText) dialogue.push('You: ' + replyText)
    if (dialogue.length > 2 * MAX_CONTEXT_LINES) {
      dialogue.splice(0, dialogue.length - 2 * MAX_CONTEXT_LINES)
    }
  } catch (e) {
    jaText = '(API error)'
    replyText = ''
    console.error('translateAndSuggest failed:', e instanceof Error ? e.message : 'unknown')
  }
  void render()
}

// ---------- listening toggle ----------
async function toggleListening() {
  listening = !listening
  if (listening) {
    if (!openStt()) { listening = false; return }
    enText = ''; jaText = ''; replyText = ''
    await bridge.audioControl(true) // open glasses mic
  } else {
    await bridge.audioControl(false)
    closeStt()
    setStatus('stopped')
  }
  void render()
}

// ---------- boot ----------
async function main() {
  // API key form
  const input = $('apiKey') as HTMLInputElement
  input.value = apiKey()
  $('saveKey').addEventListener('click', async () => {
    const k = input.value.trim()
    localStorage.setItem('openai_key', k)
    if (!looksLikeOpenAiKey(k)) { setStatus('APIキーの形式が不正です(sk-で始まる文字列)'); return }
    setStatus('APIキー保存済み — 検証中…')
    try {
      const r = await fetch('https://api.openai.com/v1/models', {
        headers: { Authorization: 'Bearer ' + k },
      })
      setStatus(
        r.ok
          ? 'キーOK (200) — グラスをタップで開始'
          : 'キー検証 HTTP ' + r.status + ' (401=キー無効 / 403=権限・課金)',
      )
    } catch {
      setStatus('キー検証 通信失敗 — ネット権限/whitelistを確認')
    }
  })

  bridge = await waitForEvenAppBridge()
  await buildPage()
  setStatus('ready — グラスをタップで開始')

  bridge.onEvenHubEvent((event: any) => {
    // mic PCM stream from the glasses
    if (event.audioEvent?.audioPcm && listening && ws?.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: resamplePcm16ToB64(event.audioEvent.audioPcm as Uint8Array, GLASSES_RATE, OAI_RATE),
        }),
      )
      return
    }
    // touch on the event-capture container → toggle (debounced).
    // NOTE: verify the exact eventType enum for single-tap in your installed SDK
    // (node_modules/@evenrealities/even_hub_sdk) or via the simulator's console.
    if (event.textEvent) {
      const now = Date.now()
      if (now - lastTapAt > 400) {
        lastTapAt = now
        void toggleListening()
      }
    }
  })
}

void main()
