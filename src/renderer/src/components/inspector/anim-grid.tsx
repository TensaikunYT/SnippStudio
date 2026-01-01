// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A clip's animations as a grid of pictures (REF-AB, item 9): for the
// entrance, the exit and the motion all through the clip, each animation a
// named tile whose picture is drawn by the program's own renderer
// (transition-preview.tsx: the same frame the Effects page's moves use, the
// animation done to it), still at rest and playing while pointed at or
// focused. Above the entrances and exits, a search (by name and by kind) and
// the kinds as chips. The list and the length slider below the grid stay as
// they were.
import { useMemo, useState } from 'react'
import { useStore } from '../../state/store'
import type { Clip, ClipAnim, IdleStyle, Project } from '../../types'
import { CLIP_ANIMS, IDLE_STYLES } from '../../types'
import { BareButton, Chip, Icon, TextField, t as say, useT, type StringKey } from '../../ui'
import { CLIP_PREVIEW_S, PreviewCanvas, moveProject } from './transition-preview'
import { animName, idleName } from './motion-names'

export type MotionPart = 'in' | 'out' | 'idle'

/** The kinds the entrances and exits are sorted into. */
export const ANIM_KINDS = ['all', 'basic', 'slide', 'lively', 'ramp'] as const
export type AnimKind = (typeof ANIM_KINDS)[number]

/** Each animation's kind. */
export const KIND_OF: Record<Exclude<ClipAnim, 'none'>, Exclude<AnimKind, 'all'>> = {
  fade: 'basic',
  'zoom-in': 'basic',
  'zoom-out': 'basic',
  blur: 'basic',
  'slide-up': 'slide',
  'slide-down': 'slide',
  'slide-left': 'slide',
  'slide-right': 'slide',
  pop: 'lively',
  spin: 'lively',
  whip: 'lively',
  elastic: 'lively',
  'ramp-right': 'ramp',
  'ramp-left': 'ramp',
  'ramp-down': 'ramp',
  'ramp-up': 'ramp'
}

export const kindName = (k: AnimKind): string => say(`refi.anim.kind.${k}` as StringKey)

const fold = (s: string): string => s.toLocaleLowerCase('tr').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i')

/**
 * The entrances / exits a search and a kind leave (in the list's order):
 * the words searched for found in the animation's name or its kind's name
 * (case and Turkish dots aside); "None" stays first while nothing is
 * searched. Pure.
 */
export function findAnims(query: string, kind: AnimKind, nameOf: (a: ClipAnim) => string = animName, kindNameOf: (k: AnimKind) => string = kindName): ClipAnim[] {
  const q = fold(query.trim())
  return CLIP_ANIMS.filter((a) => {
    if (a === 'none') return !q && kind === 'all'
    if (kind !== 'all' && KIND_OF[a] !== kind) return false
    return !q || fold(nameOf(a)).includes(q) || fold(kindNameOf(KIND_OF[a])).includes(q)
  })
}

/** How long the pictures' animations last (seconds). */
const DUR = 0.6
const CLIP_S = CLIP_PREVIEW_S * 2

/** The made-up project of one tile: the warm frame with the animation done
 *  to it. Pure (the unit test reads it). */
export function animPreviewProject(part: MotionPart, kind: ClipAnim | IdleStyle, amount = 1): Project {
  return moveProject((clip) => {
    if (kind === 'none') return
    if (part === 'idle') clip.idle = { style: kind as IdleStyle, amount, speed: 1 }
    else clip.anim = part === 'in' ? { in: kind as ClipAnim, inDur: DUR } : { out: kind as ClipAnim, outDur: DUR }
  })
}

/** The time shown at `phase` (0–1) of a tile's loop, and at rest. Pure. */
export function animPreviewTime(part: MotionPart, phase: number): number {
  const f = Math.min(1, Math.max(0, phase))
  if (part === 'in') return f * DUR * 2
  if (part === 'out') return Math.min(CLIP_S - 1e-3, CLIP_S - DUR * 2 + f * DUR * 2)
  return f * 3
}
// (At rest: early in an entrance, late in an exit, where the move shows most.)
const REST: Record<MotionPart, number> = { in: 0.15, out: 0.85, idle: 0.3 }
/** A speed ramp is dark until its middle: shown nearer it. */
const restOf = (part: MotionPart, kind: string): number => (kind.startsWith('ramp-') ? (part === 'in' ? 0.32 : 0.68) : REST[part])
const LOOP: Record<MotionPart, number> = { in: 1400, out: 1400, idle: 3000 }
/** The motions all through the clip at rest (cila4, 2): a few pixels on a
 *  tile, so all four looked alike. The still is the same motion IDLE_GAIN
 *  times stronger, at IDLE_REST s with two earlier moments faint over it
 *  (lightening only: the light's trail shows which way it went). Pointed at,
 *  the tile plays the motion as applied. (All inside the made-up clip of
 *  CLIP_S seconds: past its end the frame is black.) */
export const IDLE_GAIN = 10
export const IDLE_REST = { at: 3.5, ghosts: [0.3, 1.9] } as const

function AnimTile({ part, kind, name, on, onPick }: { part: MotionPart; kind: ClipAnim | IdleStyle; name: string; on: boolean; onPick: () => void }): JSX.Element {
  const [hot, setHot] = useState(false)
  const project = useMemo(() => animPreviewProject(part, kind), [part, kind])
  const idle = part === 'idle' && kind !== 'none'
  const still = useMemo(() => (idle ? animPreviewProject(part, kind, IDLE_GAIN) : undefined), [idle, part, kind])
  return (
    <BareButton
      className={on ? 'insp-anim is-on' : 'insp-anim'}
      aria-pressed={on}
      aria-label={name}
      testid={`inspector.clip.motion.tile.${kind}`}
      onClick={onPick}
      onPointerEnter={() => setHot(true)}
      onPointerLeave={() => setHot(false)}
      onFocus={() => setHot(true)}
      onBlur={() => setHot(false)}
    >
      <PreviewCanvas project={project} still={still} rest={idle ? IDLE_REST.at : animPreviewTime(part, restOf(part, kind))} ghosts={idle ? IDLE_REST.ghosts : undefined} light={idle} at={(phase) => animPreviewTime(part, phase)} loopMs={LOOP[part]} playing={hot && kind !== 'none'} />
      <span className="insp-anim-name">{name}</span>
    </BareButton>
  )
}

export function AnimGrid({ clip, part }: { clip: Clip; part: MotionPart }): JSX.Element {
  const t = useT()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<AnimKind>('all')
  const setAnim = useStore((s) => s.setClipAnim)
  const setIdle = useStore((s) => s.setClipIdle)
  if (part === 'idle') {
    const now = clip.idle?.style ?? 'none'
    return (
      <div className="insp-anims" role="group" aria-label={t('refi.anim.grid')} data-testid="inspector.clip.motion.grid">
        {IDLE_STYLES.map((s) => (
          <AnimTile key={s} part="idle" kind={s} name={idleName(s)} on={now === s} onPick={() => setIdle(clip.id, { style: s })} />
        ))}
      </div>
    )
  }
  const now = (part === 'in' ? clip.anim?.in : clip.anim?.out) ?? 'none'
  const list = findAnims(query, kind)
  return (
    <>
      <div className="insp-search">
        <Icon name="search" size={14} />
        <TextField size="sm" value={query} onChange={setQuery} label={t('refi.anim.search')} placeholder={t('refi.anim.search')} testid="inspector.clip.motion.search" />
      </div>
      <div className="insp-chips insp-anim-kinds" role="group" aria-label={t('refi.anim.kinds')}>
        {ANIM_KINDS.map((k) => (
          <Chip key={k} pressed={kind === k} onClick={() => setKind(k)} testid={`inspector.clip.motion.kind.${k}`}>
            {kindName(k)}
          </Chip>
        ))}
      </div>
      {list.length === 0 ? (
        <div className="hint is-state" data-testid="inspector.clip.motion.none-found">{t('refi.anim.noneFound')}</div>
      ) : (
        <div className="insp-anims" role="group" aria-label={t('refi.anim.grid')} data-testid="inspector.clip.motion.grid">
          {list.map((a) => (
            <AnimTile key={`${part}-${a}`} part={part} kind={a} name={animName(a)} on={now === a} onPick={() => setAnim(clip.id, part === 'in' ? { in: a } : { out: a })} />
          ))}
        </div>
      )}
    </>
  )
}
