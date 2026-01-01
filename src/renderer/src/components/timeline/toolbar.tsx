// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The timeline's toolbar (phase 3c.T): its own component with its own
// subscriptions, so a drag, a trim or a zoom step in the lanes no longer
// builds these buttons and their tooltips again. The buttons, their order and
// their test names are as they were in Timeline.tsx. Core polish T: the
// cut sounds (Library → Sounds does the same) and the add-track buttons (the
// + strips above and below the lanes do the same) left the toolbar;
// Compound, Group and Adjustment stay in Tools and are also in a clip's
// right-click menu.
import { memo } from 'react'
import { useStore } from '../../state/store'
import { IconButton, useT } from '../../ui'
import { ToolButton } from '../ToolButton'
import { CustomToolbar } from '../CustomToolbar'
import { TimelineView } from './view-controls'
import { ClipActions } from './clip-actions'
import { TimelineSearch } from './TimelineSearch'
import { useAgentOn } from '../agent/useAgentShown'
import { useScopeBand } from '../../agent/scope-band'
import { pressRange } from '../agent/ScopeBand'

export const TimelineToolbar = memo(function TimelineToolbar({ followPlayhead, setFollowPlayhead }: { followPlayhead: boolean; setFollowPlayhead: (on: boolean) => void }): JSX.Element {
  const t = useT()
  const splitAtPlayhead = useStore((s) => s.splitAtPlayhead)
  const selectedClipIds = useStore((s) => s.selectedClipIds)
  const deleteClips = useStore((s) => s.deleteClips)
  const cutMarks = useStore((s) => s.cutMarks)
  const cutTrackId = useStore((s) => s.cutTrackId)
  // The marked lane's name (a string: the project itself is not watched here).
  const cutTrackName = useStore((s) => (s.cutTrackId && s.cutTrackId !== 'captions' ? (s.project.tracks.find((tr) => tr.id === s.cutTrackId)?.name ?? null) : null))
  const clearCutMarks = useStore((s) => s.clearCutMarks)
  const deleteBetweenCuts = useStore((s) => s.deleteBetweenCuts)
  const cutLaneLabel =
    cutTrackId === 'captions'
      ? t('timeline.cut.lane.subtitles')
      : cutTrackId
        ? (cutTrackName ?? t('timeline.cut.lane.track'))
        : t('timeline.cut.lane.all')
  const cutterMode = useStore((s) => s.cutterMode)
  // (The agent's range: KAPSAM-AJAN-PLAN.md §1. Only while the agent is on.)
  const agentOn = useAgentOn()
  const rangeOn = useScopeBand((s) => s.armed || !!s.band)
  const setCutterMode = useStore((s) => s.setCutterMode)
  const splitToolMode = useStore((s) => s.splitToolMode)
  const slipToolMode = useStore((s) => s.slipToolMode)
  const setSlipToolMode = useStore((s) => s.setSlipToolMode)
  const setSplitToolMode = useStore((s) => s.setSplitToolMode)
  const playheadSnap = useStore((s) => s.playheadSnap)
  const linkAV = useStore((s) => s.linkAV)
  const compoundSelection = useStore((s) => s.compoundSelection)
  const uncompoundClip = useStore((s) => s.uncompoundClip)
  // Subscribed, so the toolbar swaps the button the moment selection changes.
  const compoundSelected = useStore(
    (s) => s.selectedClipIds.length === 1 && !!s.project.clips[s.selectedClipIds[0]]?.nested
  )
  const selectionGrouped = useStore((s) =>
    s.selectedClipIds.length > 0
      ? (s.project.groups ?? []).some((g) => s.selectedClipIds.some((id) => g.clipIds.includes(id)))
      : false
  )
  return (
    <div className="tl-toolbar">
      <CustomToolbar
        items={[
          {
            id: 'select',
            label: t('timeline.tool.select'),
            featured: true,
            node: (
              <ToolButton
                icon="mouse-pointer-2"
                folds
                pressed={!splitToolMode && !cutterMode}
                testid="timeline.tool.select"
                onClick={() => {
                  setSplitToolMode(false)
                  setCutterMode(false)
                }}
                label={t('timeline.tool.select')}
                hint={t('timeline.tool.select.hint')}
                shortcut="a"
              >
                {t('timeline.tool.select.short')}
              </ToolButton>
            )
          },
          {
            id: 'split',
            label: t('timeline.tool.split'),
            featured: true,
            node: (
              <ToolButton icon="scissors" folds testid="timeline.tool.split" onClick={() => splitAtPlayhead()} label={t('timeline.tool.split')} hint={t('timeline.tool.split.hint')} shortcut="s">
                {t('timeline.tool.split.short')}
              </ToolButton>
            )
          },
          {
            id: 'splittool',
            label: t('timeline.tool.splitTool'),
            active: splitToolMode,
            node: (
              <ToolButton icon="scissors" pressed={splitToolMode} testid="timeline.tool.split-tool" onClick={() => setSplitToolMode(!splitToolMode)} label={t('timeline.tool.splitTool')} hint={t('timeline.tool.splitTool.hint')} shortcut="b" />
            )
          },
          {
            id: 'sliptool',
            label: t('timeline.tool.slip'),
            active: slipToolMode,
            node: (
              <ToolButton icon="arrow-left-right" pressed={slipToolMode} testid="timeline.tool.slip-tool" onClick={() => setSlipToolMode(!slipToolMode)} label={t('timeline.tool.slip')} hint={t('timeline.tool.slip.hint')} shortcut="y" />
            )
          },
          ...(agentOn
            ? [
                {
                  id: 'agentRange',
                  label: t('kapsam.tool.range'),
                  active: rangeOn,
                  node: (
                    <ToolButton icon="scan" folds pressed={rangeOn} testid="timeline.tool.agent-range" onClick={pressRange} label={t('kapsam.tool.range')} hint={t('kapsam.tool.range.hint')}>
                      {t('kapsam.tool.range')}
                    </ToolButton>
                  )
                }
              ]
            : []),
          {
            id: 'compound',
            label: t('timeline.tool.compoundBoth'),
            node: (
              /* Uncompound replaces Compound while a compound clip is selected, so
                  only ever one of the two is on screen. */
              compoundSelected ? (
                <ToolButton icon="layers" testid="timeline.tool.uncompound" onClick={() => uncompoundClip(selectedClipIds[0])} label={t('timeline.tool.uncompound')} hint={t('timeline.tool.uncompound.hint')} />
              ) : (
                <ToolButton icon="layers" disabled={selectedClipIds.length < 2} testid="timeline.tool.compound" onClick={() => compoundSelection()} label={t('timeline.tool.compound')} hint={t('timeline.tool.compound.hint')} />
              )
            )
          },
          {
            id: 'follow',
            label: t('timeline.tool.follow'),
            node: (
              <ToolButton
                icon="arrow-right-to-line"
                pressed={followPlayhead}
                testid="timeline.tool.follow"
                onClick={() => {
                  const next = !followPlayhead
                  setFollowPlayhead(next)
                  localStorage.setItem('autocut-follow', next ? 'on' : 'off')
                }}
                label={t('timeline.tool.follow')}
                hint={t('timeline.tool.follow.hint')}
              >
                {t('timeline.tool.follow.short')}
              </ToolButton>
            )
          },
          {
            id: 'snap',
            label: t('timeline.tool.snap'),
            featured: true,
            node: (
              <ToolButton icon="locate-fixed" folds pressed={playheadSnap} testid="timeline.tool.snap" onClick={() => useStore.getState().setPlayheadSnap(!playheadSnap)} label={t('timeline.tool.snap')} hint={t('timeline.tool.snap.hint')}>
                {t('timeline.tool.snap.short')}
              </ToolButton>
            )
          },
          {
            id: 'link',
            label: t('timeline.tool.link'),
            node: (
              <ToolButton icon="link" pressed={linkAV} testid="timeline.tool.link" onClick={() => useStore.getState().setLinkAV(!linkAV)} label={t('timeline.tool.link')} hint={t('timeline.tool.link.hint')} />
            )
          },
          {
            id: 'adjustment',
            label: t('timeline.tool.adjustment'),
            node: (
              <ToolButton icon="contrast" testid="timeline.tool.adjustment" onClick={() => useStore.getState().addAdjustmentLayer()} label={t('timeline.tool.adjustment')} hint={t('timeline.tool.adjustment.hint')} />
            )
          },
          {
            id: 'ripple-delete',
            label: t('timeline.tool.rippleDelete'),
            node: (
              <ToolButton icon="trash" disabled={selectedClipIds.length === 0} testid="timeline.tool.ripple-delete" onClick={(e) => deleteClips(selectedClipIds, true, e.altKey)} label={t('timeline.tool.rippleDelete')} hint={t('timeline.rippleDelete.title')}>
                <span className="tb-label">{t('timeline.tool.rippleDelete')}</span>
                {selectedClipIds.length > 1 && <span className="tb-count">{selectedClipIds.length}</span>}
              </ToolButton>
            )
          },
          {
            id: 'keyframe',
            label: t('timeline.tool.keyframe'),
            featured: true,
            node: (
              /* Keyframe the selection right here — no trip to the inspector. The
                  behaviour follows the track kind: volume on audio, transform on video. */
              <ToolButton
                icon="diamond"
                disabled={selectedClipIds.length === 0}
                testid="timeline.tool.keyframe"
                onClick={() => {
                  // One undo step; only the clips the playhead is on, none on a
                  // locked track (phase Ç2c.2, report K19).
                  const st = useStore.getState()
                  st.keyframeClips(st.selectedClipIds)
                }}
                label={t('timeline.tool.keyframe')}
                hint={t('timeline.tool.keyframe.hint')}
              >
                <span className="tb-label">{t('timeline.tool.keyframe.short')}</span>
                {selectedClipIds.length > 1 && <span className="tb-count">{selectedClipIds.length}</span>}
              </ToolButton>
            )
          },
          {
            id: 'cutter',
            label: t('timeline.tool.cutter'),
            active: cutterMode,
            // On the bar by default, beside the keyframe (kullanım, item 2).
            featured: true,
            node: (
              <>
                <ToolButton icon="scissors" pressed={cutterMode} testid="timeline.tool.cutter" onClick={() => setCutterMode(!cutterMode)} label={t('timeline.tool.cutter')} hint={t('timeline.tool.cutter.hint')} shortcut="c">
                  <span className="tb-label">{cutMarks.length > 0 ? t('timeline.tool.cutter.marks', { n: cutMarks.length }) : t('timeline.tool.cutter')}</span>
                  {cutMarks.length > 0 && <span className="tb-count">{cutMarks.length}</span>}
                </ToolButton>
                {cutMarks.length >= 2 && (
                  <ToolButton variant="danger" icon="trash" testid="timeline.tool.cut-delete" onClick={(e) => deleteBetweenCuts(e.altKey)} label={t('timeline.tool.cutDelete', { lane: cutLaneLabel })} hint={t('timeline.cutDelete.title')} />
                )}
                {cutMarks.length > 0 && (
                  <IconButton icon="x" variant="ghost" size="sm" testid="timeline.tool.cut-clear" onClick={clearCutMarks} label={t('timeline.tool.cutClear')} shortcut="esc" />
                )}
              </>
            )
          },
          {
            id: 'group',
            label: t('timeline.tool.groupBoth'),
            node: (
              <>
                {selectedClipIds.length >= 2 && !selectionGrouped && (
                  <ToolButton icon="link" testid="timeline.tool.group" onClick={() => useStore.getState().groupSelection()} label={t('timeline.tool.group', { n: selectedClipIds.length })} hint={t('timeline.tool.group.hint')} />
                )}
                {selectionGrouped && (
                  <ToolButton icon="unlink" testid="timeline.tool.ungroup" onClick={() => useStore.getState().ungroupSelection()} label={t('timeline.tool.ungroup')} hint={t('timeline.tool.ungroup.hint')} />
                )}
              </>
            )
          }
        ]}
      />
      <div className="tl-toolbar-gap" />
      <TimelineSearch />
      <ClipActions />
      {/* Fixed slot: the gear is portalled here so it stays put on the right no
          matter how the buttons are reordered or hidden. */}
      <span className="tb-gear-slot" />
      <TimelineView />
    </div>
  )
})
