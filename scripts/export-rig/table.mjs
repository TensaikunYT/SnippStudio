// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/export-rig/table.mjs <rig-label> : the rig's results as the
// plan's Markdown tables (capability matrix, edges, freeze / reverse).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CIKTI } from './sources.mjs'

const label = process.argv[2] ?? 'son'
const r = JSON.parse(readFileSync(join(CIKTI, `rig-${label}.json`), 'utf8'))
const out = []
const caps = new Map((r.caps ?? []).map((c) => [`${c.w}x${c.h}@${c.fps}`, c]))
if (r.matrix) {
  out.push('| cell | encoder said (hw / sw) | result | fps | file: size · r_frame_rate · time_base | frames (got / asked) | spacing | key frames | level | colour | asked → delivered Mb/s | counter: wrong · repeats (rate asks) · skips (rate asks) |')
  out.push('|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const [k, v] of Object.entries(r.matrix)) {
    const [cell, codec] = k.split('.')
    const cap = caps.get(cell)
    const said = cap ? `${cap[`${codec}.prefer-hardware`]} / ${cap[`${codec}.prefer-software`]}` : (v.encoder ?? '')
    if (v.error) {
      out.push(`| ${k} | ${said} | **fails**: ${v.error.replace(/\|/g, '/')} | | | | | | | | | |`)
      continue
    }
    const c = v.counter ?? {}
    out.push(`| ${k} | ${said}${v.hw ? ` (used: ${v.hw.replace('prefer-', '')})` : ''} | works | ${v.fps.toFixed(1)} | ${v.size} · ${v.rate} · ${v.timeBase} | ${v.nb} / ${v.frames}${v.countOk ? '' : ' **≠**'} | ${v.constant ? 'constant' : `**off ${v.ptsWorstTicks} ticks**`} | ${v.keyGaps.join(', ')} s | ${v.level} | ${v.bt709 ? 'BT.709' : v.color} | ${v.asked ? (v.asked / 1e6).toFixed(1) : '?'} → ${(v.bitrate / 1e6).toFixed(1)} | ${c.wrong} · ${c.repeats} (${c.expectedRepeats ?? "?"}) · ${c.skips} (${c.expectedSkips ?? "?"})${c.back ? " · back " + c.back : ""} |`)
  }
}
if (r.edges) {
  out.push('', '| output | edge 10–90 % (px) | × 1080p | fps |', '|---|---|---|---|')
  const base = r.edges['1080p']?.edge?.esf ?? r.edges['1080p']?.edge?.median
  for (const [k, v] of Object.entries(r.edges)) {
    if (k === 'zone') out.push(`| zone plate 1080p | aliasing σ ${v.aliasStd} (mean ${v.aliasMean}) | | ${v.fps?.toFixed(1)} |`)
    else out.push(`| ${k} | ${v.edge?.esf ?? v.edge?.median} (${v.edge?.edges} edges) | ${base ? ((v.edge.esf ?? v.edge.median) / base).toFixed(2) : ''} | ${v.fps?.toFixed(1)} |`)
  }
}
if (r.fx) {
  out.push('', '| 4K clip (2160p30 long GOP), exported 3840×2160 | fps | × forward | counter first · last |', '|---|---|---|---|')
  const f = r.fx.forward?.fps
  for (const [k, v] of Object.entries(r.fx)) out.push(`| ${k} | ${v.error ? 'fails: ' + v.error : v.fps.toFixed(1)} | ${f && v.fps ? (v.fps / f).toFixed(2) : ''} | ${(v.counterHead ?? []).join(',')} · ${(v.counterTail ?? []).join(',')} |`)
}
console.log(out.join('\n'))
