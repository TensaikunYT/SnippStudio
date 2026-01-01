// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// DENEME-4, worker W (DENEME-4-PLAN-W.md): the left panel makes, adds and
// brings in; the right sets what is selected — every row of the plan's table
// in its new place, gone from the old one, its action still wired. The
// export window's several outputs in one run (export/outputs.ts) and its
// check's one line and grouped list (export/preflight-groups.ts). The top
// bar's controls the small size.
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chosenOutputs, fileNameOf, outputPaths, runOutputs, stemOf } from '../renderer/src/export/outputs'
import { groupIssues, shownAsTimes, summaryOf } from '../renderer/src/export/preflight-groups'
import type { PreflightIssue } from '../renderer/src/export/preflight'
import { STRINGS } from '../renderer/src/ui/strings'
import { STRINGS_DEN4_W } from '../renderer/src/ui/strings-den4-w'

const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const code = (f: string): string => readFileSync(join(SRC, f), 'utf8')
/** One exported function's text (to its next top-level `export`). */
const fn = (text: string, name: string): string => {
  const a = text.indexOf(`export function ${name}(`)
  assert.ok(a >= 0, `${name} is there`)
  const b = text.indexOf('\nexport ', a + 1)
  return text.slice(a, b < 0 ? undefined : b)
}

test('table: making the subtitles is on the left (generate, language, a range, .srt, the lines), not in the Subtitles tab', () => {
  const left = code('components/CaptionsPage.tsx')
  for (const x of ['parseSrt', "testid=\"subs.import-srt\"", 'testid="subs.language"', 'setTranscription', 'wordsPerCue', 'pauseThreshold', 'onClick={onTranscribe}', 'onClick={onTranscribeRange}', 'compactCaptions', 'insp-cap-row', 'deleteCaption', 'updateCaption', 'insp.caps.alternate', 'insp.caps.middle', 'isWhisperInstalled', 'insp.gen.estimated', 'selectCaptions']) {
    assert.ok(left.includes(x), `left Captions page: ${x}`)
  }
  const dock = code('components/WorkspaceDock.tsx')
  assert.match(dock, /<CaptionsPage onTranscribe=\{onTranscribe\} onTranscribeRange=\{onTranscribeRange\} \/>/)
  const right = code('components/inspector/subs-tab.tsx')
  for (const x of ['parseSrt', 'onTranscribe', 'compactCaptions', 'subs.language', 'insp.gen.voiceSet', 'insp-cap-row', 'id="Generate"', 'id="Captions"', 'isWhisperInstalled']) {
    assert.equal(right.includes(x), false, `not in the Subtitles tab any more: ${x}`)
  }
  // What stays on the right: the selected line or text, and the style.
  for (const x of ['<ManualTextEditor', 'id="This line"', '<MarkWordControls', 'id="Pop-up animation"', 'id="Current-word highlight"', '<KeyWordsSection', 'id="Emoji decoration"', 'id="Shorts subtitles"', '<CaptionPresets', 'id="Style"']) {
    assert.ok(right.includes(x), `Subtitles tab: ${x}`)
  }
  const insp = code('components/Inspector.tsx')
  assert.ok(insp.includes('<SubsTab />'), 'the tab takes nothing to make subtitles with')
  assert.equal(/onExportVoiceSet|onTranscribeRange/.test(insp), false)
})

test('table: the voice set is an export, in the export menus only', () => {
  const top = code('components/TopBar.tsx')
  assert.ok(top.includes("id: 'voice-set'") && top.includes("id: 'export-voice-set'"), 'Export menu and File menu')
  for (const f of ['components/inspector/subs-tab.tsx', 'components/CaptionsPage.tsx', 'components/Inspector.tsx']) assert.equal(code(f).includes('VoiceSet'), false, f)
})

test('table: shapes are added on the left; a selected shape is set in the Clip tab, a text’s marked word in the Subtitles tab', () => {
  const shapes = code('components/ShapesTab.tsx')
  const add = fn(shapes, 'ShapesTab')
  assert.ok(add.includes('addShapeAtPlayhead') && add.includes('shapes.add.'), 'adding')
  for (const x of ['setCaptionShape', 'deleteCaption', 'toggleMarkedWords', 'updateCaption']) assert.equal(add.includes(x), false, `the left page does not set a selected thing: ${x}`)
  // (YAZI-PANELI-PLAN.md §5: the selection is read only to put a NEW marker
  // band behind the selected text.)
  assert.ok(add.includes("addShape(k, k === 'marker' ? behind : undefined)"), 'a marker behind the selected text')
  const settings = fn(shapes, 'ShapeSettings')
  for (const x of ['setCaptionShape', 'setCaptionOwnStyle', 'updateCaption', 'testid="shapes.delete"', 'shapes.drawOn', 'shapes.glow', 'shapes.rotate', 'shapes.in', 'shapes.out', 'shapes.idle', 'keyframes(sel)']) assert.ok(settings.includes(x), `shape settings: ${x}`)
  assert.ok(fn(shapes, 'MarkWordControls').includes('toggleMarkedWords'))
  assert.match(code('components/inspector/clip-tab.tsx'), /if \(!clip && shape\) return <ShapeSettings sel=\{shape\}/)
  // Since YAZI-PANELI-PLAN.md §5 they are added on the Text page (Shapes and
  // highlights), and Effects has no second copy.
  const text = code('components/TextPage.tsx')
  assert.ok(text.includes('<ShapesTab show='))
  assert.equal(/ShapeSettings|MarkWordControls/.test(text), false)
  assert.equal(/ShapesTab|shapes\.add/.test(code('components/inspector/fx-tab.tsx')), false, 'no shapes in Effects')
  // Selecting a shape opens the Clip tab; the left panel does not jump.
  assert.ok(code('components/Inspector.tsx').includes("if (primaryCaption && primaryIsShape) setTab('clip')"))
})

test('table: the looks’ tiles are browsed in Filters only; the Color card keeps the look, its strength and a way to the tiles', () => {
  const look = code('components/inspector/clip-look.tsx')
  assert.equal((look.match(/<LookTiles\b/g) ?? []).length, 0, 'no tiles in the Clip tab')
  assert.ok(look.includes('export function LookTiles'), 'the tiles themselves kept')
  const color = fn(look, 'ColorSection')
  for (const x of ['inspector.color.lut"', 'inspector.color.lutAmount', "requestShell('dock:filters')"]) assert.ok(color.includes(x), x)
  assert.equal((code('components/WorkspaceDock.tsx').match(/<LookTiles\b/g) ?? []).length, 1, 'Filters')
  assert.match(code('components/WorkspaceDock.tsx'), /what === 'dock:filters'\) choose\('filters'\)/)
})

test('table: the background is set in the Project tab; the canvas menu points there', () => {
  const top = code('components/TopBar.tsx')
  assert.equal((top.match(/<BackdropPicker\b/g) ?? []).length, 0)
  assert.ok(top.includes("focusInspector('background')"))
  assert.equal((code('components/inspector/project-tab.tsx').match(/<BackdropPicker\b/g) ?? []).length, 1)
})

test('the new words: English and Turkish, the same parameters', () => {
  const all = STRINGS as Record<string, { en: string; tr?: string }>
  for (const [k, v] of Object.entries(STRINGS_DEN4_W)) {
    assert.ok(v.en && v.tr, k)
    assert.equal(all[k]?.en, v.en, `${k} is in STRINGS`)
    const ps = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    assert.deepEqual(ps(v.tr), ps(v.en), `${k}: the same parameters`)
  }
})

// ---- several outputs in one run ---------------------------------------------------
test('outputs: in their order, whatever was ticked first', () => {
  assert.deepEqual(chosenOutputs({ frame: true, video: true }), ['video', 'frame'])
  assert.deepEqual(chosenOutputs({ sound: true }), ['sound'])
  assert.deepEqual(chosenOutputs({}), [])
})

test('outputs: one name, one folder, each its own extension', () => {
  assert.deepEqual(outputPaths('C:\\Films\\talk.mp4', ['mp4', 'wav', 'png']), ['C:\\Films\\talk.mp4', 'C:\\Films\\talk.wav', 'C:\\Films\\talk.png'])
  assert.deepEqual(outputPaths('/home/a/my.film.webm', ['webm', 'mp3']), ['/home/a/my.film.webm', '/home/a/my.film.mp3'])
  // A dot in a folder's name is not an extension.
  assert.equal(stemOf('C:\\v1.2\\talk'), 'C:\\v1.2\\talk')
  assert.deepEqual(outputPaths('C:\\v1.2\\talk', ['mp4', 'wav']), ['C:\\v1.2\\talk', 'C:\\v1.2\\talk.wav'])
  // Two of one extension never share a file.
  assert.deepEqual(outputPaths('D:\\x\\a.png', ['png', 'png']), ['D:\\x\\a.png', 'D:\\x\\a-2.png'])
  assert.equal(fileNameOf('C:\\Films\\talk.wav'), 'talk.wav')
})

test('outputs: one after another; a cancelled or failed one stops the rest', async () => {
  const ran: string[] = []
  const step = (kind: 'video' | 'sound' | 'frame', ok: boolean | 'throw') => ({
    kind,
    run: async () => {
      ran.push(kind)
      if (ok === 'throw') throw new Error('no')
      return ok
    }
  })
  assert.deepEqual(await runOutputs([step('video', true), step('sound', true), step('frame', true)]), { done: ['video', 'sound', 'frame'] })
  assert.deepEqual(ran, ['video', 'sound', 'frame'])
  ran.length = 0
  assert.deepEqual(await runOutputs([step('video', false), step('sound', true)]), { done: [], stoppedAt: 'video' })
  assert.deepEqual(ran, ['video'])
  ran.length = 0
  assert.deepEqual(await runOutputs([step('video', true), step('sound', 'throw'), step('frame', true)]), { done: ['video'], stoppedAt: 'sound' })
  assert.deepEqual(ran, ['video', 'sound'])
})

test('the window runs them so: a save dialog once, the others beside it, a frame of the moment Export was pressed', () => {
  const w = code('components/ExportWindow.tsx')
  for (const x of ['testid="export.out.video"', 'testid="export.out.sound"', 'testid="export.out.frame"', 'outputPaths(chosen', 'runOutputs(', 'saveStillFrame(stillChoice, { path: paths[i], time })', 'onVideo(settingsFor(k), paths[i])']) assert.ok(w.includes(x), x)
  assert.equal((w.match(/chooseSavePath/g) ?? []).length, 1, 'asked once, for the first')
  // The window's old Video / Sound only / This frame switch is gone.
  assert.equal(w.includes('testid="export.kind"'), false)
  // What existed is still wired: encoder, codec move, loudness, YouTube text, range, presets.
  for (const x of ['probeEncoder', 'pickExportFormat', 'videoNormalize', 'soundNormalize', 'youtube: true', "encoder: 'software'", 'range: ranged', 'applyPreset', 'hdrShown', 'codeFilmsEnlarged', 'export.solo', 'customMbps']) assert.ok(w.includes(x), x)
  const app = code('App.tsx')
  assert.match(app, /performExport = useCallback\(async \(settings: ExportSettings, chosen\?: string\): Promise<boolean>/)
  assert.match(code('export/still-save.ts'), /export async function saveStillFrame\(choice: StillChoice, at: \{ path\?: string; time\?: number \} = \{\}\): Promise<boolean>/)
})

// ---- the check's line and list ------------------------------------------------------
const issue = (kind: PreflightIssue['kind'], at: number): PreflightIssue => ({ kind, at, text: `${kind} at ${at}` })

test('the check: grouped by kind, the biggest group first, each in time order', () => {
  const all = [issue('loud', 9), issue('missing', 1), issue('loud', 3), issue('gap', 5), issue('loud', 6), issue('still', 2)]
  const g = groupIssues(all)
  assert.deepEqual(g.map((x) => [x.kind, x.items.length]), [['loud', 3], ['missing', 1], ['gap', 1], ['still', 1]])
  assert.deepEqual(g[0].items.map((x) => x.at), [3, 6, 9])
  assert.deepEqual(summaryOf(g), { total: 6, top: { kind: 'loud', n: 3 }, other: 3 })
  assert.deepEqual(summaryOf([]), { total: 0, top: null, other: 0 })
  assert.equal(shownAsTimes('loud'), true)
  assert.equal(shownAsTimes('missing'), false)
})

test('the check is one line that opens a list; what stops the export is red and first in the right column', () => {
  const p = code('components/Preflight.tsx')
  for (const x of ['testid="export.pre.summary"', 'data-testid="export.pre.list"', 'aria-expanded={open}', 'groupIssues(all)', "t('win.pre.go')"]) assert.ok(p.includes(x), x)
  const w = code('components/ExportWindow.tsx')
  const side = w.slice(w.indexOf('<aside className="xw-side">'))
  assert.ok(side.indexOf('xw-blocked') < side.indexOf('export.summary') && side.indexOf('export.summary') < side.indexOf('<PreflightList'), 'blockers, then the files, then the check')
  assert.ok(w.includes("data-testid={b.id === 'empty' ? 'export.empty'"))
})

// ---- the top bar -------------------------------------------------------------------
test('the top bar: every control small (28 px), the export arrow inside the one pill', () => {
  const top = code('components/TopBar.tsx')
  for (const id of ['topbar.export"', 'tb-export-more', 'topbar.file"', 'topbar.canvas"', 'topbar.settings"']) {
    const at = top.indexOf(id)
    assert.ok(at > 0, id)
    const tag = top.slice(top.lastIndexOf('<', at), top.indexOf('>', at))
    assert.match(tag, /size="sm"/, `${id} is small`)
  }
  const css = code('components/topbar.css')
  // --ctl is 28 since den2-u (it made --ctl-sm 24).
  assert.match(css, /\.topbar \.ui-btn:not\(\.ui-size-sm\) \{ height: var\(--ctl\);[^}]*font-size: var\(--fs-12\)/)
  assert.match(css, /\.topbar \.tb-export \{[^}]*overflow: hidden/)
})

test('the save window opens the chosen file only: the other outputs are asked for (22 Nov, K1)', () => {
  // (Was: "siblings" of the chosen file made writable by the save window,
  // with no look at what was there. Now export:approve is the one door.)
  const main = readFileSync(join(__dirname, '..', '..', 'src', 'main', 'ipc', 'file-ipc.ts'), 'utf8')
  const handler = main.slice(main.indexOf("'dialog:choose-save'"), main.indexOf("'file:write-chosen'")).replace(/\/\/.*$/gm, '')
  assert.equal((handler.match(/chosenSavePaths\.add\(/g) ?? []).length, 1, 'one path: the chosen one')
  assert.doesNotMatch(handler, /siblings|outputPaths/)
  const win = code('components/ExportWindow.tsx')
  assert.doesNotMatch(win, /siblings/)
  // No file is approved "replace: true" before the user was asked.
  assert.equal((win.match(/\.approve\([^\n]*, true\)/g) ?? []).length, 1)
  assert.match(win, /const yes = await confirmDialog\([^\n]*\n\s*if \(!yes\) return null\n\s*r = await xp\.approve\(dir, files, true\)/)
  assert.match(win, /const more = await approveAsking\(dir, others\)/)
  // The page and the main process work the paths out with the one function.
  assert.ok(code('export/outputs.ts').includes("from '../../../shared/output-paths'"))
})
