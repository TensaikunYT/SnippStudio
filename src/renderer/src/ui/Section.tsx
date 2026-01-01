// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// A section that folds (SnippStudio phase 3c.1, tarifler\FAZ3C.md decision 4:
// the old components/Section.tsx moved into the building blocks). Its open or
// closed state is remembered per section, under a stable id (not its shown
// title, which now changes with the language); the ids are the old English
// titles, so a section stays the way the user left it before the move.
// A SubSection is a block inside a section, for the occasional parts.
// The visual polish ("az, çok", GORSEL-PLAN.md G8): a section's lines of help
// (.hint) are not on screen while explanations are short (the default); an
// info mark beside the title holds them in its tooltip, and a screen reader
// still reads them where they are. File → Long explanations shows them again.
import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from 'react'
import { Icon, type IconName } from './Icon'
import { Tooltip } from './Tooltip'

/** The help lines of this section's own body (not a nested section's), joined. */
function hintsOf(body: HTMLElement): string {
  const own = body.closest('.ui-section')
  return [...body.querySelectorAll<HTMLElement>('.hint:not(.is-danger):not(.is-warning):not(.is-state)')]
    .filter((h) => h.closest('.ui-section') === own)
    .map((h) => (h.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ')
}

/** The help of an open section, kept up to date as its body changes. */
function useSectionHelp(open: boolean): [RefObject<HTMLDivElement>, string] {
  const body = useRef<HTMLDivElement>(null)
  const [help, setHelp] = useState('')
  useLayoutEffect(() => {
    const el = body.current
    if (!open || !el) {
      setHelp('')
      return
    }
    let frame = 0
    const read = (): void => {
      frame = 0
      const text = hintsOf(el)
      setHelp((prev) => (prev === text ? prev : text))
    }
    read()
    const watch = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(read)
    })
    watch.observe(el, { childList: true, subtree: true, characterData: true })
    return () => {
      watch.disconnect()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [open])
  return [body, help]
}

const KEY = 'snipp-sections'

/** Sections the user rarely needs open: folded until they say otherwise. */
export const DEFAULT_CLOSED: ReadonlySet<string> = new Set([
  'Keyframes',
  'Crop',
  'Mask',
  'Green screen (chroma key)',
  'Cinematic motion',
  'Emoji decoration',
  'Current-word highlight',
  'Pop-up animation',
  'Style presets',
  'Snapping',
  'Transition to next clip',
  'Color',
  'Scopes',
  'Shorts subtitles',
  'Archive',
  'Chapters',
  // Round 10: the advanced parts fold away too (a click opens them, and
  // they stay the way you leave them).
  'Effects',
  'Moves',
  'Key words'
])

/**
 * Sections whose remembered state is dropped once, because the panel changed
 * around them: Audio moved to the top of the Clip tab and its rarely-used parts
 * were folded away, so anyone who had collapsed the old (very long) version
 * would otherwise never see the new one.
 */
const RESET_ONCE = { flag: 'snipp-sections-reset-1', titles: ['Audio'] }

/** The remembered open (true) or closed (false) state of each section id. */
export function readSectionState(): Record<string, boolean> {
  try {
    const state = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, boolean>
    if (!localStorage.getItem(RESET_ONCE.flag)) {
      for (const t of RESET_ONCE.titles) delete state[t]
      localStorage.setItem(RESET_ONCE.flag, '1')
      writeSectionState(state)
    }
    return state
  } catch {
    return {}
  }
}

export function writeSectionState(state: Record<string, boolean>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* storage full or blocked: folding still works for this session */
  }
}

/** Open or closed, remembered under `key` (a new key, as when the
 *  selection's kind changes under a mounted card, reads its own state). */
export function useRemembered(key: string, byDefault: boolean): [boolean, () => void] {
  const read = (): boolean => readSectionState()[key] ?? byDefault
  const [held, setHeld] = useState(() => ({ key, open: read() }))
  const now = held.key === key ? held : { key, open: read() }
  if (now !== held) setHeld(now)
  const toggle = useCallback(() => {
    setHeld((prev) => {
      const was = prev.key === key ? prev.open : read()
      const state = readSectionState()
      state[key] = !was
      writeSectionState(state)
      return { key, open: !was }
    })
  }, [key, byDefault])
  return [now.open, toggle]
}

/** A panel's folding rule (kullanım, item 5): inside it, every section is
 *  folded but the ones `open` names (the panel's main part), and what the
 *  user opens or folds is remembered for this panel or kind of selection
 *  (`name`) alone. A folded section's body is not built at all. */
export interface SectionScopeValue {
  name: string
  open: ReadonlySet<string>
}
const ScopeContext = createContext<SectionScopeValue | null>(null)
export function SectionScope({ name, open, children }: { name: string; open: readonly string[]; children: ReactNode }): JSX.Element {
  const [value, setValue] = useState<SectionScopeValue>(() => ({ name, open: new Set(open) }))
  const same = value.name === name && value.open.size === open.length && open.every((id) => value.open.has(id))
  const now = same ? value : { name, open: new Set(open) }
  if (!same) setValue(now)
  return <ScopeContext.Provider value={now}>{children}</ScopeContext.Provider>
}

export interface SectionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'id'> {
  /** The key its state is remembered by (stable; the old English title). */
  id: string
  /** What it shows (from t()). */
  title: string
  /** A count after the title (shown when above 0). */
  count?: number
  /** Open the first time (default: open unless DEFAULT_CLOSED has its id). */
  defaultOpen?: boolean
  testid?: string
  /** Arayüz v4: the card's icon, before its title. */
  icon?: IconName
  /** Arayüz v4: what sits at the right of the title (a keyframe diamond, an
   *  on/off switch); pressing it does not fold the card. */
  aside?: ReactNode
  /** Drawn as a card (InspectorCard) wherever it is; inside `.ui-cards` every
   *  top-level section is one anyway. */
  card?: boolean
  children: ReactNode
}

export function Section({ id, title, count, defaultOpen, testid, icon, aside, card, className, children, ...rest }: SectionProps): JSX.Element {
  const scope = useContext(ScopeContext)
  const [open, toggle] = useRemembered(scope ? `${scope.name}/${id}` : id, scope ? scope.open.has(id) : (defaultOpen ?? !DEFAULT_CLOSED.has(id)))
  const [body, help] = useSectionHelp(open)
  return (
    <div className={['ui-section', open ? 'is-open' : '', icon ? 'has-icon' : '', card ? 'is-card' : '', className ?? ''].filter(Boolean).join(' ')} data-testid={testid} {...rest}>
      <h3 className="ui-section-title">
        <button type="button" className="ui-section-head" aria-expanded={open} onClick={toggle} data-testid={testid ? `${testid}.head` : undefined}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="ui-section-chevron" />
          {icon && <Icon name={icon} size={15} className="ui-section-icon" />}
          <span className="ui-section-name">{title}</span>
          {count !== undefined && count > 0 && <span className="ui-section-count">{count}</span>}
        </button>
        {help && (
          <Tooltip content={help} describe={false}>
            <span className="ui-section-info" role="note" tabIndex={0} aria-label={help} data-testid={testid ? `${testid}.help` : undefined}>
              <Icon name="info" size={14} />
            </span>
          </Tooltip>
        )}
        {aside && <span className="ui-section-aside">{aside}</span>}
        {/* A card's fold mark sits last, after what is at its right (the
            button before it says open or closed to a screen reader). */}
        <span className="ui-section-end" aria-hidden="true" onClick={toggle}>
          <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} />
        </span>
      </h3>
      {open && (
        <div className="ui-section-body" ref={body}>
          {children}
        </div>
      )}
    </div>
  )
}

export interface SubSectionProps {
  /** The key its state is remembered by (stable; stored as `sub:<id>`). */
  id: string
  title: string
  /** A line of help at the top of its body. */
  hint?: string
  /** Start open (a panel's main body rather than an extra). */
  open?: boolean
  testid?: string
  children: ReactNode
}

export function SubSection({ id, title, hint, open: byDefault = false, testid, children }: SubSectionProps): JSX.Element {
  const [open, toggle] = useRemembered(`sub:${id}`, byDefault)
  return (
    <div className={open ? 'ui-subsection is-open' : 'ui-subsection'} data-testid={testid}>
      <button type="button" className="ui-subsection-head" aria-expanded={open} onClick={toggle}>
        <Icon name={open ? 'chevron-down' : 'chevron-right'} size={14} className="ui-section-chevron" />
        <span>{title}</span>
      </button>
      {open && (
        <div className="ui-subsection-body">
          {hint && <div className="ui-section-hint">{hint}</div>}
          {children}
        </div>
      )}
    </div>
  )
}

/** Arayüz v4: a section drawn as a card (the Inspector's parts): an icon and a
 *  title, what belongs at its right, folding remembered per card. */
export function InspectorCard(props: SectionProps): JSX.Element {
  return <Section card {...props} />
}

const TABS_KEY = 'snipp-card-tabs'

/** The part of a card last open (its small tabs), remembered per card. */
export function useCardPart<V extends string>(id: string, parts: readonly V[], byDefault: V): [V, (v: V) => void] {
  const [part, setPart] = useState<V>(() => {
    try {
      const v = (JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}') as Record<string, string>)[id] as V | undefined
      return v && parts.includes(v) ? v : byDefault
    } catch {
      return byDefault
    }
  })
  const choose = useCallback(
    (v: V) => {
      setPart(v)
      try {
        const all = JSON.parse(localStorage.getItem(TABS_KEY) ?? '{}') as Record<string, string>
        all[id] = v
        localStorage.setItem(TABS_KEY, JSON.stringify(all))
      } catch {
        /* not remembered: fine */
      }
    },
    [id]
  )
  return [parts.includes(part) ? part : byDefault, choose]
}
