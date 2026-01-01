// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Developer-only offline integration check. Launch the packaged app with
// --remote-debugging-port=9225, then pass a short PCM16 WAV to this script.
// It feeds the SAME bundled Worker and preload model IPC that the editor uses.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import WebSocket from 'ws'
import { cdpEvaluate } from './page-eval.mjs'

const wavPath = process.argv[2]
if (!wavPath) throw new Error('Pass a short PCM16 WAV path')
const choice = process.argv[3] === 'english' ? 'english' : 'multilingual'
const language = process.argv[4] ?? 'english'
const wav = readFileSync(wavPath)
let fmt = null
let samples = null
for (let offset = 12; offset + 8 <= wav.length;) {
  const tag = wav.toString('ascii', offset, offset + 4)
  const length = wav.readUInt32LE(offset + 4)
  const start = offset + 8
  if (tag === 'fmt ') fmt = { format: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2), rate: wav.readUInt32LE(start + 4), bits: wav.readUInt16LE(start + 14) }
  if (tag === 'data') samples = wav.subarray(start, start + length)
  offset = start + length + (length & 1)
}
if (!fmt || !samples || fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16) throw new Error('Expected mono PCM16 WAV')
const sampleCount = samples.length / 2
const audio = new Float32Array(Math.floor(sampleCount * 16000 / fmt.rate))
for (let i = 0; i < audio.length; i++) {
  const at = i * fmt.rate / 16000
  const left = Math.min(sampleCount - 1, Math.floor(at))
  const right = Math.min(sampleCount - 1, left + 1)
  const fraction = at - left
  audio[i] = ((1 - fraction) * samples.readInt16LE(left * 2) + fraction * samples.readInt16LE(right * 2)) / 32768
}
const b64 = Buffer.from(audio.buffer).toString('base64')
const workerFile = readdirSync(join('out', 'renderer', 'assets')).find((name) => name.startsWith('whisper.worker-') && name.endsWith('.js'))
if (!workerFile) throw new Error('Build the app first')

const pages = await fetch('http://127.0.0.1:9225/json').then((response) => response.json())
const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
if (!page) throw new Error('No Snipp renderer on localhost:9225')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
let nextId = 0
const pending = new Map()
ws.on('message', (raw) => {
  const packet = JSON.parse(String(raw))
  if (packet.id && pending.has(packet.id)) {
    const pair = pending.get(packet.id)
    pending.delete(packet.id)
    packet.error ? pair.reject(new Error(packet.error.message)) : pair.resolve(packet.result)
  }
})
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++nextId
  pending.set(id, { resolve, reject })
  ws.send(JSON.stringify({ id, method, params }))
})

const expression = `new Promise((resolve) => {
  const worker = new Worker(new URL(${JSON.stringify(`assets/${workerFile}`)}, document.baseURI), { type: 'module' });
  const logs = [];
  const timeout = setTimeout(() => { worker.terminate(); resolve({ error: 'timeout', logs }); }, 600000);
  const finish = (value) => { clearTimeout(timeout); worker.terminate(); resolve({ ...value, logs }); };
  worker.onerror = (event) => finish({ error: event.message || 'worker crashed' });
  worker.onmessage = async ({ data }) => {
    if (data.type === 'rpc') {
      let value = null;
      try {
        if (data.op === 'available') value = true;
        if (data.op === 'count') value = await window.api.modelCount(data.key);
        if (data.op === 'get') {
          const size = await window.api.modelSize(data.key);
          if (size !== null) {
            const bytes = new Uint8Array(size);
            for (let offset = 0; offset < size; offset += 32 * 1024 * 1024) {
              const part = await window.api.modelRead(data.key, offset, Math.min(32 * 1024 * 1024, size - offset));
              if (!part || !part.byteLength) throw new Error('model read failed');
              bytes.set(new Uint8Array(part), offset);
            }
            value = bytes.buffer;
          }
        }
      } catch (error) { logs.push(String(error)); }
      if (value instanceof ArrayBuffer) worker.postMessage({ type: 'rpc-result', id: data.id, value }, [value]);
      else worker.postMessage({ type: 'rpc-result', id: data.id, value });
      return;
    }
    if (data.type === 'status' || data.type === 'download') logs.push(data.message || data.file || data.type);
    if (data.type === 'error') finish({ error: data.message });
    if (data.type === 'ready') {
      const binary = atob(${JSON.stringify(b64)});
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      const audio = new Float32Array(bytes.buffer);
      worker.postMessage({ audio, choice: ${JSON.stringify(choice)}, language: ${JSON.stringify(language)} }, [audio.buffer]);
    }
    if (data.type === 'result') finish({ text: data.text, chunks: data.chunks?.slice(0, 12), wordCount: data.chunks?.length });
  };
  worker.postMessage({ preload: true, choice: ${JSON.stringify(choice)}, language: ${JSON.stringify(language)} });
})`

try {
  await send('Runtime.enable')
  // The promise awaited through a handle (scripts/page-eval.mjs).
  const result = (await cdpEvaluate(send, expression).catch((e) => ({ error: e.message }))) ?? { error: 'No result' }
  console.log(JSON.stringify(result, null, 2))
  if (result.error || !result.wordCount) process.exitCode = 1
} finally {
  ws.close()
}
