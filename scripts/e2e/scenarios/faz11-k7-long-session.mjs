// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 11a, K7: a long session. 30 minutes of scripted editing (K4's random
// edit machine) and playing, in one window. Measured every 2 minutes: the
// page's JS heap (CDP Performance.getMetrics), the app's process tree (count
// and working set, from the OS, our own child's tree only). Expected: the
// page's memory grows by less than 300 MB, the number of processes stays.
import { spawnSync } from 'node:child_process'
import { installProbe, keepModelCount, record, tally } from '../kesif.mjs'
import { MACHINE, seedProject } from './faz11-k4-random-500.mjs'
export const optIn = true
export const name = 'faz11-k7-long-session'
export const timeoutMs = 45 * 60_000

const MINUTES = Number(process.env.SNIPP_K7_MINUTES ?? 30)

/** Our app's process tree: count and working sets (MB). */
function tree(rootPid) {
  const r = spawnSync('powershell', ['-NoProfile', '-Command', 'Get-CimInstance Win32_Process -Filter "Name=\'electron.exe\'" | Select-Object ProcessId,ParentProcessId,WorkingSetSize,CommandLine | ConvertTo-Json -Compress'], { encoding: 'utf8', windowsHide: true })
  let list = []
  try { list = [].concat(JSON.parse(r.stdout || '[]')) } catch { return null }
  const kids = new Map()
  for (const p of list) kids.set(p.ParentProcessId, [...(kids.get(p.ParentProcessId) ?? []), p])
  const out = []
  const walk = (pid) => { for (const k of kids.get(pid) ?? []) { out.push(k); walk(k.ProcessId) } }
  const root = list.find((p) => p.ProcessId === rootPid)
  if (root) out.push(root)
  walk(rootPid)
  const renderer = out.filter((p) => /--type=renderer/.test(p.CommandLine ?? ''))
  return { count: out.length, totalMB: Math.round(out.reduce((n, p) => n + Number(p.WorkingSetSize), 0) / 1048576), renderers: renderer.length, rendererMB: Math.round(renderer.reduce((n, p) => n + Number(p.WorkingSetSize), 0) / 1048576) }
}

export async function run(ctx) {
  const { c, app, lib } = ctx
  const { assert } = lib
  await installProbe(c)
  await seedProject(ctx)
  await c.ev(`${MACHINE}(7777)`)
  await c.send('Performance.enable').catch(() => undefined)
  const heap = async () => {
    await c.send('HeapProfiler.collectGarbage').catch(() => undefined)
    const m = await c.send('Performance.getMetrics')
    const get = (n) => m.metrics.find((x) => x.name === n)?.value ?? 0
    return { usedMB: Math.round(get('JSHeapUsedSize') / 1048576), totalMB: Math.round(get('JSHeapTotalSize') / 1048576), nodes: get('Nodes'), listeners: get('JSEventListeners') }
  }
  const samples = []
  const sample = async (label) => { const s = { min: +((Date.now() - t0) / 60000).toFixed(1), label, heap: await heap(), tree: tree(app.proc.pid), clips: await c.st((s) => Object.keys(s.project.clips).length) }; samples.push(s); console.log(`     ${JSON.stringify(s)}`) }
  const t0 = Date.now()
  await sample('start')
  let steps = 0, plays = 0, nextSample = 2
  let resets = 0
  while (Date.now() - t0 < MINUTES * 60000) {
    for (let i = 0; i < 15; i++) { await c.ev('window.__k4.step()'); steps++ }
    // Play a few seconds from somewhere.
    await c.run(() => { const s = window.__store.getState(); const len = Math.max(1, ...Object.values(s.project.clips).map((k) => k.start + k.duration)); s.setTime(Math.random() * len * 0.8); s.setPlaying(true); return true })
    await c.sleep(4000)
    await c.run(() => { window.__store.getState().setPlaying(false); return true })
    plays++
    // A project that grew past what an edit session holds starts over (as the
    // user opens the next one) — the window and its page stay.
    if ((await c.st((s) => Object.keys(s.project.clips).length)) > 120) {
      await c.run(() => { const s = window.__store.getState(); s.newProject('16:9'); s.setDirty(false); return true })
      await seedProject(ctx)
      await c.ev(`${MACHINE}(${7777 + ++resets})`)
    }
    if ((Date.now() - t0) / 60000 >= nextSample) { await sample(`after ${steps} steps`); nextSample += 2 }
  }
  await sample('end')
  await keepModelCount(c)
  const counts = await tally(c)
  const first = samples[0], last = samples.at(-1)
  const result = {
    minutes: MINUTES, steps, plays, resets,
    heapGrowthMB: last.heap.usedMB - first.heap.usedMB,
    rendererGrowthMB: (last.tree?.rendererMB ?? 0) - (first.tree?.rendererMB ?? 0),
    treeGrowthMB: (last.tree?.totalMB ?? 0) - (first.tree?.totalMB ?? 0),
    processes: [...new Set(samples.map((s) => s.tree?.count))],
    samples
  }
  record(name, { counts, result })
  console.log(`     ${JSON.stringify({ ...result, samples: undefined })}\n     counts: ${JSON.stringify({ ...counts, texts: undefined })}`)
  assert.ok(result.heapGrowthMB < 300, `page heap growth ${result.heapGrowthMB} MB`)
}
