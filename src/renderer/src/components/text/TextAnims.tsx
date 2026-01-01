// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Text page's animations (YAZI-PANELI-PLAN.md §3), in three groups: how
// a text comes in, how it goes out, how it moves while it is on screen. Each
// card has its short name under it; at rest its picture is the move half
// done (lower and faint, small, turned…), pointed at it plays. A
// click gives the move to the selected texts (an "in" card their way in
// only, and so on), or adds a text with it.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import type { Caption, TextAnim, TextIdle } from '../../types'
import { BareButton, Tooltip, useT, type StringKey } from '../../ui'
import { Pick } from './Pick'
import { noteUsed } from './picks'
import { addTitle } from './TextStyles'
import { startTyping } from '../preview/text-edit/session'
import { MIDDLE, fitCanvas, newFrame, paintFrame, runPicture, sampleCaption, sampleStyle, show } from './draw'

type InAnim = Exclude<TextAnim, 'none'> | 'type'
type OutAnim = Exclude<TextAnim, 'none'>
type Idle = Extract<TextIdle, 'breathe' | 'drift' | 'tilt' | 'bob' | 'glide'>

export const IN_ANIMS: readonly InAnim[] = ['fade', 'slide', 'zoom', 'pop', 'blur', 'drop', 'spin', 'grow', 'note', 'type']
export const OUT_ANIMS: readonly OutAnim[] = ['fade', 'slide', 'zoom', 'pop', 'blur', 'drop', 'spin', 'grow', 'note']
/** The five "good" moves only (two waves each); the three single-wave
 *  originals stay in the Inspector's list. */
export const IDLE_ANIMS: readonly Idle[] = ['breathe', 'drift', 'tilt', 'bob', 'glide']

export type Group = 'in' | 'out' | 'idle'
export type Card = { group: 'in'; anim: InAnim } | { group: 'out'; anim: OutAnim } | { group: 'idle'; anim: Idle }

/** "Type on" is the program's letter-by-letter entrance, a fade per letter. */
const TYPE_STAGGER = 0.06
const DUR = 0.45
/** The sample's life: in at 0.1 s, out by 1.5 s; one loop is 1.6 s. */
const LIFE = { start: 0.1, end: 1.5 }
const LOOP_MS = 1600
/** The moves while on screen are fine ones: in the picture three times as strong
 *  and 2.5 times as fast, or a small card would show nothing. */
const IDLE_AMT = 3
const IDLE_SPEED = 2.5
const IDLE_LOOP_MS = 4000

/** The sample's animation for a card. */
function animOf(card: Card): Caption['anim'] {
  if (card.group === 'idle') return { idle: card.anim, idleAmt: IDLE_AMT }
  if (card.group === 'out') return { out: card.anim, outDur: DUR }
  if (card.anim === 'type') return { in: 'fade', inDur: 0.2, perChar: true, charStagger: TYPE_STAGGER }
  return { in: card.anim, inDur: DUR }
}

/** The moment shown at rest: halfway through the move, where one move
 *  looks least like another (lower and faint, small, turned, blurred…). Only
 *  one: two moments over each other read as doubled words, the very fault
 *  the user met in the Label look. */
function restTime(card: Card, letters: number): number {
  if (card.group === 'idle') return 2.1 * IDLE_SPEED
  if (card.group === 'out') return LIFE.end - DUR * 0.45
  if (card.anim === 'type') return LIFE.start + TYPE_STAGGER * Math.max(1, letters * 0.55) + 0.1
  return LIFE.start + DUR * 0.45
}

/**
 * The still of the cards a single moment does not tell apart (cila4, 2;
 * GORUNUS R5): the five moves while on screen are a few pixels on a card, so
 * at rest each is drawn stronger (`amt`, the move's own amount), at a moment
 * where it is furthest from rest (`at`), with one or two other moments of it
 * faint behind (`ghosts`, as the Effects cards since cila3): breathe small
 * inside its bigger self, drift and glide with their trail, tilt against its
 * other lean, bob low under its high. Grow and shrink show a moment most of
 * the way, with the smaller (grow) or the whole (shrink) word faint behind,
 * so the two read apart. Pointed at, every card plays the move as applied.
 * Pure (the unit test reads it); null: the single moment of restTime.
 */
export function stillOf(card: Card): { amt?: number; at: number; ghosts: number[] } | null {
  if (card.group === 'idle') {
    const S: Record<Idle, { amt: number; at: number; ghosts: number[] }> = {
      breathe: { amt: 10, at: 17.6, ghosts: [2.75] },
      drift: { amt: 8, at: 5.15, ghosts: [2.4, 3.8] },
      tilt: { amt: 12, at: 3.85, ghosts: [11.25] },
      bob: { amt: 6, at: 2.5, ghosts: [7.25] },
      glide: { amt: 8, at: 3.95, ghosts: [1.6, 2.8] }
    }
    return S[card.anim]
  }
  if (card.anim !== 'grow') return null
  // (The exit's eased progress 0.78 at p = 0.7: most of the way.)
  if (card.group === 'in') return { at: LIFE.start + DUR * 0.7, ghosts: [LIFE.start + DUR * 0.3] }
  return { at: LIFE.end - DUR * 0.7, ghosts: [LIFE.end - DUR - 0.05] }
}
/** How strong the faint moments are drawn. */
const GHOST_ALPHA = 0.22

function AnimPicture({ card, word, playing }: { card: Card; word: string; playing: boolean }): JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null)
  const base = useStore((s) => s.project.captionStyle)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    // The word big (96 px on the 1080p frame) so it reads in a third of the panel.
    const style = sampleStyle(base, null, { fontSize: 96 })
    const idle = card.group === 'idle'
    const cap = sampleCaption('sample', word, style, idle ? 0 : LIFE.start, idle ? 1e4 : LIFE.end, animOf(card))
    const caps = [cap]
    const fg = newFrame()
    const still = stillOf(card)
    const at = still?.at ?? restTime(card, word.length)
    // (At rest the move drawn stronger, when the still says so.)
    const restCaps = still?.amt ? [{ ...cap, anim: { ...cap.anim, idleAmt: still.amt } }] : caps
    const rest = (): void => {
      const g = fitCanvas(cv)
      g.clearRect(0, 0, cv.width, cv.height)
      for (const gt of still?.ghosts ?? []) {
        paintFrame(fg, restCaps, style, gt)
        show(g, fg, MIDDLE, GHOST_ALPHA)
      }
      paintFrame(fg, restCaps, style, at)
      show(g, fg, MIDDLE)
    }
    const paint = (s: number): void => {
      const g = fitCanvas(cv)
      g.clearRect(0, 0, cv.width, cv.height)
      paintFrame(fg, caps, style, idle ? s * IDLE_SPEED : s)
      show(g, fg, MIDDLE)
    }
    return runPicture(playing, idle ? IDLE_LOOP_MS : LOOP_MS, rest, paint)
  }, [base, card, word, playing])
  return <canvas ref={ref} className="text-style-thumb" aria-hidden="true" />
}

/** The selected texts a card acts on: titles, not subtitles or shapes. */
function selectedTexts(): Caption[] {
  const s = useStore.getState()
  return s.selectedCaptionIds.map((id) => s.project.captions.find((c) => c.id === id)).filter((c): c is Caption => !!c && !!c.manual && !c.shape)
}

/** The animation a card gives a text, merged into what it has. */
function withCard(anim: Caption['anim'], card: Card): NonNullable<Caption['anim']> {
  const a = { ...anim }
  if (card.group === 'idle') return { ...a, idle: card.anim }
  if (card.group === 'out') return { ...a, out: card.anim }
  // "Type on" is letters arriving; another way in turns it off again (it
  // would otherwise play that one letter by letter, which nobody chose).
  if (card.anim === 'type') return { ...a, in: a.in && a.in !== 'none' ? a.in : 'fade', perChar: true, charStagger: a.charStagger ?? TYPE_STAGGER }
  return { ...a, in: card.anim, perChar: false }
}

/** Does `c` have this card's move? */
function hasCard(c: Caption, card: Card): boolean {
  const a = c.anim
  if (card.group === 'idle') return a?.idle === card.anim
  if (card.group === 'out') return a?.out === card.anim
  if (card.anim === 'type') return !!a?.perChar && !!a.in && a.in !== 'none'
  return a?.in === card.anim && !a.perChar
}

function pick(card: Card): void {
  const s = useStore.getState()
  const sel = selectedTexts()
  if (sel.length) {
    s.undoable(() => {
      for (const c of sel) s.updateCaption(c.id, { anim: withCard(c.anim, card) })
    })
    return
  }
  // As every card adds one (YAZI2-PLAN.md, 2.1): in the middle of the frame,
  // selected, typed in at once; one undo step with its move.
  let id = ''
  s.undoable(() => {
    id = addTitle(null, { type: false })
    s.updateCaption(id, { anim: withCard(undefined, card) })
  })
  startTyping(id, 'all')
}

const shortName = (card: Card): StringKey => `text.anim.${card.group}.${card.anim}` as StringKey
/** The Inspector's own (longer) name, said in the tooltip. */
function longName(card: Card): StringKey {
  if (card.group === 'idle') return `insp.text.idle.${card.anim}` as StringKey
  if (card.group === 'in' && card.anim === 'type') return 'text.anim.in.type.long'
  return `insp.text.${card.group}.${card.anim}` as StringKey
}

/** A card's id among the favourites and the recently used. */
export const animId = (card: Card): string => `anim:${card.group}.${card.anim}`

export function AnimCard({ card, on }: { card: Card; on: boolean }): JSX.Element {
  const t = useT()
  const [hot, setHot] = useState(false)
  const name = t(shortName(card))
  const id = animId(card)
  return (
    <Pick id={id} name={name}>
    <Tooltip side="right" delay={500} content={t(`text.anim.tip.${card.group}` as StringKey, { name: t(longName(card)) })}>
      <BareButton
        className={on ? 'text-style text-anim is-on' : 'text-style text-anim'}
        testid={`dock.text.anim.${card.group}.${card.anim}`}
        aria-label={name}
        aria-pressed={on}
        onClick={() => {
          noteUsed(id)
          pick(card)
        }}
        onPointerEnter={() => setHot(true)}
        onPointerLeave={() => setHot(false)}
        onFocus={() => setHot(true)}
        onBlur={() => setHot(false)}
      >
        <AnimPicture card={card} word={t('dock.text.anims.sample')} playing={hot} />
        <span className="text-style-name">{name}</span>
      </BareButton>
    </Tooltip>
    </Pick>
  )
}

export const GROUPS: [Group, readonly Card[]][] = [
  ['in', IN_ANIMS.map((anim): Card => ({ group: 'in', anim }))],
  ['out', OUT_ANIMS.map((anim): Card => ({ group: 'out', anim }))],
  ['idle', IDLE_ANIMS.map((anim): Card => ({ group: 'idle', anim }))]
]

/** The search words of a card: its short and long names and its group's. */
export const animWords = (card: Card): StringKey[] => [shortName(card), longName(card), `text.anim.group.${card.group}` as StringKey]

/** The cards a selected text has: marked. */
export function useAnimOn(): (card: Card) => boolean {
  const selIds = useStore((s) => s.selectedCaptionIds)
  const captions = useStore((s) => s.project.captions)
  const sel = useMemo(() => selIds.map((id) => captions.find((c) => c.id === id)).filter((c): c is Caption => !!c && !!c.manual && !c.shape), [selIds, captions])
  return (card) => sel.length > 0 && sel.every((c) => hasCard(c, card))
}

/** The three groups (only the cards `show` keeps; a group left empty goes). */
export function TextAnims({ show }: { show: (card: Card) => boolean }): JSX.Element {
  const t = useT()
  const on = useAnimOn()
  return (
    <div className="text-anims" data-testid="dock.text.anims">
      {GROUPS.map(([group, all]) => {
        const cards = all.filter(show)
        if (!cards.length) return null
        return (
          <div key={group} className="text-anim-group" role="group" aria-label={t(`text.anim.group.${group}` as StringKey)} data-testid={`dock.text.anims.${group}`}>
            <div className="text-anim-group-name">{t(`text.anim.group.${group}` as StringKey)}</div>
            <div className="text-anim-grid">
              {cards.map((card) => <AnimCard key={card.anim} card={card} on={on(card)} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}
