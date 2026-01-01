// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The rig's own awaited evaluation (cdp.mjs `ev`) holds the page's promise
// until the answer is in (haritalar\_vaat-rapor.md). Electron 43's V8 (15.0)
// holds the promise of Runtime.evaluate's own awaitPromise only weakly: a
// garbage collection between the promise settling and the inspector's own
// reaction to it answered "Promise was collected" for a promise that had
// fulfilled (e2e 80 / 81 now and then, e2e 66 and 83 before). Here that moment
// is made on purpose: a microtask queued just before the promise fulfils runs
// gc() (the app started again with --expose-gc for this scenario only).
export const name = 'cdp-promise-hold'

const SETTLED_THEN_GC = `new Promise((res) => setTimeout(() => { queueMicrotask(() => { gc() }); res(42); res = null }, 50))`
const ASYNC_THEN_GC = `(async () => { await new Promise((r) => setTimeout(r, 50)); queueMicrotask(() => { gc() }); return { n: 42 } })()`

export async function run({ lib, relaunch }) {
  const { assert } = lib
  const app = await relaunch({ extraArgs: ['--js-flags=--expose-gc'], own: true })
  const c = app.cdp
  try {
    await lib.reset(c)
    assert.equal(await c.ev('typeof gc'), 'function')
    // The way the rig asks now: the value, every time.
    for (let i = 0; i < 5; i++) {
      assert.equal(await c.ev(SETTLED_THEN_GC), 42)
      assert.deepEqual(await c.ev(ASYNC_THEN_GC), { n: 42 })
    }
    // Values, objects, rejections and throws come back as before.
    assert.equal(await c.ev('1 + 1'), 2)
    assert.equal(await c.ev('undefined'), undefined)
    assert.equal(await c.ev('null'), null)
    assert.deepEqual(await c.ev('({ a: [1, "b"] })'), { a: [1, 'b'] })
    assert.deepEqual(await c.run(async (x) => ({ x }), 3), { x: 3 })
    await assert.rejects(c.ev('Promise.reject(new Error("no way"))'), /no way/)
    await assert.rejects(c.ev('(() => { throw new Error("thrown") })()'), /thrown/)
    // (Runtime.evaluate's own awaitPromise on the same moment, said, not
    // asserted: a later Electron whose V8 holds the promise answers 42.)
    const raw = await c.send('Runtime.evaluate', { expression: SETTLED_THEN_GC, awaitPromise: true, returnByValue: true }).then((r) => 'value ' + r.result.value, (e) => e.message)
    console.log(`     Runtime.evaluate awaitPromise on a promise collected after it fulfilled: ${raw}`)
  } finally {
    // Back to a normal app for whatever runs next.
    await relaunch({ own: true })
  }
}
