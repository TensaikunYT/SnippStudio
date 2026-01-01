// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// What goes over and under the preview from VideoHub's review page
// (ONIZLEME-UYGULA-PLAN.md): the review's "before" frame (B), the
// comparison's labels and wipe handle, the click-and-type note's box, the
// shortcut list (?) and the narration line (Shift+C). All of it is the
// page's own layer: the film itself is drawn as it always was, and nothing
// here reaches the export.
import { useEffect, useRef, useState, type RefObject } from 'react'
import { useStore } from '../../state/store'
import { Button, IconButton, TextArea, notify, useT } from '../../ui'
import { usePreviewUi } from './pv-ui'
import { candidate, compareMode, wipeAt, type CompareMode } from '../../playback/candidate'
import { compareLayout, fitFrame, type Rect } from './compare'
import { saveDraft } from '../../notes/actions'
import { useWatch } from '../watch/watch-state'
import { ACTIONS, bindingLabel, loadBindings, type ActionId } from '../../shortcuts'
import { openSettings } from '../settings/open'
import type { Caption } from '../../types'

/** The size of the preview's area (the wrap), kept by a ResizeObserver. */
function useAreaSize(ref: RefObject<HTMLElement>): { cw: number; ch: number } {
  const [size, setSize] = useState({ cw: 0, ch: 0 })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = (): void => setSize({ cw: el.clientWidth, ch: el.clientHeight })
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    return () => ro.disconnect()
  }, [ref])
  return size
}

const place = (r: Rect): React.CSSProperties => ({ left: r.left, top: r.top, width: r.w, height: r.h })

/** The note's frame as it was when it was written, over the frame now (B). */
function ReviewBefore({ cw, ch }: { cw: number; ch: number }): JSX.Element | null {
  const t = useT()
  const on = usePreviewUi((s) => s.reviewBefore)
  const image = useStore((s) => (s.noteReview ? s.project.notes?.find((n) => n.id === s.noteReview!.ids[s.noteReview!.index])?.regionImage : undefined))
  const W = useStore((s) => s.project.settings.width)
  const H = useStore((s) => s.project.settings.height)
  const pv = useStore((s) => s.previewView)
  if (!on || !image || cw <= 0) return null
  const box = fitFrame(cw, ch, W, H, pv)
  return (
    <>
      <img className="pv-before-img" data-testid="review.before.image" src={image} alt={t('review.before.tag')} style={place(box)} />
      <span className="pv-tag" data-testid="review.before.tag" style={{ left: Math.max(8, box.left + 8), top: Math.max(8, box.top + 8) }}>
        {t('review.before.tag')}
      </span>
    </>
  )
}

function useCompare(): { mode: CompareMode; wipe: number } {
  const [v, setV] = useState(() => ({ mode: compareMode(), wipe: wipeAt() }))
  useEffect(() => candidate.subscribe(() => setV({ mode: compareMode(), wipe: wipeAt() })), [])
  return v
}

/** The comparison's labels, the wipe's handle, and "draft quality". */
function CompareMarks({ cw, ch }: { cw: number; ch: number }): JSX.Element | null {
  const t = useT()
  const { mode, wipe } = useCompare()
  const W = useStore((s) => s.project.settings.width)
  const H = useStore((s) => s.project.settings.height)
  const pv = useStore((s) => s.previewView)
  const low = usePreviewUi((s) => s.compareDraft)
  if (mode === 'off' || cw <= 0) return null
  const lay = compareLayout(mode, cw, ch, W, H, pv)
  const a = lay.after
  const b = lay.before ?? a
  const tag = (r: Rect, right: boolean): React.CSSProperties => ({ top: Math.max(8, r.top + 8), ...(right ? { left: Math.min(cw - 8, r.left + r.w - 8), transform: 'translateX(-100%)' } : { left: Math.max(8, r.left + 8) }) })
  const drag = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const area = el.parentElement!.getBoundingClientRect()
    const move = (ev: PointerEvent): void => candidate.setWipe((ev.clientX - area.left - a.left) / Math.max(1, a.w))
    const up = (): void => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }
  return (
    <div className="pv-compare" data-testid="compare.layer" data-mode={mode}>
      {mode === 'diff' ? (
        <span className="pv-tag" style={tag(a, false)}>{t('compare.diff')}</span>
      ) : (
        <>
          <span className="pv-tag" data-testid="compare.before" style={tag(b, false)}>{t('compare.before')}</span>
          <span className="pv-tag" data-testid="compare.after" style={tag(a, true)}>{t('compare.after')}</span>
        </>
      )}
      {mode === 'wipe' && (
        <div
          className="pv-wipe"
          data-testid="compare.wipe"
          role="slider"
          aria-label={t('compare.wipe')}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(wipe * 100)}
          title={t('compare.wipe')}
          style={{ left: a.left + a.w * wipe, top: a.top, height: a.h }}
          onPointerDown={drag}
        />
      )}
      {low && (
        <span className="pv-tag is-warn" data-testid="compare.draft" style={{ left: Math.max(8, a.left + 8), top: Math.min(ch - 32, a.top + a.h - 32) }}>
          {t('compare.draft')}
        </span>
      )}
    </div>
  )
}

/**
 * The click-and-type note (ONIZLEME-UYGULA-PLAN.md, K7): beside the pin a
 * click put down, a box for the note's words. Enter saves (and the film
 * plays on when the click stopped it), Esc closes, Space with nothing
 * written lets the note go and plays on.
 */
function QuickNote({ cw, ch }: { cw: number; ch: number }): JSX.Element | null {
  const t = useT()
  const at = usePreviewUi((s) => s.quickNote)
  const draft = useStore((s) => s.noteDraft)
  const W = useStore((s) => s.project.settings.width)
  const H = useStore((s) => s.project.settings.height)
  const pv = useStore((s) => s.previewView)
  const ref = useRef<HTMLTextAreaElement>(null)
  // The watch mode writes the note in its own box (IZLE-PLAN.md, K5).
  const watch = useWatch((w) => w.on)
  const open = !!at && !!draft && !watch
  // The note saved or let go some other way (the Notes tab): the box goes.
  useEffect(() => {
    if (at && !draft) usePreviewUi.getState().setQuickNote(null)
  }, [at, draft])
  useEffect(() => {
    if (open) ref.current?.focus()
  }, [open])
  if (!open || !at || !draft || cw <= 0) return null
  const box = fitFrame(cw, ch, W, H, pv)
  const px = box.left + at.x * box.w
  const py = box.top + at.y * box.h
  const w = Math.min(280, cw - 16)
  const left = px + 18 + w > cw - 8 ? Math.max(8, px - 18 - w) : px + 18
  const top = Math.max(8, Math.min(ch - 132, py - 24))
  const close = (): void => usePreviewUi.getState().setQuickNote(null)
  const playOn = (): void => {
    if (at.wasPlaying) useStore.getState().setPlaying(true)
  }
  return (
    <div className="pv-quick" data-testid="notes.quick" style={{ left, top, width: w }} onPointerDown={(e) => e.stopPropagation()}>
      <TextArea
        ref={ref}
        rows={2}
        testid="notes.quick.text"
        label={t('notes.quick.label')}
        placeholder={t('notes.quick.placeholder')}
        value={draft.text}
        onChange={(text) => useStore.getState().patchNoteDraft({ text })}
        onKeyDown={(e) => {
          e.stopPropagation()
          const empty = !draft.text.trim()
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            if (empty) {
              notify({ text: t('notes.quick.empty') })
              return
            }
            close()
            // The point tool stays in hand: the next click is the next note.
            if (saveDraft()) {
              useStore.getState().setNoteTool('pin')
              playOn()
            }
            return
          }
          if (e.key === 'Escape') {
            e.preventDefault()
            close()
            // Nothing said and only pins: the note goes; words stay in the Notes tab.
            if (empty && draft.shapes.every((x) => x.type === 'pin')) useStore.getState().cancelNoteDraft()
            return
          }
          if (e.key === ' ' && empty) {
            e.preventDefault()
            close()
            useStore.getState().cancelNoteDraft()
            useStore.getState().setNoteTool('pin')
            useStore.getState().setPlaying(true)
          }
        }}
      />
      <div className="pv-quick-hint">{t('notes.quick.hint')}</div>
    </div>
  )
}

/** The short list over the preview: the user's own keys (?). */
const LIST: [ActionId | ActionId[], boolean?][] = [
  ['playPause'],
  [['frameBack', 'frameForward'], true],
  [['secondBack', 'secondForward']],
  [['shuttleBack', 'shuttlePause', 'shuttleForward']],
  [['slower', 'faster']],
  ['goToTime'],
  [['shortIn', 'shortOut']],
  ['toggleLoop'],
  [['newNote', 'pointNote']],
  [['prevNote', 'nextNote']],
  [['previewActual', 'previewFit']],
  ['narration'],
  [['reviewBefore', 'reviewApprove']],
  ['shortcutList']
]
function KeyList(): JSX.Element | null {
  const t = useT()
  const on = usePreviewUi((s) => s.keyList)
  if (!on) return null
  const b = loadBindings()
  const name = (id: ActionId): string => {
    const a = ACTIONS.find((x) => x.id === id)
    return a?.labelKey ? t(a.labelKey) : a?.label ?? id
  }
  const close = (): void => usePreviewUi.getState().setKeyList(false)
  const rows: [string, string][] = LIST.map(([ids, hold]) => {
    const list = Array.isArray(ids) ? ids : [ids]
    const what = list.map(name).join(' · ')
    return [list.map((id) => bindingLabel(b[id])).join(' / '), hold ? t('keys.list.hold', { what }) : what]
  })
  rows.push([t('keys.list.spaceDrag'), t('keys.list.spaceDrag.what')], [t('keys.list.wheel'), t('keys.list.wheel.what')], [t('keys.list.click'), t('keys.list.click.what')])
  return (
    <div className="pv-keys" data-testid="keys.list" role="dialog" aria-label={t('keys.list.title')} onPointerDown={(e) => e.stopPropagation()}>
      <div className="pv-keys-head">
        <strong>{t('keys.list.title')}</strong>
        <IconButton icon="x" variant="ghost" size="sm" label={t('keys.list.close')} testid="keys.list.close" onClick={close} />
      </div>
      <dl className="pv-keys-rows">
        {rows.map(([k, what]) => (
          <div key={k + what} className="pv-keys-row">
            <dt>
              <kbd className="ui-kbd">{k}</kbd>
            </dt>
            <dd>{what}</dd>
          </div>
        ))}
      </dl>
      <Button
        size="sm"
        variant="secondary"
        icon="settings"
        testid="keys.list.all"
        onClick={() => {
          close()
          openSettings('keys')
        }}
      >
        {t('keys.list.all')}
      </Button>
    </div>
  )
}

/** Over the preview: the layers above, sized to the preview's area. */
export function PreviewExtras(): JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const { cw, ch } = useAreaSize(ref)
  return (
    <div ref={ref} className="pv-extras">
      <ReviewBefore cw={cw} ch={ch} />
      <CompareMarks cw={cw} ch={ch} />
      <QuickNote cw={cw} ch={ch} />
      <KeyList />
    </div>
  )
}

/** The spoken line at the playhead: the subtitles, not the titles placed by hand. */
export function narrationAt(captions: readonly Caption[], time: number): string | null {
  for (const c of captions) if (!c.manual && !c.shape && time >= c.start && time < c.end && c.text.trim()) return c.text.trim()
  return null
}

/** Under the preview, never on the film: what is said now (Shift+C). */
export function NarrationLine(): JSX.Element | null {
  const t = useT()
  const on = usePreviewUi((s) => s.narration)
  const any = useStore((s) => s.project.captions.some((c) => !c.manual && !c.shape))
  const text = useStore((s) => (on ? narrationAt(s.project.captions, s.currentTime) : null))
  if (!on) return null
  return (
    <div className={`pv-narration${text ? '' : ' is-empty'}`} data-testid="preview.narration" role="status" aria-label={t('narration.name')}>
      {text ?? (any ? t('narration.none') : t('narration.empty'))}
    </div>
  )
}
