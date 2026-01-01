// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The phase 9 audit patch, worker D (tarifler\FAZ9-YAMA.md "İşçi D";
// haritalar\_faz9-denetim-dil.md D1–D16): the agent's language, the words the
// Turkish interface still showed in English, numbers, the guides.
import './dom-stub'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { defaultProject, type Project } from '../renderer/src/types'
import { spokenLanguage } from '../renderer/src/subtitles/models'
import { projectText } from '../renderer/src/agent/format'
import { agentTools } from '../renderer/src/agent/tools'

const ROOT = join(__dirname, '..', '..')
const read = (f: string): string => readFileSync(join(ROOT, f), 'utf8')
const info = { version: 'a1b2c-1', state: 'live' as const }

// ---- D1: the agent's language ----------------------------------------------------
test('D1: the project answer says the spoken language; "auto" in the job tool is said to be it', () => {
  const said = (p: Project): string | undefined => /^Spoken language: (.+)$/m.exec(projectText(p, info))?.[1]
  // A new project in the Turkish interface is Turkish; in the English one English.
  assert.equal(said(defaultProject('16:9', 'tr')), 'tr')
  assert.equal(spokenLanguage(defaultProject('16:9', 'tr').transcription), 'turkish')
  assert.equal(said(defaultProject('16:9', 'en')), 'en')
  // Existing projects keep what they meant: none, "auto" of the English-only
  // model (English), "auto" of the multilingual one (Turkish), a chosen one.
  const p = defaultProject()
  assert.deepEqual(p.transcription, { model: 'english', language: 'auto' }, 'the defaults a loaded file is filled from are unchanged')
  assert.equal(said({ ...p, transcription: undefined }), 'en')
  assert.equal(said({ ...p, transcription: { model: 'multilingual', language: 'auto' } }), 'tr')
  assert.equal(said({ ...p, transcription: { model: 'english', language: 'german' } }), 'german')
  const job = agentTools().find((t) => t.name === 'job')!.description
  assert.match(job, /language auto = the project's spoken language, tr, en/)
  assert.doesNotMatch(job, /language auto, tr, en/)
})

test('D1: the store makes a new project in the interface language; the job answer names the language it wrote', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  const s = useStore.getState()
  const before = s.uiLang
  try {
    s.setUiLang('tr')
    useStore.getState().newProject('16:9')
    assert.equal(spokenLanguage(useStore.getState().project.transcription), 'turkish')
    useStore.getState().setUiLang('en')
    useStore.getState().newProject('9:16')
    assert.equal(spokenLanguage(useStore.getState().project.transcription), 'english')
    // Changeable: the Subtitles tab's choice wins.
    useStore.getState().setTranscription({ language: 'turkish' })
    assert.equal(spokenLanguage(useStore.getState().project.transcription), 'turkish')
  } finally {
    useStore.getState().setUiLang(before)
  }
  assert.match(read('src/renderer/src/agent/transcribe-job.ts'), /subtitle lines \(\$\{spoken\}\)/)
})

// ---- D4: the effect lists and the blend modes ----------------------------------
test('D4: the effect lists and the blend modes are shown in the interface language; English is the list itself', async () => {
  const { VIDEO_FX, STILL_IMAGE_FX, AMBIENT_FX, BLEND_MODES } = await import('../renderer/src/types')
  const { videoFxName, stillFxName, ambientFxName, blendName } = await import('../renderer/src/ui/data-names')
  const { setLang } = await import('../renderer/src/ui/strings')
  const lists: [string, string, (id: string) => string][] = [
    ...VIDEO_FX.map(([id, en]) => [id, en, videoFxName] as [string, string, (id: string) => string]),
    ...STILL_IMAGE_FX.map(([id, en]) => [id, en, stillFxName] as [string, string, (id: string) => string]),
    ...AMBIENT_FX.map(([id, en]) => [id, en, ambientFxName] as [string, string, (id: string) => string])
  ]
  try {
    for (const [id, en, name] of lists) {
      setLang('en')
      assert.equal(name(id), en, id)
      setLang('tr')
      assert.ok(name(id) && name(id) !== en && !/^data\./.test(name(id)), `${id}: ${name(id)}`)
    }
    for (const m of BLEND_MODES) {
      setLang('en')
      assert.ok(!/^data\./.test(blendName(m)) && blendName(m) !== m, `${m}: a word, not the CSS name`)
      setLang('tr')
      if (m !== 'normal') assert.notEqual(blendName(m).toLowerCase(), m, m)
    }
  } finally {
    setLang('en')
  }
  const look = read('src/renderer/src/components/inspector/clip-look.tsx') + read('src/renderer/src/components/inspector/fx-tab.tsx')
  assert.doesNotMatch(look, /_FX\.map\(\(\[id, label\]\)/, 'no list shows its English label')
  assert.match(look, /BLEND_MODES\.map\(\(m\) => \(\{ value: m, label: blendName\(m\) \}\)\)/)
})
// ---- D5: the guide's Inspector ----------------------------------------------------
test('D5: the guides tell the Inspector as the app has it: every bold name in it is a word of the app; colour, LUT and mask are on the Clip tab', async () => {
  const { STRINGS } = await import('../renderer/src/ui/strings')
  const all = Object.values(STRINGS as Record<string, { en: string; tr?: string }>)
  for (const [file, lang, head] of [['docs/guide.md', 'en', '### The Inspector (right)'], ['docs/kullanim.md', 'tr', '### Inspector (sağda)']] as const) {
    const doc = read(file)
    const block = doc.slice(doc.indexOf(head), doc.indexOf('\n### ', doc.indexOf(head) + 4))
    const words = new Set(all.map((e) => (lang === 'tr' ? e.tr ?? e.en : e.en).trim()))
    const bold = [...block.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => m[1]).filter((w) => !/^(Alt|Ctrl|Shift)\+/.test(w))
    assert.ok(bold.length >= 15, `${file}: ${bold.length}`)
    for (const w of bold) assert.ok(words.has(w), `${file}: "${w}" is not a word of the app`)
    const look = block.split('\n').find((l) => l.startsWith(lang === 'tr' ? '- **Görünüm**' : '- **Look**'))!
    assert.doesNotMatch(look, lang === 'tr' ? /LUT|maske|Renk\b/i : /LUT|mask|colou?r/i, `${file}: the Look tab has no colour, LUT or mask`)
    const clip = block.split('\n').find((l) => l.startsWith(lang === 'tr' ? '- **Klip**' : '- **Clip**'))!
    assert.match(clip, /LUT/)
  }
})
// ---- D6: what a drag snapped to ---------------------------------------------------
test('D6: the snap label is in the interface language; English is the target\'s own label', async () => {
  const { findDragSnap } = await import('../renderer/src/timeline/snapping')
  const { snapTargetName } = await import('../renderer/src/timeline/snap-name')
  const { setLang } = await import('../renderer/src/ui/strings')
  const p = defaultProject()
  const v1 = p.tracks.find((k) => k.kind === 'video')!
  p.assets.push({ id: 'a', kind: 'video', name: 'a.mp4', url: '', path: 'a.mp4', size: 1, duration: 10, width: 10, height: 10, hasAudio: false })
  p.clips.c1 = { id: 'c1', assetId: 'a', trackId: v1.id, start: 2, duration: 4, inPoint: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 } as never
  v1.clipIds.push('c1')
  p.captions.push({ id: 's1', start: 20, end: 22, text: 'hi' } as never)
  p.markers = [{ id: 'm', time: 30 } as never]
  // Each target found the way a drag finds it: a clip 1 s long dropped near it.
  const at = (t: number, playhead = 99): ReturnType<typeof findDragSnap> => findDragSnap(p, t, 1, 100, 'other', new Set(), playhead)
  const found = [at(0.02), at(2.02), at(6.02), at(20.02), at(22.02), at(30.02), at(50.02, 50)].map((r) => r!.target)
  assert.deepEqual(found.map((x) => x.label), ['Timeline start', 'Video · V1 start', 'Video · V1 end', 'Subtitle start', 'Subtitle end', 'Marker', 'Playhead'])
  try {
    for (const x of found) {
      setLang('en')
      assert.equal(snapTargetName(x), x.label)
      setLang('tr')
      const tr = snapTargetName(x)
      assert.doesNotMatch(tr, /\b(start|end|Timeline|Playhead|Marker|Subtitle)\b/, tr)
    }
    assert.equal(snapTargetName(found[6]), 'Oynatma çizgisi')
    assert.equal(snapTargetName(found[2]), 'Video · V1 sonu')
  } finally {
    setLang('en')
  }
  assert.doesNotMatch(read('src/renderer/src/components/timeline/overlays.tsx'), /activeSnapTarget\.label|snapGuide\.toFixed/)
})
// ---- D11: numbers -------------------------------------------------------------------
test('D11: a number or time passed to t() takes the Turkish comma; percents are %60 in Turkish; sliders read both', async () => {
  const { t, setLang } = await import('../renderer/src/ui/strings')
  const { fmtPct, withUnit } = await import('../renderer/src/ui/format')
  const { sliderNumberFormat } = await import('../renderer/src/ui/slider-value')
  try {
    setLang('tr')
    // The snap tooltip, the archive's size, a cut's length: toFixed() at the call site.
    assert.equal(t('timeline.snap.at', { time: (8).toFixed(2) }), '8,00 sn anına yapıştı')
    assert.equal(t('timeline.snap.at', { time: 2.5 }), '2,5 sn anına yapıştı')
    assert.equal(t('timeline.snap.with', { what: 'v1.0.81', time: '0:12.4' }), 'v1.0.81 ile hizalı, 0:12,4 sn', 'a name keeps its points; a time takes the comma')
    assert.equal(fmtPct(0.6), '%60')
    assert.equal(withUnit('25', '%'), '%25')
    const pct = (v: number): string => fmtPct(v)
    assert.deepEqual(sliderNumberFormat(1, 0.05, pct), { scale: 100, suffix: '%', step: 5, digits: 2 })
    setLang('en')
    assert.equal(t('timeline.snap.at', { time: (8).toFixed(2) }), 'Snapped to 8.00 s')
    assert.equal(fmtPct(0.6), '60%')
    assert.deepEqual(sliderNumberFormat(1, 0.05, pct), { scale: 100, suffix: '%', step: 5, digits: 2 })
  } finally {
    setLang('en')
  }
  // No "N%" written by hand where the interface shows it.
  for (const f of ['components/inspector/clip-look.tsx', 'components/inspector/fx-tab.tsx', 'components/TemplateInspector.tsx', 'components/PreviewToolbar.tsx', 'components/CleanVoice.tsx']) {
    assert.doesNotMatch(read('src/renderer/src/' + f), /\$\{Math\.round\([^}]*\* 100\)\}%|\{Math\.round\([^}]*\* 100\)\}%/, f)
  }
})
// ---- D12 / D10: the other English left in the Turkish interface ----------------------
test('D12: look presets, palettes, a clip\'s kind and the 97 language names in Turkish; English is the module\'s own word', async () => {
  const { LOOK_PRESETS } = await import('../renderer/src/effects/look')
  const { TEMPLATE_PALETTES, KIND_PALETTES, palettesFor } = await import('../renderer/src/templates/info')
  const { lookPresetName, lookPresetHint, lookShown, paletteName } = await import('../renderer/src/ui/data-names')
  const { spokenLanguageName, languageCode } = await import('../renderer/src/ui/language-names')
  const { WHISPER_SPOKEN_LANGUAGES } = await import('../renderer/src/subtitles/models')
  const { setLang } = await import('../renderer/src/ui/strings')
  const pals = [...TEMPLATE_PALETTES, ...Object.values(KIND_PALETTES).flat(), ...palettesFor('stat'), ...palettesFor('boxes')].map((p) => p!.name)
  try {
    setLang('en')
    for (const p of LOOK_PRESETS) {
      assert.equal(lookPresetName(p.id), p.label)
      assert.equal(lookPresetHint(p.id), p.hint)
    }
    for (const n of pals) assert.equal(paletteName(n), n)
    assert.equal(spokenLanguageName('haitian creole'), 'Haitian creole')
    setLang('tr')
    assert.equal(lookShown('Noir', LOOK_PRESETS), 'Kara film')
    assert.equal(lookShown('Custom', LOOK_PRESETS), 'Özel')
    for (const n of new Set(pals)) assert.notEqual(paletteName(n), n, n)
    for (const l of WHISPER_SPOKEN_LANGUAGES) {
      assert.ok(languageCode(l), `${l}: an ISO code`)
      assert.match(spokenLanguageName(l), /^\p{Lu}/u, l)
    }
    assert.equal(spokenLanguageName('german'), 'Almanca')
    assert.equal(spokenLanguageName('japanese'), 'Japonca')
  } finally {
    setLang('en')
  }
  assert.doesNotMatch(read('src/renderer/src/components/inspector/clip-tab.tsx'), /\(\$\{asset\.kind\}\)/)
})

test('D10: the sample project writes its stat template and the clips\' time in the interface language', () => {
  const src = read('src/renderer/src/media/sample-project.ts')
  assert.match(src, /stat\.items\[0\]\.title = t\('sample\.stat\.people'\)/)
  assert.match(src, /g\.fillText\(fmtSec\(s\)/)
  assert.doesNotMatch(src, /toFixed\(2\)\} s`/)
})
test('D12: the template Inspector names its fields with t() (the sample\'s "Label", "Unit", "Number", "Chip" were English)', () => {
  const src = read('src/renderer/src/components/TemplateInspector.tsx')
  const block = src.slice(src.indexOf('const HEADLINE'), src.indexOf('function ImagePicker('))
  assert.doesNotMatch(block, /(title|note|value|value2|image): '[A-Za-z]/, 'no English field name written out')
  assert.doesNotMatch(block, /: '[A-Z][a-z]+[^']*',?\n/, 'the headline and items maps hold keys')
  assert.doesNotMatch(src, /note: '(The walls of Troy|The Library of Celsus|Fairy chimneys|9600 BC)'/)
  assert.match(src, /SCREEN_HEADLINE: Record<TerminalDesign, StringKey>/)
})