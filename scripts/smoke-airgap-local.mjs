// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Developer-only packaged-app check. Start Snipp with the temporary local
// --remote-debugging-port=9225 switch, then run this and close that instance.
import WebSocket from 'ws'
import { cdpEvaluate } from './page-eval.mjs'

const pages = await fetch('http://127.0.0.1:9225/json').then((response) => response.json())
const page = pages.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
if (!page) throw new Error('No packaged Snipp renderer on localhost:9225')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject) })
const command = (method, params = {}) => new Promise((resolve, reject) => {
  const id = Math.floor(Math.random() * 0x7fffffff)
  ws.on('message', function handler(raw) {
    const packet = JSON.parse(String(raw))
    if (packet.id !== id) return
    ws.off('message', handler)
    packet.error ? reject(new Error(packet.error.message)) : resolve(packet.result)
  })
  ws.send(JSON.stringify({ id, method, params }))
})
try {
  await command('Runtime.enable')
  // The promise awaited through a handle (scripts/page-eval.mjs).
  const result = await cdpEvaluate(command, `(async () => {
      const statuses = await Promise.allSettled([
        fetch('https://example.com/snipp-airgap-check'),
        fetch('http://example.com/snipp-airgap-check'),
        fetch('http://127.0.0.1:4173/snipp-airgap-check')
      ]);
      const websocketBlocked = await new Promise(resolve => {
        try {
          const socket = new WebSocket('wss://example.com/snipp-airgap-check');
          const timeout = setTimeout(() => { socket.close(); resolve(false); }, 5000);
          socket.onerror = () => { clearTimeout(timeout); resolve(true); };
          socket.onopen = () => { clearTimeout(timeout); socket.close(); resolve(false); };
        } catch { resolve(true); }
      });
      const key = 'https://huggingface.co/onnx-community/whisper-medium.en_timestamped/resolve/main/config.json';
      const bytes = await window.api.modelRead(key, 0, 4096);
      const config = bytes && JSON.parse(new TextDecoder().decode(bytes));
      // The renderer can only add a file the user chose (main merges one entry;
      // whole lists are not taken any more): an unknown path is refused.
      const unapproved = 'C:/snipp-security-unapproved.json';
      const taken = await window.api.recentsUpsert({ path: unapproved, name: 'x', durationSec: 0, width: 1, height: 1, sizeBytes: 0 });
      const after = await window.api.recentsRead();
      const opened = await window.api.openProjectPath(unapproved);
      const recentsEscalationBlocked = taken === false && !after.some(entry => entry.path.toLowerCase() === 'c:\\snipp-security-unapproved.json') && opened?.error === 'not a known project';
      return {
        externalFetchStatuses: statuses.map(entry => entry.status),
        websocketBlocked,
        nodeUnavailable: typeof process === 'undefined' && typeof require === 'undefined',
        modelReadable: config?.model_type === 'whisper',
        modelOverwriteBlocked: (await window.api.modelPut(key, new ArrayBuffer(1))) === false,
        arbitraryModelReadBlocked: (await window.api.modelGet('private.json')) === null,
        recentsEscalationBlocked,
        networkMediaBlocked: (await window.api.registerDroppedMedia('\\\\\\\\example.com\\\\share\\\\sample.wav')) === null
      };
    })()`).catch((e) => ({ error: e.message }))
  const checks = result?.error === undefined ? result : undefined
  console.log(JSON.stringify(checks ?? result, null, 2))
  if (!checks || JSON.stringify(checks.externalFetchStatuses) !== JSON.stringify(['rejected', 'rejected', 'rejected']) ||
      Object.entries(checks).some(([key, value]) => key !== 'externalFetchStatuses' && value !== true)) process.exitCode = 1
} finally {
  ws.close()
}
