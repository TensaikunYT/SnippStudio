// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The right end of the timeline's toolbar (phase 3c.T): "fit the film in the
// view" and the zoom. (The lane height step went to Settings → General in
// DENEME-3, item 12; Alt + wheel still steps it.) Their own subscriptions: a zoom
// step draws this, not the toolbar's tools.
import { memo } from 'react'
import { useStore } from '../../state/store'
import { IconButton, Slider, useT } from '../../ui'
import { ZOOM_MAX, ZOOM_MIN } from '../../timeline/view-math'
import { loadBindings } from '../../shortcuts'
import { fitTimeline, setZoom } from './view-state'

export const TimelineView = memo(function TimelineView(): JSX.Element {
  const t = useT()
  const pxPerSec = useStore((s) => s.pxPerSec)
  return (
    <div className="tl-view">
      <IconButton icon="maximize-2" variant="ghost" testid="timeline.zoom.fit" label={t('timeline.zoom.fit')} shortcut={loadBindings().zoomFit} onClick={fitTimeline} />
      <div className="tl-zoom">
        <Slider label={t('timeline.zoom')} min={ZOOM_MIN} max={ZOOM_MAX} step={1} decimals={0} free value={pxPerSec} onChange={(value) => setZoom(value)} trackTestid="timeline.zoom" />
      </div>
    </div>
  )
})
