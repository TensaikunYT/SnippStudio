// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The user's list, item 1 (SnippStudio KLISTE-PLAN.md): "a WAV plays behind
// the picture, an MP3 does not". Measured, not listened to: the same clicks
// (a 5 ms burst on every whole second of the file) as WAV 44.1 / 48 kHz,
// 16-bit, 24-bit and float, MP3 44.1 / 48 kHz, AAC (.m4a) and the sound of
// an MP4. Each one alone on the timeline (in point 0.3 s, at 0.5 s: its
// clicks sit at 1.2, 2.2, 3.2 … on the timeline). The preview's own sound
// path is tapped after its meter (the point every element's sound passes on
// its way out); each click's moment is taken to the audio device's clock
// (getOutputTimestamp) and set against where the playhead was then.
// Four ways in: Play from the top, Play after the playhead was put down
// somewhere else (a scrub), a jump while it rolls, and a jump with a long
// frame right after it (the page kept busy 110 ms, as a heavy project's
// redraw after a click does). The last one is what left the sound 0.05-0.12 s
// behind the playhead until the next stop (SnippStudio WAV-PLAN.md): the
// clock counted the long frame, the element had not been told to play yet.
// Offset > 0: the sound comes after the playhead.
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ffmpegBin } from '../media.mjs'
export const optIn = true
export const name = 'kliste-wav-sync'
export const timeoutMs = 600_000

const CLICKS = "if(lt(mod(t\\,1)\\,0.005)\\,0.8*sin(2*PI*2000*t)\\,0)"

function make(file, args) {
  const r = spawnSync(ffmpegBin('ffmpeg'), ['-v', 'error', '-y', ...args, file], { encoding: 'utf8', windowsHide: true })
  if (r.status !== 0) throw new Error('ffmpeg: ' + r.stderr)
  return file
}

/** In the page: a tap after the meter that writes down, in the audio
 *  device's time (ms, performance clock), when each click comes out. */
const TAP = `window.__clickTap = () => {
  const an = window.__engine.getAnalyser()
  const ctx = an.context
  if (!window.__tap) {
    const sp = ctx.createScriptProcessor(256, 2, 2)
    const tap = { sp, hits: [], quiet: 0, on: false }
    sp.onaudioprocess = (e) => {
      const x = e.inputBuffer.getChannelData(0)
      const sr = ctx.sampleRate
      // The input of this call was rendered one buffer before its output time.
      const t0 = e.playbackTime - x.length / sr
      for (let i = 0; i < x.length; i++) {
        const loud = Math.abs(x[i]) > 0.05
        if (loud && tap.quiet > sr * 0.05 && tap.on) {
          const ct = t0 + i / sr
          const ts = ctx.getOutputTimestamp()
          tap.hits.push(ts.performanceTime + (ct - ts.contextTime) * 1000)
        }
        tap.quiet = loud ? 0 : tap.quiet + 1
      }
    }
    an.connect(sp)
    sp.connect(ctx.destination)
    // Not out of the speakers: the way out is turned down 66 dB (the tap
    // listens before that). The window itself is NOT muted any more: a muted
    // window's sound path stalls 10-45 ms about every 30 s, and each stall
    // leaves the playing element that far behind the playhead (measured:
    // WAV and MP3 alike, 30-70 ms in 90 s; none in an unmuted window).
    const quiet = ctx.createGain()
    quiet.gain.value = 0.0005
    an.disconnect(ctx.destination)
    an.connect(quiet)
    quiet.connect(ctx.destination)
    tap.quiet66 = quiet
    window.__tap = tap
  }
  return true
}; true`

export async function run({ c, app, lib, work, out }) {
  const { assert } = lib
  const files = {
    'wav 44.1k s16': make(join(work, 'w44.wav'), ['-f', 'lavfi', '-i', `aevalsrc=${CLICKS}:s=44100:d=7`, '-c:a', 'pcm_s16le']),
    'wav 48k s16': make(join(work, 'w48.wav'), ['-f', 'lavfi', '-i', `aevalsrc=${CLICKS}:s=48000:d=7`, '-c:a', 'pcm_s16le']),
    'wav 48k s24': make(join(work, 'w48-24.wav'), ['-f', 'lavfi', '-i', `aevalsrc=${CLICKS}:s=48000:d=7`, '-c:a', 'pcm_s24le']),
    'wav 44.1k f32': make(join(work, 'w44-f.wav'), ['-f', 'lavfi', '-i', `aevalsrc=${CLICKS}:s=44100:d=7`, '-c:a', 'pcm_f32le']),
    'mp3 44.1k': make(join(work, 'm44.mp3'), ['-f', 'lavfi', '-i', `aevalsrc=${CLICKS}:s=44100:d=7`, '-c:a', 'libmp3lame', '-b:a', '192k']),
    'mp3 48k': make(join(work, 'm48.mp3'), ['-f', 'lavfi', '-i', `aevalsrc=${CLICKS}:s=48000:d=7`, '-c:a', 'libmp3lame', '-b:a', '192k']),
    'm4a 48k': make(join(work, 'a48.m4a'), ['-f', 'lavfi', '-i', `aevalsrc=${CLICKS}:s=48000:d=7`, '-c:a', 'aac', '-b:a', '192k']),
    'mp4 video': make(join(work, 'v.mp4'), ['-f', 'lavfi', '-i', 'color=c=gray:s=320x180:r=30:d=7', '-f', 'lavfi', '-i', `aevalsrc=${CLICKS}:s=48000:d=7`, '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k'])
  }
  // (SNIPP_KLISTE_FILES=<regex> narrows the files, SNIPP_KLISTE_JUMPS=<n>
  // repeats the jump: for looking closer at what a jump does.)
  const pick = process.env.SNIPP_KLISTE_FILES ? new RegExp(process.env.SNIPP_KLISTE_FILES) : null
  for (const k of Object.keys(files)) if (pick && !pick.test(k)) delete files[k]
  const jumps = Math.max(3, Number(process.env.SNIPP_KLISTE_JUMPS) || 3)
  // The long frame after a jump: how long the page is kept busy (ms;
  // SNIPP_KLISTE_JANK=<ms> for another length), started this long after the
  // jump (spread so that, at 60 Hz and at 144 Hz, some land on the tick that
  // hands the held clock over to the elements).
  const jank = Math.max(0, Number(process.env.SNIPP_KLISTE_JANK) || 110)
  const jankAfter = [3, 10, 17, 24, 31]
  const names = Object.keys(files)
  const assets = await lib.seedAssets(app, c, Object.values(files))
  await c.ev(TAP)
  const rows = []
  for (const [i, label] of names.entries()) {
    const asset = assets[i]
    const r = await c.run(async (asset, jumps, jank, jankAfter) => {
      const S = window.__store
      const wait = (ms) => new Promise((res) => setTimeout(res, ms))
      const p = structuredClone(S.getState().project)
      const T = { x: 960, y: 540, scale: 1, rotation: 0 }
      const video = asset.kind === 'video'
      p.tracks = [{ id: 'V1', kind: 'video', name: 'V1', clipIds: video ? ['k'] : [] }, { id: 'A1', kind: 'audio', name: 'A1', clipIds: video ? [] : ['k'] }]
      p.clips = { k: { id: 'k', assetId: asset.id, trackId: video ? 'V1' : 'A1', start: 0.5, inPoint: 0.3, duration: 6, transform: T, volume: 1 } }
      p.captions = []
      S.getState().setPlaying(false)
      S.getState().loadProject(p)
      window.__clickTap()
      const tap = window.__tap
      // Where the playhead was, against the performance clock.
      const seen = []
      // And where the element said it was (its currentTime against the
      // media time under the playhead): the engine's own idea of the drift.
      const eng = window.__engine
      const drifts = []
      // (By the asset's kind: the other map can still hold the element of
      // the file before, under the same clip id.)
      const elOf = () => (asset.kind === 'video' ? eng.videos : eng.audios).get('k')
      const off = S.subscribe((s) => {
        seen.push([performance.now(), s.currentTime, s.playing])
        const el = elOf()
        if (s.playing && el && !el.paused && !el.seeking && s.currentTime > 0.6) drifts.push([performance.now(), Math.round((el.currentTime - (0.3 + s.currentTime - 0.5)) * 1000)])
      })
      // What a jump did to the element, tick by tick: every write of its
      // currentTime (a seek), every play(), and where it and the playhead
      // were at each frame.
      const writes = []
      const frames = []
      const ctDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime')
      const traced = () => {
        const el = elOf()
        if (el && el.__traceOf !== writes) {
          el.__traceOf = writes
          Object.defineProperty(el, 'currentTime', {
            configurable: true,
            get() { return ctDesc.get.call(this) },
            set(v) { this.__traceOf.push([performance.now(), 'seek', v]); ctDesc.set.call(this, v) }
          })
          el.play = function () { this.__traceOf.push([performance.now(), 'play', ctDesc.get.call(this)]); return HTMLMediaElement.prototype.play.call(this) }
        }
        return el
      }
      let sampling = true
      const sample = (stamp) => {
        if (!sampling) return
        const el = traced()
        const s = S.getState()
        if (el) frames.push([performance.now(), s.currentTime, el.currentTime, el.paused || el.seeking || el.readyState < 3 ? 0 : 1, el.playbackRate, stamp])
        requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
      /** After a jump: how long the clock was held, its first step, the
       *  element's writes, and the element against the playhead (ms; < 0:
       *  the element behind) as it starts rolling and later. */
      const jumpTrace = () => {
        const after = frames.filter(([t]) => t >= jumpedAt)
        if (after.length < 3) return null
        const landed = after[0][1]
        const k = after.findIndex(([, time]) => time > landed + 1e-6)
        if (k < 1) return null
        const t0 = after[k][0]
        const lagAt = (ms) => {
          const f = after.filter(([t, , , rolling]) => rolling && t >= t0 + ms)[0]
          return f ? Math.round((f[2] - (0.3 + f[1] - 0.5)) * 1000) : null
        }
        const rates = after.slice(k).map((f) => f[4])
        return {
          hold: Math.round(after[k - 1][0] - jumpedAt),
          firstStep: Math.round((after[k][1] - landed) * 1000),
          // How long after its own frame time the first rolling tick ran (a
          // long frame: the tick's time is the frame's, not the moment).
          late: Math.round(after[k][0] - after[k][5]),
          writes: writes.filter(([t]) => t >= jumpedAt).map(([t, what, v]) => [Math.round(t - t0), what, Math.round(v * 1000)]),
          lag: [lagAt(0), lagAt(100), lagAt(300), lagAt(600), lagAt(1200), lagAt(1900)],
          rate: [Math.min(...rates), Math.max(...rates)]
        }
      }
      const headAt = (ms) => {
        let k = seen.findIndex(([t]) => t > ms)
        if (k <= 0) return null
        const [ta, va, pa] = seen[k - 1]
        const [tb, vb] = seen[k]
        // (Inside a stretch the playhead was not running: no reading.)
        if (!pa || tb - ta > 100) return null
        // (Across a jump there is nothing between the two readings: the
        // playhead went on from the one before until it was moved.)
        if (Math.abs(vb - va) > 0.25) return va + (ms - ta) / 1000
        return va + ((vb - va) * (ms - ta)) / (tb - ta)
      }
      const clicksAt = [1.2, 2.2, 3.2, 4.2, 5.2]
      let jumpedAt = Infinity
      /** Each heard click: its offset, the element's drift then, and how
       *  long after the jump (ms; null: before it or none). */
      const offsets = (hits) =>
        hits
          .map((ms) => {
            const head = headAt(ms)
            if (head === null) return null
            const near = clicksAt.reduce((a, b) => (Math.abs(b - head) < Math.abs(a - head) ? b : a))
            if (Math.abs(head - near) >= 0.4) return null
            const d = drifts.filter(([t]) => t <= ms).at(-1)
            return { off: Math.round((head - near) * 1000), el: d ? d[1] : null, since: ms > jumpedAt ? Math.round(ms - jumpedAt) : null }
          })
          .filter((v) => v !== null)
      const take = async (fromTime, ms, jump) => {
        S.getState().setTime(fromTime)
        await wait(700)
        tap.hits = []
        seen.length = 0
        drifts.length = 0
        writes.length = 0
        frames.length = 0
        tap.on = true
        S.getState().setPlaying(true)
        jumpedAt = Infinity
        if (jump) {
          await wait(jump.after)
          jumpedAt = performance.now()
          S.getState().setTime(jump.to)
          if (jump.busyAfter !== undefined) {
            setTimeout(() => {
              const until = performance.now() + jank
              while (performance.now() < until) { /* a long frame */ }
            }, jump.busyAfter)
          }
        }
        await wait(ms)
        S.getState().setPlaying(false)
        tap.on = false
        await wait(100)
        const ds = drifts.map(([, d]) => d).sort((a, b) => a - b)
        return { at: offsets(tap.hits), el: ds.length ? ds[Math.floor(ds.length / 2)] : null, trace: jump ? jumpTrace() : null }
      }
      const res = {
        top: [await take(0, 3600)],
        scrub: [await take(2.6, 2300), await take(1.9, 2300)],
        jump: [],
        long: []
      }
      const targets = [[0, 1500, 3.9], [0.4, 1300, 2.85], [3.0, 1200, 1.7], [0.2, 1150, 4.75], [1.0, 700, 3.55], [2.0, 900, 0.9]]
      for (let k = 0; k < jumps; k++) {
        const [from, after, to] = targets[k % targets.length]
        res.jump.push(await take(from, 2300, { after, to }))
      }
      for (const [k, busyAfter] of jankAfter.entries()) {
        const [from, after, to] = targets[k % targets.length]
        res.long.push(await take(from, 2300, { after, to, busyAfter }))
      }
      off()
      sampling = false
      return res
    }, asset, jumps, jank, jankAfter)
    rows.push({ label, ...r })
  }
  const steady = (r) => [...r.top, ...r.scrub, ...r.jump, ...r.long].flatMap((x) => x.at.filter((h) => h.since === null || h.since > 600)).map((h) => h.off)
  const afterJump = (r) => [...r.jump, ...r.long].flatMap((x) => x.at.filter((h) => h.since !== null && h.since <= 600))
  const say = (xs) => xs.map((x) => `${x.at.map((h) => h.off + (h.since !== null ? `@${h.since}` : '')).join(',')} [el ${x.el}]`).join(' / ')
  const median = (xs) => {
    const s = [...xs].sort((a, b) => a - b)
    return s.length ? s[Math.floor(s.length / 2)] : NaN
  }
  // The element against the playhead after a jump (ms; < 0: behind): as it
  // starts rolling, then 100, 300, 600, 1 200 and 1 900 ms later.
  const lags = (xs) => xs.map((x) => (x.trace ? `${x.trace.lag.map((v) => v ?? '-').join(',')}${x.trace.late > 20 ? ` (tick ${x.trace.late} ms late)` : ''}${x.trace.firstStep > 20 ? ` (first step ${x.trace.firstStep} ms)` : ''}${x.trace.rate[0] !== x.trace.rate[1] ? ` (rate ${x.trace.rate.join('-')})` : ''}` : 'no trace')).join(' / ')
  const lines = rows.map((r) => `${r.label}: top ${say(r.top)} · scrub ${say(r.scrub)} · jump ${say(r.jump)} · long frame ${say(r.long)} (steady median ${median(steady(r))} ms)\n      element after a jump: ${lags(r.jump)}\n      after a long frame: ${lags(r.long)}`)
  console.log('    ' + lines.join('\n    '))
  // (Every reading kept, for the plan.)
  writeFileSync(join(out, 'kliste-wav-sync.json'), JSON.stringify(rows, null, 1))
  // The sound path's own delay (the device, the tap, the picture): the
  // median of every steady click of every file.
  const base = median(rows.flatMap(steady))
  const late = rows.flatMap((r) => afterJump(r).filter((h) => Math.abs(h.off - base) > 60).map((h) => `${r.label} ${h.off} ms ${h.since} ms after the jump (element ${h.el} ms)`))
  console.log(`    base ${base} ms; clicks within 600 ms of a jump more than 60 ms off it: ${late.length ? late.join('; ') : 'none'}`)
  for (const r of rows) {
    assert.ok(r.top[0].at.length >= 3, `${r.label}: the clicks from the top are heard (${r.top[0].at.length})`)
    for (const x of [...r.scrub, ...r.jump, ...r.long]) assert.ok(x.at.length >= 1, `${r.label}: the clicks after a scrub and a jump are heard`)
    // After a jump, long frame or not, the element is where it always is
    // against the playhead (the file's median: with a real device its delay
    // is in the element's time), within a frame (40 ms), from 300 ms on.
    for (const x of [...r.jump, ...r.long]) assert.ok(x.trace, `${r.label}: the jump was followed`)
    const usual = median([...r.jump, ...r.long].flatMap((x) => x.trace.lag.slice(2).filter((v) => v !== null)))
    for (const x of [...r.jump, ...r.long]) {
      for (const v of x.trace.lag.slice(2)) assert.ok(v === null || Math.abs(v - usual) <= 40, `${r.label}: the element ${v} ms off the playhead after a jump, usually ${usual} ms (${x.trace.lag.join(',')})`)
    }
    // Played, scrubbed, or settled after a jump: every click within 45 ms of
    // the base (a frame and a half at 30 fps). An MP3 carries its encoder's
    // delay (about 1 100 samples, 23 ms) on top: still inside.
    for (const v of steady(r)) assert.ok(Math.abs(v - base) <= 45, `${r.label}: a click ${v} ms off the playhead, the base ${base} ms`)
  }
  // The first clicks after a jump too (they were only written down before).
  assert.equal(late.length, 0, 'clicks right after a jump more than 60 ms off the base: ' + late.join('; '))
  // The way out as it was.
  await c.run(() => {
    const tap = window.__tap
    const an = window.__engine.getAnalyser()
    an.disconnect(tap.quiet66)
    tap.quiet66.disconnect()
    an.connect(an.context.destination)
    an.disconnect(tap.sp)
    tap.sp.disconnect()
    window.__tap = null
  })
  void out
}
