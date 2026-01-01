// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// 5a/5b patch, item 7 (audit C-5, haritalar\_faz5-denetim-citler.md): the
// guard's sound and box fence was bypassed four ways: the AudioContext's own
// constructor (AudioContext.prototype.constructor), a blank child frame
// reached through window[0], a script placed before <head> (which could also
// fake the guard's record), and an .svg of the folder opened as a document.
// Now the film cannot start sound at all (the browser's own policy: the
// editor's window plays sound only after the person used it, and the film's
// frames never get that; the guard's patches stay as a courtesy), its frames
// cannot open a box (the host frame is sandboxed without modals), and the
// guard runs before any script of the page, its record handed out as copies.
// The window is muted for the whole scenario (nothing is heard on this PC);
// Chromium still says whether it WOULD sound (checked first with the
// editor's own oscillator).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
export const name = 'code-clip-sound-boxes'
export const timeoutMs = 150_000

const page = (body, pre = '') => `<!doctype html>
<html>${pre}<head><meta charset="utf-8"></head><body style="margin:0;background:#000">
<canvas id="c" width="320" height="180"></canvas>
<script>
const say = (k, v) => console.error('Z ' + k + ': ' + v)
const g = document.getElementById('c').getContext('2d')
window.__config = { width: 320, height: 180, fps: 30, duration: 10 }
window.renderOut = (t) => { g.fillStyle = '#246'; g.fillRect(0, 0, 320, 180) }
function beep(AC) { try { const ac = new AC(); const o = ac.createOscillator(); o.connect(ac.destination); o.start(); ac.resume().catch(() => {}); const a = new Audio('tone.wav'); a.muted = false; a.play().catch(() => {}); return ac.state } catch (e) { return 'threw ' + e } }
window.renderOut(0)
window.READY = true
${body}
</script></body></html>`

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script><![CDATA[
const ac = new AudioContext(); const o = ac.createOscillator(); o.connect(ac.destination); o.start(); ac.resume().catch(() => {})
parent.postMessage({ svg: ac.state }, '*')
]]></script></svg>`

const MODES = {
  ctor: `say('sound', beep(AudioContext.prototype.constructor)); say('done', 'yes')`,
  blank: `const f = document.createElement('iframe'); document.body.appendChild(f); say('sound', beep(window[0].AudioContext)); say('done', 'yes')`,
  srcdoc: `const f = document.createElement('iframe'); f.srcdoc = '<script>const ac = new AudioContext(); const o = ac.createOscillator(); o.connect(ac.destination); o.start(); ac.resume().catch(() => {})<\\/script>'; document.body.appendChild(f); setTimeout(() => say('done', 'yes'), 500)`,
  pre: `say('sound', beep(AudioContext)); try { __snippGuard.errors.push('FAKE pushed by the page') } catch (e) {} say('done', 'yes')`,
  svg: `addEventListener('message', (e) => { if (e.data && e.data.svg) { say('sound', e.data.svg); say('done', 'yes') } }); const s = document.createElement('iframe'); s.src = 'x.svg'; document.body.appendChild(s)`
}
// Written before <head>: runs before the guard did (5498899), and fakes its record.
const PRE = `<script>try { Object.defineProperty(window, '__snippGuard', { value: { errors: ['FAKE record written by the page'], blocked: [], failed: [], dialogs: [], media: 0, audio: 0, opened: 0 } }) } catch (e) {} ;(function () { const AC = window.AudioContext; try { const ac = new AC(); const o = ac.createOscillator(); o.connect(ac.destination); o.start(); ac.resume().catch(() => {}) } catch (e) {} })()</script>`

async function bootFilm(c, folder) {
  return c.run(async (folder) => {
    const S = window.__store
    const [films, imp] = await window.__codeFilm()
    const info = await window.api.codeFilm.register(folder)
    const a0 = (await imp.codeFilmImport(info)).assets.find((a) => a.kind === 'code')
    const [a] = S.getState().addAssets([a0])
    films.codeFilms.ensure(a)
    const t0 = performance.now()
    for (;;) {
      const st = films.codeFilms.status(a.id)
      if (st && st.state !== 'booting') return { id: a.id, url: a.url, state: st.state }
      if (performance.now() - t0 > 30000) return { id: a.id, url: a.url, state: 'booting' }
      await new Promise((r) => setTimeout(r, 50))
    }
  }, folder)
}
const probe = (c, q) => c.run((q) => window.api.testFilmProbe(q), q)
const diag = (c, id) => c.run(async (id) => { const [films] = await window.__codeFilm(); // (Audit D8a: the page's own console.error lines come marked as facts; these pages report by them.)
    const r = await films.codeFilms.diag(id); return r && { ...r, errors: r.errors.map((e) => e.replace(/^console\.error: /, '')) } }, id)

export async function run({ c, media, lib, work }) {
  const { assert } = lib
  assert.equal((await probe(c, { kind: 'mute', on: true })).muted, true)
  try {
    const control = await c.run(async () => {
      const ac = new AudioContext()
      const o = ac.createOscillator()
      o.connect(ac.destination)
      o.start()
      await ac.resume()
      let seen = false
      for (let i = 0; i < 30 && !seen; i++) {
        await new Promise((r) => setTimeout(r, 100))
        seen = (await window.api.testFilmProbe({ kind: 'audible' })).audible
      }
      o.stop()
      await ac.close()
      return seen
    })
    assert.equal(control, true, "the probe hears the editor's own sound (else the checks below mean nothing)")
    await c.waitFor('the editor silent again', async () => !(await probe(c, { kind: 'audible' })).audible, 8000)

    const heard = {}
    for (const [mode, body] of Object.entries(MODES)) {
      const dir = join(work, 'snd-' + mode)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'index.html'), page(body, mode === 'pre' ? PRE : ''))
      writeFileSync(join(dir, 'x.svg'), SVG)
      writeFileSync(join(dir, 'tone.wav'), Buffer.alloc(0))
      const film = await bootFilm(c, dir)
      assert.equal(film.state, 'ready', `${mode}: ${JSON.stringify(film)}`)
      const rec = await c.waitFor(`${mode} done`, async () => { const r = await diag(c, film.id); return r && r.errors.includes('Z done: yes') ? r : null }, 20000, 250)
      let audible = false
      for (let i = 0; i < 12 && !audible; i++) {
        await c.sleep(250)
        audible = (await probe(c, { kind: 'audible' })).audible
      }
      heard[mode] = audible
      if (mode === 'pre') {
        assert.ok(!rec.errors.some((e) => e.startsWith('FAKE')), `the page wrote nothing into the guard's record: ${JSON.stringify(rec.errors)}`)
      }
      await c.run(async () => { const [films] = await window.__codeFilm(); films.codeFilms.release(new Set()); return true })
      await c.waitFor('silent', async () => !(await probe(c, { kind: 'audible' })).audible, 8000).catch(() => undefined)
    }
    console.log('     would sound:', JSON.stringify(heard))
    for (const [mode, a] of Object.entries(heard)) assert.equal(a, false, `${mode}: the film page would sound`)

    // Boxes: the host frame is sandboxed without modals (checked first: only
    // then is a real alert called), so a native alert in any of its frames
    // returns at once and opens nothing.
    const dir = join(work, 'boxes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'index.html'), page(`setTimeout(() => {
  const f = document.createElement('iframe'); document.body.appendChild(f)
  const t0 = performance.now(); window[0].alert('Z native alert'); const r1 = window[0].confirm('Z native confirm')
  say('boxes', Math.round(performance.now() - t0) + ' ms, confirm ' + r1); say('done', 'yes') }, 300)`))
    const film = await bootFilm(c, dir)
    const sb = await c.run((url) => { const f = [...document.querySelectorAll('iframe')].find((x) => x.src.startsWith(url)); return f ? { sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow') } : null }, film.url)
    assert.ok(sb && sb.sandbox !== null && !/allow-modals/.test(sb.sandbox) && !/allow-popups/.test(sb.sandbox), `the host frame is sandboxed without modals: ${JSON.stringify(sb)}`)
    const rec = await c.waitFor('boxes done', async () => { const r = await diag(c, film.id); return r && r.errors.includes('Z done: yes') ? r : null }, 20000, 250)
    const line = rec.errors.find((e) => e.startsWith('Z boxes: ')) ?? ''
    console.log('     ' + line)
    const ms = parseInt(line.slice('Z boxes: '.length), 10)
    assert.ok(ms < 500 && / confirm false$/.test(line), `the boxes returned at once, nothing opened: ${line}`)
    await c.run(async () => { const [films] = await window.__codeFilm(); films.codeFilms.release(new Set()); return true })
  } finally {
    await probe(c, { kind: 'mute', on: false })
  }
  void media
}
