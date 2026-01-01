// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The design values have one definition (ui/tokens.css; SnippStudio phase 1
// step 1.0, values v2 in phase 3a), it matches the one source
// (the design notes tasarim\TASARIM.md beside the repository, when they are
// there), its text is readable (4.5:1), and
// the sheets of the new language use nothing else.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const SRC = join(__dirname, '..', '..', 'src', 'renderer', 'src')
const read = (f: string): string => readFileSync(join(SRC, f), 'utf8')
/** A stylesheet without its comments (a comment may name a colour). */
const code = (f: string): string => read(f).replace(/\/\*[\s\S]*?\*\//g, '')

const tokens = code('ui/tokens.css')
/** The :root block's own values (not the reduced-motion overrides). */
// (The values under html.motion-off, the durations at 0, are that state's own: read apart below.)
const rootBlock = tokens.slice(0, tokens.indexOf('html.motion-off'))
const values = new Map([...rootBlock.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
const defined = new Set([...tokens.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
/** A value with var() followed to the end. */
const resolve = (name: string, seen = 0): string => {
  const v = values.get(name)
  assert.ok(v !== undefined, `${name} is defined`)
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(v!)
  return m && seen < 10 ? resolve(m[1], seen + 1) : v!
}
/** Values a component sets on its own element (style={{ '--x': … }}). */
const fromCode = new Set<string>()
const walk = (dir: string): string[] => readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]))
for (const f of [...walk('components'), ...walk('ui')]) {
  if (!f.endsWith('.tsx') && !f.endsWith('.ts')) continue
  for (const m of read(f).matchAll(/['"`](--[a-z0-9-]+)['"`]/g)) fromCode.add(m[1])
}
/** Every stylesheet of the renderer but the values themselves (phase 3c.4b:
 *  no list to forget a sheet on; styles.css is gone). */
const SHEETS = walk('.').map((f) => f.slice(2)).filter((f) => f.endsWith('.css') && f !== 'ui/tokens.css').sort()

// ---- the one source ---------------------------------------------------------
const TASARIM = join(__dirname, '..', '..', '..', 'tasarim', 'TASARIM.md')
const hasSource = existsSync(TASARIM)
const md = hasSource ? readFileSync(TASARIM, 'utf8') : ''
const lineOf = (start: string): string => {
  const l = md.split('\n').find((x) => x.trim().startsWith(start))
  assert.ok(l, `TASARIM.md has a line starting "${start}"`)
  return l!
}
const hex = (v: string): string => v.toUpperCase()
const sameColour = (name: string, want: string): void => assert.equal(hex(resolve(name)), hex(want), `${name} is ${want} as TASARIM.md says`)

test('TASARIM.md colour table = tokens.css (names, values, the second values in brackets)', { skip: !hasSource && 'TASARIM.md is not beside the repository' }, () => {
  const table = md.slice(md.indexOf('## Renkler'), md.indexOf('## Yazı'))
  const rows = [...table.matchAll(/^\|\s*`(--[a-z0-9-]+)`\s*\|\s*([^|]+)\|/gm)]
  assert.ok(rows.length >= 19, `the colour table has its rows (${rows.length})`)
  const suffix: Record<string, string> = { kenar: 'line', zemin: 'soft', 'yazı': 'text' }
  let seconds = 0
  for (const [, name, cell] of rows) {
    const main = /`(#[0-9A-Fa-f]{6})`/.exec(cell)
    assert.ok(main, `${name} has a value`)
    sameColour(name, main![1])
    for (const m of cell.matchAll(/(kenar|zemin|yazı)\s*`(#[0-9A-Fa-f]{6})`/g)) {
      sameColour(`${name.replace(/-soft$/, '')}-${suffix[m[1]]}`, m[2])
      seconds++
    }
  }
  assert.equal(seconds, 8, 'the eight second values (accent, agent, danger, note)')
  // The clips' table and the waveform.
  const clips = [...table.matchAll(/^\|\s*(video|code|image|audio)\s*\|\s*`(#\w{6})`\s*\|\s*`(#\w{6})`\s*\|\s*`(#\w{6})`\s*\|/gm)]
  assert.equal(clips.length, 4)
  for (const [, kind, fill, line, text] of clips) {
    sameColour(`--clip-${kind}-fill`, fill)
    sameColour(`--clip-${kind}-line`, line)
    sameColour(`--clip-${kind}-text`, text)
  }
  sameColour('--clip-wave', /ses dalgası `(#\w{6})`/.exec(table)![1])
})

test('TASARIM.md type, sizes, corners, gaps, layers, motion = tokens.css', { skip: !hasSource && 'TASARIM.md is not beside the repository' }, () => {
  const nums = (s: string): number[] => [...s.matchAll(/\d+(?:,\d+)?/g)].map((m) => Number(m[0].replace(',', '.')))
  const px = (name: string): number => {
    const v = resolve(name)
    assert.match(v, /^\d+px$/, `${name} is in px`)
    return parseInt(v, 10)
  }
  // Type sizes: exactly these, no other --fs-<n>.
  const sizes = nums(lineOf('- Boyutlar:'))
  assert.deepEqual(sizes, [11, 12, 13, 14, 15])
  for (const n of sizes) assert.equal(px(`--fs-${n}`), n)
  assert.deepEqual([...values.keys()].filter((k) => /^--fs-\d+$/.test(k)).map((k) => Number(k.slice(5))), sizes)
  // Weights.
  const weights = nums(lineOf('- Ağırlıklar:'))
  assert.deepEqual(weights, [400, 500, 600])
  assert.deepEqual([resolve('--fw-regular'), resolve('--fw-medium'), resolve('--fw-semibold')].map(Number), weights)
  // Faces.
  assert.match(resolve('--font'), /^'Inter UI'/)
  assert.match(resolve('--font-mono'), /^'JetBrains Mono'/)
  // Controls 28 / 24 and the known exceptions.
  const ctl = lineOf('- Kontrol yüksekliği:')
  assert.deepEqual([...ctl.matchAll(/\*\*(\d+)\*\*/g)].map((m) => Number(m[1])), [px('--ctl'), px('--ctl-sm')])
  const ex = lineOf('- Kuralın bilinen istisnaları:')
  assert.equal(px('--tab-h'), Number(/sekme satırı (\d+)/.exec(ex)![1]))
  assert.equal(px('--seg-h'), Number(/parçalı seçim (\d+)/.exec(ex)![1]))
  const sw = /anahtarı (\d+)×(\d+)/.exec(ex)!
  assert.deepEqual([px('--switch-w'), px('--switch-h')], [Number(sw[1]), Number(sw[2])])
  assert.equal(px('--check'), Number(/onay kutusu (\d+)/.exec(ex)![1]))
  assert.equal(px('--play'), Number(/oynat düğmesi (\d+)/.exec(ex)![1]))
  // Corners.
  const r = lineOf('- Köşe:')
  assert.equal(px('--r-ctl'), Number(/kontrol (\d+)/.exec(r)![1]))
  assert.equal(px('--r-card'), Number(/kart ve menü (\d+)/.exec(r)![1]))
  assert.equal(px('--r-clip'), Number(/Klip (\d+)/.exec(r)![1]))
  assert.ok(/yarısı/.test(r) && px('--r-pill') >= 999, 'a chip is round at its ends')
  // Gaps.
  const gaps = lineOf('- Boşluk:')
  assert.deepEqual(nums(gaps.split('(')[0]), [1, 2, 3, 4, 5].map((i) => px(`--space-${i}`)))
  assert.equal(px('--pad-panel'), Number(/panel iç boşluğu (\d+)/.exec(gaps)![1]))
  // The focus ring.
  const focus = lineOf('- Sınır:')
  const halo = /`(rgba\([^)]+\))`/.exec(focus)![1]
  assert.equal(resolve('--focus-halo').replace(/\s|0(?=\.)/g, ''), halo.replace(/\s|0(?=\.)/g, ''))
  assert.equal(resolve('--focus-ring'), '0 0 0 1px var(--accent), 0 0 0 3px var(--focus-halo)')
  // Layers: exactly these values.
  const z = lineOf('- Katman sırası')
  const zs = nums(z.split(':').slice(1).join(':'))
  const ours = ['--z-base', '--z-sticky', '--z-timeline', '--z-pop', '--z-dialog', '--z-toast', '--z-tooltip'].map((k) => Number(resolve(k)))
  assert.deepEqual(ours, zs)
  assert.deepEqual([...values.keys()].filter((k) => k.startsWith('--z-')).length, zs.length)
  // Motion.
  const d = lineOf('- Süreler:')
  assert.deepEqual(nums(d).filter((n) => n >= 100), ['--dur-fast', '--dur-mid', '--dur-slow'].map((k) => parseInt(resolve(k), 10)))
  assert.equal(resolve('--ease'), /`(cubic-bezier\([^)]+\))`/.exec(lineOf('- Tek yumuşatma:'))![1])
  const ag = lineOf('- Ajan görselleri:')
  assert.equal(resolve('--agent-sweep'), /(\d+,\d+) saniyede geçer/.exec(ag)![1].replace(',', '.') + 's')
  assert.equal(resolve('--agent-pulse'), /nabzı (\d+,\d+) saniye/.exec(ag)![1].replace(',', '.') + 's')
  assert.equal(resolve('--agent-looked'), /(\d+,\d+) saniye görünür/.exec(ag)![1].replace(',', '.') + 's')
  assert.equal(resolve('--agent-stagger'), /(\d+) ms arayla/.exec(ag)![1] + 'ms')
  assert.equal(resolve('--agent-read-min'), /en az (\d+) ms/.exec(ag)![1] + 'ms')
  // The tooltip's wait (Kontroller table).
  assert.equal(resolve('--tooltip-delay'), /(\d+) ms gecikme/.exec(md)![1] + 'ms')
})

// ---- readable text ------------------------------------------------------------
/** WCAG 2 contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (h: string): number => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl
  }
  const [x, y] = [lum(a), lum(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

test('contrast: every text colour on the surfaces it is used on is at least 4.5:1', () => {
  assert.ok(contrast('#000000', '#FFFFFF') > 20.9 && contrast('#777777', '#FFFFFF') < 4.5, 'the formula')
  // v3.1: the stage (ruler numbers, lane names over it) and a lane are surfaces too.
  const surfaces = ['--bg-well', '--bg-app', '--bg-panel', '--bg-raised', '--bg-hover', '--bg-lane']
  const pairs: [string, string][] = []
  // (--warn joined in phase 3c.4b: the one value outside TASARIM.md's tables that text uses.)
  for (const text of ['--text', '--text-2', '--text-3', '--accent-text', '--agent-text', '--danger-text', '--note-text', '--accent', '--danger', '--warn', '--mark-text']) for (const s of surfaces) pairs.push([text, s])
  pairs.push(
    ['--on-accent', '--accent'], ['--on-agent', '--agent'],
    ['--accent-text', '--accent-soft'], ['--agent-text', '--agent-soft'], ['--danger-text', '--danger-soft'], ['--note-text', '--note-soft'],
    ['--text', '--accent-soft'], ['--text', '--agent-soft'], ['--text-2', '--accent-soft'],
    ['--clip-video-text', '--clip-video-fill'], ['--clip-code-text', '--clip-code-fill'], ['--clip-image-text', '--clip-image-fill'], ['--clip-audio-text', '--clip-audio-fill'],
    // The tooltip: a light bubble, dark text.
    ['--bg-app', '--text'],
    // Phase 3c.4b: the main button under the pointer; the selected caption chip's text.
    ['--on-accent', '--accent-text'], ['--text', '--bg-hover'], ['--clip-image-text', '--clip-image-fill'],
    // The visual polish: the filled button pressed; an error toast's text on its tone.
    ['--on-accent', '--accent-press'], ['--text', '--danger-soft'], ['--text-2', '--danger-soft'],
    // v3.1: the selection's gold frame stands out on a lane and on a video clip.
    ['--select', '--bg-lane'], ['--select', '--clip-video-fill'], ['--clip-caption-text', '--clip-caption-fill']
  )
  const low: string[] = []
  for (const [t, s] of pairs) {
    const r = contrast(resolve(t), resolve(s))
    if (r < 4.5) low.push(`${t} on ${s}: ${r.toFixed(2)}`)
  }
  assert.deepEqual(low, [])
  assert.ok(pairs.length >= 50)
})

// The visual polish ("az, çok", GORSEL-PLAN.md): parts are told apart by their
// tone, not a line, and a bare button's states by its fill. Each step of the
// surfaces must be visible (a luminance ratio of at least 1.08), and the
// greys come from the one ramp of nine.
test('surfaces and button states are told apart by tone; the greys are one ramp', () => {
  // DENEME-1 (the user: CapCut's greys, no black): the stage is no longer a
  // darker depth under the ground but sits just under a panel, close to it
  // on purpose (the timeline reads as part of its card); it is told apart by
  // the lanes on it and the gap around the card, not by its tone. So it is
  // held the other way: close to the panel, never black.
  const near = contrast(resolve('--bg-well'), resolve('--bg-panel'))
  assert.ok(near < 1.1, `--bg-well / --bg-panel: ${near.toFixed(3)} (the stage stays close to the panel)`)
  assert.ok(contrast(resolve('--bg-well'), '#000000') > 1.2, 'the stage is not black')
  const steps: [string, string][] = [
    ['--bg-app', '--bg-panel'], // the ground and a panel
    ['--bg-panel', '--bg-raised'], // a panel and a soft-filled button, card or menu
    ['--bg-raised', '--bg-hover'], // pressed (raised) and under the pointer (hover)
    ['--bg-panel', '--bg-hover'] // a bare button at rest and under the pointer
  ]
  for (const [a, b] of steps) {
    const r = contrast(resolve(a), resolve(b))
    assert.ok(r >= 1.08, `${a} / ${b}: ${r.toFixed(3)}`)
  }
  // Ten steps since v3.1 (--grey-0, the stage).
  const ramp = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => resolve(`--grey-${i}`))
  for (let i = 1; i < ramp.length; i++) assert.ok(contrast(ramp[i], '#000000') > contrast(ramp[i - 1], '#000000'), `--grey-${i} is lighter than --grey-${i - 1}`)
  assert.ok(!ramp.includes('#000000') && !ramp.includes('#FFFFFF'), 'no pure black or white')
  for (const k of ['--bg-well', '--bg-app', '--bg-panel', '--bg-raised', '--bg-hover', '--line', '--line-strong', '--text', '--text-2', '--text-3']) {
    assert.match(values.get(k)!, /^var\(--grey-[0-9]\)$/, `${k} is a step of the ramp`)
  }
})

test('less motion: the durations and the agent pulses stop with motion off (ui/motion.ts: the user\'s choice, or the system\'s when followed)', () => {
  const rm = /html\.motion-off\s*\{([^}]*)\}/.exec(tokens)
  assert.ok(rm, 'tokens.css answers html.motion-off')
  for (const k of ['--dur-fast', '--dur-mid', '--dur-slow', '--agent-sweep', '--agent-pulse']) assert.match(rm![1], new RegExp(`${k}:\\s*0m?s;`), k)
})

// ---- where the values are read -------------------------------------------------
test('the design values are defined once: no :root block but tokens.css, no old name, no styles.css', () => {
  assert.ok(defined.size > 60, 'tokens.css defines the values')
  assert.equal(existsSync(join(SRC, 'styles.css')), false, 'styles.css is gone (phase 3c.4b)')
  for (const sheet of SHEETS) assert.equal(/:root\s*\{/.test(code(sheet)), false, `${sheet}: a :root block of its own`)
  // The old names went with the old panels (phase 3c.4b): neither defined nor read.
  const OLD = ['--bg', '--panel', '--bg2', '--bg3', '--raised', '--hover', '--border', '--border-strong', '--text-dim', '--text-faint', '--accent2', '--ok', '--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--fs-xs', '--fs-sm', '--fs-md', '--fs-base', '--fs-lg', '--r-sm', '--r-md', '--r-lg', '--ctl-h', '--ctl-h-lg', '--num-w', '--num-font', '--clip-video', '--clip-image', '--clip-code', '--clip-audio']
  for (const old of OLD) assert.equal(defined.has(old), false, `${old} is not defined`)
  const reads = new RegExp(`var\\((${OLD.map((o) => o.replace(/-/g, '\\-')).join('|')})\\)`)
  for (const f of [...SHEETS, ...walk('components'), ...walk('ui')].filter((x) => /\.(css|tsx?)$/.test(x))) assert.equal(reads.test(read(f.replace(/^\.\//, ''))), false, `${f} reads an old name`)
  // The faces: the app's text reads the variable; no sheet names a face of its own.
  assert.match(code('ui/base.css'), /body\s*\{[^}]*font-family:\s*var\(--font\);/)
  for (const sheet of SHEETS) assert.equal(/Consolas|Segoe UI/.test(code(sheet)), false, `${sheet}: names a face`)
})

test('the entry loads the values before the styles that read them', () => {
  const main = read('main.tsx')
  const at = (f: string): number => main.indexOf(`import '${f}'`)
  const order = ['./ui/tokens.css', './ui/base.css', './ui/panel.css', './notes/notes.css', './ui/kit.css'].filter((f) => at(f) >= 0)
  assert.equal(order.length, 5)
  for (let i = 1; i < order.length; i++) assert.ok(at(order[i - 1]) < at(order[i]), `${order[i - 1]} before ${order[i]}`)
  // Every sheet is loaded by someone (main.tsx, or the page that uses it).
  const loaders = walk('.').filter((f) => /\.tsx?$/.test(f)).map((f) => read(f.slice(2))).join('\n')
  for (const sheet of SHEETS) assert.ok(loaders.includes(sheet.split('/').pop()!), `${sheet} is imported`)
})

test('the type faces come from the package (no address on the internet)', () => {
  const base = code('ui/base.css')
  const urls = [...base.matchAll(/url\(['"]?([^'")]+)['"]?\)/g)].map((m) => m[1])
  assert.ok(urls.length >= 3)
  for (const u of urls) {
    assert.ok(!/^[a-z]+:/i.test(u), `${u} is a local file`)
    assert.ok(existsSync(join(SRC, 'ui', u)), `${u} exists`)
  }
  assert.match(base, /font-family:\s*'Inter UI'/)
  assert.match(base, /font-family:\s*'JetBrains Mono'/)
  // The CSP still allows fonts from the app itself only.
  const html = readFileSync(join(SRC, '..', 'index.html'), 'utf8')
  assert.match(html, /font-src 'self' data:;/)
})

test('one focus ring: :focus-visible with the accent edge and the halo', () => {
  const base = code('ui/base.css')
  assert.match(base, /:focus-visible\s*\{[^}]*outline:\s*var\(--border-w\) solid var\(--accent\);[^}]*box-shadow:\s*0 0 0 3px var\(--focus-halo\);/)
  // The building blocks do not draw a ring of their own.
  assert.equal(/:focus-visible/.test(code('ui/kit.css')), false)
})

test('less motion: with motion off no transition or animation runs in any sheet', () => {
  const base = code('ui/base.css')
  const m = /html\.motion-off,\s*html\.motion-off \*,\s*html\.motion-off \*::before,\s*html\.motion-off \*::after\s*\{([^}]*)\}/.exec(base)
  assert.ok(m, 'base.css stops every transition and animation')
  for (const p of ['transition-duration: 0s !important', 'animation-duration: 0s !important', 'animation-iteration-count: 1 !important']) assert.ok(m![1].includes(p), p)
})

test('every sheet is written in the design values alone (colours, type, corners, weights, layers)', () => {
  assert.ok(SHEETS.length >= 20, `${SHEETS.length} sheets`)
  const sizes = new Set<string>()
  const layers = new Set<string>()
  for (const sheet of SHEETS) {
    const css = code(sheet).replace(/@font-face\s*\{[^}]*\}/g, '')
    assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(css), false, `${sheet}: a colour written as a literal`)
    assert.equal(/\brgba?\(|\bhsla?\(/.test(css), false, `${sheet}: a colour written as a literal`)
    const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
    for (const m of css.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(defined.has(m[1]) || local.has(m[1]) || fromCode.has(m[1]), `${sheet}: ${m[1]} is not a design value`)
    // Type sizes: one of the five (TASARIM.md), or the parent's.
    for (const m of css.matchAll(/font-size:\s*([^;}]+)/g)) {
      const v = m[1].trim().replace(/\s*!important$/, '')
      assert.ok(/^var\(--fs-1[1-5]\)$/.test(v) || v === 'inherit', `${sheet}: font-size ${v}`)
      if (v !== 'inherit') sizes.add(v)
    }
    assert.equal(/(^|[;{\s])font:\s*[^;}]*\d+(\.\d+)?px/.test(css), false, `${sheet}: a type size in the font shorthand`)
    assert.equal(/border-radius:\s*[\d.]+px/.test(css), false, `${sheet}: a corner written as a literal`)
    for (const m of css.matchAll(/font-weight:\s*([^;}\s]+)/g)) assert.ok(['400', '500', '600', 'inherit'].includes(m[1]) || /^var\(--fw-/.test(m[1]), `${sheet}: weight ${m[1]}`)
    // Layers: the seven named ones only (TASARIM.md, "Katman sırası"). Inside
    // a part that is its own stacking context (the lanes, a clip, the
    // picture) they are used for their order (timeline.css says which).
    for (const m of css.matchAll(/z-index:\s*([^;}]+)/g)) {
      const v = m[1].trim()
      assert.match(v, /^var\(--z-[a-z]+\)$/, `${sheet}: z-index ${v}`)
      assert.ok(defined.has(v.slice(4, -1)), `${sheet}: ${v} is a layer`)
      layers.add(v)
    }
  }
  assert.ok(sizes.size <= 5, `at most five type sizes (${[...sizes].join(' ')})`)
  assert.ok(layers.size <= 7, `at most seven layers (${[...layers].join(' ')})`)
  // The parts whose layers are their own.
  for (const [sheet, sel] of [['components/timeline/timeline.css', '.tl-scroll'], ['components/timeline/timeline.css', '.tl-clip'], ['components/preview/preview.css', '.preview-canvas-wrap']]) {
    assert.match(code(sheet), new RegExp(`\\${sel} \\{[^}]*isolation: isolate`), `${sel} is its own stacking context`)
  }
  // The building blocks: durations from the scale only.
  assert.equal(/\d+m?s\b/.test(code('ui/kit.css').replace(/var\([^)]*\)/g, '')), false, 'kit.css: a duration written as a literal')
})
