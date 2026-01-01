// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
export function checkRenderCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Render cancelled', 'AbortError')
}

/** Stop waiting as soon as a render is cancelled. Decoder cleanup may finish
 * later, but its result can no longer enter the cancelled render. */
export async function cancellable<T>(job: Promise<T>, signal?: AbortSignal, onAbort?: () => void): Promise<T> {
  checkRenderCancelled(signal)
  if (!signal) return job
  let cancel: (() => void) | undefined
  const aborted = new Promise<never>((_resolve, reject) => {
    cancel = () => { onAbort?.(); reject(new DOMException('Render cancelled', 'AbortError')) }
    signal.addEventListener('abort', cancel, { once: true })
  })
  try { return await Promise.race([job, aborted]) }
  finally { if (cancel) signal.removeEventListener('abort', cancel) }
}
