// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11b, the usability audit's findings (U1…) that a style sheet or a
// pure function decides. The window checks are in the e2e scenario
// `faz11b-fixes`.
import './dom-stub'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const css = (file: string): string => readFileSync(join(SRC, file), 'utf8')

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(sheet: string, selector: string): Record<string, string> {
  const at = sheet.split(/\}/).find((block) => block.split('{')[0].replace(/\/\*[\s\S]*?\*\//g, '').trim() === selector)
  assert.ok(at, `rule ${selector}`)
  const out: Record<string, string> = {}
  for (const d of at.split('{')[1].split(';')) {
    const [k, ...v] = d.split(':')
    if (k.trim()) out[k.trim()] = v.join(':').trim()
  }
  return out
}

test('U1: the project name in the top bar has room above its letters (the marks of İ, Ö, Ğ were cut)', () => {
  const r = rule(css('components/shell.css'), '.tb-name .tb-name-text')
  assert.equal(r.overflow, 'hidden')
  // The button's line is 1 (kit.css); a clipping box needs a taller one.
  assert.ok(Number(r['line-height']) >= 1.3, `line-height ${r['line-height']}`)
})

test('U4: a folder that is gone (ENOENT, ENOTDIR) is said plainly, in Turkish too; the old kinds as before', async () => {
  const { plainFileError } = await import('../renderer/src/export/file-target')
  const { setLang } = await import('../renderer/src/ui/strings')
  const enoent = new Error("Error invoking remote method 'export:open': Error: ENOENT: no such file or directory, open 'E:\\gone\\film.mp4.part'")
  assert.match(plainFileError(enoent).message, /^The folder chosen for the video is not there any more/)
  assert.match(plainFileError(new Error('ENOTDIR: not a directory, open'), 'file').message, /^The folder chosen for the file/)
  assert.match(plainFileError(new Error('ENOSPC: no space left on device')).message, /^The disk is full/)
  setLang('tr')
  try {
    assert.match(plainFileError(enoent).message, /^Video için seçilen klasör artık yok/)
  } finally {
    setLang('en')
  }
})

test('U8: "+ Text" writes its placeholder in the window\'s language; the command (an agent\'s) stays English', async () => {
  const { useStore } = await import('../renderer/src/state/store')
  const { defaultProject } = await import('../renderer/src/types')
  const { setLang } = await import('../renderer/src/ui/strings')
  const S = useStore.getState
  S().loadProject(defaultProject())
  setLang('tr')
  try {
    const id = S().addCaptionAtPlayhead()
    assert.equal(S().project.captions.find((c) => c.id === id)?.text, 'Yeni yazı')
    S().runBatch([{ name: 'text.add', params: { time: 5 } }] as never)
    assert.ok(S().project.captions.some((c) => c.text === 'New text'), 'the command as before')
  } finally {
    setLang('en')
  }
  const en = S().addCaptionAtPlayhead()
  assert.equal(S().project.captions.find((c) => c.id === en)?.text, 'New text')
})

test('U9: a percentage and a time in seconds take the Turkish form ("%45", "1,50 sn")', async () => {
  const { setLang, t } = await import('../renderer/src/ui/strings')
  assert.equal(t('ui.percent', { n: 45 }), '45%')
  assert.match(t('timeline.lockedBehind', { names: 'A2', time: (1.5).toFixed(2) }), /from 1\.50 s on/)
  assert.match(t('export.decode.held', { name: 'a.mp4', at: (12.25).toFixed(2) }), /at 12\.25 s:/)
  setLang('tr')
  try {
    assert.equal(t('ui.percent', { n: 45 }), '%45')
    assert.match(t('timeline.lockedBehind', { names: 'A2', time: (1.5).toFixed(2) }), /1,50 sn sonrasında/)
    assert.match(t('export.decode.held', { name: 'a.mp4', at: (12.25).toFixed(2) }), /12,25 sn anındaki/)
  } finally {
    setLang('en')
  }
  // (The two places that wrote "45%" by hand now ask for it.)
  assert.ok(!css('components/PreviewToolbar.tsx').includes('ahead.total)}%`'))
  assert.ok(!css('components/RendersPanel.tsx').includes('? `${pct}%`'))
})

test('U5: a transition tile\'s name wraps to its two lines (the button\'s nowrap cut "Yumuşak çekim ra")', () => {
  const sheet = css('components/inspector/transition-preview.css')
  const r = rule(sheet, '.ct-tile-name')
  assert.equal(r['white-space'], 'normal')
  assert.equal(r['-webkit-line-clamp'], '2')
})

test('U6: a menu with room on neither side stays under its button and scrolls (it lay over "Dosya" at 768 px)', async () => {
  const { placeMenu } = await import('../renderer/src/ui/logic')
  // 1366 x 768: "File" at the top (10-38), its menu 731 px tall.
  const view = { w: 1366, h: 768 }
  const p = placeMenu({ x: 60, y: 10, w: 60, h: 28 }, { w: 260, h: 731 }, view)
  assert.equal(p.side, 'below')
  assert.equal(p.y, 42, 'under the button')
  assert.equal(p.maxH, 768 - 8 - 42, 'scrolls within the room below')
  // A menu that fits, and one that goes above, are placed as before.
  assert.deepEqual(placeMenu({ x: 100, y: 100, w: 80, h: 28 }, { w: 200, h: 150 }, { w: 1000, h: 600 }), { x: 100, y: 132, side: 'below' })
  assert.equal(placeMenu({ x: 100, y: 540, w: 80, h: 28 }, { w: 200, h: 150 }, { w: 1000, h: 600 }).side, 'above')
  assert.match(css('ui/kit.css'), /\.ui-menu-layer > \.ui-menu \{ max-height: var\(--menu-max, calc\(100vh - 16px\)\)/)
})

test('U7: the empty timeline\'s sentence lies on the timeline\'s ground (the V1/A1 line ran through it at 768 px)', () => {
  // Arayüz v4: the sentence moved into the first picture lane, at its start
  // (no line runs through it there); a lane's own words are quiet.
  const r = rule(css('components/timeline/timeline.css'), '.tl-lane-hint')
  assert.equal(r.color, 'var(--text-3)')
  assert.match(css('components/Timeline.tsx'), /className="tl-lane-hint" text=\{t\('timeline.empty.lane'\)\}/)
})

test('U2: the tour\'s bubble keeps off the transport bar when another place fits (1366 and 1920, steps 2 and 3)', async () => {
  const { placeBubble } = await import('../renderer/src/components/Tour')
  const rect = (left: number, top: number, width: number, height: number): DOMRect => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect
  const hits = (p: { x: number; y: number }, a: DOMRect, h: number): boolean => p.x < a.right && p.x + 300 > a.left && p.y < a.bottom && p.y + h > a.top
  for (const [vw, vh] of [[1366, 768], [1920, 1080]]) {
    // The preview over the transport bar, the timeline under it.
    const preview = rect(280, 48, vw - 640, vh * 0.42)
    const bar = rect(280, preview.bottom, vw - 640, 40)
    const timeline = rect(0, bar.bottom + 4, vw, vh - bar.bottom - 4)
    for (const part of [preview, timeline]) {
      const p = placeBubble(part, 150, vw, vh, [bar])
      assert.ok(!hits(p, bar, 150), `${vw}: not over Play (${JSON.stringify(p)})`)
      assert.ok(p.x >= 8 && p.x + 300 <= vw - 8 && p.y >= 8 && p.y + 150 <= vh - 8, 'inside the window')
    }
  }
  // Nothing to keep off: as before (below the part).
  assert.equal(placeBubble(rect(10, 60, 80, 28), 150, 1366, 768).y, 98)
})

test('C22: what the review strip holds of a draft belongs to that draft: a new one (its calls numbered from 1 again) is another', async () => {
  const { draftIdOf } = await import('../renderer/src/components/agent/draft-text')
  const view = (id: number, seqs: number[]) => ({ id, session: 's1', client: 'c', calls: seqs.map((seq) => ({ seq, label: '', at: 0, ops: [] })), summary: { calls: 0, cuts: 0, seconds: 0, addedClips: 0, dropped: 0 }, dropped: [], version: 'v' }) as never
  assert.equal(draftIdOf(null), null)
  assert.equal(draftIdOf(view(3, [1])), draftIdOf(view(3, [1, 2])), 'more calls: the same draft, the choice stays')
  assert.notEqual(draftIdOf(view(3, [1, 2])), draftIdOf(view(4, [1, 2])), 'a new draft, the same call numbers: the choice goes')
  // (D22, worker C: the card went; the strip replays the draft it is shown for.)
  assert.match(css('components/agent/ReviewStrip.tsx'), /useEffect\(\(\) => \{\s*freshDraft\(\)\s*\}, \[draftId\]\)/)
})

test('D24: "Back to the previous version" asks before it puts a version back (it was one click)', () => {
  const src = css('components/inspector/CodeFilmVersions.tsx')
  const ask = src.indexOf('await confirmDialog(')
  const go = src.indexOf('api.codeFilm.versionBack(id)')
  assert.ok(ask > 0 && go > ask, 'asked first')
  assert.match(src.slice(ask, go), /if \(!yes\) return/)
})

test('C21: "Back to here" says that the user\'s own edits after the step go back too, in both languages', async () => {
  const { setLang, t } = await import('../renderer/src/ui/strings')
  assert.match(t('agent.steps.backAsk'), /your own edits as well/)
  setLang('tr')
  try {
    assert.match(t('agent.steps.backAsk'), /senin kendi düzenlemelerin de/)
  } finally {
    setLang('en')
  }
})

test('C20: "Make subtitles" over subtitles already there asks first (corrections by hand went without a word)', () => {
  const src = css('components/agent/CommandBox.tsx')
  const ask = src.indexOf("tt('agent.ready.subtitles.replace'")
  const go = src.indexOf('onTranscribe()', src.indexOf("case 'transcribe'"))
  assert.ok(ask > 0 && go > ask, 'asked before it transcribes')
  assert.match(src.slice(src.indexOf("case 'transcribe'"), go), /filter\(isSubtitle\)\.length/)
})

test('C19: "Even out the loudness" leaves the music bed and the sound effects alone and says what it left past 40', () => {
  const src = css('agent/ready.ts')
  assert.match(src, /const beds = new Set\(await speechBeds\(v\.project\)\)/)
  assert.match(src, /!beds\.has\(c\.trackId\) && !sfx\.has\(c\.trackId\)/)
  assert.match(src, /const skipped = Math\.max\(0, sounding\.length - 40\)/)
  assert.match(css('components/agent/CommandBox.tsx'), /if \(r\.skipped\) notify\(\{ text: tt\('agent\.ready\.loudness\.skipped'/)
})

test('B19: deleting from the transcript while the project keeps changing never cuts without the music scope', () => {
  const src = css('components/TranscriptPanel.tsx')
  const body = src.slice(src.indexOf('const attempt = (left: number)'), src.indexOf('attempt(2)'))
  assert.match(body, /if \(left === 0\) \{\s*void scope\.then\(\(s\) => go\(s\)\)/)
  assert.doesNotMatch(body, /!scope \|\| left === 0/)
})

test('D25: the question says that versions keep the text files only (pictures and sounds stay as they are)', async () => {
  const { setLang, t } = await import('../renderer/src/ui/strings')
  assert.match(t('codeFilm.versionBack.note'), /text files only/)
  setLang('tr')
  try {
    assert.match(t('codeFilm.versionBack.note'), /yalnız metin dosyalarını/)
  } finally {
    setLang('en')
  }
})
