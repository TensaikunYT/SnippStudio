// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 9b, decision 1 (FAZ9-PLAN.md "9b"): the English messages of the
// engine and the main process are shown in the interface's language. Every
// fixed message of the files whose messages reach the person (a thrown
// Error, an `errors.push`, an `error:` / `message:` answer, an export note or
// a progress line) is read here with TypeScript's parser, made concrete (a
// `${…}` becomes a number or, for `a ? b : c`, its plural branch) and put
// through localizeMessage in Turkish: no English word of it may be left. The
// messages that never reach the person are listed with their reason.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import ts from 'typescript'
import { localizeMessage, ERROR_KEYS } from '../renderer/src/ui/errors'
import { setLang, t, STRINGS } from '../renderer/src/ui/strings'

const SRC = join(__dirname, '..', '..', 'src')

/** The files whose messages are shown (toasts, the export window, the exports
 *  list, the sound effects line, the projects window, the transcription line). */
const FILES = [
  'main/code-templates.ts',
  'main/codefilm-host.ts',
  'main/codefilm-values.ts',
  'main/codefilm-versions.ts',
  'main/ipc/file-ipc.ts',
  'main/ipc/project-ipc.ts',
  'main/ipc/recents-ipc.ts',
  'main/ipc/media-ipc.ts',
  'main/safe-write.ts',
  'main/state.ts',
  'main/render-workers.ts',
  'main/film-window.ts',
  'main/agent-connect.ts',
  'renderer/src/App.tsx',
  'renderer/src/export/exporter.ts',
  'renderer/src/export/encoder.ts',
  'renderer/src/export/file-target.ts',
  'renderer/src/export/parallel.ts',
  'renderer/src/media/codefilm.ts',
  'renderer/src/media/import.ts',
  'renderer/src/media/proxy.ts',
  'renderer/src/audio/sfx-library.ts',
  'renderer/src/audio/clean-run.ts',
  'renderer/src/playback/draw/lut-table.ts',
  'renderer/src/subtitles/transcribe.ts',
  'renderer/src/components/TranscriptPanel.tsx',
  'renderer/src/media/sample-project.ts'
]
// (renderer/src/workers/whisper.worker.ts is not read: worker I of phase 9
// rewrites its model messages; its present messages have rules all the same.)

/** Never shown: internal answers the code reads, guards against a broken
 *  caller, or a lane fault the export answers by drawing again in one window. */
const INTERNAL = new Set([
  // guards on the IPC bridge and the render lanes (a caller's bug, not a person's)
  'no such stream', 'bad write', 'bad read', 'bad stretch number', 'Untrusted IPC sender', 'no such render process',
  'that render process is busy', 'no stretch is being written', 'path not chosen', 'unknown kind', 'bad text', 'bad path', 'bad name',
  'outside folder', 'unknown media', 'not a registered film', 'avc1.64007',
  // (phase 11b, A17: archive:copy-lut; the archive names the LUT that failed, not this)
  'not a LUT',
  // codes the renderer reads and answers in its own words
  'not a known project', 'not a project file', 'missing', 'exists', 'stale', 'own renderOut',
  // a code film page's waits, which end in the film's own message
  'closed', 'dropped', 'timeout',
  // the parallel export's lane faults: App.tsx draws the film again in one window
  'stretch 7 is missing', 'stretch 7 has no video', 'stretch 7 has no decoder setup', "the lanes' encoders set up differently (stretch 7: 7, the first: 7)",
  'stretch 7 has 7 frames, not 7', 'A render lane failed (frames 7–7): 7',
  // the agent's terminal and the agent server's HTTP answers (the agent reads them)
  'Request too large.', 'Internal error.'
])

/** Words that stay as they are in Turkish (names, formats, code). */
const KEEP = new Set(['WebGL', 'JSON', 'index', 'html', 'window', 'READY', 'true', 'Whisper', 'resources', 'models', 'cube', 'LUT', 'LUTs', 'MP3', 'M4A', 'WAV', 'Mbps', 'VP9', 'Windows', 'GPU', 'CPU', 'WebGPU', 'SRT', 'ONNX', 'MP4', 'video', 'film', 'program', 'model', 'Short', 'ENOSPC'])

interface Msg { file: string; line: number; text: string }

/** A concrete message from an expression: strings as they are, `${x}` as 7, `a ? b : c` as c. */
function concrete(e: ts.Expression, sf: ts.SourceFile): string | null {
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text
  if (ts.isTemplateExpression(e)) return e.head.text + e.templateSpans.map((s) => (concrete(s.expression, sf) ?? '7') + s.literal.text).join('')
  if (ts.isConditionalExpression(e)) return concrete(e.whenFalse, sf) ?? '7'
  if (ts.isParenthesizedExpression(e)) return concrete(e.expression, sf)
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const a = concrete(e.left, sf)
    const b = concrete(e.right, sf)
    return a === null && b === null ? null : (a ?? '7') + (b ?? '7')
  }
  return null
}

function messages(rel: string): Msg[] {
  const file = join(SRC, rel)
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const out: Msg[] = []
  const add = (e: ts.Expression | undefined): void => {
    if (!e) return
    // A message only when written as words here (not a variable, not t()).
    if (!(ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isTemplateExpression(e) || ts.isConditionalExpression(e) || ts.isBinaryExpression(e))) return
    const text = concrete(e, sf)
    if (text && /[a-z]{3}/i.test(text)) out.push({ file: rel, line: sf.getLineAndCharacterOfPosition(e.getStart()).line + 1, text })
  }
  const visit = (n: ts.Node): void => {
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && /Error$/.test(n.expression.text)) add(n.arguments?.[0])
    if (ts.isCallExpression(n)) {
      const callee = n.expression.getText(sf)
      if (/(^|\.)errors\.push$/.test(callee) || /^(exportNote|progress|onLabel\??\.?|opts\.onProgress|stage)$/.test(callee.replace(/\?\./g, '.').replace(/\.$/, ''))) add(n.arguments[callee.endsWith('onProgress') || callee === 'progress' ? 1 : 0])
    }
    if (ts.isPropertyAssignment(n) && ts.isIdentifier(n.name) && (n.name.text === 'error' || ((rel.endsWith('codefilm-host.ts') || rel.endsWith('film-window.ts')) && n.name.text === 'message') || (rel.endsWith('transcribe.ts') && n.name.text === 'label'))) add(n.initializer)
    if (ts.isReturnStatement(n) && rel.endsWith('encoder.ts') && n.expression && ts.isTemplateExpression(n.expression)) add(n.expression)
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'retryLabel' && n.initializer && ts.isArrowFunction(n.initializer) && ts.isConditionalExpression(n.initializer.body as ts.Expression)) {
      const c = n.initializer.body as ts.ConditionalExpression
      add(c.whenTrue)
      add(c.whenFalse)
    }
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return out
}

const words = (s: string): string[] => s.match(/[A-Za-z]{3,}/g) ?? []

test('every shown engine and main-process message is in Turkish (no English word left)', (ctx) => {
  const all = FILES.flatMap(messages)
  assert.ok(all.length >= 120, `messages read: ${all.length}`)
  setLang('tr')
  try {
    const left: string[] = []
    let shown = 0
    for (const m of all) {
      if (INTERNAL.has(m.text)) continue
      shown++
      const out = localizeMessage(m.text)
      const english = new Set(words(m.text).filter((w) => !KEEP.has(w)))
      const stay = words(out).filter((w) => english.has(w) && w !== '7')
      if (stay.length) left.push(`${m.file}:${m.line} "${m.text}" → "${out}" (left: ${stay.join(' ')})`)
    }
    assert.deepEqual(left, [], 'messages with English left in Turkish')
    assert.ok(shown >= 100, `shown messages checked: ${shown}`)
    ctx.diagnostic(`messages read ${all.length}, shown ${shown}, rules ${ERROR_KEYS.length}`)
  } finally {
    setLang('en')
  }
})

test('the internal list holds only messages that are still in the code', () => {
  const texts = new Set(FILES.flatMap(messages).map((m) => m.text))
  const gone = [...INTERNAL].filter((x) => !texts.has(x) && x !== 'Request too large.' && x !== 'Internal error.')
  assert.deepEqual(gone, [])
})

test('English shows a message as it is', () => {
  setLang('en')
  const m = 'bozuk.mp4: Input has an unsupported or unrecognizable format.'
  assert.equal(localizeMessage(m), m)
})

test('a message made of clauses: each in Turkish, the names kept', () => {
  setLang('tr')
  try {
    assert.equal(localizeMessage('bozuk.mp4: Input has an unsupported or unrecognizable format.'), 'bozuk.mp4: Dosyanın biçimi desteklenmiyor ya da tanınmıyor.')
    assert.equal(
      localizeMessage('The video was not exported. A file used in the video can\'t be found: "a b.mp4". It was moved, renamed or deleted since the project was opened — relink it in the Media panel (or take it off the timeline), then export again.'),
      'Video dışa aktarılmadı. Videoda kullanılan 1 dosya bulunamıyor: "a b.mp4". Proje açıldığından beri taşındı, adı değişti ya da silindi: Medya panelinden yeniden bağla (ya da çizelgeden kaldır), sonra yeniden dışa aktar.'
    )
    assert.equal(localizeMessage('Transcription failed: Transcription cancelled.'.replace('Transcription failed: ', t('app.transcribe.failed', { error: '' }))), 'Yazıya dökme başarısız: Yazıya dökme durduruldu.')
    assert.equal(localizeMessage('This project is already open in another SnippStudio Dev window.'), 'Bu proje başka bir SnippStudio Dev penceresinde zaten açık.')
    // A Turkish text passes untouched.
    assert.equal(localizeMessage('Proje kaydedildi.'), 'Proje kaydedildi.')
  } finally {
    setLang('en')
  }
})

test('every rule has its words in both languages', () => {
  for (const k of ERROR_KEYS) {
    const e = (STRINGS as Record<string, { en: string; tr?: string }>)[k]
    assert.ok(e && e.en && e.tr, k)
  }
})

// ---- phase 9 audit patch D3: the export check's findings ----------------------
test('the export check (export/preflight.ts) says every finding in Turkish; English is the finding itself', async () => {
  const { preflight } = await import('../renderer/src/export/preflight')
  const { preflightText } = await import('../renderer/src/export/preflight-say')
  const { defaultProject } = await import('../renderer/src/types')
  type P = ReturnType<typeof defaultProject>
  const make = (backdrop: boolean): P => {
    const p = defaultProject()
    if (backdrop) (p as { backdrop?: unknown }).backdrop = { kind: 'solid', color: '#202020' }
    p.assets.push(
      { id: 'a', kind: 'image', name: 'one.png', url: '', path: 'one.png', size: 1, duration: 0, width: 10, height: 10, hasAudio: false },
      { id: 'b', kind: 'image', name: 'two.png', url: '', path: 'two.png', size: 1, duration: 0, width: 10, height: 10, hasAudio: false, missing: true },
      { id: 'f', kind: 'code', name: 'title-card', url: '', path: 'anim/title-card/index.html', size: 1, duration: 10, width: 1920, height: 1080, hasAudio: false } as never
    )
    const v = p.tracks.find((k) => k.kind === 'video')!
    const add = (id: string, assetId: string, start: number, duration: number, extra: Record<string, unknown> = {}): void => {
      p.clips[id] = { id, assetId, trackId: v.id, start, duration, inPoint: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1, ...extra } as never
      v.clipIds.push(id)
    }
    add('c1', 'a', 0, 3, { lut: 'warm.cube' })
    add('c2', 'a', 3, 3, { lut: 'warm.cube' })
    add('c3', 'b', 8, 3)
    add('c4', 'a', 11, 12)
    add('c5', 'zz', 23, 2)
    add('c6', 'zz', 25, 2)
    add('c7', '', 27, 2, { automationMissing: { number: 4 } })
    add('c8', 'f', 29, 2)
    add('c9', 'b', 31, 2)
    // Sound beyond the last picture: "the last … s".
    const a1 = p.tracks.find((k) => k.kind === 'audio')!
    p.assets.push({ id: 's', kind: 'audio', name: 'voice.wav', url: '', path: 'voice.wav', size: 1, duration: 60, width: 0, height: 0, hasAudio: true })
    p.clips.s1 = { id: 's1', assetId: 's', trackId: a1.id, start: 0, duration: 40, inPoint: 0, transform: { x: 0, y: 0, scale: 1, rotation: 0 }, volume: 1 } as never
    a1.clipIds.push('s1')
    return p
  }
  const opts = { lutMissing: () => true, codeFilmError: (id: string) => (id === 'f' ? 'ReferenceError: boot is not defined\n at index.html:3' : null) }
  const kinds = new Set<string>()
  for (const backdrop of [false, true]) {
    const found = preflight(make(backdrop), opts)
    for (const it of found) {
      assert.ok(it.say, `a key for "${it.text}"`)
      kinds.add(it.say!.key)
      setLang('en')
      assert.equal(preflightText(it), it.text, 'English is the text the agent reads')
      setLang('tr')
      try {
        const out = preflightText(it)
        const names = new Set(words([it.say!.name ?? '', 'ReferenceError: boot is not defined'].join(' ')))
        const english = new Set(words(it.text).filter((w) => !KEEP.has(w) && !names.has(w)))
        const stay = words(out).filter((w) => english.has(w))
        assert.deepEqual(stay, [], `"${it.text}" → "${out}"`)
        assert.doesNotMatch(out, /\d\.\d/, `the Turkish decimal mark: "${out}"`)
      } finally {
        setLang('en')
      }
    }
  }
  assert.deepEqual([...kinds].sort(), ['pre.f9y.codeFilm', 'pre.f9y.fileMissingMany', 'pre.f9y.gap', 'pre.f9y.gapBackdrop', 'pre.f9y.gapEnd', 'pre.f9y.lutMany', 'pre.f9y.missingMany', 'pre.f9y.repeat', 'pre.f9y.slot', 'pre.f9y.still'])
})
