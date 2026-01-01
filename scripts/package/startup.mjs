// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// How fast the packaged program starts (SnippStudio phase 9a, "bitti ölçüsü"):
// launched with a fresh profile, off-screen, three times; for each, from the
// launch to
//   - the first window (its page is there to connect to),
//   - the editor drawn (the top bar and the store exist),
//   - the first frame painted after that (a requestAnimationFrame).
// Prints the medians.
// Phase 11c: since the security patch (launch-guard.ts) a packaged copy does
// not start with --remote-debugging-port unless it is a test copy (the
// marker file in its resources, --e2e and its own --user-data-dir), so the
// package is marked for the run (scripts/e2e/packaged.mjs preparePackaged;
// the marker is removed at exit). The only difference from the shipped
// launch: the test hooks (window.__store …) are installed.
//
//   node scripts/package/startup.mjs <package folder> [--runs=3]
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { freePort, killTree } from '../e2e/app.mjs'
import { preparePackaged } from '../e2e/packaged.mjs'
import { cdpEvaluate } from '../page-eval.mjs'

const folder = resolve(process.argv[2] ?? 'release')
const runs = Number((process.argv.find((a) => a.startsWith('--runs=')) ?? '--runs=3').split('=')[1])
const { exe } = preparePackaged(folder)

async function once() {
  const profile = mkdtempSync(join(tmpdir(), 'snipp-startup-'))
  const port = await freePort()
  const t0 = performance.now()
  const proc = spawn(exe, ['--e2e', `--user-data-dir=${profile}`, '--show-inactive=offscreen', `--remote-debugging-port=${port}`], { cwd: dirname(exe), stdio: 'ignore', windowsHide: true })
  let ws
  try {
    let page = null
    while (!page) {
      if (performance.now() - t0 > 60_000) throw new Error('no window in 60 s')
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
        page = targets.find((t) => t.type === 'page' && t.url.startsWith('file:')) ?? null
      } catch { /* not up yet */ }
      if (!page) await new Promise((r) => setTimeout(r, 20))
    }
    const window = performance.now() - t0
    ws = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }) })
    let id = 0
    const send = (method, params = {}) => new Promise((res, rej) => {
      const me = ++id
      const on = (m) => {
        const msg = JSON.parse(m.data)
        if (msg.id !== me) return
        ws.removeEventListener('message', on)
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
      }
      ws.addEventListener('message', on)
      ws.send(JSON.stringify({ id: me, method, params }))
    })
    // A promise awaited through a handle (scripts/page-eval.mjs).
    const ev = (expression) => cdpEvaluate(send, expression)
    let editor = 0
    while (!editor) {
      if (performance.now() - t0 > 60_000) throw new Error('no editor in 60 s')
      if (await ev(`!!(window.__store && document.querySelector('[data-testid="topbar.file"]'))`).catch(() => false)) editor = performance.now() - t0
      else await new Promise((r) => setTimeout(r, 20))
    }
    await ev('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))')
    const frame = performance.now() - t0
    return { window, editor, frame }
  } finally {
    try { ws?.close() } catch { /* closed */ }
    killTree(proc.pid)
    await new Promise((r) => setTimeout(r, 800))
    for (let i = 0; i < 10; i++) { try { rmSync(profile, { recursive: true, force: true }); break } catch { await new Promise((r) => setTimeout(r, 300)) } }
  }
}

const all = []
for (let i = 0; i < runs; i++) {
  const r = await once()
  all.push(r)
  console.log(`run ${i + 1}: first window ${Math.round(r.window)} ms, editor drawn ${Math.round(r.editor)} ms, first frame ${Math.round(r.frame)} ms`)
}
const med = (k) => { const v = all.map((r) => r[k]).sort((a, b) => a - b); return Math.round(v[Math.floor(v.length / 2)]) }
console.log(JSON.stringify({ exe, runs, firstWindowMs: med('window'), editorMs: med('editor'), firstFrameMs: med('frame') }))
