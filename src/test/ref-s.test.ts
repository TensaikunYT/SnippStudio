// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// REF-AB, worker S (REF-AB-PLAN-S.md): the voice-over's WAV, meter and
// script; the one permission the app grants (the microphone) and every way
// of being refused it; the take placed as one undo step on a new audio
// track; the subtitles' source (all, a track, a clip) and its warnings; the
// style grid's looks.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useStore } from '../renderer/src/state/store'
import { defaultCaptionStyle, defaultProject, type Asset, type Clip, type Project } from '../renderer/src/types'
import { countdownOf, meterFraction, meterZone, peakOf, scriptWith, takeClock, toInt16, wavOfChunks } from '../renderer/src/audio/voiceover'
import { noteScript } from '../renderer/src/audio/voiceover-note'
import { ARM_MS, fileStamp, isVoiceoverWav, micCheckAllowed, micRequestAllowed, type MicRequest } from '../main/voiceover-permission'
import { MAIN_STRINGS } from '../main/strings-main'
import { ALL_SOUND, isCaptionSource, liveSource, sourceChoices, sourceProject, sourceWarnings } from '../renderer/src/subtitles/source'
import { CAPTION_ONLY_LOOKS, gridLooks, LOOK_FIELDS, lookPatch, styleWithLook, wearsLook } from '../renderer/src/subtitles/caption-looks'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_REF_S } from '../renderer/src/ui/strings-ref-s'

const SRC = join(__dirname, '..', '..', 'src')
const code = (f: string): string => readFileSync(join(SRC, f), 'utf8')

// ---- the WAV and the meter -------------------------------------------------------------
test('a take is a 16-bit mono PCM WAV of its chunks, in order, clipped', () => {
  const a = toInt16(new Float32Array([0, 1, -1, 2, -2, 0.5]))
  assert.deepEqual([...a], [0, 32767, -32768, 32767, -32768, 16384])
  const wav = wavOfChunks([a, toInt16(new Float32Array([0.25]))], 48000)
  assert.equal(wav.byteLength, 44 + 7 * 2)
  const dv = new DataView(wav.buffer)
  assert.equal(String.fromCharCode(...wav.subarray(0, 4)), 'RIFF')
  assert.equal(dv.getUint32(4, true), 36 + 14)
  assert.equal(dv.getUint16(22, true), 1, 'mono')
  assert.equal(dv.getUint32(24, true), 48000)
  assert.equal(dv.getUint16(34, true), 16)
  assert.equal(dv.getUint32(40, true), 14)
  assert.equal(dv.getInt16(44 + 2, true), 32767)
  assert.equal(dv.getInt16(44 + 12, true), 8192, 'the second chunk follows')
  assert.equal(isVoiceoverWav(wav), true, 'main takes it')
})

test('main takes only the WAV the page makes', () => {
  const good = wavOfChunks([toInt16(new Float32Array(8))], 48000)
  const bad = (f: (b: Uint8Array) => void): Uint8Array => {
    const b = good.slice()
    f(b)
    return b
  }
  assert.equal(isVoiceoverWav(new Uint8Array(10)), false, 'too short')
  assert.equal(isVoiceoverWav(bad((b) => b.set([0x4d, 0x5a], 0))), false, 'not RIFF (an .exe)')
  assert.equal(isVoiceoverWav(bad((b) => new DataView(b.buffer).setUint16(22, 2, true))), false, 'stereo')
  assert.equal(isVoiceoverWav(bad((b) => new DataView(b.buffer).setUint32(40, 999, true))), false, 'a data size that lies')
  assert.equal(isVoiceoverWav(good.subarray(0, good.byteLength - 2)), false, 'cut short')
})

test('the meter: -60 dB at the left, 0 dB at the right; red near clipping', () => {
  assert.equal(meterFraction(0), 0)
  assert.equal(meterFraction(1), 1)
  assert.ok(Math.abs(meterFraction(0.1) - 2 / 3) < 1e-9, '-20 dB is two thirds')
  assert.equal(meterFraction(0.0001), 0)
  assert.ok(Math.abs(peakOf(new Float32Array([0.1, -0.7, 0.3])) - 0.7) < 1e-6)
  assert.equal(meterZone(0.001), 'low')
  assert.equal(meterZone(0.3), 'ok')
  assert.equal(meterZone(0.9), 'hot')
})

test('countdown, clock, the script and a note into it', () => {
  assert.equal(countdownOf(5), 5)
  assert.equal(countdownOf('0'), 0)
  assert.equal(countdownOf(7), 3)
  assert.equal(countdownOf(undefined), 3)
  assert.equal(takeClock(75.9), '1:15')
  assert.equal(scriptWith('old', ' new ', 'replace'), 'new')
  assert.equal(scriptWith('old\n\n', 'new', 'append'), 'old\n\nnew')
  assert.equal(scriptWith('  ', 'new', 'append'), 'new')
  assert.equal(noteScript({ text: 'write the voiceover', reply: ' Here it is. ' }), 'Here it is.', 'the agent\'s reply first')
  assert.equal(noteScript({ text: 'An agent note', reply: undefined }), 'An agent note')
  assert.equal(noteScript({ text: '', reply: '' }), '')
})

// ---- the one permission ---------------------------------------------------------------------
const ask = (o: Partial<MicRequest> = {}): MicRequest => ({ permission: 'media', mediaTypes: ['audio'], isMainFrame: true, ownPage: true, editor: true, armedAt: 1000, now: 1500, ...o })

test('the microphone: only sound, only the editor\'s own page in its top frame, only right after Record', () => {
  assert.equal(micRequestAllowed(ask()), true)
  const refused: [string, Partial<MicRequest>][] = [
    ['the camera', { mediaTypes: ['video'] }],
    ['the camera with the microphone', { mediaTypes: ['audio', 'video'] }],
    ['unknown media', { mediaTypes: [] }],
    ['no media types', { mediaTypes: undefined }],
    ['the screen', { permission: 'display-capture' }],
    ['notifications', { permission: 'notifications' }],
    ['a code clip\'s frame', { isMainFrame: false }],
    ['another page', { ownPage: false }],
    ['another window (the clip drawing window)', { editor: false }],
    ['not armed', { armedAt: undefined }],
    ['armed too long ago', { now: 1000 + ARM_MS + 1 }],
    ['armed in the future (a clock that jumped)', { now: 500 }]
  ]
  for (const [why, o] of refused) assert.equal(micRequestAllowed(ask(o)), false, why)
})

test('the permission check: the microphone of a window given it, or armed, and nothing else', () => {
  const c = { permission: 'media', mediaType: 'audio', isMainFrame: true, ownPage: true, editor: true, granted: true }
  assert.equal(micCheckAllowed(c), true)
  assert.equal(micCheckAllowed({ ...c, granted: false }), false)
  assert.equal(micCheckAllowed({ ...c, granted: false, armed: true }), true)
  assert.equal(micCheckAllowed({ ...c, mediaType: 'video' }), false)
  assert.equal(micCheckAllowed({ ...c, mediaType: 'unknown' }), false)
  assert.equal(micCheckAllowed({ ...c, permission: 'clipboard-read' }), false)
  assert.equal(micCheckAllowed({ ...c, isMainFrame: false }), false)
  assert.equal(micCheckAllowed({ ...c, ownPage: false }), false)
  assert.equal(micCheckAllowed({ ...c, editor: false }), false)
})

test('the session\'s handlers go through the voice-over\'s rules; the page never names a path', () => {
  const index = code('main/index.ts')
  assert.match(index, /guardPermissions\(ses\)/)
  assert.equal(/setPermissionRequestHandler|setPermissionCheckHandler/.test(index), false, 'one place decides (voiceover.ts)')
  const main = code('main/voiceover.ts')
  assert.match(main, /setDevicePermissionHandler\(\(\) => false\)/)
  assert.match(main, /ipcMain\.handle\('voiceover:write', async \(event, data: unknown\)/, 'the bytes only')
  assert.match(main, /currentProjectPath/, 'the folder from the window\'s own project')
  assert.match(main, /realpath/, 'a junction cannot lead out')
  const preload = code('preload/index.ts')
  assert.match(preload, /write: \(data: Uint8Array\)/)
  // Only the e2e may use Chromium's fake devices; nothing in the app turns them on.
  for (const f of ['main/index.ts', 'main/voiceover.ts']) assert.equal(/use-fake-(ui|device)/.test(code(f)), false, f)
})

test('a take\'s file name: a date with no colon, both languages', () => {
  assert.equal(fileStamp(new Date(2026, 10, 21, 9, 5, 7)), '2026-11-21 09.05.07')
  for (const k of ['voiceover.folder', 'voiceover.profileFolder', 'voiceover.file'] as const) assert.ok(MAIN_STRINGS[k].en && MAIN_STRINGS[k].tr, k)
})

// ---- the take on the timeline -----------------------------------------------------------------
const S = useStore.getState

test('a take goes on a new audio track at its start, import and all one undo step', () => {
  S().loadProject(defaultProject())
  const before = S().project
  const tracks = before.tracks.length
  const past = S().past.length
  const take = { id: 'vo1', kind: 'audio', name: 'Voiceover 2026-11-21 10.00.00.wav', url: 'media://vo', path: 'C:\\p\\Voiceover\\v.wav', size: 100, duration: 4.5, hasAudio: true } as Asset
  const r = S().addClipsAt([take.id], null, 2.25, { assets: [take], newTrack: 'audio' })
  const p = S().project
  assert.equal(p.tracks.length, tracks + 1, 'a new track')
  const track = p.tracks.at(-1)!
  assert.equal(track.kind, 'audio')
  assert.deepEqual(track.clipIds, r.clipIds)
  const clip = p.clips[r.clipIds[0]]
  assert.equal(clip.start, 2.25)
  assert.equal(clip.duration, 4.5)
  assert.ok(p.assets.some((a) => a.id === 'vo1'), 'imported')
  assert.equal(S().past.length, past + 1, 'one undo step')
  S().undo()
  assert.equal(S().project.tracks.length, tracks)
  assert.equal(S().project.assets.some((a) => a.id === 'vo1'), false, 'the undo takes the import too')
})

// ---- the subtitles' source -----------------------------------------------------------------------
const asset = (id: string, kind: 'audio' | 'video', hasAudio = true): Asset => ({ id, kind, name: `${id}.${kind === 'audio' ? 'wav' : 'mp4'}`, url: `media://${id}`, size: 1, duration: 30, hasAudio }) as Asset
const clip = (id: string, assetId: string, trackId: string, start: number, duration: number, extra: Partial<Clip> = {}): Clip =>
  ({ id, assetId, trackId, start, inPoint: 0, duration, volume: 1, transform: { x: 960, y: 540, scale: 1, rotation: 0 }, ...extra }) as Clip

function film(): Project {
  const p = defaultProject()
  const v = p.tracks.find((t) => t.kind === 'video')!
  const a = p.tracks.find((t) => t.kind === 'audio')!
  const a2 = { id: 'A2', kind: 'audio' as const, name: 'A2', clipIds: ['m1'] }
  p.tracks.push(a2)
  p.assets = [asset('cam', 'video'), asset('voice', 'audio'), asset('music', 'audio')]
  p.clips = {
    c1: clip('c1', 'cam', v.id, 0, 10),
    n1: clip('n1', 'voice', a.id, 2, 5),
    n2: clip('n2', 'voice', a.id, 9, 3),
    m1: clip('m1', 'music', 'A2', 0, 20)
  }
  v.clipIds = ['c1']
  a.clipIds = ['n1', 'n2']
  return p
}

test('the source choices: all, each track with sound, each clip with sound', () => {
  const p = film()
  const values = sourceChoices(p).map((c) => c.value)
  const a1 = p.tracks.find((t) => t.kind === 'audio')!.id
  const v1 = p.tracks.find((t) => t.kind === 'video')!.id
  assert.deepEqual(values, ['all', `track:${v1}`, `track:${a1}`, 'track:A2', 'clip:c1', 'clip:n1', 'clip:n2', 'clip:m1'])
  p.assets[0].hasAudio = false
  assert.equal(sourceChoices(p).some((c) => c.value === `track:${v1}`), false, 'a silent video is no source')
  assert.equal(isCaptionSource({ kind: 'track', trackId: 'x' }), true)
  assert.equal(isCaptionSource({ type: 'click' }), false, 'a click event is not a source')
})

test('from a track: only it is heard, over its own stretch; from a clip: only that clip', () => {
  const p = film()
  p.tracks.find((t) => t.id === 'A2')!.solo = true
  const a1 = p.tracks.find((t) => t.kind === 'audio')!.id
  const fromTrack = sourceProject(p, { kind: 'track', trackId: a1 })
  assert.deepEqual(fromTrack.span, [2, 12])
  for (const t of fromTrack.project.tracks) {
    assert.equal(!!t.muted, t.id !== a1, `${t.name} muted unless chosen`)
    assert.equal(t.solo, undefined, 'solo taken off')
  }
  assert.equal(p.tracks.find((t) => t.id === 'A2')!.solo, true, 'the project itself untouched')
  const fromClip = sourceProject(p, { kind: 'clip', clipId: 'n2' })
  assert.deepEqual(fromClip.span, [9, 12])
  assert.equal(fromClip.project.clips.n1.muted, true, 'the track\'s other clip silent')
  assert.equal(!!fromClip.project.clips.n2.muted, false)
  assert.equal(p.clips.n1.muted, undefined, 'the project itself untouched')
  assert.equal(sourceProject(p, ALL_SOUND).project, p, 'all the sound: the project as it is')
  // A deleted choice falls back to all.
  assert.deepEqual(liveSource(p, { kind: 'clip', clipId: 'gone' }), ALL_SOUND)
  assert.deepEqual(liveSource(p, { kind: 'track', trackId: 'gone' }), ALL_SOUND)
})

test('the warnings: muted, soloed out, hidden; silence blocks the run', () => {
  const p = film()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  const v1 = p.tracks.find((t) => t.kind === 'video')!
  assert.deepEqual(sourceWarnings(p, ALL_SOUND), { muted: [], soloedOut: [], hidden: [], silent: false })
  a1.muted = true
  v1.hidden = true
  let w = sourceWarnings(p, ALL_SOUND)
  assert.deepEqual(w.muted, [a1.name])
  assert.deepEqual(w.hidden, [v1.name], 'a hidden track\'s sound is still heard: said')
  assert.equal(w.silent, false)
  assert.equal(sourceWarnings(p, { kind: 'track', trackId: a1.id }).silent, true, 'a muted track chosen: nothing to hear')
  assert.equal(sourceWarnings(p, { kind: 'clip', clipId: 'n1' }).silent, true)
  p.tracks.find((t) => t.id === 'A2')!.solo = true
  w = sourceWarnings(p, ALL_SOUND)
  assert.deepEqual(w.soloedOut, [v1.name])
  for (const t of p.tracks) t.muted = true
  assert.equal(sourceWarnings(p, ALL_SOUND).silent, true, 'all muted')
  p.tracks.forEach((t) => (t.muted = false))
  p.clips.n1 = { ...p.clips.n1, muted: true }
  assert.equal(sourceWarnings(p, { kind: 'clip', clipId: 'n1' }).silent, true, 'a muted clip chosen')
})

test('the run: the source reaches the speech model; the agent\'s job stays all the sound', () => {
  const run = code('renderer/src/subtitles/run.ts')
  assert.match(run, /sourceProject\(s\.project, run\.source\)/)
  assert.match(run, /transcribeProjectRange\(heard\.project/)
  assert.match(code('renderer/src/App.tsx'), /source: isCaptionSource\(source\) \? source : undefined/)
  assert.equal(/source/.test(code('renderer/src/agent/transcribe-job.ts')), false)
})

// ---- the style grid --------------------------------------------------------------------------------
test('a look sets the look fields only, from the default; the tile shows what a click gives', () => {
  const style = { ...defaultCaptionStyle(), uppercase: true, boil: { enabled: true, amount: 1, fps: 10 }, fontSize: 90, posY: 0.7, maxLineChars: 22, wordsPerCue: 3 }
  const sticker = { fontFamily: 'Archivo Black', color: '#ffffff', outlineWidth: 9 }
  const after = styleWithLook(style, sticker)
  assert.equal(after.fontFamily, 'Archivo Black')
  assert.equal(after.uppercase, false, 'the capitals of the look before are gone')
  assert.equal(after.boil, undefined, 'and its boiling')
  assert.equal(after.fontSize, 90, 'the size stays')
  assert.equal(after.posY, 0.7, 'the place stays')
  assert.equal(after.maxLineChars, 22)
  assert.equal(after.wordsPerCue, 3)
  assert.equal(wearsLook(after, sticker), true)
  assert.equal(wearsLook(after, {}), false)
  assert.equal(wearsLook(defaultCaptionStyle(), {}), true, 'a new project wears Plain')
  for (const k of Object.keys(lookPatch({}))) assert.ok((LOOK_FIELDS as readonly string[]).includes(k), k)
})

test('the grid: Plain, the built-in looks, the subtitles\' own, the saved; one tile a name', () => {
  const built: [string, object][] = [['insp.presets.sticker', { color: '#fff' }], ['insp.presets.label', {}]]
  const g = gridLooks(built, { Mine: { color: '#f00' }, 'Mine ': {} })
  assert.deepEqual(g.slice(0, 3).map((x) => x.id), ['plain', 'sticker', 'label'])
  assert.equal(g.length, 3 + CAPTION_ONLY_LOOKS.length + 2)
  assert.ok(g.at(-1)!.saved)
  // A second list with a name already there (two workers' lists merged).
  const twice = gridLooks([...built, ['other.presets.sticker', {}]], {})
  assert.equal(twice.filter((x) => x.id === 'sticker').length, 1)
  for (const [id] of CAPTION_ONLY_LOOKS) {
    const s = (STRINGS as Record<string, { en: string; tr?: string }>)[`caps.look.${id}`]
    assert.ok(s?.en && s.tr, id)
  }
  // Fonts the program carries (fonts.ts), every platform the same.
  const fonts = code('renderer/src/fonts.ts')
  for (const [, look] of CAPTION_ONLY_LOOKS) if (look.fontFamily) assert.ok(fonts.includes(`['${look.fontFamily}'`), look.fontFamily)
})

test('the words: every key in both languages, the same parameters', () => {
  for (const [k, v] of Object.entries(STRINGS_REF_S)) {
    const e = v as { en: string; tr?: string }
    assert.ok(e.tr, `${k} in Turkish`)
    const ps = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(ps(e.tr!), ps(e.en), k)
  }
})
