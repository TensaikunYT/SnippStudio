// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The review strip (D22, worker C; YOL-HARITASI.md, part 4; the mock-up's
// second screen): while an agent's draft waits, one line under the
// timeline's toolbar — whose draft it is (in the program's colour), ◀ n / N
// ▶ through its changes, "play this change", the one sentence of the change
// in focus, Accept and Reject for that change, "k operations not applied"
// (with why), Reject all, Accept all, Before | After. Going through the
// changes takes the timeline and the playhead to each; the timeline marks
// every change (DraftMarks). Nothing changes in the film until something is
// accepted; every accept is one undo step, the point before the agent
// written first (draft-text.ts). It takes the place of the floating bar and
// of the Agent tab's draft card.
//
// The second pass (the coordinator's notes):
// - Accept is never a dimmed button without a reason: a change that cannot
//   be accepted by itself says why in the strip, with "decide that one
//   first" (a press takes the strip to it);
// - "play this change": the draft from 2 s before the change to 2 s after
//   it, as "After", then back to what was shown;
// - why an operation is not applied is said in the user's words
//   (agent/drop-words.ts), the agent's own sentence under "Details";
// - one range of a cut can be taken out (the "…" menu).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dialog, IconButton, MenuTrigger, Segmented, TextField, Tooltip, useT, type MenuItem } from '../../ui'
import { useStore } from '../../state/store'
import { useAgentStore, type DraftView } from '../../agent/store'
import { freshDraft, removeRange, reviveOp } from '../../agent/drafts'
import { agentDisplayName } from '../../agent/holder'
import { LOCAL_CLIENT } from '../../agent/ready'
import { saidOf } from '../../agent/said'
import { form } from '../../agent/count'
import { mmssT } from '../../agent/draft-words'
import { dropKey } from '../../agent/drop-words'
import { MARK_OF } from '../../agent/marks'
import { acceptGroup, acceptItem, acceptWholeDraft, draftIdOf, headline, jumpShort, jumpText, planAlone, planGroup, playItem, rejectGroup, rejectItem, rejectWholeDraft, showInPreview, useShowing, type AlonePlan, type PreviewWhich } from './draft-text'
import { groupsOf } from '../../agent/crew'
import { useCrewOf } from './useCrew'
import { revealItem } from './reveal'
import type { StringKey } from '../../ui'

/** The draft's owner as the user knows it. */
export const draftOwner = (d: Pick<DraftView, 'client'>, local: string): string => (d.client === LOCAL_CLIENT ? local : agentDisplayName(d.client))

export function ReviewStrip({ working = false }: { working?: boolean }): JSX.Element | null {
  const t = useT()
  const draft = useAgentStore((s) => s.draft)
  const focus = useAgentStore((s) => s.focusItem)
  const showing = useShowing()
  const [busy, setBusy] = useState(false)
  const [dropped, setDropped] = useState(false)
  const [details, setDetails] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [why, setWhy] = useState('')
  // The item whose "why it is not accepted by itself" is shown in the strip.
  const [blockedKey, setBlockedKey] = useState<string | null>(null)
  // "Play this change" is running: its stop.
  const stopPlay = useRef<(() => void) | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const all = draft?.items ?? []
  // The team mode (EKIP-PLAN.md): the draft by worker. A group picked: the
  // strip goes through its changes, and accepts or rejects them together.
  const crew = useCrewOf(draft?.client ?? null)
  const team = all.some((i) => i.as)
  const groups = team ? groupsOf(all, crew.order) : []
  const [pickedGroup, setGroup] = useState<string | null>(null)
  const group = pickedGroup !== null && groups.some((g) => g.as === pickedGroup) ? pickedGroup : null
  const groupKeys = group === null ? [] : groups.find((g) => g.as === group)!.keys
  const items = group === null ? all : all.filter((i) => (i.as ?? '') === group)
  const [groupBlocked, setGroupBlocked] = useState<string | null>(null)
  const [groupBusy, setGroupBusy] = useState(false)
  // (The item in focus went — accepted or rejected: the one that took its place.)
  const lastAt = useRef(0)
  const found = items.findIndex((i) => i.key === focus)
  const at = found >= 0 ? found : Math.max(0, Math.min(lastAt.current, items.length - 1))
  lastAt.current = at
  const item = items[at]
  const draftId = draftIdOf(draft)
  // Replayed now, before the strip is drawn from it.
  useEffect(() => {
    freshDraft()
  }, [draftId])
  // The item in focus is the store's (the timeline lights its marks).
  useEffect(() => {
    useAgentStore.getState().setFocusItem(item?.key ?? null)
  }, [item?.key])
  useEffect(
    () => () => {
      useAgentStore.getState().setFocusItem(null)
      stopPlay.current?.()
    },
    []
  )
  const after = showing !== 'live'
  // "After" is read-only: nothing stays selected there (a selected clip's
  // Inspector, a pressed Delete would be the live film's).
  useEffect(() => {
    if (!after) return
    const s = useStore.getState()
    if (s.selectedClipIds.length) s.selectClips([])
    if (s.selectedCaptionIds.length) s.selectCaptions([])
  }, [after])
  // Would the item in focus be applied by itself, on the project as it is?
  const planKey = `${draft?.version ?? ''}|${item?.key ?? ''}|${draft?.updating ? 1 : 0}`
  const [alone, setAlone] = useState<{ key: string; plan: AlonePlan | null } | null>(null)
  useEffect(() => {
    if (!draft || !item || draft.updating || draft.broken) return setAlone(null)
    setAlone({ key: planKey, plan: planAlone(item.key) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planKey])
  const gPlanKey = `${draft?.version ?? ''}|${groupKeys.join(',')}|${draft?.updating ? 1 : 0}`
  const [gPlan, setGPlan] = useState<{ key: string; plan: AlonePlan | null } | null>(null)
  useEffect(() => {
    if (!draft || group === null || draft.updating || draft.broken) return setGPlan(null)
    setGPlan({ key: gPlanKey, plan: planGroup(groupKeys) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gPlanKey])
  const sentence = useMemo(() => (item ? saidOf(item.changes) : ''), [item, t])
  if (!draft) return null
  const name = draftOwner(draft, t('agent.name.local'))
  // The group in focus, as accepting it would go.
  const groupName = group === null ? '' : crew.name(group || undefined)
  const groupPlan = gPlan && gPlan.key === gPlanKey ? gPlan.plan : null
  const groupCosts = groupPlan?.lost.length ? all.find((i) => groupPlan.lost.includes(i.key)) : undefined
  const groupLeans = groupPlan && !groupPlan.ok ? all.find((i) => !groupKeys.includes(i.key)) : undefined
  const showGroupWhy = group !== null && groupBlocked === gPlanKey && !!groupPlan && (!groupPlan.ok || !!groupCosts)
  const groupWhy = groupCosts ? t('ekip.group.wouldDrop', { name: groupName, what: saidOf(groupCosts.changes) }) : t('ekip.group.leans', { name: groupName })
  const groupFirst = groupCosts ?? groupLeans
  const plan = alone && alone.key === planKey ? alone.plan : null
  // Why the item in focus is not accepted by itself, and the item to decide
  // first: one it would cost if it landed alone (an item that moves holds
  // only on the very project it was written on), or — written on the ones
  // before it — the first of those.
  const costs = plan?.ok && plan.lost.length ? all.find((i) => plan.lost.includes(i.key)) : undefined
  const leansOn = plan && !plan.ok && !!item && all.indexOf(item) > 0 ? all[0] : undefined
  const blocked = !!plan && (!plan.ok || !!costs)
  const first = costs ?? leansOn
  const showWhy = blocked && !!item && blockedKey === item.key
  const whyNot = costs ? t('d22c.review.wouldDrop', { what: saidOf(costs.changes) }) : t('d22c.review.notAlone')
  const goTo = (key: string): void => {
    setBlockedKey(null)
    setGroupBlocked(null)
    useAgentStore.getState().setFocusItem(key)
    revealItem(draft, key, after)
  }
  const go = (d: number): void => {
    if (!items.length) return
    goTo(items[(at + d + items.length) % items.length].key)
  }
  const play = (): void => {
    if (previewing) return void stopPlay.current?.()
    if (!item) return
    setPreviewing(true)
    stopPlay.current = playItem(draft, item.key, () => {
      stopPlay.current = null
      setPreviewing(false)
    })
  }
  const jump = jumpText(draft)
  const short = jumpShort(draft)
  const notApplied = draft.dropped.length
  const COMPARE = { side: 'agent.draft.side', wipe: 'agent.draft.wipe', diff: 'agent.draft.diff' } as const
  const more: MenuItem[] = [
    // One range of the cut in focus taken out (the others stay).
    ...(item?.ranges ?? []).slice(0, 12).map(([a, b], r): MenuItem => ({ id: `range${r}`, label: t('d22c.review.leaveRange', { n: r + 1, from: mmssT(a), to: mmssT(b) }), onSelect: () => void removeRange(item!.seq, item!.index, r), testid: `agent.draft.leave.${r}`, ...(r === 0 ? { headingBefore: t('d22c.review.leaveRange.title') } : {}) })),
    ...(['side', 'wipe', 'diff'] as const).map((m): MenuItem => ({ id: m, label: t(COMPARE[m]), checked: showing === m, hint: t('agent.draft.compare.hint'), onSelect: () => showInPreview(showing === m ? 'candidate' : m), testid: `agent.draft.view.${m}`, ...(m === 'side' ? { headingBefore: t('d22c.review.compare'), separatorBefore: !!item?.ranges?.length } : {}) })),
    ...(draft.client !== LOCAL_CLIENT ? [{ id: 'why', label: t('d22c.review.rejectWhy'), separatorBefore: true, onSelect: () => setAsking(true), testid: 'agent.draft.rejectWhy' } satisfies MenuItem] : [])
  ]
  return (
    <div className={`agent-rev${after ? ' is-after' : ''}`} role="group" aria-label={headline(draft)} data-testid="agent.draft" data-version={draft.version} data-updating={draft.updating ? 'yes' : 'no'} data-items={all.length} data-view={after ? 'after' : 'before'}>
      <Tooltip content={headline(draft)}>
        <span className="agent-rev-title" data-testid="agent.draft.headline">
          <span className={`agent-dot${working ? ' is-live' : ''}`} aria-hidden="true" />
          <span className="agent-rev-who">{t('d22c.review.title', { name })}</span>
        </span>
      </Tooltip>
      {team && (
        <span className="agent-rev-group">
          {group !== null && <span className="agent-crew-dot" style={{ background: crew.colour(group || undefined) }} aria-hidden="true" />}
          <MenuTrigger
            label={group === null ? t('ekip.group.all', { n: all.length }) : t('ekip.group.one', { name: groupName, n: items.length })}
            hint={t('ekip.group.hint')}
            menuLabel={t('ekip.group.menu')}
            size="sm"
            testid="agent.draft.group"
            items={[
              { id: 'all', label: t('ekip.group.all', { n: all.length }), checked: group === null, onSelect: () => { setGroup(null); setGroupBlocked(null) }, testid: 'agent.draft.group.all' },
              ...groups.map((g): MenuItem => ({ id: `g:${g.as}`, label: t('ekip.group.one', { name: crew.name(g.as || undefined), n: g.keys.length }), checked: group === g.as, onSelect: () => { setGroup(g.as); goTo(g.keys[0]) }, testid: `agent.draft.group.${g.as || 'main'}` }))
            ]}
          />
        </span>
      )}
      <span className="agent-rev-nav">
        <IconButton icon="chevron-left" size="sm" variant="ghost" label={t('d22c.review.prev')} disabled={items.length < 2} onClick={() => go(-1)} testid="agent.draft.prev" />
        <span className="agent-rev-count" data-testid="agent.draft.count">{t('d22c.review.count', { n: items.length ? at + 1 : 0, of: items.length })}</span>
        <IconButton icon="chevron-right" size="sm" variant="ghost" label={t('d22c.review.next')} disabled={items.length < 2} onClick={() => go(1)} testid="agent.draft.next" />
        <IconButton icon={previewing ? 'pause' : 'play'} size="sm" variant="ghost" label={t(previewing ? 'd22c.review.play.stop' : 'd22c.review.play')} disabled={!item || !!draft.updating || !!draft.broken} onClick={play} testid="agent.draft.play" data-playing={previewing ? 'yes' : 'no'} />
      </span>
      {draft.updating ? (
        <span className="agent-rev-text is-warn" data-testid="agent.draft.sentence">
          {t('agent.draft.updating')}
        </span>
      ) : draft.broken ? (
        <span className="agent-rev-text is-danger" data-testid="agent.draft.sentence">
          {t('agent.draft.broken', { why: draft.broken })}
        </span>
      ) : showGroupWhy ? (
        <>
          <Tooltip content={groupWhy}>
            <span className="agent-rev-text is-warn" data-testid="agent.draft.group.blocked" role="status" tabIndex={0}>
              {groupWhy}
            </span>
          </Tooltip>
          {groupFirst && (
            <Button
              size="sm"
              variant="ghost"
              icon="arrow-right"
              className="agent-rev-first"
              onClick={() => {
                setGroup(groupFirst.as ?? '')
                goTo(groupFirst.key)
              }}
              testid="agent.draft.group.blocked.go"
            >
              {t('d22c.review.decideFirst')}
            </Button>
          )}
        </>
      ) : showWhy ? (
        <>
          <Tooltip content={whyNot}>
            <span className="agent-rev-text is-warn" data-testid="agent.draft.blocked" role="status" tabIndex={0}>
              {whyNot}
            </span>
          </Tooltip>
          {first && (
            <Button size="sm" variant="ghost" icon="arrow-right" className="agent-rev-first" onClick={() => goTo(first.key)} testid="agent.draft.blocked.go">
              {t('d22c.review.decideFirst')}
            </Button>
          )}
        </>
      ) : (
        <Tooltip content={item ? sentence : t('den2t.change.none')}>
          <span className="agent-rev-text" data-testid="agent.draft.sentence" tabIndex={0}>
            {item ? sentence : t('den2t.change.none')}
          </span>
        </Tooltip>
      )}
      {draft.updating && (
        <Button size="sm" onClick={() => freshDraft()} testid="agent.draft.refresh">
          {t('agent.draft.refresh')}
        </Button>
      )}
      <Tooltip content={t(blocked ? 'd22c.review.accept.blocked' : 'd22c.review.accept.hint')}>
        <Button
          size="sm"
          variant="secondary"
          icon="check"
          className="agent-rev-yes"
          disabled={busy || !item || !plan}
          onClick={() => {
            if (!item || !plan) return
            // (Not by itself: the strip says why, and which one to decide first.)
            if (blocked) return setBlockedKey(item.key)
            setBusy(true)
            void acceptItem(draft, item.key, plan).finally(() => setBusy(false))
          }}
          testid="agent.draft.acceptOne"
          data-blocked={plan && !plan.ok ? 'alone' : costs ? costs.key : undefined}
        >
          {t('d22c.review.accept')}
        </Button>
      </Tooltip>
      <Tooltip content={t('d22c.review.reject.hint')}>
        <Button
          size="sm"
          variant="secondary"
          icon="x"
          className="agent-rev-no"
          disabled={busy || !item || !!draft.updating}
          onClick={() => {
            setBlockedKey(null)
            if (item) rejectItem(draft, item.seq, item.index)
          }}
          testid="agent.draft.rejectOne"
        >
          {t('d22c.review.reject')}
        </Button>
      </Tooltip>
      <span className="agent-rev-sep" aria-hidden="true" />
      {draft.disconnected && (
        <Tooltip content={t('agent.draft.disconnected')}>
          <span className="agent-rev-note" tabIndex={0} data-testid="agent.draft.disconnected">{t('d22c.review.closed')}</span>
        </Tooltip>
      )}
      {short && jump && (
        <Tooltip content={jump}>
          <span className="agent-rev-note is-warn" tabIndex={0} data-testid="agent.draft.jump">{short}</span>
        </Tooltip>
      )}
      {notApplied > 0 && (
        <Button size="sm" variant="ghost" className="agent-rev-skip" onClick={() => setDropped(true)} testid="agent.draft.notApplied">
          {t(`d22c.review.notApplied.${form(notApplied)}`, { n: notApplied })}
        </Button>
      )}
      {group !== null ? (
        <>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || groupBusy || !!draft.updating}
            onClick={() => {
              setGroupBlocked(null)
              rejectGroup(draft, groupKeys, groupName)
            }}
            testid="agent.draft.group.reject"
          >
            {t('ekip.group.reject')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || groupBusy || !!draft.updating || !!draft.broken || !groupPlan}
            onClick={() => {
              if (!groupPlan) return
              // (Not by itself: the strip says why, and which one to decide first.)
              if (!groupPlan.ok || groupPlan.lost.length) return setGroupBlocked(gPlanKey)
              setGroupBusy(true)
              void acceptGroup(draft, groupKeys, groupPlan, groupName).finally(() => setGroupBusy(false))
            }}
            testid="agent.draft.group.accept"
            data-blocked={groupPlan && (!groupPlan.ok || groupPlan.lost.length) ? 'yes' : undefined}
          >
            {t('ekip.group.accept')}
          </Button>
        </>
      ) : (
        <>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => rejectWholeDraft(draft)} testid="agent.draft.reject">
            {t('d22c.review.rejectAll')}
          </Button>
          <Button
            size="sm"
            variant="primary"
            disabled={busy || !!draft.updating || !!draft.broken || !all.length}
            onClick={() => {
              setBusy(true)
              void acceptWholeDraft(draft).finally(() => setBusy(false))
            }}
            testid="agent.draft.acceptAll"
          >
            {t('d22c.review.acceptAll')}
          </Button>
        </>
      )}
      <Tooltip content={t('d22c.review.view.hint')}>
        <Segmented<PreviewWhich>
          value={after ? 'candidate' : 'live'}
          options={[
            { value: 'live', label: t('agent.draft.before') },
            { value: 'candidate', label: t('agent.draft.after') }
          ]}
          onChange={showInPreview}
          label={t('d22c.review.view')}
          testid="agent.draft.view"
        />
      </Tooltip>
      <MenuTrigger icon="ellipsis" iconLabel={t('d22c.review.more')} items={more} size="sm" testid="agent.draft.more" />
      <Dialog
        open={dropped}
        title={t(`d22c.review.notAppliedTitle.${form(notApplied)}`, { n: notApplied })}
        onClose={() => setDropped(false)}
        width="md"
        testid="agent.draft.dropped"
        actions={
          <Button variant="primary" onClick={() => setDropped(false)} testid="agent.draft.dropped.ok">
            {t('d22c.bar.close')}
          </Button>
        }
      >
        <div className="agent-line">{t('d22c.review.notAppliedAbout')}</div>
        <ul className="agent-rev-dropped">
          {draft.dropped.map((d, i) => (
            <li key={`${d.seq}.${d.index ?? ''}.${i}`} data-testid={`agent.draft.dropped.${i}`} data-rejected={d.rejected ? 'yes' : undefined} data-sort={d.rejected ? 'rejected' : dropKey(d.reason).slice('d22c.drop.'.length)}>
              <span className="agent-rev-dropped-what">{t(`d22c.kind.${MARK_OF[d.command ?? '']?.[0] ?? 'other'}` as StringKey)}</span>
              <span className="agent-rev-dropped-why" data-after={d.after}>
                {d.rejected ? t('d22c.review.rejectedByYou') : d.after !== undefined ? `${t('ekip.drop.after', { name: crew.name(d.after || undefined) })} ${t(dropKey(d.reason))}` : t(dropKey(d.reason))}
              </span>
              {!d.rejected && (
                <Button size="sm" variant="ghost" icon={details === i ? 'chevron-up' : 'chevron-down'} onClick={() => setDetails(details === i ? null : i)} testid={`agent.draft.dropped.details.${i}`}>
                  {t('d22c.review.details')}
                </Button>
              )}
              {d.revivable && d.index !== undefined && (
                <Button size="sm" variant="ghost" icon="rotate-ccw" onClick={() => reviveOp(d.seq, d.index!)} testid={`agent.draft.revive.${d.seq}.${d.index}`}>
                  {t('agent.draft.revive')}
                </Button>
              )}
              {details === i && !d.rejected && (
                <span className="agent-rev-dropped-raw" data-testid={`agent.draft.dropped.raw.${i}`}>
                  {t('d22c.review.details.said', { name: d.label, reason: d.reason })}
                </span>
              )}
            </li>
          ))}
        </ul>
      </Dialog>
      <Dialog
        open={asking}
        title={t('d22c.review.rejectWhy.title', { name })}
        onClose={() => setAsking(false)}
        width="sm"
        testid="agent.draft.whyAsk"
        actions={
          <>
            <Button variant="ghost" onClick={() => setAsking(false)}>{t('agent.cancel')}</Button>
            <Button
              variant="primary"
              onClick={() => {
                setAsking(false)
                rejectWholeDraft(draft, why)
                setWhy('')
              }}
              testid="agent.draft.whyReject"
            >
              {t('d22c.review.rejectAll')}
            </Button>
          </>
        }
      >
        <TextField value={why} onChange={setWhy} label={t('d22c.review.why')} placeholder={t('d22c.review.why')} size="sm" testid="agent.draft.why" />
      </Dialog>
    </div>
  )
}
