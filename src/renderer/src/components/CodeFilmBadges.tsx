// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A code film's state chips: "slow" (phase 5d.2: while the preview plays it
// brings fewer than 24 pictures a second; not an error, the export waits for
// every frame) and ONE verdict chip (phase 5e): "error" (its page wrote down
// an error, did not start, or a check found one), "blank" (every moment the
// checker drew is one colour or clear) or "unstable" (the checker drew a
// moment twice differently; before a check, the page's early sign: animations
// born away from the clock). The checker's verdict rules over the early sign.
import { useEffect, useState } from 'react'
import { codeFilms, SLOW_FPS } from '../media/codefilm'
import { Chip, Tooltip, useT } from '../ui'

export function CodeFilmBadges({ assetId }: { assetId: string }): JSX.Element | null {
  const t = useT()
  const [, setTick] = useState(0)
  useEffect(() => codeFilms.subscribe(() => setTick((n) => n + 1)), [])
  const st = codeFilms.status(assetId)
  const v = codeFilms.verdict(assetId)
  const slow = !!st && st.state === 'ready' && !!st.slow
  const shown = v && v.verdict !== 'ok' ? v : null
  if (!slow && !shown) return null
  const need = Math.min(SLOW_FPS, st?.fps ?? SLOW_FPS)
  const line = shown?.lines[0] ?? ''
  return (
    <span className="codefilm-badges">
      {slow && (
        <Tooltip content={t('codeFilm.slowHint', { fps: String(st?.playFps ?? 0), need: String(need) })}>
          <span className="codefilm-badge" tabIndex={0}>
            <Chip tone="note" icon="hourglass" testid="codefilm.slow">
              {t('codeFilm.slow')}
            </Chip>
          </span>
        </Tooltip>
      )}
      {shown?.verdict === 'unstable' && (
        <Tooltip content={shown.checked ? t('codeFilm.checkedUnstableHint', { line }) : t('codeFilm.unstableHint')}>
          <span className="codefilm-badge" tabIndex={0}>
            <Chip tone="danger" icon="triangle-exclamation-point" testid="codefilm.unstable">
              {t('codeFilm.unstable')}
            </Chip>
          </span>
        </Tooltip>
      )}
      {shown?.verdict === 'blank' && (
        <Tooltip content={t('codeFilm.blankHint')}>
          <span className="codefilm-badge" tabIndex={0}>
            <Chip tone="note" icon="square" testid="codefilm.blank">
              {t('codeFilm.verdict.blank')}
            </Chip>
          </span>
        </Tooltip>
      )}
      {shown?.verdict === 'error' && (
        <Tooltip content={t('codeFilm.errorHint', { line })}>
          <span className="codefilm-badge" tabIndex={0}>
            <Chip tone="danger" icon="circle-x" testid="codefilm.error">
              {t('codeFilm.verdict.error')}
            </Chip>
          </span>
        </Tooltip>
      )}
    </span>
  )
}
