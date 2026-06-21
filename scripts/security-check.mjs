// Static security scan for the Even Hub app sources.
// Checks: hardcoded secrets, dangerous DOM/JS APIs, non-TLS endpoints,
// endpoints missing from app.json network whitelist, key-leaking logs.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCAN_DIRS = ['src']
const SCAN_FILES = ['index.html']

function* walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) yield* walk(p)
    else if (/\.(ts|js|mjs|html)$/.test(f)) yield p
  }
}

const files = [...SCAN_DIRS.flatMap((d) => [...walk(join(root, d))]), ...SCAN_FILES.map((f) => join(root, f))]

const findings = []
const add = (sev, file, line, msg) => findings.push({ sev, file: file.replace(root + '/', ''), line, msg })

// app.json whitelist for cross-check
const manifest = JSON.parse(readFileSync(join(root, 'app.json'), 'utf8'))
const whitelist = (manifest.permissions ?? []).find((p) => p.name === 'network')?.whitelist ?? []
const allowedHosts = new Set(whitelist.map((u) => new URL(u).host))

const RULES = [
  { re: /sk-[A-Za-z0-9_-]{20,}/, sev: 'CRITICAL', msg: 'Hardcoded API key — remove before commit/packaging' },
  { re: /\b(api[_-]?key|secret|token)\s*[:=]\s*["'][^"']{16,}["']/i, sev: 'CRITICAL', msg: 'Possible hardcoded credential' },
  { re: /\beval\s*\(/, sev: 'HIGH', msg: 'eval() — arbitrary code execution risk' },
  { re: /new\s+Function\s*\(/, sev: 'HIGH', msg: 'new Function() — arbitrary code execution risk' },
  { re: /\.innerHTML\s*=/, sev: 'HIGH', msg: 'innerHTML assignment — XSS risk; use textContent' },
  { re: /document\.write\s*\(/, sev: 'HIGH', msg: 'document.write — XSS risk' },
  { re: /\bdangerouslySetInnerHTML\b/, sev: 'HIGH', msg: 'dangerouslySetInnerHTML — XSS risk' },
  { re: /(?:http|ws):\/\/(?!localhost|127\.0\.0\.1)/, sev: 'HIGH', msg: 'Non-TLS endpoint (http/ws) — use https/wss' },
  { re: /console\.(log|error|warn|info)\([^)]*(apiKey\(\)|openai_key|\bkey\b)/, sev: 'MEDIUM', msg: 'Possible API-key logging' },
  { re: /localStorage\.setItem\(\s*['"](?!openai_key)/, sev: 'INFO', msg: 'localStorage write — confirm no sensitive data beyond the user-entered key' },
]

const urlRe = /(https|wss):\/\/([a-z0-9.-]+)/gi

for (const file of files) {
  const lines = readFileSync(file, 'utf8').split('\n')
  lines.forEach((text, i) => {
    if (/^\s*(\/\/|\*|<!--)/.test(text)) return // skip comments
    for (const r of RULES) if (r.re.test(text)) add(r.sev, file, i + 1, r.msg)
    // whitelist cross-check: every remote endpoint must be in app.json network whitelist
    for (const m of text.matchAll(urlRe)) {
      const host = m[2]
      if (host === 'localhost' || host === '127.0.0.1') continue
      if (!allowedHosts.has(host)) add('HIGH', file, i + 1, `Endpoint ${m[0]} not in app.json network whitelist`)
    }
  })
}

// Manifest-level checks
if (whitelist.some((u) => u.startsWith('http://'))) add('HIGH', 'app.json', 0, 'Plain-http entry in network whitelist')
if (!readFileSync(join(root, 'index.html'), 'utf8').includes('Content-Security-Policy'))
  add('MEDIUM', 'index.html', 0, 'No CSP meta tag — restrict connect-src to your APIs')

const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, INFO: 3 }
findings.sort((a, b) => order[a.sev] - order[b.sev])
for (const f of findings) console.log(`[${f.sev}] ${f.file}:${f.line} — ${f.msg}`)

const blocking = findings.filter((f) => f.sev === 'CRITICAL' || f.sev === 'HIGH')
if (blocking.length) {
  console.error(`\nFAIL: ${blocking.length} blocking finding(s)`)
  process.exit(1)
}
console.log(`OK: security scan passed (${findings.length} informational finding(s))`)
