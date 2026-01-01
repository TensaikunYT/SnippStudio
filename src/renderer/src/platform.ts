// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import type { Api } from '../../preload/index'

/**
 * Bridge to the Electron main process. When the UI is opened in a plain
 * browser (dev convenience), `api` is undefined and the app falls back to
 * file inputs + blob URLs + downloads.
 */
export const api: Api | undefined = typeof window === 'undefined'
  ? undefined
  : (window as unknown as { api?: Api }).api

export const isElectron = api !== undefined

/** Browser-fallback registry of picked File objects, keyed by asset id. */
export const browserFiles = new Map<string, File>()

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

export function pickFilesBrowser(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.onchange = () => resolve([...(input.files ?? [])])
    // If the dialog is cancelled no event fires; resolve on focus return.
    window.addEventListener('focus', () => setTimeout(() => resolve([...(input.files ?? [])]), 400), {
      once: true
    })
    input.click()
  })
}
