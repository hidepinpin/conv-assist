// Validates app.json against Even Hub packaging rules (hub.evenrealities.com/docs/reference/packaging)
import { readFileSync, existsSync } from 'node:fs'

const errs = []
const warn = []
let m
try {
  m = JSON.parse(readFileSync(new URL('../app.json', import.meta.url), 'utf8'))
} catch (e) {
  console.error('FAIL: app.json is not valid JSON:', e.message)
  process.exit(1)
}

// package_id: reverse-domain, >=2 segments, each starts lowercase letter, [a-z0-9] only
const seg = /^[a-z][a-z0-9]*$/
const ids = (m.package_id ?? '').split('.')
if (ids.length < 2 || !ids.every((s) => seg.test(s)))
  errs.push(`package_id "${m.package_id}" must be reverse-domain, >=2 segments, lowercase letter start, [a-z0-9] only, no hyphens`)

if (m.edition !== '202601') errs.push(`edition must be "202601", got "${m.edition}"`)
if (typeof m.name !== 'string' || m.name.length === 0 || m.name.length > 20)
  errs.push(`name must be 1–20 chars, got ${m.name?.length ?? 0}`)
if (!/^\d+\.\d+\.\d+$/.test(m.version ?? '')) errs.push(`version must be x.y.z, got "${m.version}"`)
if (typeof m.min_app_version !== 'string') errs.push('min_app_version is required (string)')
if (typeof m.min_sdk_version !== 'string') errs.push('min_sdk_version is required (string)')
if (typeof m.entrypoint !== 'string') errs.push('entrypoint is required (string)')

// permissions: array of {name, desc(1-300)}, name from allowed set, whitelist only for network
const ALLOWED = ['network', 'location', 'g2-microphone', 'phone-microphone', 'album', 'camera']
if (!Array.isArray(m.permissions)) {
  errs.push('permissions must be an ARRAY of objects, not a key-value map')
} else {
  for (const p of m.permissions) {
    if (typeof p !== 'object' || !p) { errs.push('each permission must be an object'); continue }
    if (!ALLOWED.includes(p.name)) errs.push(`permission name "${p.name}" not in ${ALLOWED.join(', ')}`)
    if (typeof p.desc !== 'string' || p.desc.length < 1 || p.desc.length > 300)
      errs.push(`permission "${p.name}": desc must be 1–300 chars`)
    if (p.whitelist && p.name !== 'network') errs.push(`whitelist is only valid on "network" (found on "${p.name}")`)
    if (p.name === 'network' && p.whitelist) {
      for (const d of p.whitelist) {
        if (!/^(https|wss):\/\//.test(d)) warn.push(`network whitelist entry "${d}" is not https/wss`)
      }
    }
  }
}

// supported_languages
const LANGS = ['en', 'de', 'fr', 'es', 'it', 'zh', 'ja', 'ko']
if (!Array.isArray(m.supported_languages) || !m.supported_languages.every((l) => LANGS.includes(l)))
  errs.push(`supported_languages must be subset of ${LANGS.join(',')}`)

// entrypoint existence (post-build check; informational pre-build)
if (m.entrypoint && !existsSync(new URL('../dist/' + m.entrypoint, import.meta.url)))
  warn.push(`dist/${m.entrypoint} not found — run "npm run build" before "evenhub pack"`)

for (const w of warn) console.log('WARN:', w)
if (errs.length) {
  for (const e of errs) console.error('FAIL:', e)
  process.exit(1)
}
console.log('OK: app.json passes all Even Hub manifest rules')
