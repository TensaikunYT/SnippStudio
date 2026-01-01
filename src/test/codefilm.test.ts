// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Code films (CODE-FILM-CLIP-PLAN.md): the folder server's confinement and
// facts, the firewall, the host page's helpers, the preview's frame plan, and
// a code film on the timeline (its sound linked under it).
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { filmFolderArg, filmMime, filmPathFor, filmProjectPath, FilmRegistry, ignoredChange, isFilmHost, isInside, metaFrom, wavSeconds } from '../main/codefilm'
import { HOST_HTML, pickConfig, visibleCanvases } from '../main/codefilm-host'
import { isAllowedAppRequest } from '../main/network'
import { arrive, clearPlan, forget, gridAfter, markOld, newPlan, noteAsked, pick, RING, want } from '../renderer/src/media/codefilm-schedule'
import { codeFilmMix, useStore } from '../renderer/src/state/store'
import { defaultProject, isPictureAsset, type Asset, type Project } from '../renderer/src/types'
import { preflight } from '../renderer/src/export/preflight'

const ROOT = 'C:\\Films\\videohub'

test('a snippfilm path stays inside its film folder', () => {
  assert.equal(filmPathFor(ROOT, '/'), 'C:\\Films\\videohub\\index.html')
  assert.equal(filmPathFor(ROOT, '/index.html'), 'C:\\Films\\videohub\\index.html')
  assert.equal(filmPathFor(ROOT, '/img/notes/n01.jpg'), 'C:\\Films\\videohub\\img\\notes\\n01.jpg')
  assert.equal(filmPathFor(ROOT + '\\', '/fonts/a%20b.woff2'), 'C:\\Films\\videohub\\fonts\\a b.woff2')
  for (const bad of ['/../secret.txt', '/img/../../x', '/%2e%2e/x', '/..%5Cx', '/C:/Windows/win.ini', '/a.txt:stream', '/con', '/nul.txt', '/a%00b', '/%E0%A4%A']) {
    assert.equal(filmPathFor(ROOT, bad), null, bad)
  }
  // A sibling folder whose name starts the same is outside.
  assert.equal(isInside(ROOT, 'C:\\Films\\videohub2\\x.js'), false)
  assert.equal(isInside(ROOT, 'C:\\Films\\VideoHub\\x.js'), true)
})

test('film files get the types a web page needs', () => {
  assert.match(filmMime('a.js'), /javascript/)
  assert.match(filmMime('a.MJS'), /javascript/)
  assert.equal(filmMime('f.woff2'), 'font/woff2')
  assert.equal(filmMime('x.wasm'), 'application/wasm')
  assert.equal(filmMime('x.unknown'), 'application/octet-stream')
})

test('a film host is 16 hex characters, and the registry keeps one id per folder', () => {
  assert.equal(isFilmHost('0123456789abcdef'), true)
  assert.equal(isFilmHost('0123456789ABCDEF'), false)
  assert.equal(isFilmHost('evil.example'), false)
  const reg = new FilmRegistry()
  const id = reg.idFor(ROOT)
  assert.equal(isFilmHost(id), true)
  assert.equal(reg.idFor(ROOT.toUpperCase() + '\\'), id)
  assert.equal(reg.root(id), ROOT)
  assert.notEqual(reg.idFor('C:\\Films\\other'), id)
  assert.equal(reg.root('ffffffffffffffff'), undefined)
})

test('the firewall lets a film folder through and nothing that looks like one', () => {
  assert.equal(isAllowedAppRequest('snippfilm://0123456789abcdef/index.html'), true)
  assert.equal(isAllowedAppRequest('snippfilm://evil.example/index.html'), false)
  assert.equal(isAllowedAppRequest('snippfilm://0123456789abcdef.evil.example/'), false)
  assert.equal(isAllowedAppRequest('https://0123456789abcdef/'), false)
})

test('a film\'s length and fps come from its VideoHub project, else its mix', () => {
  assert.deepEqual(metaFrom({ render: { env: { DUR: '363.53', FPS: '60' } } }, 364.5), { duration: 363.53, fps: 60 })
  assert.deepEqual(metaFrom(null, 12.5), { duration: 12.5, fps: null })
  assert.deepEqual(metaFrom({ render: { env: { DUR: 'x' } } }, null), { duration: null, fps: null })
})

test('a WAV\'s length is read from its header', () => {
  const rate = 48000
  const bytes = rate * 2 * 2 * 3 // 3 s of 16-bit stereo
  const head = new Uint8Array(44 + 8 + 4)
  const dv = new DataView(head.buffer)
  const put = (o: number, s: string): void => [...s].forEach((c, i) => (head[o + i] = c.charCodeAt(0)))
  put(0, 'RIFF')
  put(8, 'WAVE')
  put(12, 'LIST')
  dv.setUint32(16, 4, true)
  put(24, 'fmt ')
  dv.setUint32(28, 16, true)
  dv.setUint32(40, rate * 4, true) // byte rate (fmt + 12)
  // fmt chunk: 24..48; data chunk at 48
  put(48, 'data')
  dv.setUint32(52, bytes, true)
  assert.equal(wavSeconds(head, 56 + bytes), 3)
  dv.setUint32(52, 0xffffffff, true)
  assert.equal(wavSeconds(head, 56 + bytes), 3)
  assert.equal(wavSeconds(new Uint8Array(10), 10), null)
})

test('changes outside a film\'s code and sound are not reloads', () => {
  for (const f of ['.videohub/notes.json', 'work/x.png', 'node_modules/a/b.js', 'tools/crop.py', 'retime.py', 'SECTIONS.md', 'snipp/videohub.snipp', 'snipp/x.json']) assert.equal(ignoredChange(f), true, f)
  for (const f of ['s1_hub.js', 'img/notes/n01.jpg', 'audio/mix.wav', 'index.html', 'cues.json']) assert.equal(ignoredChange(f), false, f)
})

test('VideoHub hands a film over on the command line; its project sits beside it', () => {
  assert.equal(filmFolderArg(['Snipp.exe', '--code-film=C:\\films\\videohub']), 'C:\\films\\videohub')
  assert.equal(filmFolderArg(['Snipp.exe', '--code-film', '"C:\\a b\\film"']), 'C:\\a b\\film')
  assert.equal(filmFolderArg(['Snipp.exe', 'C:\\x.snipp']), null)
  assert.equal(filmFolderArg(['Snipp.exe', '--code-film=']), null)
  assert.equal(filmProjectPath('C:\\films\\videohub'), 'C:\\films\\videohub\\snipp\\videohub.snipp')
})

test('the host page reads a film\'s size as VideoHub does', () => {
  // (A canvas's box is its size in CSS pixels: phase 5a.)
  const canvases = (list: { width: number; height: number }[]) => ({ querySelectorAll: () => list.map((c) => ({ ...c, getBoundingClientRect: () => ({ left: 0, top: 0, width: c.width, height: c.height }) })) })
  assert.deepEqual(pickConfig({ __config: { width: 1080, height: 1920, fps: 30, duration: 59 }, document: canvases([]) }), { width: 1080, height: 1920, fps: 30, duration: 59, transparent: null })
  assert.deepEqual(pickConfig({ VH_CONFIG: { outWidth: 1280, outHeight: 720 }, document: canvases([]) }), { width: 1280, height: 720, fps: null, duration: null, transparent: null })
  assert.deepEqual(pickConfig({ DATA: { width: 640, height: 480 }, document: canvases([]) }), { width: 640, height: 480, fps: null, duration: null, transparent: null })
  assert.deepEqual(pickConfig({ document: canvases([{ width: 32, height: 32 }, { width: 1920, height: 1080 }]) }), { width: 1920, height: 1080, fps: null, duration: null, transparent: null })
  assert.deepEqual(pickConfig({ document: canvases([]) }), { width: 1920, height: 1080, fps: null, duration: null, transparent: null })
  // The page's script carries the helpers it calls.
  assert.match(HOST_HTML, /function pickConfig/)
  assert.match(HOST_HTML, /function visibleCanvases/)
  assert.match(HOST_HTML, /\/index\.html/)
})

test('only laid-out, shown canvases make the picture, in page order', () => {
  const cv = (name: string, w: number, h: number, rw: number, display = 'block') => ({ name, width: w, height: h, display, getBoundingClientRect: () => ({ left: 0, top: 0, width: rw, height: rw ? 10 : 0 }) })
  const list = [cv('gl', 1920, 1080, 1920), cv('hidden', 1920, 1080, 1920, 'none'), cv('zero', 1920, 1080, 0), cv('empty', 0, 0, 100), cv('ui', 1920, 1080, 1920)]
  const doc = { querySelectorAll: () => list, defaultView: { getComputedStyle: (c: { display: string }) => ({ display: c.display, visibility: 'visible' }) } }
  assert.deepEqual(visibleCanvases(doc).map((c: { name: string }) => c.name), ['gl', 'ui'])
})

test('paused, the preview asks for exactly the playhead\'s frame, once', () => {
  const plan = newPlan<string>()
  const a = want(plan, 10.25, 'exact', 60, 1920, 1080)
  assert.deepEqual(a, { t: 10.25, prep: true, w: 1920, h: 1080 })
  noteAsked(plan, { id: 1, ...a! })
  assert.equal(want(plan, 10.25, 'exact', 60, 1920, 1080), null)
  assert.deepEqual(arrive(plan, 1, { t: 10.25, w: 1920, h: 1080, bmp: 'f1' }, 0.02), [])
  assert.equal(want(plan, 10.25, 'exact', 60, 1920, 1080), null)
  assert.equal(pick(plan, 10.25, 'exact', 60)?.bmp, 'f1')
  // A new place: the old frame stays on screen until the new one comes.
  assert.ok(want(plan, 11, 'exact', 60, 1920, 1080))
  assert.equal(pick(plan, 11, 'exact', 60)?.bmp, 'f1')
})

test('playing, it asks a round trip ahead on the film\'s grid, two at most', () => {
  const plan = newPlan<string>()
  plan.latency = 0.03
  const a = want(plan, 5, 'play', 60, 1280, 720)!
  assert.equal(a.prep, false)
  assert.equal(a.t, gridAfter(5.03, 60))
  noteAsked(plan, { id: 1, ...a })
  // Already on its way: nothing more this tick; the next frame on the next.
  assert.equal(want(plan, 5, 'play', 60, 1280, 720), null)
  const b = want(plan, 5 + 1 / 60, 'play', 60, 1280, 720)!
  assert.ok(b.t > a.t)
  noteAsked(plan, { id: 2, ...b })
  assert.equal(want(plan, 5 + 2 / 60, 'play', 60, 1280, 720), null)
  arrive(plan, 1, { t: a.t, w: 1280, h: 720, bmp: 'a' }, 0.03)
  // Never a frame later than the clock (half a frame of slack).
  assert.equal(pick(plan, 5, 'play', 60)?.bmp, 'a')
  assert.equal(pick(plan, a.t - 0.5 / 60, 'play', 60)?.bmp, 'a')
})

test('the ring keeps a few frames and hands back the rest to close', () => {
  const plan = newPlan<number>()
  const dropped: number[] = []
  for (let i = 1; i <= RING + 2; i++) {
    noteAsked(plan, { id: i, t: i, w: 10, h: 10, prep: true })
    dropped.push(...arrive(plan, i, { t: i, w: 10, h: 10, bmp: i }, 0.01))
  }
  assert.deepEqual(dropped, [1, 2])
  // An answer nobody waits for (dropped, or after a clear) is closed at once.
  assert.deepEqual(arrive(plan, 99, { t: 1, w: 10, h: 10, bmp: 99 }, 0.01), [99])
  noteAsked(plan, { id: 7, t: 7, w: 10, h: 10, prep: false })
  forget(plan, [7])
  assert.equal(plan.asked.length, 0)
  assert.deepEqual(clearPlan(plan).sort(), [3, 4, 5])
})

test('after the film\'s code changed, the paused preview asks for its frame again and shows the old one meanwhile', () => {
  const plan = newPlan<string>()
  noteAsked(plan, { id: 1, t: 5, w: 960, h: 540, prep: true })
  arrive(plan, 1, { t: 5, w: 960, h: 540, bmp: 'before' }, 0.02)
  // Held: nothing to ask.
  assert.equal(want(plan, 5, 'exact', 60, 960, 540), null)
  // The page starts again (codeFilms.reload): what is held is of the old page.
  markOld(plan)
  // Still on screen (no black frame while the new page starts)…
  assert.equal(pick(plan, 5, 'exact', 60)?.bmp, 'before')
  // …and asked for again, once.
  const ask = want(plan, 5, 'exact', 60, 960, 540)
  assert.deepEqual(ask, { t: 5, prep: true, w: 960, h: 540 })
  noteAsked(plan, { id: 2, ...ask! })
  assert.equal(want(plan, 5, 'exact', 60, 960, 540), null)
  arrive(plan, 2, { t: 5, w: 960, h: 540, bmp: 'after' }, 0.02)
  assert.equal(pick(plan, 5, 'exact', 60)?.bmp, 'after')
  // Coming back to that frame later shows the new one too, not the old.
  assert.equal(pick(plan, 5.2, 'exact', 60)?.bmp, 'after')
  assert.equal(pick(plan, 5, 'exact', 60)?.bmp, 'after')
  // Playing: a new frame wins over an old one, even an older-timed one;
  // an old frame is shown only when no new one has come yet, and never
  // counts as being ahead.
  const playing = newPlan<string>()
  for (const [id, t] of [[1, 5], [2, 5 + 1 / 60]] as [number, number][]) {
    noteAsked(playing, { id, t, w: 960, h: 540, prep: false })
    arrive(playing, id, { t, w: 960, h: 540, bmp: `old${id}` }, 0.02)
  }
  markOld(playing)
  assert.equal(pick(playing, 5 + 1 / 60, 'play', 60)?.bmp, 'old2')
  assert.ok(want(playing, 5, 'play', 60, 960, 540))
  noteAsked(playing, { id: 3, t: 5, w: 960, h: 540, prep: false })
  arrive(playing, 3, { t: 5, w: 960, h: 540, bmp: 'new' }, 0.02)
  assert.equal(pick(playing, 5 + 1 / 60, 'play', 60)?.bmp, 'new')
})

const filmAssets = (): Asset[] => [
  { id: 'film', kind: 'code', name: 'videohub', path: 'C:\\Films\\videohub', url: 'snippfilm://0123456789abcdef/', size: 0, duration: 30, width: 1920, height: 1080, hasAudio: false, code: { fps: 60, mixAssetId: 'mix' } },
  { id: 'mix', kind: 'audio', name: 'videohub mix.wav', path: 'C:\\Films\\videohub\\audio\\mix.wav', url: 'media://local/x', size: 1, duration: 30.5, width: 0, height: 0, hasAudio: true }
]

test('a code film comes onto the timeline with its sound under it, linked', () => {
  const p0: Project = defaultProject()
  p0.assets.push(...filmAssets())
  useStore.getState().loadProject(p0)
  useStore.getState().addToTimeline('film')
  const p = useStore.getState().project
  const clips = Object.values(p.clips)
  assert.equal(clips.length, 2)
  const pic = clips.find((c) => c.assetId === 'film')!
  const snd = clips.find((c) => c.assetId === 'mix')!
  assert.equal(p.tracks.find((t) => t.id === pic.trackId)?.kind, 'video')
  assert.equal(p.tracks.find((t) => t.id === snd.trackId)?.kind, 'audio')
  assert.equal(snd.start, pic.start)
  assert.equal(snd.inPoint, pic.inPoint)
  assert.equal(snd.duration, pic.duration)
  assert.ok(pic.linkId && pic.linkId === snd.linkId)
  // A split with the A/V link on cuts both at the same place.
  useStore.setState({ currentTime: 12, selectedClipIds: [pic.id], linkAV: true })
  useStore.getState().splitAtPlayhead()
  const after = Object.values(useStore.getState().project.clips)
  const cuts = (id: string) => after.filter((c) => c.assetId === id).map((c) => [c.start, c.inPoint, c.duration]).sort((a, b) => a[0] - b[0])
  assert.deepEqual(cuts('film'), cuts('mix'))
})

test('add-all places a film once (its sound comes with it, not again)', () => {
  const p0: Project = defaultProject()
  p0.assets.push(...filmAssets())
  useStore.getState().loadProject(p0)
  useStore.getState().addAllToTimeline()
  const clips = Object.values(useStore.getState().project.clips)
  assert.equal(clips.filter((c) => c.assetId === 'film').length, 1)
  assert.equal(clips.filter((c) => c.assetId === 'mix').length, 1)
})

test('a film without its mix comes in alone; its sound is found by path too', () => {
  const [film, mix] = filmAssets()
  const p0: Project = defaultProject()
  p0.assets.push({ ...film, code: { fps: 60 } })
  useStore.getState().loadProject(p0)
  useStore.getState().addToTimeline('film')
  assert.equal(Object.values(useStore.getState().project.clips).length, 1)
  const p1: Project = defaultProject()
  p1.assets.push({ ...film, code: { fps: 60, mixAssetId: 'gone' } }, mix)
  assert.equal(codeFilmMix(p1, p1.assets[0])?.id, 'mix')
})

test('a code film is a picture', () => {
  const [film, mix] = filmAssets()
  assert.equal(isPictureAsset(film), true)
  assert.equal(isPictureAsset(mix), false)
  assert.equal(isPictureAsset(undefined), false)
})

test('the pre-export check names a code film whose page does not run', () => {
  const p: Project = defaultProject()
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  p.assets.push(filmAssets()[0])
  p.clips.f = { id: 'f', assetId: 'film', trackId: v1.id, start: 0, duration: 10, inPoint: 0, volume: 1, transform: { x: 960, y: 540, scale: 1, rotation: 0 } }
  v1.clipIds = ['f']
  const issues = preflight(p, { codeFilmError: (id) => (id === 'film' ? 'ReferenceError: boot is not defined\n at index.html:3' : null) })
  const it = issues.find((i) => i.clipId === 'f')
  assert.ok(it)
  assert.match(it!.text, /“videohub” does not run: ReferenceError: boot is not defined$/)
  assert.equal(preflight(p, { codeFilmError: () => null }).some((i) => i.clipId === 'f'), false)
})
