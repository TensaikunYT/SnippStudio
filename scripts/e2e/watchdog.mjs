// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node watchdog.mjs <parentPid> <appPid>: when the test process is gone, the
// app's whole process tree goes too (no window is ever left behind).
import { spawnSync } from 'node:child_process'
import { killPlan } from './harness-paths.mjs'
const [parent, child] = process.argv.slice(2).map(Number)
const alive = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
const tick = setInterval(() => {
  if (!alive(child)) return clearInterval(tick)
  if (alive(parent)) return
  clearInterval(tick)
  // (macOS / Linux: the app's whole process group; phase 10a, S3.)
  const plan = killPlan(child)
  if (plan.command) spawnSync(plan.command, plan.args, { stdio: 'ignore', windowsHide: true })
  else try { process.kill(plan.target, plan.signal) } catch { try { process.kill(child, 'SIGKILL') } catch { /* gone */ } }
}, 500)
