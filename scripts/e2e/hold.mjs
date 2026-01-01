// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// node scripts/e2e/hold.mjs [minutes]: opens the test window (off-screen, own
// profile) and keeps it open for exploring and writing scenarios; prints the
// CDP port to scripts/e2e/.hold.json. The window goes when this process ends
// (or after `minutes`, default 30). Used with: node scripts/e2e/eval.mjs <file.js>
import { writeFileSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { launchApp } from './app.mjs'

const minutes = Number(process.argv[2] ?? 30)
const app = await launchApp()
const info = fileURLToPath(new URL('./.hold.json', import.meta.url))
writeFileSync(info, JSON.stringify({ port: app.port, agentPort: app.agentPort, profile: app.profile, pid: app.proc.pid }))
console.log(JSON.stringify({ port: app.port, agentPort: app.agentPort, profile: app.profile }))
const end = async () => {
  rmSync(info, { force: true })
  await app.close()
  process.exit(0)
}
app.proc.on('exit', end)
process.on('SIGINT', end)
setTimeout(end, minutes * 60_000)
