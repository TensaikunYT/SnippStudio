// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Text page's quick font choice (YAZI-PANELI-PLAN.md §6): six fonts, each
// card its name in its own face. First the faces this project's titles use
// most, then the program's own bundled ones; every one checked the way the
// export checks (phase 10, fontMissingHere). A click sets the selected texts
// in it (one undo step). With no text selected the section rests, faded, and
// says to select one. Every font and the size: the Subtitles tab on the right.
import { useMemo } from 'react'
import { fontMissingHere, FONT_LABELS } from '../../fonts'
import { useStore } from '../../state/store'
import type { Caption } from '../../types'
import { BareButton, Tooltip, useT } from '../../ui'

/** The program's own faces, always installed (bundled), the same everywhere. */
const OWN = ['Inter', 'Anton', 'Archivo Black', 'Bebas Neue', 'Merriweather', 'Permanent Marker']
const COUNT = 6

/** The six: the project's titles' faces by use, then the program's own. */
export function quickFonts(captions: Caption[], fallback: string, missing: (f: string) => boolean = fontMissingHere): string[] {
  const used = new Map<string, number>()
  for (const c of captions) {
    if (!c.manual || c.shape) continue
    const f = c.font ?? c.style?.fontFamily ?? fallback
    used.set(f, (used.get(f) ?? 0) + 1)
  }
  const byUse = [...used.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f)
  const out: string[] = []
  for (const f of [...byUse, ...OWN]) {
    if (out.length >= COUNT) break
    if (!out.includes(f) && !missing(f)) out.push(f)
  }
  return out
}

export function TextFonts({ show = () => true }: { show?: (font: string) => boolean }): JSX.Element {
  const t = useT()
  const captions = useStore((s) => s.project.captions)
  const fallback = useStore((s) => s.project.captionStyle.fontFamily)
  const selIds = useStore((s) => s.selectedCaptionIds)
  const sel = useMemo(() => selIds.map((id) => captions.find((c) => c.id === id)).filter((c): c is Caption => !!c && !!c.manual && !c.shape), [selIds, captions])
  // Ranked again when the selection changes, not on every edit: picking a
  // font must not reorder the cards under the pointer.
  const fonts = useMemo(() => quickFonts(useStore.getState().project.captions, fallback), [selIds, fallback])
  const off = sel.length === 0
  const use = (fontFamily: string): void => {
    const s = useStore.getState()
    s.undoable(() => {
      for (const c of sel) s.setCaptionOwnStyle(c.id, { fontFamily })
    })
  }
  return (
    <div className={off ? 'text-fonts is-off' : 'text-fonts'} data-testid="dock.text.fonts">
      {off && <div className="hint is-state" data-testid="dock.text.fonts.pick">{t('text.font.pick')}</div>}
      <div className="text-font-grid" role="group" aria-label={t('text.sec.font')}>
        {fonts.filter(show).map((f) => {
          const name = FONT_LABELS[f] ?? f
          const on = !off && sel.every((c) => (c.style?.fontFamily ?? fallback) === f)
          return (
            <Tooltip key={f} content={off ? t('text.font.pick') : t('text.font.use', { font: name })}>
              <BareButton
                className={on ? 'text-font is-on' : 'text-font'}
                testid={`dock.text.font.${f.replace(/\s+/g, '-').toLowerCase()}`}
                aria-label={name}
                aria-pressed={on}
                disabled={off}
                style={{ fontFamily: `"${f}", var(--font)` }}
                onClick={() => use(f)}
              >
                {name}
              </BareButton>
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}
