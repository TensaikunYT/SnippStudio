// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5a (tarifler\FAZ5.md 5a, "Bitti ölçüsü"): a hostile code film page (F5,
// testdata\kod-klibi-serbest\F5-kotu) cannot read the user's media or another
// film's folder, cannot open a box, make a sound or leave its frame, and a page
// that loops forever leaves the editor answering and is marked failed in 15 s.
// The window is muted for the whole scenario (nothing is heard on this PC);
// Chromium still says whether it WOULD sound (checked first: the editor's own
// oscillator counts as audible while muted).
import { cpSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { TESTDATA } from '../media.mjs'
export const name = 'code-clip-hostile'
export const timeoutMs = 120_000

const F5 = join(TESTDATA, 'kod-klibi-serbest', 'F5-kotu')

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
      if (st && st.state !== 'booting') return { id: a.id, url: a.url, state: st.state, error: st.error ?? null }
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
  // Nothing heard on this PC; "would it sound" still answered.
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
    assert.equal(control, true, "the probe hears the editor's own sound (else the check below means nothing)")
    await c.waitFor('the editor silent again', async () => !(await probe(c, { kind: 'audible' })).audible, 8000)

    const f5 = join(work, 'f5')
    const other = join(work, 'other')
    cpSync(F5, f5, { recursive: true })
    cpSync(media.film, other, { recursive: true })
    const reg = await c.run(async (talk, other) => ({ media: (await window.api.testRegisterMedia(talk)).url, other: (await window.api.codeFilm.register(other)).url }), media.talk, other)
    writeFileSync(join(f5, 'targets.json'), JSON.stringify({ media: reg.media, otherFilm: reg.other, hang: 'none' }))
    const editorUrl = await c.ev('location.href')
    const since = Date.now()
    const film = await bootFilm(c, f5)
    assert.equal(film.state, 'ready', JSON.stringify(film))
    // Its page runs in a process of its own (U1).
    const tree = await probe(c, { kind: 'frames' })
    const own = film.url.replace(/\/$/, '')
    const mine = tree.frames.filter((f) => f.url.startsWith(own))
    assert.ok(mine.length >= 2, JSON.stringify(tree))
    for (const f of mine) assert.notEqual(f.pid, tree.editorPid, "the film page is not in the editor's process")

    const rec = await c.waitFor('the hostile page done', async () => { const r = await diag(c, film.id); return r && r.errors.includes('F5 done: yes') ? r : null }, 20000, 250)
    const said = Object.fromEntries(rec.errors.filter((e) => e.startsWith('F5 ')).map((e) => { const [k, ...v] = e.slice(3).split(': '); return [k, v.join(': ')] }))
    // 1. The user's media: not read, not shown.
    assert.equal(said['media fetch'], 'refused')
    assert.equal(said['media img'], 'refused')
    assert.equal(said['media video'], 'refused')
    // 2. Another film's folder: not read, its frame shows nothing of it.
    assert.equal(said['film fetch'], 'refused')
    assert.equal(said['film frame'], 'not readable')
    const otherId = /^snippfilm:\/\/([a-f0-9]{16})\//.exec(reg.other)[1]
    const seen = await probe(c, { kind: 'requests', since })
    assert.deepEqual(seen.filter((r) => r.scheme === 'media'), [], 'no media:// request came from the film')
    assert.deepEqual(seen.filter((r) => r.url.includes(otherId)), [], 'no request reached the other film')
    // The page's policy refusals are written down.
    assert.ok(rec.blocked.length >= 4, JSON.stringify(rec.blocked))
    // 3. Boxes: none opened, the page went on.
    assert.equal(said.alert, 'returned')
    assert.equal(said.confirm, 'false')
    assert.deepEqual(rec.dialogs, ['alert: F5 alert', 'confirm: F5 confirm'])
    // 4. Sound: <audio autoplay>, new Audio().play(), an oscillator: nothing would sound.
    assert.equal(said['audio element'], 'muted=true')
    assert.ok(rec.media >= 1 && rec.audio === 1, JSON.stringify(rec))
    for (let i = 0; i < 12; i++) {
      assert.equal((await probe(c, { kind: 'audible' })).audible, false, 'the film page would sound')
      await c.sleep(250)
    }
    // 5. Out of its frame: no window, the editor's page where it was, the film frames on their own film.
    assert.equal(said['window.open'], 'null')
    assert.equal(await c.ev('location.href'), editorUrl)
    const after = await probe(c, { kind: 'frames' })
    for (const f of after.frames) assert.ok(f.url === 'about:blank' || f.url.startsWith('snippfilm://'), f.url)
    assert.ok(after.frames.some((f) => f.url.startsWith(own + '/__snipp/host.html')), "the host frame is still its own film's")
    assert.ok(!after.frames.some((f) => f.url.startsWith(`snippfilm://${otherId}/__snipp`)), "no frame went to the other film's host page")

    // 6. A page that never comes back from renderOut.
    const f5h = join(work, 'f5h')
    cpSync(F5, f5h, { recursive: true })
    writeFileSync(join(f5h, 'targets.json'), JSON.stringify({ hang: 'render' }))
    const hung = await bootFilm(c, f5h)
    assert.equal(hung.state, 'ready')
    await c.run(async (id) => {
      const [films] = await window.__codeFilm()
      const a = window.__store.getState().project.assets.find((x) => x.id === id)
      films.codeFilms.exactFrame(a, 6).catch(() => undefined)
      return true
    }, hung.id)
    const t0 = Date.now()
    let worst = 0
    let failedAt = null
    let st = null
    while (Date.now() - t0 < 16000 && failedAt === null) {
      const a = Date.now()
      st = await c.run(async (id) => { const [films] = await window.__codeFilm(); return films.codeFilms.status(id) }, hung.id)
      worst = Math.max(worst, Date.now() - a)
      if (st?.state === 'error') failedAt = Date.now() - t0
      await c.sleep(200)
    }
    assert.ok(worst < 2000, `the editor answered within 2 s while the film looped (worst ${worst} ms)`)
    assert.ok(failedAt !== null && failedAt <= 15000, `the clip failed within 15 s (${failedAt} ms, ${JSON.stringify(st)})`)
    assert.equal(st.unresponsive, true)
    const gone = await probe(c, { kind: 'frames' })
    assert.ok(!gone.frames.some((f) => f.url.startsWith(hung.url.replace(/\/$/, ''))), 'the looping page was let go')
    console.log(`     hostile: blocked ${rec.blocked.length}, editor worst ${worst} ms, failed after ${failedAt} ms`)
  } finally {
    await probe(c, { kind: 'mute', on: false })
  }
}
