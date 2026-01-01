// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useLayoutEffect, useRef } from 'react'

/**
 * A place the preview can be shown. The single preview (one canvas, one
 * draw loop, its zoom and whatever it is in the middle of) moves to the one
 * in use — two previews would fight over the one draw loop the playback
 * engine drives.
 */
export function PreviewSlot({ host, active, className = 'preview-slot' }: { host: HTMLElement; active: boolean; className?: string }): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  // Before paint, and before the preview's own effects look at its size.
  useLayoutEffect(() => {
    const el = ref.current
    if (active && el && host.parentElement !== el) el.appendChild(host)
  }, [active, host])
  return <div ref={ref} className={className} />
}
