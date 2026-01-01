// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The interface audit patch, worker B (tarifler\YAMA-ARAYUZ.md "İşçi B"): the
// shell, the language, the windows, number and time formats, the building
// blocks. Each item's rule as a plain function or a fact of the source; the
// app itself is driven by scripts/e2e/scenarios/99-yama-ui-b.mjs.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { defaultProject, type Caption, type Clip, type Project } from '../renderer/src/types'

Object.defineProperty(globalThis, 'document', {
  configurable: true,
  value: { createElement: () => ({ width: 0, height: 0, getContext: () => null }) }
})
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
})

const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const read = (f: string): string => readFileSync(join(SRC, f), 'utf8')

const strings = async () => import('../renderer/src/ui/strings')
const format = async () => import('../renderer/src/ui/format')

// ---- E1: the language ----------------------------------------------------------
test('E1: File → Language offers English and Türkçe, kept in the store; App draws again on a change', async () => {
  const { langOf } = await strings()
  // A fresh profile: nothing stored, English (phase 9b, decision 1).
  assert.equal(langOf(null), 'en')
  const top = read('components/TopBar.tsx')
  assert.match(top, /LANGS\.map\(/)
  assert.match(top, /testid: `menu\.file\.lang-\$\{l\}`/)
  assert.match(top, /onSelect: \(\) => setUiLang\(l\)/)
  assert.match(top, /checked: uiLang === l/)
  // App's own words follow the language at once.
  assert.match(read('App.tsx'), /export function App\(\): JSX\.Element \{[\s\S]{0,200}useT\(\)/)
  // No choice from the system's language anywhere.
  assert.equal(/navigator\.language/.test(read('state/store.ts')), false)
})

// ---- E2: Space on a control the keyboard reached ----------------------------------
test('E2: Space works a button, tab, switch or check box the keyboard reached; plays elsewhere and after a click', async () => {
  const { spaceWorksControl } = await import('../renderer/src/shortcuts')
  const el = (tagName: string, role: string | null = null, type?: string) => ({ tagName, type, getAttribute: (n: string) => (n === 'role' ? role : null) })
  for (const [x, why] of [
    [el('BUTTON'), 'a button'],
    [el('BUTTON', 'tab'), 'a tab'],
    [el('BUTTON', 'switch'), 'a switch'],
    [el('BUTTON', 'radio'), 'a segment'],
    [el('INPUT', null, 'checkbox'), 'a check box'],
    [el('BUTTON', 'menuitemcheckbox'), 'a menu row']
  ] as const) {
    assert.equal(spaceWorksControl(x, true), true, why + ' reached by the keyboard')
    assert.equal(spaceWorksControl(x, false), false, why + ' a click left focused: Space plays')
  }
  assert.equal(spaceWorksControl(el('DIV', 'separator'), true), false, 'the splitter: plays')
  assert.equal(spaceWorksControl(el('DIV'), true), false, 'a clip, the preview: plays')
  assert.equal(spaceWorksControl(el('INPUT', null, 'range'), true), false, 'a slider: plays')
  assert.equal(spaceWorksControl(null, true), false)
  const app = read('App.tsx')
  assert.match(app, /binding === 'space' && spaceWorksControl\(target, focusCameByKeyboard\(\)\)\) return/)
})

test('E2: how the focus came is told by the last input before it (focus-origin)', async () => {
  const { installFocusOrigin, focusCameByKeyboard } = await import('../renderer/src/ui/focus-origin')
  const handlers: Record<string, ((e: unknown) => void)[]> = {}
  const win = { addEventListener: (k: string, fn: (e: unknown) => void) => (handlers[k] ??= []).push(fn), removeEventListener: () => {} } as unknown as Window
  const off = installFocusOrigin(win)
  const fire = (k: string, e: unknown = {}): void => handlers[k].forEach((fn) => fn(e))
  fire('keydown', { key: 'Tab' })
  fire('focusin')
  assert.equal(focusCameByKeyboard(), true, 'Tab')
  fire('pointerdown')
  fire('focusin')
  assert.equal(focusCameByKeyboard(), false, 'a click')
  fire('keydown', { key: 'Shift' })
  fire('focusin')
  assert.equal(focusCameByKeyboard(), false, 'a lone modifier moves nothing')
  fire('keydown', { key: ' ' })
  assert.equal(focusCameByKeyboard(), false, 'a key on a clicked control does not make it keyboard-reached')
  off()
})

// ---- E6: the Projects window -----------------------------------------------------
test('E6: the Projects window is modal for the keyboard and its cards open with a key', () => {
  const home = read('components/ProjectHome.tsx')
  assert.match(home, /aria-modal="true"/)
  assert.match(home, /useModalFocus\(panel, true/)
  assert.match(home, /onKeyDown=\{trap\}/)
  assert.match(home, /<BareButton\s+className="project-thumb"/)
  assert.equal(/<div className="project-thumb" onClick/.test(home), false, 'no card picture that only a mouse opens')
  // The Dialog and the window share the one trap.
  assert.match(read('ui/Dialog.tsx'), /const trap = useModalFocus\(box, open && !inline\)/)
})

// ---- E8: the Shortcuts window in Turkish -------------------------------------------
test('E8: every action and the named keys come from t(): nothing English left in the Turkish window', async () => {
  const { ACTIONS, bindingLabel } = await import('../renderer/src/shortcuts')
  const { setLang, t } = await strings()
  const english = new Set(['Space', 'Left', 'Right', 'Up', 'Down'])
  try {
    setLang('tr')
    const left = ACTIONS.filter((a) => !a.labelKey || t(a.labelKey) === a.label).map((a) => a.id)
    assert.deepEqual(left, [], 'actions without a Turkish name')
    assert.equal(bindingLabel('space'), 'Boşluk')
    assert.equal(bindingLabel('shift+arrowleft'), 'Shift + Sol ok')
    assert.equal(bindingLabel('alt+,'), 'Alt + ,')
    for (const a of ACTIONS) for (const part of bindingLabel(a.default).split(' + ')) assert.equal(english.has(part), false, `${a.id}: ${part}`)
    setLang('en')
    assert.equal(bindingLabel('shift+arrowleft'), 'Shift + Left')
    assert.equal(bindingLabel('ctrl+shift+z'), 'Ctrl + Shift + Z')
  } finally {
    setLang('en')
  }
})

// ---- E10: the ring of a filled button ------------------------------------------------
test('E10: a filled (accent) button shows its ring off the fill, 2 px of the accent', () => {
  const base = read('ui/base.css')
  const m = /\.ui-btn\.ui-btn-primary:focus-visible\s*\{([^}]*)\}/.exec(base)
  assert.ok(m, 'a rule of its own')
  assert.match(m![1], /outline-offset:\s*calc\(2 \* var\(--border-w\)\)/)
  assert.match(m![1], /outline-width:\s*calc\(2 \* var\(--border-w\)\)/)
})

// ---- G6 / G7: one time form, the language's decimal mark ----------------------------
test('G6: one time form: m:ss (h:mm:ss), hundredths when asked, rounded to the place shown', async () => {
  const { fmtTime } = await format()
  const { setLang } = await strings()
  setLang('en')
  assert.equal(fmtTime(26), '0:26', 'the ruler read 26 s as "0:26:00"')
  assert.equal(fmtTime(13.9999), '0:14')
  assert.equal(fmtTime(4.6, 2), '0:04.60')
  assert.equal(fmtTime(15.333, 2), '0:15.33')
  assert.equal(fmtTime(59.996, 2), '1:00.00')
  assert.equal(fmtTime(3723), '1:02:03')
  assert.equal(fmtTime(18.4), '0:18')
  assert.equal(fmtTime(12.25, 1), '0:12.3')
  assert.equal(fmtTime(Number.NaN), '0:00')
  setLang('tr')
  try {
    assert.equal(fmtTime(4.6, 2), '0:04,60')
    assert.equal(fmtTime(26), '0:26')
  } finally {
    setLang('en')
  }
  // The ruler, the transport, a drag's label, the export, the transcript and
  // the media panel all use it.
  for (const f of ['components/timeline/playhead.tsx', 'components/TransportBar.tsx', 'components/timeline/shared.ts', 'components/ExportWindow.tsx', 'components/TranscriptPanel.tsx', 'components/MediaBin.tsx', 'components/Preflight.tsx', 'components/ProjectHome.tsx']) {
    assert.match(read(f), /fmtTime/, f)
  }
  assert.equal(/String\(f\)\.padStart\(2, '0'\)/.test(read('components/timeline/playhead.tsx')), false, 'no m:ss:ff on the ruler')
})

test('G7: Turkish writes a decimal comma and "sn"; typing takes both marks', async () => {
  const { fmtNum, fmtSec, fmtTimes, localNum } = await format()
  const { formatFree, formatNumber, parseNumber } = await import('../renderer/src/ui/logic')
  const { setLang } = await strings()
  try {
    setLang('tr')
    assert.equal(fmtTimes(0.25), '0,25×')
    assert.equal(localNum('23.976'), '23,976')
    assert.equal(fmtSec(1.61), '1,61 sn')
    assert.equal(fmtNum(8, 1, true), '8,0')
    assert.equal(fmtNum(-0.001, 2), '0')
    assert.equal(formatFree(0.5, 2), '0,5')
    // (Phase 9 audit patch D11: the percent sign goes first in Turkish, SOZLUK.md.)
    assert.equal(formatNumber(1.5, 2, '%'), '%1,50')
    assert.equal(formatNumber(0.35, 2, 's'), '0,35 sn')
    assert.equal(parseNumber('%1,50', '%'), 1.5)
    assert.equal(parseNumber('0,35 sn', 's'), 0.35)
    setLang('en')
    assert.equal(fmtTimes(0.25), '0.25×')
    assert.equal(fmtSec(1.61), '1.61 s')
    assert.equal(formatFree(0.5, 2), '0.5')
    assert.equal(formatNumber(1.5, 2, '%'), '1.50 %')
  } finally {
    setLang('en')
  }
  assert.equal(parseNumber('0,25'), 0.25)
  assert.equal(parseNumber('0.25'), 0.25)
  assert.equal(parseNumber('1,5 sn', 'sn'), 1.5)
  const { sliderNumberFormat } = await import('../renderer/src/ui/slider-value')
  assert.equal(sliderNumberFormat(3, 0.05, () => '3,00 sn').suffix, ' sn', 'a slider reads its unit past a comma')
})

// ---- G9: one question box ----------------------------------------------------------------
test('G9: no window.confirm / alert left in the interface; confirmDialog answers by promise', async () => {
  const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
  const found = walk(SRC)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .flatMap((f) => (/\bwindow\.(confirm|alert)\(/.test(readFileSync(f, 'utf8')) ? [f] : []))
  assert.deepEqual(found, [])
  const { confirmDialog, currentConfirm, answerConfirm, subscribeConfirm } = await import('../renderer/src/ui/confirm')
  let told = 0
  const off = subscribeConfirm(() => told++)
  const yes = confirmDialog({ title: 'A', message: 'a', confirm: 'Do' })
  const no = confirmDialog({ title: 'B', message: 'b', confirm: 'Do' })
  assert.equal(currentConfirm()?.options.title, 'A', 'the first asked is shown first')
  answerConfirm(currentConfirm()!.id, true)
  assert.equal(currentConfirm()?.options.title, 'B')
  answerConfirm(currentConfirm()!.id, false)
  assert.equal(currentConfirm(), null)
  assert.equal(await yes, true)
  assert.equal(await no, false)
  assert.ok(told >= 4)
  off()
  // A test window answers it the way it answers the page's own confirm.
  const g = globalThis as unknown as { __e2eConfirm?: (m: string) => unknown; __e2eShowConfirms?: boolean }
  const asked: string[] = []
  g.__e2eConfirm = (m) => (asked.push(m), false)
  try {
    assert.equal(await confirmDialog({ title: 'T', message: 'm', confirm: 'Do' }), false)
    assert.deepEqual(asked, ['T\nm'])
    g.__e2eShowConfirms = true
    const shown = confirmDialog({ title: 'S', message: 's', confirm: 'Do' })
    assert.equal(currentConfirm()?.options.title, 'S', 'drawn when a scenario asks to see it')
    answerConfirm(currentConfirm()!.id, true)
    assert.equal(await shown, true)
  } finally {
    delete g.__e2eConfirm
    delete g.__e2eShowConfirms
  }
  // The test window's guard defines the answer.
  assert.match(readFileSync(join(SRC, '..', '..', 'main', 'e2e-hooks.ts'), 'utf8'), /window\.__e2eConfirm = \(m\) => !!next\('confirm', m, true\)/)
})

// ---- G10: what deleting a file takes with it -------------------------------------------------
function voiceProject(): Project {
  const p = defaultProject()
  const a1 = p.tracks.find((t) => t.kind === 'audio')!
  p.assets.push({ id: 'voice', kind: 'audio', name: 'voice.wav', url: '', size: 1, duration: 30, width: 0, height: 0, hasAudio: true })
  for (const [id, start] of [['v1', 0], ['v2', 12]] as const) {
    const clip: Clip = { id, assetId: 'voice', trackId: a1.id, start, inPoint: start, duration: 12, volume: 1, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }
    p.clips[clip.id] = clip
    a1.clipIds.push(clip.id)
  }
  const cue = (id: string, a: number, b: number): Caption => ({ id, start: a, end: b, text: id, words: [{ text: id, start: a, end: b }] })
  p.captions.push(cue('c1', 0.5, 1.5), cue('c2', 4, 5), cue('c3', 8, 9), cue('c4', 14, 15))
  // A title is a graphic: it stays.
  p.captions.push({ id: 'title', start: 4, end: 6, text: 'Title', manual: true, layer: 1 })
  return p
}

test('G10: the question names the clips and the subtitles heard in them, as the store then deletes them', async () => {
  const { assetDeleteCost } = await import('../renderer/src/media/delete-cost')
  const p = voiceProject()
  assert.deepEqual(assetDeleteCost(p, 'voice'), { clips: 2, subtitles: 4 })
  assert.deepEqual(assetDeleteCost(p, 'nothing'), { clips: 0, subtitles: 0 })
  assert.equal(p.captions.length, 5, 'the project itself untouched')
  const { useStore } = await import('../renderer/src/state/store')
  useStore.getState().loadProject(voiceProject())
  useStore.getState().deleteAsset('voice')
  const after = useStore.getState().project
  assert.equal(after.captions.length, 1, 'the store deletes the same four (the title stays)')
  assert.equal(Object.keys(after.clips).length, 0)
  const { setLang, t } = await strings()
  setLang('en')
  assert.match(t('bin.item.deleteAsk.many', { n: 2 }) + ' ' + t('bin.item.deleteAsk.subs.many', { n: 4 }), /2 clips[\s\S]*4 subtitle lines heard in its sound/)
  assert.match(read('components/MediaBin.tsx'), /assetDeleteCost\(useStore\.getState\(\)\.project, a\.id\)/)
})

// ---- item 9: the cheap ones ------------------------------------------------------------------
test('item 9: one English spelling; the Turkish "quiet sound"; the default name; one icon per job; the switch\'s own name', async () => {
  const { STRINGS, setLang } = await strings()
  // (A parameter's name is no word the user reads: {colour} stays.)
  const british = Object.entries(STRINGS).filter(([, e]) => /\b(colour|centre|customis)/i.test((e as { en: string }).en.replace(/\{\w+\}/g, ''))).map(([k]) => k)
  assert.deepEqual(british, [])
  assert.equal(/sessiz bir ses/.test(JSON.stringify(STRINGS)), false)
  const { projectNameShown } = await format()
  try {
    setLang('tr')
    assert.equal(projectNameShown('Untitled'), 'Adsız')
    assert.equal(projectNameShown(''), 'Adsız')
    assert.equal(projectNameShown('Röportaj'), 'Röportaj')
  } finally {
    setLang('en')
  }
  assert.match(read('components/PreviewToolbar.tsx'), /testid="preview\.silence"\s+icon="audio-lines"/)
  assert.match(read('components/agent/AgentTop.tsx'), /label=\{t\('agent\.switch'\)\}/)
  // (22 November, L1: the panel's own scroll, ui/reveal.ts; still at once with less motion.)
  assert.match(read('components/Inspector.tsx'), /revealIn\(el, 'start', \{ smooth: !motionOff\(\)/)
  for (const k of ['agent.box.clips', 'agent.box.media', 'export.encoder.slow', 'insp.clip.keyAll'] as const) assert.equal(/\(s\)|@|\(.*\(/.test(STRINGS[k].en), false, k)
})
