// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
/// <reference lib="webworker" />
// The lock a film's own code runs behind (things.worker.ts draws a film's
// things.js, sounds.worker.ts makes its sounds.js): before the code runs,
// everything it could reach out with is gone — no network, no files, no
// storage, no messages, no other workers, no timers, no making code from
// text, no clock but the time it is given. The worker keeps what it needs
// (its own postMessage, a timer for fonts) by taking them before the lock.

const BANNED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'RTCPeerConnection', 'importScripts',
  'Worker', 'SharedWorker', 'BroadcastChannel', 'MessageChannel', 'MessagePort', 'caches', 'CacheStorage', 'indexedDB', 'IDBFactory',
  'navigator', 'location', 'postMessage', 'close', 'eval', 'Function', 'FileReader', 'FileReaderSync', 'Request', 'Response', 'Headers',
  'webkitRequestFileSystem', 'webkitRequestFileSystemSync', 'webkitResolveLocalFileSystemURL', 'webkitResolveLocalFileSystemSyncURL',
  'storageFoundation', 'onmessage', 'onmessageerror', 'addEventListener', 'removeEventListener', 'dispatchEvent',
  'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask', 'requestAnimationFrame', 'cancelAnimationFrame',
  'Atomics', 'SharedArrayBuffer', 'WebAssembly', 'fonts', 'FontFace', 'createImageBitmap', 'crypto', 'Notification', 'reportError', 'scheduler'
]

let locked = false

/** Everything the film's code could reach out with, gone (once). */
export function lockDown(scope: DedicatedWorkerGlobalScope & Record<string, unknown>): void {
  if (locked) return
  locked = true
  const ban = new Set(BANNED)
  const gone = (o: object, k: string): void => {
    try {
      Object.defineProperty(o, k, { value: undefined, writable: false, configurable: false, enumerable: false })
    } catch {
      /* not this one's */
    }
  }
  for (const k of BANNED) gone(scope, k)
  // And on the prototypes the worker's scope inherits them from.
  for (let o = Object.getPrototypeOf(scope); o && o !== Object.prototype; o = Object.getPrototypeOf(o)) for (const k of Object.getOwnPropertyNames(o)) if (ban.has(k)) gone(o, k)
  // No code made from text, by any way round (a function's constructor).
  for (const f of [function () {}, async function () {}, function* () {}, async function* () {}]) gone(Object.getPrototypeOf(f), 'constructor')
  // No clock but t.
  const RealDate = Date
  class FrozenDate extends RealDate {
    constructor(...a: unknown[]) {
      super(...((a.length ? a : [0]) as [number]))
    }
    static now(): number {
      return 0
    }
  }
  gone(scope, 'Date')
  try {
    Object.defineProperty(scope, 'Date', { value: FrozenDate, writable: false, configurable: false })
  } catch {
    /* kept */
  }
  try {
    if (typeof performance !== 'undefined') Object.defineProperty(performance, 'now', { value: () => 0, writable: false, configurable: false })
  } catch {
    /* kept */
  }
}
