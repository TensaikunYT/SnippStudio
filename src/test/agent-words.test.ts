// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 5e, decision 7 (ANA-PLAN principle 6: the app never steers how the
// agent animates): no tool definition and no tool answer holds the words
// prefer, style, font, color / colour, palette, layout, "should look",
// template. Exceptions: the edit tool's operation catalogue (command names
// such as caption.setStyle, their fields and what they do to the user's
// project: the user's own subtitle look, not advice), the internal record
// keys of the answer code listed below, and (phase 5f) the user's own
// project look line.
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { agentTools, editCommands, editOperations, opsHelp, SERVER_INSTRUCTIONS } from '../renderer/src/agent/tools'
import { STRINGS } from '../renderer/src/ui/strings'
import { rangeContext } from '../renderer/src/agent/format'
import { BLANK_LINE, checkText } from '../renderer/src/media/codefilm-limits'
import { EMPTY_PAGE } from '../main/codefilm-versions'
import { defaultProject } from '../renderer/src/types'

export const BANNED = /prefer|style|font|colou?r|palette|layout|should look|template/i

const SRC = path.join(__dirname, '..', '..', 'src')

/** Literals of the answer code that are record keys or code, never said to
 *  the agent as words. */
const INTERNAL = new Set(["'color'", "'templates'", "'template'", "'style'", '`600 ${font}px sans-serif`', "'../components/app/layout'",
  // Phase 5f, decision 4: the one line the user's "quick" way adds to their own
  // message (where the code templates are), not a tool's answer.
  '`[fast: code templates in ${templatesDir}]`'])

test('decision 7: the tool definitions (but the operation catalogue) and the instructions hold no word of look or advice', () => {
  const ops = editOperations()
  for (const tool of agentTools()) {
    const text = JSON.stringify({ ...tool, description: tool.description.replace(ops, '') })
    const hit = BANNED.exec(text)
    assert.equal(hit, null, `${tool.name}: "${hit?.[0]}" in ${text.slice(Math.max(0, (hit?.index ?? 0) - 40), (hit?.index ?? 0) + 40)}`)
  }
  assert.equal(BANNED.exec(SERVER_INSTRUCTIONS), null)
  // The catalogue's last line (the operations listed by name) is checked too,
  // but for the names themselves.
  const also = ops.split('\n').pop()!.replace(/\b[a-z]+\.(\{[^}]*\}|\w+)/g, '')
  assert.equal(BANNED.exec(also), null, also)
})

test('decision 7: the code clip\'s empty page, the check\'s answer and the frames context say nothing of how to animate', () => {
  assert.equal(BANNED.exec(EMPTY_PAGE), null, EMPTY_PAGE)
  for (const verdict of ['ok', 'blank', 'unstable', 'error'] as const) {
    const s = checkText({ verdict, lines: [BLANK_LINE, '2 s drawn again differs (3.1 % of the pixels)'], length: 4, width: 1920, height: 1080, moments: [0.4, 2, 3.6], ms: 900, at: 0 }, 'c1')
    assert.equal(BANNED.exec(s), null, s)
  }
  const p = defaultProject()
  p.captions = [{ id: 'l1', start: 1, end: 2.5, text: 'hello there' } as never]
  const ctx = rangeContext(p, [0.5, 3])
  assert.match(ctx, /^Context 0\.50–3\.00 s\. Said \(s from 0\.50\):\n0\.50–2\.00 "hello there"\nSafe area \(90 %\): x \d+–\d+, y \d+–\d+\. Output \d+x\d+, \d+ fps\.$/)
  assert.equal(BANNED.exec(ctx), null)
  // Phase 5f: the user's own project look, only when set, as its own line
  // (the one exception), and nothing else changes.
  p.look = { accent: '#e0a030', font: 'Inter' }
  const withLook = rangeContext(p, [0.5, 3]).split('\n')
  assert.equal(withLook.pop(), 'Project look (set by the user): accent #e0a030, font "Inter".')
  assert.equal(withLook.join('\n'), ctx)
  p.look = {}
  assert.equal(rangeContext(p, [0.5, 3]), ctx)
})

test('decision 7: no string the answer code writes holds a word of look or advice (command names aside)', () => {
  const dir = path.join(SRC, 'renderer', 'src', 'agent')
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f)), path.join(SRC, 'renderer', 'src', 'notes', 'agent.ts')]
  const hits: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    if (path.basename(f) === 'tools.ts') continue // the catalogue and the definitions: the tests above
    for (const m of src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)) {
      if (INTERNAL.has(m[0])) continue
      if (BANNED.test(m[0].replace(/\b[a-z]+\.[a-zA-Z]+\b/g, ''))) hits.push(`${path.basename(f)}: ${m[0].slice(0, 120)}`)
    }
  }
  assert.deepEqual(hits, [])
})

// ---- Audit T1: tools.ts itself, help, and the error messages ---------------------

/** Command names (`caption.setStyle`) and field names in a signature are the
 *  catalogue: not words said to the agent. */
const words = (s: string): string => s.replace(/\b[a-z]+\.\{[^}]*\}/g, '').replace(/\b[a-z]+\.[a-zA-Z]+\b/g, '').replace(/\{[^{}]*\}/g, '{}')

test('audit T1: every help answer holds no word of look or advice (but the user\'s own subtitle and G lane settings it edits)', () => {
  // Commands whose summary names the user's own settings of that kind (the
  // subtitles' look, a G lane item, a still's look, a marker's colour): what
  // they edit, not advice.
  const OWN = /^(caption\.|captions\.|template\.|fx\.stillImage$|timeline\.cutRanges$|marker\.update$)/
  const hits: string[] = []
  for (const c of editCommands()) {
    if (OWN.test(c.name)) continue
    const h = words(opsHelp([c.name]))
    const m = BANNED.exec(h)
    if (m) hits.push(`${c.name}: "${m[0]}" in ${h.slice(Math.max(0, m.index - 50), m.index + 50)}`)
  }
  assert.deepEqual(hits, [])
})

test('audit T1: tools.ts\'s own strings, the commands\' error messages, the main process\'s answers and the code film messages the agent gets hold no word of look or advice', () => {
  const files = [
    path.join(SRC, 'renderer', 'src', 'agent', 'tools.ts'),
    ...readdirSync(path.join(SRC, 'renderer', 'src', 'commands')).filter((f) => f.endsWith('.ts')).map((f) => path.join(SRC, 'renderer', 'src', 'commands', f)),
    ...['agent-protocol.ts', 'agent-server.ts', 'agent-host.ts', 'agent-restore.ts'].map((f) => path.join(SRC, 'main', f))
  ]
  const hits: string[] = []
  for (const f of files) {
    const src = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    // In commands/: only what is thrown at the caller (CommandError, Error).
    const strings = path.dirname(f).endsWith('commands')
      ? [...src.matchAll(/(?:CommandError|Error)\(\s*[^,()]*,?\s*('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`)/g)].map((m) => m[1])
      : [...src.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map((m) => m[0])
    for (const s of strings) {
      if (INTERNAL.has(s)) continue
      if (BANNED.test(words(s))) hits.push(`${path.basename(f)}: ${s.slice(0, 120)}`)
    }
  }
  for (const [k, v] of Object.entries(STRINGS)) {
    if (!/^codeFilm\.(checkNote|checkPasses|glLost|pageBlocked|pageMemory|pageStopped|tooMany|unresponsive|verdict\.)/.test(k)) continue
    if (BANNED.test((v as { en: string }).en)) hits.push(`${k}: ${(v as { en: string }).en}`)
  }
  assert.deepEqual(hits, [])
})

test('cila K: nothing an agent is given says that a page\'s values are found by the app or can be changed by hand', () => {
  // (The feature is the user's: no page is asked to be written in any way for
  // it. Its commands are internal, its words live in the editor only.)
  const names = editCommands().map((c) => c.name)
  assert.ok(!names.includes('code.setEdits') && !names.includes('code.setParams'), 'the commands are not offered')
  const p = defaultProject()
  const given = [
    JSON.stringify(agentTools()),
    SERVER_INSTRUCTIONS,
    editOperations(),
    opsHelp(names),
    EMPTY_PAGE,
    rangeContext(p, [0, 3]),
    ...(['ok', 'blank', 'unstable', 'error'] as const).map((verdict) => checkText({ verdict, lines: [BLANK_LINE], length: 4, width: 1920, height: 1080, moments: [0.4, 2, 3.6], ms: 900, at: 0 }, 'c1'))
  ]
  const SAID = /code.?values?|codeval|setEdits|set\s?Params|__params|\bsne=|by hand\b.*(colou?r|text|font)|hand-made|hand-set/i
  for (const text of given) {
    const hit = SAID.exec(text)
    assert.equal(hit, null, `"${hit?.[0]}" in ${text.slice(Math.max(0, (hit?.index ?? 0) - 60), (hit?.index ?? 0) + 60)}`)
  }
  // An unknown name (the internal command's) is answered as unknown, not
  // described (the answer echoes only the name the agent itself sent).
  const unknown = opsHelp(['code.setEdits'])
  assert.match(unknown, /no such operation/)
  assert.doesNotMatch(unknown.replace('code.setEdits', ''), SAID)
  assert.doesNotMatch(unknown, /constants|changes of|colou?r|font/i)
  // And no source file an agent's answers are written in names the feature.
  const dir = path.join(SRC, 'renderer', 'src', 'agent')
  const files = [...readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => path.join(dir, f)), path.join(SRC, 'renderer', 'src', 'notes', 'agent.ts'), ...['agent-protocol.ts', 'agent-server.ts', 'agent-host.ts', 'agent-connect.ts'].map((f) => path.join(SRC, 'main', f))]
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /codeval|code-values|codefilm-values|setEdits|\.edits\b/, path.basename(f))
})
