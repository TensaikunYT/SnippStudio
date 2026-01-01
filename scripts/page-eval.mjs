// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Evaluating an expression in a page over the Chrome DevTools Protocol, its
// promise (if it gives one) awaited and its value returned. Shared by every
// script that drives a window over CDP (e2e, the reference frames, the startup
// timing, the packaged-app smoke checks).
//
// A promise is awaited through a handle to it (its object id, then
// Runtime.awaitPromise), not by Runtime.evaluate's own awaitPromise: the V8 of
// Electron 43 (15.0) holds that promise only weakly, so a garbage collection
// between the promise settling and the inspector's own reaction to it answered
// "Promise was collected" for a promise that had fulfilled (V8 holds it
// strongly since "fix(inspector): hold on to promises", 2026-07;
// an internal report, not published; e2e 99-cdp-promise-hold). The
// handle holds it until the answer is in. A promise that never settles still
// never answers.

const said = (d) => d.exception?.description ?? d.text

/** `send(method, params)` resolves with a CDP command's result (rejects on its
 *  error). Throws what the page threw (or rejected with). */
export async function cdpEvaluate(send, expression, { userGesture = false } = {}) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: false, ...(userGesture ? { userGesture: true } : {}) })
  if (r.exceptionDetails) throw new Error(said(r.exceptionDetails))
  const o = r.result
  if (!o.objectId) return o.value
  try {
    const v =
      o.subtype === 'promise'
        ? await send('Runtime.awaitPromise', { promiseObjectId: o.objectId, returnByValue: true })
        : await send('Runtime.callFunctionOn', { objectId: o.objectId, functionDeclaration: 'function () { return this }', returnByValue: true })
    if (v.exceptionDetails) throw new Error(said(v.exceptionDetails))
    return v.result.value
  } finally {
    Promise.resolve()
      .then(() => send('Runtime.releaseObject', { objectId: o.objectId }))
      .catch(() => undefined)
  }
}
