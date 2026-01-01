// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "LIVE" on a code clip (DENEME-2-PLAN-T.md, item 5): an HTML / code film is
// drawn from its code, not played from a file. The same small badge on its
// timeline block, its media card and the Inspector's clip head, so a code
// clip and an MP4 are told apart at a glance. Styles: timeline.css.
import { useT } from '../../ui'

export function LiveBadge({ testid }: { testid?: string }): JSX.Element {
  const t = useT()
  return (
    <span className="live-badge" title={t('den2t.live.hint')} data-testid={testid}>
      {t('den2t.live')}
    </span>
  )
}
