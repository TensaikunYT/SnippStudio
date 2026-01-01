// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What a code clip shows of its own life on the timeline (phase 5e, decision
// 2; ANA-PLAN §3's three code clip rows): a dashed frame while the agent has
// made it and not written its code yet ("being written"), a short flash when
// its code is saved, a red chip when its verdict is an error. CSS only; read
// when the code film module tells of a change, never per frame.
import { useEffect, useState } from 'react'
import { codeFilms } from '../../media/codefilm'
import { Chip, useT } from '../../ui'

/** A save flashes only while it is this fresh (a clip drawn again later does not). */
const FLASH_MS = 1500

export function CodeClipActivity({ assetId }: { assetId: string }): JSX.Element | null {
  const t = useT()
  const [, setTick] = useState(0)
  useEffect(() => codeFilms.subscribe(() => setTick((n) => n + 1)), [])
  const a = codeFilms.activity(assetId)
  const v = codeFilms.verdict(assetId)
  const fresh = a.savedAt > 0 && Date.now() - a.savedAt < FLASH_MS
  if (!a.writing && !fresh && v?.verdict !== 'error') return null
  return (
    <>
      {a.writing && <span className="codeclip-writing" data-testid="codeclip.writing" title={t('codeFilm.writing')} />}
      {fresh && <span key={a.savedAt} className="codeclip-saved" data-testid="codeclip.saved" aria-hidden="true" />}
      {v?.verdict === 'error' && (
        <span className="codeclip-error">
          <Chip tone="danger" icon="circle-x" testid="codeclip.error">
            {t('codeFilm.verdict.error')}
          </Chip>
        </span>
      )}
    </>
  )
}
