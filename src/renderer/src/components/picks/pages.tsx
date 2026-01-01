// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The left panel's Effects and Transitions pages with their search,
// favourites and recents (REF-AB item 6): the things of each page named for
// the search, the search line above, the page's own parts below, narrowed.
import { useMemo } from 'react'
import { FxTab } from '../inspector/fx-tab'
import { TRANSITION_KINDS } from '../../timeline/transition-types'
import { LUT_PRESETS } from '../../playback/draw/lut-table'
import { useStore } from '../../state/store'
import { useT, type StringKey } from '../../ui'
import { PickBar, PickEmpty, usePickView, type PickView } from './PickBar'
import { pickUsed, type PickItem } from './picks'

/** The Effects page: the three moves (the shapes are the Text page's since
 *  YAZI-PANELI-PLAN.md §5). */
export function EffectsPage(): JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.uiLang)
  const items = useMemo<PickItem[]>(
    () => [
      { id: 'cinematize', name: t('refp.fx.cinematize'), group: t('refp.pick.group.motion') },
      { id: 'pan', name: t('insp.fxtab.pan'), group: t('refp.pick.group.motion') },
      { id: 'ramp', name: t('insp.fxtab.ramps'), group: t('refp.pick.group.motion') }
    ],
    // (The words follow the interface's language.)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang]
  )
  const view = usePickView('effects', items)
  return (
    <>
      <PickBar view={view} testid="effects.pick" />
      <PickEmpty view={view} testid="effects.pick.empty" />
      {(!view.narrowed || view.shown.length > 0) && <FxTab view="batch" pick={fxPick(view)} />}
    </>
  )
}

/** The Transitions page: the kinds of the one table. */
export function TransitionsPage(): JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.uiLang)
  const items = useMemo<PickItem[]>(
    () => TRANSITION_KINDS.map((k) => ({ id: k.id, name: t(k.name), group: t(`trans.group.${k.group}` as StringKey) })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang]
  )
  const view = usePickView('transitions', items)
  return (
    <>
      <PickBar view={view} testid="transitions.pick" />
      <PickEmpty view={view} testid="transitions.pick.empty" />
      {(!view.narrowed || view.shown.length > 0) && <FxTab view="transitions" pick={{ ...fxPick(view), only: view.only, flat: view.mode !== 'all' }} />}
    </>
  )
}

/** The Filters page's looks: 'none' and the built-in ones. */
export function useLookPicks(): PickView {
  const t = useT()
  const lang = useStore((s) => s.uiLang)
  const items = useMemo<PickItem[]>(
    () => [
      { id: 'none', name: t('insp.lut.none'), group: t('refp.pick.group.looks') },
      ...LUT_PRESETS.map((p) => ({ id: p.id, name: t(`insp.lut.preset.${p.id}` as StringKey), group: t('refp.pick.group.looks') }))
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lang]
  )
  return usePickView('filters', items)
}

const fxPick = (view: PickView) => ({
  narrowed: view.narrowed,
  shows: view.shows,
  mark: view.mark,
  use: (id: string) => pickUsed(view.page, id)
})
