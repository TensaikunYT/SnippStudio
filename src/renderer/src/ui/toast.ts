// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The old toast() call, kept only as a forwarder into notify() (phase 3c.4b).
// Its last caller is media/codefilm.ts (a dynamic import, in a file another
// part of the work holds); once that line calls notify() itself, this file goes.
import { notify } from './toast-core'

/** Shows a toast in the one stack (ui/Toasts.tsx). The text is already in words. */
export function toast(text: string, opts: { error?: boolean; action?: { label: string; run: () => void } } = {}): void {
  notify({ text, kind: opts.error ? 'error' : 'info', action: opts.action })
}
