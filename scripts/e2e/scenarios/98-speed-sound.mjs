// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Core polish, part B (CILA-B-PLAN.md): the speed row of the Inspector, and
// one rule for a retimed clip's sound in the preview and in the export.
//   - the row: a preset is one click and one undo step, a typed speed is
//     taken as typed (0.1 – 100), the hints say what the timeline cannot
//     (no sound beyond 0.25x – 8x, the preview stepping above 16x), "Keep
//     pitch" is there when the speed is not 1 and is one undo step;
//   - a 330 Hz tone at 2x: with "Keep pitch" it stays 330 Hz in the preview
//     AND in the export's mix, without it both give 660 Hz; at 10x and at
//     0.2x both are silent;
//   - the export's mix of a retimed voice in 2 s windows is the mix in one
//     piece (the stretch does not depend on the window).
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { E2E_MEDIA, ffmpegBin } from '../media.mjs'
export const name = 'speed-sound'

/** A 440 Hz tone recorded at 44.1 kHz (the export mixes at 48 kHz: this one
 *  goes through the resampler before it is stretched). */
function tone441() {
  const f = join(E2E_MEDIA, 'tone-440-44k.wav')
  if (existsSync(f)) return f
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=6', '-af', 'volume=0.5', '-c:a', 'pcm_s16le', f], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
  return f
}

/** In the page (window.__pitchOf): the frequency of a tone from its rising
 *  zero crossings, and its level. */
const PITCH = `window.__pitchOf = (x, rate) => {
  let cross = 0, first = -1, last = -1, sum = 0
  for (let i = 1; i < x.length; i++) { sum += x[i] * x[i]; if (x[i - 1] <= 0 && x[i] > 0) { cross++; if (first < 0) first = i; last = i } }
  return { hz: cross > 1 ? ((cross - 1) * rate) / (last - first) : 0, rms: Math.sqrt(sum / Math.max(1, x.length)) }
}; true`

export async function run({ c, app, media, lib }) {
  const { assert } = lib
  await c.ev(PITCH)
  // other.mp4: colour bars with a 330 Hz tone, 6 s.
  const [tone, talk] = await lib.seedAssets(app, c, [media.other, media.talk])
  await lib.seedTimeline(c, [tone.id])
  await c.run(() => {
    const state = JSON.parse(localStorage.getItem('snipp-sections') ?? '{}')
    for (const id of ['Clip', 'Audio']) state[id] = true
    localStorage.setItem('snipp-sections', JSON.stringify(state))
  })
  await lib.openCards(c, ['Clip', 'Audio', 'Speed'])
  const [clip] = await lib.clipList(c)
  await c.click(`timeline.clip.${clip.id}`, { fx: 0.5 })
  await c.click('inspector.tab.subs')
  await c.click('inspector.tab.clip')
  await c.waitId('inspector.clip.speed')
  const now = () => c.st((s, id) => ({ speed: s.project.clips[id].speed ?? 1, duration: s.project.clips[id].duration, keep: s.project.clips[id].keepPitch, depth: s.past.length }), clip.id)
  const pick = () => c.run((id) => { const st = window.__store; if (!st.getState().selectedClipIds.includes(id)) st.setState({ selectedClipIds: [id] }) }, clip.id)
  const show = (id) => c.run((sel) => document.querySelector(sel)?.scrollIntoView({ block: 'center' }), `[data-testid="${id}"]`)
  // A speed typed in the row's number (DENEME-2, item 11: the preset buttons
  // 0.25× … 100× are gone; the slider and the number stay).
  const typeSpeed = async (v) => {
    await show('inspector.clip.speed.value')
    await c.fill('inspector.clip.speed.value', String(v))
    await c.key('Enter')
    await c.waitFor(`typed ${v}x`, async () => (await now()).speed === v)
    // (Out of the field, as a click on a button was: Ctrl+Z is the editor's again.)
    await c.run(() => { document.activeElement?.blur(); return true })
  }

  // ---- the row ----------------------------------------------------------------------
  assert.equal(await c.value('inspector.clip.speed.value'), '1 ×', 'the number shows the speed in ×')
  assert.equal(await c.has('inspector.audio.keep-pitch'), false, 'no "Keep pitch" at speed 1')
  const d0 = (await now()).depth
  await typeSpeed(2)
  let st = await now()
  assert.equal(st.speed, 2)
  assert.ok(lib.near(st.duration, 3, 1e-6), `6 s at 2x is 3 s (${st.duration})`)
  assert.equal(st.depth, d0 + 1, 'a typed speed is one undo step')
  assert.equal(await c.has('inspector.clip.speed.preset.2'), false, 'no preset buttons (DENEME-2)')
  // A second speed straight after it: its own step.
  await typeSpeed(4)
  st = await now()
  assert.equal(st.speed, 4)
  assert.equal(st.depth, d0 + 2, 'the next speed is another step')
  await c.key('z', ['ctrl'])
  await c.waitFor('undo gives 2x back', async () => (await now()).speed === 2)
  await pick()
  // "Keep pitch": there now, on, one undo step to turn off.
  await c.waitId('inspector.audio.keep-pitch')
  await show('inspector.audio.keep-pitch')
  assert.equal((await now()).keep, undefined, 'on by default: nothing stored')
  const d1 = (await now()).depth
  await c.click('inspector.audio.keep-pitch')
  await c.waitFor('"Keep pitch" off', async () => (await now()).keep === false)
  assert.equal((await now()).depth, d1 + 1, 'the switch is one undo step')
  await c.click('inspector.audio.keep-pitch')
  await c.waitFor('"Keep pitch" on again', async () => (await now()).keep === undefined)
  // 50x: the hints.
  await typeSpeed(50)
  st = await now()
  assert.equal(st.speed, 50)
  assert.ok(lib.near(st.duration, 0.12, 1e-6), `6 s at 50x is 0.12 s (${st.duration})`)
  assert.ok(await c.has('inspector.clip.speed.silent'), 'the row says there is no sound at 50x')
  assert.ok(await c.has('inspector.clip.speed.stepped'), 'the row says the preview steps above 16x')
  assert.ok(await c.has('inspector.audio.silent-speed'), 'the Audio section says so too')
  assert.equal(await c.has('inspector.audio.keep-pitch'), false, 'no "Keep pitch" where there is no sound')
  // 100x: 0.06 s, two frames; a typed 0.1: 60 s; out of range is held to it.
  await typeSpeed(100)
  assert.ok(lib.near((await now()).duration, 0.06, 1e-6))
  await show('inspector.clip.speed.value')
  await c.fill('inspector.clip.speed.value', '0.1')
  await c.key('Enter')
  await c.waitFor('typed 0.1x', async () => (await now()).speed === 0.1)
  assert.ok(lib.near((await now()).duration, 60, 1e-6), 'a typed 0.1: 60 s')
  await c.fill('inspector.clip.speed.value', '37.5')
  await c.key('Enter')
  await c.waitFor('typed 37.5x (not a value of the track: taken as typed)', async () => (await now()).speed === 37.5)
  await c.fill('inspector.clip.speed.value', '5000')
  await c.key('Enter')
  await c.waitFor('typed 5000: held at 100x', async () => (await now()).speed === 100)

  // ---- one rule for the sound: preview and export -----------------------------------
  const heard = []
  for (const [speed, keep] of [[2, true], [2, false], [0.5, true], [0.5, false], [6, true], [10, true], [0.2, true]]) {
    heard.push(await c.run(async (id, speed, keep) => {
      const S = window.__store
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      S.getState().setPlaying(false)
      S.getState().setClipSpeed(id, speed)
      S.getState().setClipKeepPitch(id, keep)
      S.getState().setTime(0)
      await wait(350)
      // The export's mix: the middle half of the clip.
      const [, , A] = await window.__subs()
      const p = S.getState().project
      const buf = await A.mixProjectAudio(p, 48000, 2)
      const len = p.clips[id].duration
      const x = buf.getChannelData(0).subarray(Math.round(len * 0.25 * 48000), Math.round(len * 0.75 * 48000))
      const exported = window.__pitchOf(x, 48000)
      let step = 0
      for (let i = 1; i < x.length; i++) step = Math.max(step, Math.abs(x[i] - x[i - 1]))
      // The preview: what the meter's analyser hears a little into playback.
      const eng = window.__engine
      const an = eng.getAnalyser()
      an.fftSize = 8192
      S.getState().setPlaying(true)
      let t0 = performance.now()
      while (S.getState().currentTime < 0.05 && performance.now() - t0 < 3000) await wait(20)
      await wait(Math.min(450, Math.max(120, (len - 0.1) * 1000 * 0.6)))
      const t = new Float32Array(an.fftSize)
      an.getFloatTimeDomainData(t)
      const preview = window.__pitchOf(t, an.context.sampleRate)
      const el = [...eng.videos.values()][0]
      const out = { speed, keep, exported, step, preview, pitch: el?.preservesPitch, muted: el?.muted }
      S.getState().setPlaying(false)
      return out
    }, clip.id, speed, keep))
  }
  for (const h of heard) {
    const what = `${h.speed}x, keep pitch ${h.keep ? 'on' : 'off'}`
    if (h.speed > 8 || h.speed < 0.25) {
      assert.ok(h.exported.rms < 1e-5, `${what}: the export is silent (${h.exported.rms})`)
      assert.ok(h.preview.rms < 1e-4, `${what}: the preview is silent (${h.preview.rms})`)
      assert.equal(h.muted, true)
      continue
    }
    const want = h.keep ? 330 : 330 * h.speed
    assert.ok(Math.abs(h.exported.hz - want) <= want * 0.01, `${what}: the export's tone is ${h.exported.hz.toFixed(1)} Hz, expected ${want}`)
    assert.ok(Math.abs(h.preview.hz - want) <= want * 0.03, `${what}: the preview's tone is ${h.preview.hz.toFixed(1)} Hz, expected ${want}`)
    assert.ok(h.exported.rms > 0.07 && h.exported.rms < 0.11, `${what}: the export keeps the level (${h.exported.rms})`)
    assert.ok(h.preview.rms > 0.05, `${what}: the preview is heard (${h.preview.rms})`)
    assert.equal(h.pitch, h.keep, `${what}: the element's preservesPitch`)
    // No click in the export: no step larger than the tone's own (plus a margin).
    const own = 2 * Math.PI * want / 48000 * 0.126 * 1.6
    assert.ok(h.step < own + 0.004, `${what}: no click in the export (largest step ${h.step.toFixed(4)}, the tone's own ${own.toFixed(4)})`)
  }
  console.log('    ' + heard.map((h) => `${h.speed}x${h.keep ? '' : ' (pitch follows)'}: export ${h.exported.hz.toFixed(0)} Hz, preview ${h.preview.hz.toFixed(0)} Hz`).join(' · '))

  // ---- a 44.1 kHz recording: resampled, then stretched ---------------------------------
  const [wav] = await lib.seedAssets(app, c, [tone441()])
  const odd = await c.run(async (wavId) => {
    const S = window.__store
    const [, , A] = await window.__subs()
    const base = structuredClone(S.getState().project)
    const a1 = base.tracks.find((t) => t.kind === 'audio')
    for (const id of Object.keys(base.clips)) delete base.clips[id]
    for (const t of base.tracks) t.clipIds = []
    const out = []
    for (const [speed, keep] of [[2, true], [0.5, true], [1.3, true], [2, false]]) {
      const p = structuredClone(base)
      p.clips.w = { id: 'w', assetId: wavId, trackId: a1.id, start: 0.25, inPoint: 0.1, duration: 5.6 / speed, speed, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, ...(keep ? {} : { keepPitch: false }) }
      p.tracks.find((t) => t.id === a1.id).clipIds = ['w']
      const buf = await A.mixProjectAudio(p, 48000, 2)
      const len = 5.6 / speed
      const x = buf.getChannelData(0).subarray(Math.round((0.25 + len * 0.2) * 48000), Math.round((0.25 + len * 0.8) * 48000))
      let step = 0
      for (let i = 1; i < x.length; i++) step = Math.max(step, Math.abs(x[i] - x[i - 1]))
      out.push({ speed, keep, ...window.__pitchOf(x, 48000), step })
    }
    return out
  }, wav.id)
  for (const h of odd) {
    const want = h.keep ? 440 : 440 * h.speed
    assert.ok(Math.abs(h.hz - want) <= want * 0.01, `44.1 kHz tone at ${h.speed}x${h.keep ? '' : ' (pitch follows)'}: ${h.hz.toFixed(1)} Hz, expected ${want}`)
    // (ffmpeg's sine is an eighth of full scale, halved: amplitude 0.0625, level 0.0442.)
    assert.ok(h.rms > 0.038 && h.rms < 0.05, `its level is kept (${h.rms})`)
    // (Such a tone steps 0.0036 a sample at most at 440 Hz; a click would be far above.)
    assert.ok(h.step < (2 * Math.PI * want / 48000) * 0.0625 * 1.5 + 0.002, `no click (largest step ${h.step.toFixed(4)})`)
  }
  console.log('    44.1 kHz tone: ' + odd.map((h) => `${h.speed}x${h.keep ? '' : ' (pitch follows)'} ${h.hz.toFixed(0)} Hz`).join(' · '))

  // ---- the stretch does not depend on the export's windows ---------------------------
  const win = await c.run(async (talkId) => {
    const S = window.__store
    const A = await window.__audioStream()
    const p = structuredClone(S.getState().project)
    const a1 = p.tracks.find((t) => t.kind === 'audio')
    for (const id of Object.keys(p.clips)) delete p.clips[id]
    for (const t of p.tracks) t.clipIds = []
    const T = { x: 0, y: 0, scale: 1, rotation: 0 }
    p.clips.t1 = { id: 't1', assetId: talkId, trackId: a1.id, start: 0.3137, inPoint: 0.2, duration: 6, speed: 1.5, volume: 1, transform: T }
    p.clips.t2 = { id: 't2', assetId: talkId, trackId: a1.id, start: 7, inPoint: 1, duration: 9, speed: 0.7, volume: 1, transform: T }
    a1.clipIds = ['t1', 't2']
    const all = async (windowSec) => {
      const m = new A.ExportMix(p, [0, 16], { windowSec })
      await m.prepare()
      const L = new Float32Array(m.frames)
      let at = 0
      for (let b = await m.next(); b; b = await m.next()) { L.set(b.getChannelData(0).subarray(0, m.frames - at), at); at += b.length }
      return L
    }
    const short = await all(2)
    const whole = await all(1000)
    let worst = 0, sum = 0
    for (let i = 0; i < whole.length; i++) { worst = Math.max(worst, Math.abs(short[i] - whole[i])); sum += whole[i] * whole[i] }
    return { worst, rms: Math.sqrt(sum / whole.length) }
  }, talk.id)
  assert.ok(win.rms > 0.02, `the retimed voice is heard (${win.rms})`)
  assert.ok(win.worst < 1e-4, `in 2 s windows the mix is the mix in one piece (largest difference ${win.worst})`)
  console.log(`    windows: largest difference ${win.worst} (level ${win.rms.toFixed(3)})`)
}
