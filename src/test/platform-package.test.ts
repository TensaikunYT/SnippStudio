// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10b.5 (FAZ10-PLAN.md; report section 2): the package configuration
// for macOS and Linux, read here on Windows (nothing is built for them on
// this PC). Windows' part is checked unchanged.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const ROOT = join(__dirname, '..', '..')
const CONFIG = join(ROOT, 'electron-builder.config.cjs')

type Target = { target: string; arch: string[] }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cfg = any

/** The configuration as electron-builder reads it, under an environment. */
function config(env: Record<string, string> = {}): Cfg {
  const keys = ['CSC_LINK', 'CSC_NAME', 'APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER', 'APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
  const before = Object.fromEntries(keys.map((k) => [k, process.env[k]]))
  try {
    for (const k of keys) delete process.env[k]
    Object.assign(process.env, env)
    delete require.cache[require.resolve(CONFIG)]
    return require(CONFIG)
  } finally {
    for (const k of keys) {
      if (before[k] === undefined) delete process.env[k]
      else process.env[k] = before[k]
    }
    delete require.cache[require.resolve(CONFIG)]
  }
}

function evalModule(file: string, expr: string): unknown {
  const url = 'file:///' + join(ROOT, file).replace(/\\/g, '/')
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const m = await import(${JSON.stringify(url)}); console.log(JSON.stringify(await (${expr})))`], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout.trim().split('\n').pop()!)
}

const pngSize = (b: Buffer): { w: number; h: number } => {
  assert.equal(b.readUInt32BE(0), 0x89504e47, 'a PNG')
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }
}

test('Windows: the same target, icon, installer and association as before phase 10', () => {
  const c = config()
  assert.deepEqual(c.win, { icon: 'build/icon.ico', target: ['nsis'] })
  assert.equal(c.nsis.oneClick, false)
  assert.equal(c.fileAssociations.length, 1)
  assert.equal(c.fileAssociations[0].ext, 'snipp')
  assert.equal(c.fileAssociations[0].icon, 'build/snipp-file.ico')
  assert.equal(c.electronFuses.enableEmbeddedAsarIntegrityValidation, true)
})

test('macOS: dmg + zip for arm64 and x64, hardened runtime, the entitlements, the icon', () => {
  const c = config()
  const targets: Target[] = c.mac.target
  for (const t of ['dmg', 'zip']) {
    const found = targets.find((x) => x.target === t)
    assert.ok(found, t)
    assert.deepEqual([...found!.arch].sort(), ['arm64', 'x64'], `${t}: both chips`)
  }
  assert.notEqual(c.mac.hardenedRuntime, false)
  const ent = readFileSync(join(ROOT, c.mac.entitlements), 'utf8')
  for (const k of ['com.apple.security.cs.allow-jit', 'com.apple.security.cs.disable-library-validation']) assert.ok(ent.includes(`<key>${k}</key>`), k)
  for (const k of ['com.apple.security.device.camera', 'com.apple.security.device.audio-input', 'com.apple.security.network.server']) assert.equal(ent.includes(k), false, `${k}: not asked for`)
  assert.equal(c.mac.entitlementsInherit, c.mac.entitlements)
  assert.equal(c.mac.icon, 'build/icon.icns')
})

test('macOS signing: a certificate when given, else ad-hoc; notarisation only with a full set of credentials', () => {
  assert.equal(config().mac.identity, '-', 'no certificate: ad-hoc')
  assert.equal(config({ CSC_LINK: 'x' }).mac.identity, undefined, 'a certificate: found by electron-builder')
  assert.equal(config().mac.notarize, false, 'no credentials: skipped')
  assert.equal(config({ APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i' }).mac.notarize, false, 'half a set: skipped')
  assert.equal(config({ APPLE_API_KEY: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' }).mac.notarize, true)
  assert.equal(config({ APPLE_ID: 'a', APPLE_APP_SPECIFIC_PASSWORD: 'p', APPLE_TEAM_ID: 't' }).mac.notarize, true)
  // No credential in the file itself.
  const text = readFileSync(CONFIG, 'utf8')
  assert.equal(/(password|secret|apiKey)\s*:\s*['"]/i.test(text), false)
})

test('Linux: AppImage + deb, the desktop entry, the MIME type, the lower-case program', () => {
  const c = config()
  const targets: Target[] = c.linux.target
  assert.deepEqual(targets.map((t) => t.target).sort(), ['AppImage', 'deb'])
  assert.equal(c.linux.executableName, 'snippstudio')
  assert.equal(c.linux.category, 'AudioVideo')
  assert.equal(c.linux.desktop.entry.StartupWMClass, c.productName)
  assert.match(c.linux.maintainer, /<[^@\s]+@[^>\s]+>$/, 'a deb needs a maintainer address')
  assert.equal(c.fileAssociations[0].mimeType, 'application/x-snippstudio-project')
  assert.equal(c.linux.icon, 'build/icon-1024.png')
})

test('files: no native module at all (no node-pty since TERMINAL-YOK-PLAN.md, no onnxruntime-node, no sharp)', () => {
  const files: string[] = config().files
  assert.ok(files.includes('!node_modules/**'))
  assert.deepEqual(files.filter((f) => f.startsWith('node_modules/')), [])
  assert.equal(files.some((f) => /onnxruntime|sharp|@img/.test(f) && !f.startsWith('!')), false)
  assert.equal(config().asarUnpack, undefined)
})

test('icons: the macOS .icns holds 512 and 1024 px, the Linux PNG is at least 512 px', () => {
  const icns = (f: string): { type: string; w: number }[] => {
    const b = readFileSync(join(ROOT, f))
    assert.equal(b.toString('ascii', 0, 4), 'icns')
    assert.equal(b.readUInt32BE(4), b.length)
    const out: { type: string; w: number }[] = []
    for (let at = 8; at < b.length; ) {
      const len = b.readUInt32BE(at + 4)
      out.push({ type: b.toString('ascii', at, at + 4), w: pngSize(b.subarray(at + 8, at + len)).w })
      at += len
    }
    return out
  }
  for (const f of ['build/icon.icns', 'build/snipp-file.icns']) {
    const got = icns(f)
    assert.deepEqual(got.map((x) => `${x.type}:${x.w}`), ['ic07:128', 'ic08:256', 'ic09:512', 'ic10:1024'], f)
  }
  assert.ok(pngSize(readFileSync(join(ROOT, 'build', 'icon-1024.png'))).w >= 512)
  // The file association's macOS icon is found by the .ico's name.
  assert.ok(existsSync(join(ROOT, config().fileAssociations[0].icon.replace(/\.ico$/, '.icns'))))
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'package', 'icons-posix.mjs'), '--check'], { cwd: ROOT, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
})

test('the scripts: dist:mac and dist:linux; the package check knows each platform\'s layout', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
  assert.match(pkg.scripts['dist:mac'], /--platform=mac/)
  assert.match(pkg.scripts['dist:linux'], /--platform=linux/)
  assert.match(pkg.scripts.dist, /dist\.mjs$/, 'npm run dist as before')
  const l = evalModule('scripts/package/check.mjs', `['C:/r/win-unpacked', '/r/mac-arm64', '/r/mac', '/r/linux-unpacked/'].map((d) => { const x = m.packageLayout(d); return [m.layoutPlatform(d), x.res.replace(/\\\\/g, '/'), x.exe.replace(/\\\\/g, '/')] })`) as string[][]
  assert.deepEqual(l[0], ['win32', 'C:/r/win-unpacked/resources', 'C:/r/win-unpacked/SnippStudio.exe'])
  assert.deepEqual(l[1], ['darwin', '/r/mac-arm64/SnippStudio.app/Contents/Resources', '/r/mac-arm64/SnippStudio.app/Contents/MacOS/SnippStudio'])
  assert.equal(l[2][0], 'darwin')
  assert.deepEqual(l[3], ['linux', '/r/linux-unpacked/resources', '/r/linux-unpacked/snippstudio'])
})
