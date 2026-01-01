// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker S (REF-AB-PLAN-S.md, item 8): a voice-over recorded from
// Chromium's fake microphone (--use-fake-device-for-media-stream, this
// scenario's window only; NOT the fake permission UI: the app's own handler
// is what grants it). Record → a WAV in the project's Voiceover folder → a
// clip on a new audio track where the playhead was; one undo takes it all
// back. Without the Record press, and for the camera, the microphone is
// refused. A note's "Put in the script" fills the script.
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
export const name = 'ref-s-voiceover'
export const timeoutMs = 180000

export async function run({ app: first, media, lib, relaunch }) {
  const { assert } = lib
  const app = await relaunch({ extraArgs: ['--use-fake-device-for-media-stream'] })
  const c = app.cdp
  // The first window's profile (and its work folder) went with it.
  const work = join(app.profile, 'work', 'ref-s-voiceover')
  mkdirSync(work, { recursive: true })
  try {
    await lib.reset(c)
    const [talk] = await lib.seedAssets(app, c, [media.talk])
    await lib.seedTimeline(c, [talk.id])

    // ---- refused: no Record press; the camera even after one ---------------------------
    const unasked = await c.run(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
        s.getTracks().forEach((t) => t.stop())
        return 'granted'
      } catch (e) {
        return e.name
      }
    })
    assert.equal(unasked, 'NotAllowedError', 'the microphone without a Record press')
    const camera = await c.run(async () => {
      await window.api.voiceover.arm()
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true })
        s.getTracks().forEach((t) => t.stop())
        return 'granted'
      } catch (e) {
        return e.name
      }
    })
    assert.notEqual(camera, 'granted', 'never the camera')

    // ---- the project saved, so the take goes beside it -------------------------------------
    const file = join(work, 'vo project.snipp')
    lib.answer(app, { kind: 'save', path: file })
    await c.click('timeline.scroll', { fx: 0.95, fy: 0.97 })
    await c.key('s', ['ctrl'])
    await c.waitFor('saved', async () => existsSync(file) && !(await c.st((s) => s.dirty)), 10000).catch(async (e) => {
      throw new Error(`${e.message}; file ${existsSync(file)}, dirty ${await c.st((s) => s.dirty)}, asked ${JSON.stringify(lib.dialogsAsked(app))}, pending ${JSON.stringify(app.answers.pending())}`)
    })

    // ---- the page ----------------------------------------------------------------------------
    await lib.dockPage(c, 'voiceover')
    await c.waitId('voiceover.script')
    await c.run(() => window.__store.getState().setTime(1))
    await c.click('voiceover.countdown.0')
    const tracksBefore = await c.st((s) => s.project.tracks.length)
    const assetsBefore = await c.st((s) => s.project.assets.length)
    const pastBefore = await c.st((s) => s.past.length)
    await c.click('voiceover.record')
    await c.waitId('voiceover.prompter', 8000)
    await c.waitFor('recording', async () => (await c.attr('voiceover.record', 'aria-pressed')) === 'true', 8000)
    await c.waitFor('the meter moves', async () => Number(await c.attr('voiceover.level', 'aria-valuenow')) > 5, 5000)
    assert.equal(await c.st((s) => s.playing), true, 'the timeline plays while recording')
    await c.sleep(2200)
    await c.click('voiceover.record')
    await c.waitFor('the take on a new track', async () => (await c.st((s) => s.project.tracks.length)) === tracksBefore + 1, 15000)
    const got = await c.st((s) => {
      const tr = s.project.tracks.at(-1)
      const clip = s.project.clips[tr.clipIds[0]]
      const asset = s.project.assets.find((a) => a.id === clip.assetId)
      return { kind: tr.kind, n: tr.clipIds.length, start: clip.start, duration: clip.duration, path: asset.path, assets: s.project.assets.length, past: s.past.length, playing: s.playing, time: s.currentTime }
    })
    assert.equal(got.kind, 'audio')
    assert.equal(got.n, 1)
    assert.ok(Math.abs(got.start - 1) < 0.25, `starts where the playhead was: ${got.start}`)
    assert.ok(got.duration > 1.5 && got.duration < 4, `about the take's length: ${got.duration}`)
    assert.equal(got.assets, assetsBefore + 1)
    assert.equal(got.past, pastBefore + 1, 'one undo step')
    assert.equal(got.playing, false)
    assert.ok(Math.abs(got.time - got.start) < 0.01, 'the playhead back at the take')
    assert.equal(dirname(got.path), join(dirname(file), 'Voiceover'), 'in the project\'s Voiceover folder')
    assert.ok(existsSync(got.path) && statSync(got.path).size > 44 + 48000 * 2, 'a WAV with sound in it')
    assert.equal(readdirSync(join(work, 'Voiceover')).filter((f) => f.endsWith('.wav')).length, 1)

    // The microphones have names now (the fake device's).
    await c.waitFor('microphones named', async () => (await c.run(() => document.querySelectorAll('[data-testid="voiceover.mic"] option').length)) > 1, 5000)

    // One undo: the clip, its track and the import go.
    await c.run(() => window.__store.getState().undo())
    assert.equal(await c.st((s) => s.project.tracks.length), tracksBefore)
    assert.equal(await c.st((s) => s.project.assets.length), assetsBefore)

    // A second take needs a second press (the first grant was used up).
    const again = await c.run(async () => {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true })
        s.getTracks().forEach((t) => t.stop())
        return 'granted'
      } catch (e) {
        return e.name
      }
    })
    assert.equal(again, 'NotAllowedError', 'one press, one microphone')

    // ---- a note into the script ------------------------------------------------------------------
    await c.run(() => {
      const s = window.__store.getState()
      s.startNoteDraft({ start: 2, end: 2 })
      window.__store.getState().patchNoteDraft({ text: 'Write the voice-over' })
      const id = window.__store.getState().saveNoteDraft()
      window.__store.getState().editNotes((p) => {
        const n = p.notes.find((x) => x.id === id)
        n.status = 'ready'
        n.reply = 'Welcome to the film. This is the script.'
      }, false)
      return id
    })
    const noteId = await c.st((s) => s.project.notes.at(-1).id)
    await c.run(() => { localStorage.removeItem('snipp-voiceover') })
    await c.click('dock.page.media')
    await c.click('inspector.tab.notes')
    await c.click(`notes.card.${noteId}.script`)
    await c.waitFor('the Voiceover page with the script', async () => (await c.attr('dock.page.voiceover', 'aria-selected')) === 'true' && (await c.run(() => document.querySelector('[data-testid="voiceover.script"]')?.value)) === 'Welcome to the film. This is the script.', 5000)
  } finally {
    // The next scenarios get a window without the fake device.
    await relaunch({})
    void first
  }
}
