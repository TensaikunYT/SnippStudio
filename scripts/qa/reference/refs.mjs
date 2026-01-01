// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Reference frames: small projects with every feature the product keeps (video,
// word-animated subtitles, a text, shapes, transitions and their sounds, moving
// pictures, a code film clip, every template, a backdrop and the camera look,
// Shorts), drawn the way an export draws them, each frame's SHA-256 and the
// sound mix's written down. Made for the clean-product phase (SnippStudio
// TEMIZLIK-PLAN.md): after a change that should not change what is drawn, the
// same run must give the same hashes (compare with cmp.mjs).
//
//   node make-media.mjs <mediaDir>          once: the test footage (ffmpeg)
//   node refs.mjs <out.json> <pngDir> <mediaDir>
//   node cmp.mjs <before.json> <after.json> <beforePngs> <afterPngs>
// Needs a Snipp window with --remote-debugging-port=9333 (see README.md).
import { connect } from './cdp.mjs'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync, existsSync } from 'node:fs'
import { makeFxMedia } from './make-fx-media.mjs'
const BLOCKS = JSON.parse(readFileSync(new URL('./tpl-blocks.json', import.meta.url), 'utf8'))
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null

const HERE = fileURLToPath(new URL('.', import.meta.url)).replace(/[\/]$/, '')
const out = process.argv[2] ?? 'hashes.json'
const pngDir = process.argv[3] ?? null
const MEDIA_DIR = process.argv[4] ?? join(HERE, 'media')
if (pngDir) mkdirSync(pngDir, { recursive: true })

const c = await connect(Number(process.env.SNIPP_CDP_PORT ?? 9333))
await c.sleep(1500)
await c.dismissRecovery()

const MEDIA = {
  v1: { file: join(MEDIA_DIR, 'v1.mp4'), kind: 'video', w: 1280, h: 720, d: 6, audio: true },
  v2: { file: join(MEDIA_DIR, 'v2.mp4'), kind: 'video', w: 1280, h: 720, d: 6, audio: false },
  v3: { file: join(MEDIA_DIR, 'v3.mp4'), kind: 'video', w: 720, h: 1280, d: 6, audio: false },
  img1: { file: join(MEDIA_DIR, 'img1.png'), kind: 'image', w: 1600, h: 900, d: 0, audio: false },
  img2: { file: join(MEDIA_DIR, 'img2.png'), kind: 'image', w: 1080, h: 1350, d: 0, audio: false },
  // "Cila" part D: the picture the effect frames are drawn from, written
  // pixel by pixel (make-fx-media.mjs).
  fx: { file: join(MEDIA_DIR, 'fx.png'), kind: 'image', w: 1280, h: 720, d: 0, audio: false }
}
if (!existsSync(MEDIA.fx.file)) makeFxMedia(MEDIA_DIR)

const page = `(async () => {
  const BLOCKS = ${JSON.stringify(BLOCKS)}
  const ONLY = ${ONLY ? 'new RegExp(' + JSON.stringify(ONLY.source) + ')' : 'null'}
  const MEDIA = ${JSON.stringify(MEDIA)}
  const FILM = ${JSON.stringify(join(HERE, 'film-demo'))}
  const S = window.__store
  const ex = await window.__exporter()
  const assets = {}
  for (const [id, m] of Object.entries(MEDIA)) {
    const reg = await window.api.testRegisterMedia(m.file)
    if (!reg) throw new Error('could not register ' + m.file)
    assets[id] = { id, kind: m.kind, name: reg.name, path: reg.path, url: reg.url, size: reg.size, duration: m.d, width: m.w, height: m.h, hasAudio: m.audio }
  }
  // The code film: registered and imported the app's own way, its id fixed.
  const info = await window.api.codeFilm.register(FILM)
  const [films, imp] = await window.__codeFilm()
  const res = await imp.codeFilmImport(info)
  const film = res.assets.find((a) => a.kind === 'code')
  film.id = 'film1'
  assets.film1 = film
  films.codeFilms.ensure(film)
  // Phase 5b: a code film with a transparent page (film-alpha/). Its
  // hasAlpha said here, as the app's strip sampling says it.
  const infoA = await window.api.codeFilm.register(${JSON.stringify(join(HERE, 'film-alpha'))})
  const filmA = (await imp.codeFilmImport(infoA)).assets.find((a) => a.kind === 'code')
  filmA.id = 'film2'
  filmA.code = { ...filmA.code, hasAlpha: true }
  assets.film2 = filmA
  films.codeFilms.ensure(filmA)

  const words = (list) => list.map(([text, start, end]) => ({ text, start, end }))
  const capStyle = (over = {}) => ({ fontFamily: 'Arial', fontSize: 56, fontWeight: 800, color: '#ffffff', outlineColor: '#000000', outlineWidth: 6, bgColor: '#000000', bgOpacity: 0, posY: 0.86, maxLineChars: 28, uppercase: false, popup: { enabled: true, duration: 0.2, intensity: 1, style: 'pop' }, wordsPerCue: 0, pauseThreshold: 0, ...over })
  const T = (x, y, s) => ({ x, y, scale: s, rotation: 0 })
  const clip = (id, assetId, trackId, start, inPoint, duration, transform, extra = {}) => ({ id, assetId, trackId, start, inPoint, duration, transform, volume: 1, ...extra })
  const base = (name, w, h, extra = {}) => ({ version: 1, name, settings: { width: w, height: h, fps: 30 }, mode: 'frame', tracks: [], clips: {}, assets: [], captions: [], captionStyle: capStyle(), transcription: { model: 'english', language: 'auto' }, snap: { enabled: true, distance: 12, snapEdges: true, snapCenters: true }, ...extra })
  const put = (p, track, clips) => { p.tracks.push(track); for (const c of clips) { p.clips[c.id] = c; track.clipIds.push(c.id) } }
  const subs = [
    { id: 's1', start: 0.5, end: 3.2, text: 'Every frame stays the same', words: words([['Every', 0.5, 0.9], ['frame', 0.9, 1.4], ['stays', 1.4, 2.0], ['the', 2.0, 2.2], ['same', 2.2, 3.2]]) },
    { id: 's2', start: 4.2, end: 7.0, text: 'after the cleanup is done', words: words([['after', 4.2, 4.6], ['the', 4.6, 4.8], ['cleanup', 4.8, 5.6], ['is', 5.6, 5.9], ['done', 5.9, 7.0]]) }
  ]

  const P = []
  // 1. Video + word-animated subtitles + a text + a shape + transitions.
  {
    const p = base('ref-edit', 1280, 720, { risers: 0.6, transitionSfx: 0.7 })
    p.assets = [assets.v1, assets.v2, assets.img1]
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [
      clip('a', 'v1', 'V1', 0, 0, 4, T(640, 360, 1), { transitionOut: { type: 'mix', duration: 0.8 } }),
      clip('b', 'v2', 'V1', 4, 0, 4, T(640, 360, 1), { transitionOut: { type: 'wipe', duration: 0.8, direction: 'right' } }),
      clip('c', 'img1', 'V1', 8, 0, 3, T(640, 360, 0.8), { transitionOut: { type: 'zoom', duration: 0.8 } }),
      clip('d', 'v1', 'V1', 11, 1, 3, T(640, 360, 1), { transitionOut: { type: 'slide', duration: 0.6, direction: 'left' } }),
      clip('e', 'v2', 'V1', 14, 2, 2, T(640, 360, 1))
    ])
    put(p, { id: 'A1', kind: 'audio', name: 'A1', clipIds: [] }, [])
    p.captions = [
      ...subs,
      { id: 't1', start: 1, end: 6, text: 'A title of my own', manual: true, layer: 1, style: capStyle({ fontSize: 72, color: '#ffd23f', posY: 0.2, popup: { enabled: false, duration: 0.16, intensity: 1, style: 'pop' } }), anim: { in: 'slide', out: 'fade', idle: 'none' } },
      { id: 'sh1', start: 1.5, end: 6, text: '', manual: true, layer: 2, shape: { kind: 'rect', w: 0.25, h: 0.15 }, style: capStyle({ bgColor: '#3b6cf6', bgOpacity: 0.85, bgRadius: 18, bgBorder: { color: '#ffffff', width: 4 }, posY: 0.5, popup: { enabled: false, duration: 0.16, intensity: 1, style: 'pop' } }), anim: { in: 'pop' } },
      { id: 'sh2', start: 2, end: 6, text: '', manual: true, layer: 3, shape: { kind: 'circle', w: 0.12, h: 0.2 }, style: capStyle({ bgColor: '#22c7a0', bgOpacity: 1, posY: 0.45, posX: 0.8, popup: { enabled: false, duration: 0.16, intensity: 1, style: 'pop' } }), anim: { in: 'fade' } }
    ]
    P.push({ wav: true, p, times: [0.7, 1.2, 2.4, 3.95, 4.9, 7.95, 10.95, 12.0, 13.85, 15.0], drawer: [0.7, 3.95, 7.95, 13.85] })
  }
  // 2. Moving pictures: a slow push-in, and a picture that walks in and hops.
  {
    const p = base('ref-picture', 1280, 720)
    p.assets = [assets.img1, assets.img2]
    put(p, { id: 'V2', kind: 'video', name: 'V2', clipIds: [] }, [
      clip('m', 'img2', 'V2', 0, 0, 5, T(900, 360, 0.35), { moves: { actions: [{ id: 'mv1', kind: 'enter', time: 0.2, dur: 0.8, side: 'left' }, { id: 'mv2', kind: 'hop', time: 2, dur: 0.6 }, { id: 'mv3', kind: 'dash', time: 3.2, dur: 0.5, x: 300, y: 360 }] } })
    ])
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [
      clip('k', 'img1', 'V1', 0, 0, 5, T(640, 360, 0.8), { motionFx: { enabled: true, zoomFrom: 1, zoomTo: 1.35, panX: 0.1, panY: -0.05, shakeAmp: 0, shakeRotAmp: 0, shakeSpeed: 1, seed: 7 } })
    ])
    P.push({ wav: true, p, times: [0.1, 0.6, 1.0, 2.2, 3.4, 4.5] })
  }
  // 3. A small code film clip, with a subtitle over it.
  {
    const p = base('ref-codefilm', 1280, 720)
    p.assets = [assets.film1]
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [clip('f', 'film1', 'V1', 0, 2, 5, T(640, 360, 1))])
    p.captions = [subs[0]]
    P.push({ wav: true, p, times: [0.0, 1.0, 2.5, 4.9], drawer: [1.0, 4.9] })
  }
  // 4. Two templates that stay: Big words (from the subtitles) and a bar chart.
  {
    const p = base('ref-templates', 1280, 720)
    p.assets = [assets.v1]
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [clip('a', 'v1', 'V1', 0, 0, 6, T(640, 360, 1))])
    p.captions = subs
    p.templates = [
      { id: 'g1', kind: 'words', start: 0.3, duration: 3, title: '', items: [], style: { accent: '#ffd23f', ink: '#0b0b0d', card: '#ffffff', font: 'Snipp Display', hand: false, backdrop: 'dim' }, seed: 11, design: 'stack' },
      { id: 'g2', kind: 'bars', start: 3.6, duration: 2.4, title: 'Frames kept', items: [{ id: 'i1', title: 'Before', value: 120 }, { id: 'i2', title: 'After', value: 120 }, { id: 'i3', title: 'Changed', value: 0 }], style: { accent: '#ff5a3c', ink: '#0b0b0d', card: '#fbf6ea', font: 'Archivo Black', hand: false, backdrop: 'blur' }, seed: 12 }
    ]
    P.push({ wav: true, p, times: [0.6, 1.5, 2.6, 4.0, 4.8, 5.8] })
  }
  // 5. A backdrop behind a smaller picture, and the camera look over all.
  {
    const p = base('ref-look', 1280, 720, { backdrop: { style: 'aurora', motion: 0.6 }, cameraLook: { grain: 0.4, weave: 0.3, halation: 0.4, fade: 0.3, flicker: 0.2, dust: 0.4, mono: 0, vignette: 0.5, vShape: 'round', vMotion: 'breathe', vSpeed: 1, bars: 0.3, gate: 0.2 } })
    p.assets = [assets.v2]
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [clip('a', 'v2', 'V1', 0, 0, 5, T(640, 360, 0.6))])
    P.push({ wav: true, p, times: [0.4, 2.0, 4.2] })
  }
  // 6. Shorts: a wide edit cut to 9:16, its own caption style.
  {
    const p = base('ref-shorts', 1280, 720, { mode: 'shorts', shorts: { baseX: 0.5, keyframes: [{ id: 'k1', time: 0, x: 0.3 }, { id: 'k2', time: 4, x: 0.7 }] }, captionStyleShorts: capStyle({ fontSize: 80, posY: 0.7, popup: { enabled: true, duration: 0.2, intensity: 1, style: 'rise' } }) })
    p.assets = [assets.v1, assets.v3]
    put(p, { id: 'V2', kind: 'video', name: 'V2', clipIds: [] }, [clip('b', 'v3', 'V2', 2, 0, 2, T(1100, 360, 0.3))])
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [clip('a', 'v1', 'V1', 0, 0, 6, T(640, 360, 1))])
    p.captions = subs
    P.push({ wav: true, p, times: [1.0, 2.5, 4.5], drawer: [1.0, 2.5, 4.5], shorts: true })
  }

  // 7. Every template kind alone over two clips (blocks saved by tpl-capture.mjs).
  const twoClips = (p) => { p.assets = [assets.v1, assets.v2]; put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [clip('a', 'v1', 'V1', 0, 0, 6, T(640, 360, 1)), clip('b', 'v2', 'V1', 6, 0, 6, T(640, 360, 1)), clip('c', 'v1', 'V1', 12, 0, 6, T(640, 360, 1)), clip('d', 'v2', 'V1', 18, 0, 6, T(640, 360, 1)), clip('e', 'v1', 'V1', 24, 0, 6, T(640, 360, 1)), clip('f', 'v2', 'V1', 30, 0, 6, T(640, 360, 1)), clip('g', 'v1', 'V1', 36, 0, 6, T(640, 360, 1))]); p.captions = subs }
  // (Intro, Outro and Black hole left with the hands in 1b.2: their baseline
  // frames are skipped by cmp.mjs, and a block of a kind the app no longer
  // has is not put in at all — the timeline has no lane label for it.)
  for (const b of BLOCKS.filter((x) => !['intro', 'outro', 'blackhole'].includes(x.kind))) {
    const p = base('tpl-' + b.kind, 1280, 720)
    twoClips(p)
    p.templates = [b]
    P.push({ p, times: [0.25, 0.6, 0.9].map((f) => +(b.start + b.duration * f).toFixed(3)) })
  }
  // 9. A dissolve from a portrait picture (bars at its sides) into a landscape
  // one (phase Ç2b.2, decision 2: a real mix): at the moments the mix is 10 %
  // and 50 % through (smoothstep 0.1 at 0.1958 of the window). Its side bars
  // showed the incoming picture at full strength before.
  {
    const p = base('ref-dissolve', 1280, 720)
    p.assets = [assets.img2, assets.img1]
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [
      clip('a', 'img2', 'V1', 0, 0, 3, T(640, 360, 720 / 1350), { transitionOut: { type: 'mix', duration: 1 } }),
      clip('b', 'img1', 'V1', 3, 0, 3, T(640, 360, 0.8))
    ])
    P.push({ p, times: [2.6958, 3.0] })
  }
  // 10. A compound clip holding a dissolve between two of its children
  // (phase Ç2b.2, decision 5): at the old cut, both are drawn (a hard cut
  // before).
  {
    const p = base('ref-compound', 1280, 720)
    p.assets = [assets.v1, assets.v2]
    const kids = [
      clip('ka', 'v1', 'V1', 0, 1, 3, T(640, 360, 1), { transitionOut: { type: 'mix', duration: 1, to: 'kb' } }),
      clip('kb', 'v2', 'V1', 3, 1, 3, T(640, 360, 1))
    ]
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [
      { id: 'k', assetId: '', nested: { clips: kids }, trackId: 'V1', start: 0, inPoint: 0, duration: 6, transform: T(640, 360, 1), volume: 1 }
    ])
    P.push({ p, times: [2.75, 3.0, 3.25] })
  }
  // 11. Phase 5b, decision 3: a transparent code clip over video, plain, with
  // a clip look, with the edge glow, and dissolving and sliding into another
  // cut of itself: the video shows through its transparent parts, untouched
  // by the effects (they painted it before).
  {
    const p = base('ref-alpha', 1280, 720)
    p.assets = [assets.v1, assets.film2]
    const look = { grain: 0.4, weave: 0, halation: 0.4, fade: 0.6, flicker: 0, dust: 0.3, mono: 0, vignette: 0.9, vShape: 'round', vMotion: 'still', vSpeed: 1, bars: 0.5, gate: 0 }
    put(p, { id: 'V2', kind: 'video', name: 'V2', clipIds: [] }, [
      clip('k0', 'film2', 'V2', 0, 0, 1, T(640, 360, 1)),
      clip('k1', 'film2', 'V2', 1, 1, 1, T(640, 360, 1), { look }),
      clip('k2', 'film2', 'V2', 2, 2, 1, T(640, 360, 1), { ambientFx: { style: 'edge-glow', amount: 1, seed: 3 } }),
      clip('k3', 'film2', 'V2', 3, 3, 1, T(640, 360, 1), { transitionOut: { type: 'mix', duration: 0.6, to: 'k4', align: 'center' } }),
      clip('k4', 'film2', 'V2', 4, 6, 1, T(640, 360, 1), { transitionOut: { type: 'slide', duration: 0.6, to: 'k5', align: 'center', direction: 'left' } }),
      clip('k5', 'film2', 'V2', 5, 8, 1, T(640, 360, 1))
    ])
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [clip('a', 'v1', 'V1', 0, 0, 6, T(640, 360, 1))])
    P.push({ p, times: [0.5, 1.5, 2.5, 4.0, 5.0] })
  }
  // 12. 5a/5b patch, item 5 (audit S-2): pictures opaque in themselves keep
  // the path they had before 5b, whatever the clip does to them: a masked
  // still with a clip look, the same with the edge glow, and a compound clip
  // (an opaque video filling it) with a look. Their frames equal those of the
  // build of a43f1f2 (FAZ5-PLAN.md, the patch's report).
  {
    const p = base('ref-oldpath', 1280, 720)
    p.assets = [assets.v1, assets.v2, assets.img1]
    const look = { grain: 0, weave: 0, halation: 0, fade: 0.6, flicker: 0, dust: 0, mono: 0, vignette: 0.9, vShape: 'round', vMotion: 'still', vSpeed: 1, bars: 0, gate: 0 }
    const mask = { enabled: true, shape: 'ellipse', mode: 'cut', feather: 0, cx: 0, cy: 0, w: 800, h: 450 }
    put(p, { id: 'V2', kind: 'video', name: 'V2', clipIds: [] }, [
      clip('m1', 'img1', 'V2', 0, 0, 1, T(640, 360, 0.6), { mask, look }),
      clip('m2', 'img1', 'V2', 1, 0, 1, T(640, 360, 0.6), { mask, ambientFx: { style: 'edge-glow', amount: 1, seed: 3 } }),
      { id: 'n1', assetId: '', nested: { clips: [clip('nk', 'v2', 'V1', 0, 0, 1, T(640, 360, 1))] }, trackId: 'V2', start: 2, inPoint: 0, duration: 1, transform: T(640, 360, 0.7), volume: 1, look },
      // (item 11: an opaque still's own light, and transition light between
      // opaque cuts that do not fill the frame, as before 5b.)
      clip('m3', 'img1', 'V2', 3, 0, 1, T(640, 360, 0.6), { stillImageFx: { style: 'window-light', amount: 0.8, seed: 2 } }),
      clip('f1', 'v2', 'V2', 4, 0, 1, T(640, 360, 0.6), { transitionOut: { type: 'flash', duration: 0.6, to: 'f2', align: 'center' } }),
      clip('f2', 'v2', 'V2', 5, 1, 1, T(640, 360, 0.6), { transitionOut: { type: 'light-leak', duration: 0.6, to: 'f3', align: 'center' } }),
      clip('f3', 'v2', 'V2', 6, 2, 1, T(640, 360, 0.6))
    ])
    put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [clip('a', 'v1', 'V1', 0, 0, 6, T(640, 360, 1)), clip('a2', 'v1', 'V1', 6, 0, 2, T(640, 360, 1))])
    P.push({ p, times: [0.5, 1.5, 2.5, 3.5, 5.0, 6.0] })
  }
  // 8. The sounds templates make on their own (and transitions between them).
  {
    const p = base('ref-sfx', 1280, 720)
    twoClips(p)
    p.clips.a.transitionOut = { type: 'whip', duration: 0.6, direction: 'left' }
    p.clips.c.transitionOut = { type: 'film-burn', duration: 0.8 }
    let at = 0.2
    p.templates = ['home', 'map', 'boxes', 'news', 'chess', 'chapter', 'words'].map((k, i) => { const b = structuredClone(BLOCKS.find((x) => x.kind === k)); b.id = 's' + i; b.start = at; at += b.duration + 0.3; return b })
    P.push({ wav: true, p, times: [1.0] })
  }
  // 13. Phase 5f: the six code templates (the app's own pages, read where they
  // are), each over a video at 1280 × 720; the counter again with a value of
  // its own (Asset.code.params) and the blank one under a project look. Last,
  // so nothing before them changes.
  {
    const TPL = ${JSON.stringify(join(HERE, '..', '..', '..', 'resources', 'kod-sablonlari'))}
    const LEN = { blank: 4, 'lower-third': 5, 'bar-chart': 6, counter: 4, arrow: 4, 'title-card': 4 }
    const tpl = async (id, n, extra = {}) => {
      const info = await window.api.codeFilm.register(TPL + '\\\\' + id)
      const a = (await imp.codeFilmImport(info)).assets.find((x) => x.kind === 'code')
      a.id = n
      a.width = 1280
      a.height = 720
      a.duration = LEN[id]
      a.code = { ...a.code, ...extra }
      return a
    }
    for (const [id, n, extra, look] of [['blank', 'tpl1'], ['lower-third', 'tpl2'], ['bar-chart', 'tpl3'], ['counter', 'tpl4'], ['arrow', 'tpl5'], ['title-card', 'tpl6'], ['counter', 'tpl7', { params: { to: 4321, suffix: ' km' } }], ['blank', 'tpl8', {}, { accent: '#00c8ff', font: 'Consolas' }]]) {
      const film = await tpl(id, n, extra)
      films.codeFilms.ensure(film)
      const p = base('code-' + n + '-' + id, 1280, 720, look ? { look } : {})
      p.assets = [assets.v1, film]
      put(p, { id: 'V2', kind: 'video', name: 'V2', clipIds: [] }, [clip('k', n, 'V2', 0, 0, LEN[id], T(640, 360, 1))])
      put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [clip('a', 'v1', 'V1', 0, 0, 6, T(640, 360, 1))])
      P.push({ p, times: [0.3, LEN[id] / 2, LEN[id] - 0.3].map((x) => +x.toFixed(2)) })
    }
  }

  // 14. "Cila" part D: the pixel pass (LUT at three strengths, the keyers,
  // vignette and grain, the colour dials, glow, halation, mosaic, colour
  // isolate, and several at once). One picture (fx.png) over a video, cut in
  // one-second clips, each with one thing switched on. Drawn twice: by the
  // shader ('fx-gpu') and by the CPU path ('fx-cpu': the GPU path refuses
  // for those frames). Last, so nothing before them changes.
  {
    const looks = [
      { lut: 'preset:tealOrange' },
      { lut: 'preset:tealOrange', lutAmount: 0.5 },
      { lut: 'preset:tealOrange', lutAmount: 0.25 },
      { lut: 'preset:monoContrast' },
      { chroma: { enabled: true, color: '#19c832', similarity: 0.4, smoothness: 0.1, method: 'chroma', spill: 0.8 } },
      { chroma: { enabled: true, color: '#19c832', similarity: 0.35, smoothness: 0.12 } },
      { vignette: 0.6, grain: 0.5 },
      { tone: { exposure: 0.7, tint: 0.3, highlights: -0.6, shadows: 0.5 } },
      { bloom: { amount: 0.8, threshold: 0.6, radius: 0.5 } },
      { halation: { amount: 0.8, size: 0.6 } },
      { mosaic: 24 },
      { isolate: { color: '#dc1e1e', range: 0.08, amount: 1 } },
      { lut: 'preset:warmFilm', lutAmount: 0.8, tone: { exposure: 0.3, tint: 0, highlights: -0.3, shadows: 0.2 }, bloom: { amount: 0.4, threshold: 0.7, radius: 0.4 }, vignette: 0.3, sharpen: 0.4 }
    ]
    for (const [name, cpu] of [['fx-gpu', false], ['fx-cpu', true]]) {
      const p = base(name, 1280, 720)
      p.assets = [assets.v1, assets.fx]
      put(p, { id: 'V2', kind: 'video', name: 'V2', clipIds: [] }, looks.map((look, i) => clip('x' + i, 'fx', 'V2', i, 0, 1, T(640, 360, 1), look)))
      put(p, { id: 'V1', kind: 'video', name: 'V1', clipIds: [] }, [clip('a', 'v1', 'V1', 0, 0, 6, T(640, 360, 1)), clip('a2', 'v1', 'V1', 6, 0, 6, T(640, 360, 1)), clip('a3', 'v1', 'V1', 12, 0, 2, T(640, 360, 1))])
      P.push({ p, cpu, times: looks.map((_, i) => i + 0.5) })
    }
  }

  const hex =async (u8) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', u8))].map((b) => b.toString(16).padStart(2, '0')).join('')
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
  const result = []
  const RENDER = await window.__render()
  for (const { p, times, drawer, shorts, wav, cpu } of P) {
    if (ONLY && !ONLY.test(p.name)) continue
    // These projects were written when a transition that said nothing about
    // its sound played it in full. Since project format 7 one that says
    // nothing is silent, and a file of that time gets sfx: 1 written in
    // when it is read (model/format.ts, "to: 7"). The projects here are
    // built in memory and never pass the file reader, so the same is written
    // here (nested clips too): the exported sound is the baseline's again
    // (22 Nov, K7: ref-edit and ref-sfx differed; the baseline is NOT rewritten).
    const oldSound = (list) => {
      for (const c of list) {
        if (c.nested?.clips) oldSound(c.nested.clips)
        if (c.transitionOut && c.transitionOut.sfx === undefined) c.transitionOut.sfx = 1
      }
    }
    oldSound(Object.values(p.clips))
    S.getState().loadProject(structuredClone(p))
    await new Promise((r) => setTimeout(r, 400))
    const proj = S.getState().project
    // (The pixel pass's CPU path, for the projects that ask for it.)
    RENDER.setPixelFxCpuOnly(!!cpu)
    try {
      for (const t of times) {
        const png = await ex.exportFramePng(proj, t, true, 'final')
        result.push({ project: p.name, path: 'exportFramePng', t, sha256: await hex(png), bytes: png.length, png: ${pngDir ? 'b64(png)' : 'null'} })
      }
    } finally {
      RENDER.setPixelFxCpuOnly(false)
    }
    if (wav) {
      const w = await ex.exportProjectMp4(proj, { onProgress() {}, settings: { container: 'wav' } })
      result.push({ project: p.name, path: 'wav', t: 0, sha256: await hex(w), bytes: w.length, png: null })
    }
    if (drawer) {
      await ex.preloadImagesForExport(proj)
      const d = ex.frameDrawer(proj, shorts ? { w: 1080, h: 1920, shorts: true } : { w: 1280, h: 720, shorts: false })
      try {
        for (const t of drawer) {
          await d.draw(t)
          const png = new Uint8Array(await (await d.canvas.convertToBlob({ type: 'image/png' })).arrayBuffer())
          result.push({ project: p.name, path: 'frameDrawer', t, sha256: await hex(png), bytes: png.length, png: ${pngDir ? 'b64(png)' : 'null'} })
        }
      } finally { d.close() }
    }
  }
  S.getState().setDirty(false)
  return result
})()`

const result = await c.ev(page)
for (const r of result) {
  if (pngDir && r.png) writeFileSync(join(pngDir, `${r.project}-${r.path}-${r.t.toFixed(2)}.png`), Buffer.from(r.png, 'base64'))
  delete r.png
}
writeFileSync(out, JSON.stringify(result, null, 1))
console.log(result.map((r) => `${r.project.padEnd(14)} ${r.path.padEnd(14)} t=${r.t.toFixed(2).padStart(5)} ${r.sha256.slice(0, 16)} ${r.bytes}`).join('\n'))
c.close()
