// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The empty states' small pictures (REF-AB item 7, REF-AB-PLAN-P.md): drawn
// in code, a few calm lines in the panel's text colour with one part in the
// accent's text tone (empty-art.css). Decorative: hidden from screen readers,
// the sentence under it says it all.
import './empty-art.css'

export type EmptyArtKind = 'media' | 'sound' | 'effects' | 'search' | 'projects'

const PATHS: Record<EmptyArtKind, JSX.Element> = {
  // A picture card leaning on another, a plus on the front one.
  media: (
    <>
      <rect x="14" y="16" width="34" height="26" rx="4" transform="rotate(-8 31 29)" />
      <rect x="22" y="22" width="36" height="28" rx="4" className="ea-fill" />
      <path d="M26 44l9-9 7 7 4-4 8 8" />
      <circle cx="47" cy="30" r="3" />
      <g className="ea-accent">
        <circle cx="56" cy="50" r="8" className="ea-fill" />
        <path d="M56 46v8M52 50h8" />
      </g>
    </>
  ),
  // Two notes and the waves of their sound.
  sound: (
    <>
      <path d="M26 46V20l22-5v26" />
      <circle cx="21" cy="46" r="5" className="ea-fill" />
      <circle cx="43" cy="41" r="5" className="ea-fill" />
      <g className="ea-accent">
        <path d="M54 26c3 3 3 9 0 12" />
        <path d="M59 22c5 5 5 15 0 20" />
      </g>
    </>
  ),
  // A frame with sparkles over it.
  effects: (
    <>
      <rect x="14" y="22" width="40" height="30" rx="4" className="ea-fill" />
      <path d="M18 46l10-10 8 8 6-6 8 8" />
      <g className="ea-accent">
        <path d="M52 10l2.5 6.5L61 19l-6.5 2.5L52 28l-2.5-6.5L43 19l6.5-2.5z" className="ea-fill" />
        <path d="M60 32l1 3 3 1-3 1-1 3-1-3-3-1 3-1z" />
      </g>
    </>
  ),
  // A magnifier over an empty line.
  search: (
    <>
      <path d="M14 52h22M14 58h14" />
      <circle cx="40" cy="28" r="13" className="ea-fill" />
      <path d="M49.5 37.5L60 48" />
      <g className="ea-accent">
        <path d="M35 23l10 10M45 23L35 33" />
      </g>
    </>
  ),
  // A clapperboard and a plus: a film to begin.
  projects: (
    <>
      <rect x="12" y="26" width="42" height="28" rx="4" className="ea-fill" />
      <path d="M12 26l40-10 2 8" />
      <path d="M22 23.5l5 6M32 21l5 6M42 18.5l5 6" />
      <g className="ea-accent">
        <circle cx="56" cy="52" r="9" className="ea-fill" />
        <path d="M56 47.5v9M51.5 52h9" />
      </g>
    </>
  )
}

export function EmptyArt({ kind, size = 72 }: { kind: EmptyArtKind; size?: number }): JSX.Element {
  return (
    <svg className="empty-art" data-art={kind} width={size} height={size} viewBox="0 0 72 72" aria-hidden="true" focusable="false">
      {PATHS[kind]}
    </svg>
  )
}
