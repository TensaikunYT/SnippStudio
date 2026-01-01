// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Local export smoke test with two generated video clips. Never opens user media.
const { app, BrowserWindow } = require('electron')
const { buildSync } = require('esbuild')
const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const qaRoot = path.resolve('out-test')
fs.mkdirSync(qaRoot, { recursive: true })
for (const [name, frequency, mirrored] of [
  ['ramp-fixture-a.mp4', 440, false],
  ['ramp-fixture-b.mp4', 660, true]
]) {
  const target = path.join(qaRoot, name)
  if (fs.existsSync(target)) continue
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi',
    '-i', 'testsrc2=size=160x90:rate=30', '-f', 'lavfi',
    '-i', `sine=frequency=${frequency}:sample_rate=48000`,
    ...(mirrored ? ['-vf', 'hflip'] : []), '-t', '5', '-c:v', 'libx264',
    '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', target]
  const generated = spawnSync('ffmpeg', args, { encoding: 'utf8' })
  if (generated.status !== 0) throw new Error(`Could not create ${name}: ${generated.stderr}`)
}
const page = path.join(qaRoot, 'ramp-qa.html')
if (!fs.existsSync(page)) fs.writeFileSync(page, '<!doctype html><meta charset="utf-8">')
const videoA = fs.readFileSync(path.join(qaRoot, 'ramp-fixture-a.mp4')).toString('base64')
const videoB = fs.readFileSync(path.join(qaRoot, 'ramp-fixture-b.mp4')).toString('base64')
app.setPath('userData', path.join(qaRoot, 'speed-ramp-export-profile'))

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/.test(details.url) }))
  await win.loadFile(page)
  const source = `
    import { defaultProject } from './src/renderer/src/types'
    import { browserFiles } from './src/renderer/src/platform'
    import { exportProjectMp4, exportFramePng } from './src/renderer/src/export/exporter'
    crypto.randomUUID ??= (() => 'qa-' + Math.random().toString(36).slice(2));
    window.qaPromise = (async () => {
      const project = defaultProject()
      project.settings = { width: 160, height: 90, fps: 30 }
      const track = project.tracks[0]
      track.clipIds = ['a', 'b']
      for (const [index, id] of ['a', 'b'].entries()) {
        const bytes = Uint8Array.from(atob(index === 0 ? ${JSON.stringify(videoA)} : ${JSON.stringify(videoB)}),
          char => char.charCodeAt(0))
        browserFiles.set(id, new File([bytes], id + '.mp4', { type: 'video/mp4' }))
        project.assets.push({ id, name: id + '.mp4', kind: 'video', url: '', size: bytes.length,
          duration: 5, width: 160, height: 90, hasAudio: true })
        project.clips[id] = { id, assetId: id, trackId: track.id, start: index * 5,
          duration: 5, inPoint: 0, transform: { x: 80, y: 45, scale: 1, rotation: 0 }, volume: 1 }
      }
      project.clips.a.transitionOut = { type: 'speed-ramp', duration: 0.7, peakSpeed: 10, direction: 'right' }
      const frames = []
      for (const time of [4.92, 4.99, 5.01, 5.08]) {
        const png = await exportFramePng(project, time, false)
        frames.push(Array.from(png))
      }
      const movie = await exportProjectMp4(project, {
        onProgress: () => {},
        settings: { range: [4.5, 5.5], fps: 30, resolutionScale: 1, bitrateFactor: 0.1 }
      })
      const toBase64 = bytes => {
        let raw = ''; for (let i = 0; i < bytes.length; i += 8192) {
          raw += String.fromCharCode(...bytes.subarray(i, i + 8192))
        }
        return btoa(raw)
      }
      return { movie: toBase64(movie), frames: frames.map(frame => toBase64(Uint8Array.from(frame))) }
    })()
  `
  const bundle = buildSync({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', platform: 'browser', target: 'chrome120',
    loader: { '.ttf': 'dataurl', '.wasm': 'dataurl' } }).outputFiles[0].text
  await win.webContents.executeJavaScript(bundle)
  const result = await win.webContents.executeJavaScript('window.qaPromise')
  fs.writeFileSync(path.join(qaRoot, 'smooth-ramp-qa.mp4'), Buffer.from(result.movie, 'base64'))
  result.frames.forEach((frame, index) => {
    fs.writeFileSync(path.join(qaRoot, `smooth-ramp-frame-${index}.png`), Buffer.from(frame, 'base64'))
  })
  fs.writeFileSync(path.join(qaRoot, 'smooth-ramp-export-qa.json'), JSON.stringify({ passed: true,
    movieBytes: Buffer.byteLength(result.movie, 'base64'), frames: result.frames.length }))
  app.exit(0)
}).catch(error => {
  fs.writeFileSync(path.join(qaRoot, 'smooth-ramp-export-qa.json'), JSON.stringify({ error: String(error.stack || error) }))
  app.exit(1)
})
