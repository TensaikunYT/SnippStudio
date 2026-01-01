// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The left panel's Text page (DENEME-1, P1: "text kısmında templates
// gözükmesin … bir sub kategori olarak gözükebilir"). It opens on text and
// titles; the templates are its second sub-page. The page remembers which of
// the two was open. Made clearer at the user's word (YAZI-PANELI-PLAN.md):
// "Add text" first, then folding sections in this order: ready-made texts,
// styles (each writing its own name in its look; REF-AB, item 10),
// animations (in / out / while on screen), shapes and highlights (moved here
// from Effects), and a quick font choice for the selected text. A search over
// all of it, and the cards' favourites and recently used (REF-AB, item 6).
// (okunur, 23 November: "textte ready made kısmını da templates in içine
// taşı". The ready-made texts are the first section of the Templates
// sub-page now; the text sub-page shows them only as results of a search or
// of the favourites, and the recently used still lists them.)
import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../state/store'
import type { Caption } from '../types'
import { Button, Icon, IconButton, Section, Tabs, TextField, Tooltip, useT, type StringKey } from '../ui'
import { STRINGS } from '../ui/strings'
import { TemplatePanel } from './TemplatePanel'
import { onShellRequest } from './app/requests'
import { ShapesTab } from './ShapesTab'
import { AnimCard, GROUPS, TextAnims, animId, animWords, useAnimOn, type Card } from './text/TextAnims'
import { TextFonts } from './text/TextFonts'
import { READY, ReadyCard, TextReady } from './text/TextReady'
import { StyleCard, TextStyles, addTitle } from './text/TextStyles'
import { TEXT_LOOKS } from './text/looks'
import { fold, usePicks } from './text/picks'
import { startCardDrag } from './preview/text-edit/card-drag'

type Sub = 'text' | 'templates'
const KEY = 'snipp-dock-text-sub'

function readSub(): Sub {
  try {
    return localStorage.getItem(KEY) === 'templates' ? 'templates' : 'text'
  } catch {
    return 'text'
  }
}

type Mode = 'all' | 'fav' | 'recent'

/** The quick fonts a search can name (folded): the program's own and the usual default. */
const FONT_WORDS = ['inter', 'anton', 'archivo black', 'bebas neue', 'merriweather', 'permanent marker', 'arial']

/** Every animation card, by its id (the recently used list names them). */
const ANIM_BY_ID = new Map<string, Card>(GROUPS.flatMap(([, cards]) => cards.map((c): [string, Card] => [animId(c), c])))

/** The selected titles' count (the line saying what a click does). */
function useSelectedTitles(): number {
  const selIds = useStore((s) => s.selectedCaptionIds)
  const captions = useStore((s) => s.project.captions)
  return useMemo(() => selIds.map((id) => captions.find((c) => c.id === id)).filter((c): c is Caption => !!c && !!c.manual && !c.shape).length, [selIds, captions])
}

/** Does `query` (folded) appear in one of these strings, in either language? */
function matches(query: string, keys: StringKey[]): boolean {
  if (!query) return true
  return keys.some((k) => {
    const e = STRINGS[k] as { en: string; tr?: string } | undefined
    return !!e && (fold(e.en).includes(query) || fold(e.tr ?? '').includes(query))
  })
}

export function TextPage({ active }: { active: boolean }): JSX.Element {
  const t = useT()
  const [sub, setSub] = useState<Sub>(readSub)
  const choose = (next: Sub): void => {
    setSub(next)
    try {
      localStorage.setItem(KEY, next)
    } catch {
      /* not remembered: fine */
    }
  }
  // An empty Template tab's button asks for the templates themselves.
  // Shapes asked for (a shape selected): the text sub-page, where they are added.
  useEffect(() => onShellRequest((what) => {
    if (what === 'dock:templates') choose('templates')
    else if (what === 'dock:text') choose('text')
  }), [])
  // The search and the two lists: the page's own (not remembered).
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('all')
  const picks = usePicks()
  const selected = useSelectedTitles()
  const animOn = useAnimOn()
  const q = fold(query.trim())
  const keep = (id: string, keys: StringKey[]): boolean => (mode !== 'fav' || picks.fav.includes(id)) && matches(q, keys)
  const readyShownHere = q !== '' || mode === 'fav'
  const ready = READY.filter((r) => keep(`ready:${r.id}`, [`text.ready.${r.id}` as StringKey, 'text.sec.ready']))
  const looks = TEXT_LOOKS.filter((l) => keep(`style:${l.id}`, [l.name, 'text.sec.styles']))
  const showAnim = (card: Card): boolean => keep(animId(card), [...animWords(card), 'text.sec.anims'])
  const anyAnim = GROUPS.some(([, cards]) => cards.some(showAnim))
  // Shapes and fonts have no bookmark: they are not among the favourites, and
  // a search finds them by their names (or the section's).
  const inShapes = matches(q, ['text.sec.shapes'])
  const shapeNames: StringKey[] = ['shapes.kind.rect', 'shapes.kind.marker', 'shapes.kind.circle', 'shapes.kind.line', 'shapes.kind.arrow', 'text.shape.frame']
  const shapesShown = mode === 'all' && (!q || inShapes || shapeNames.some((k) => matches(q, [k])))
  const inFonts = matches(q, ['text.sec.font'])
  const fontsShown = mode === 'all' && (!q || inFonts || FONT_WORDS.some((f) => f.includes(q)))
  const nothing = !(readyShownHere && ready.length) && !looks.length && !anyAnim && !shapesShown && !fontsShown
  const recent = picks.recent.filter((id) => {
    if (id.startsWith('ready:')) return READY.some((r) => `ready:${r.id}` === id && matches(q, [`text.ready.${r.id}` as StringKey]))
    if (id.startsWith('style:')) return TEXT_LOOKS.some((l) => `style:${l.id}` === id && matches(q, [l.name]))
    const card = ANIM_BY_ID.get(id)
    return !!card && matches(q, animWords(card))
  })
  // On the text sub-page the ready-made texts come only as found (a search,
  // the favourites); their home is the Templates sub-page.
  const readyFound = readyShownHere && ready.length > 0 && (
    <Section id="Text: ready" title={t('text.sec.ready')} testid="dock.text.sec.ready" className="text-sec">
      <TextReady items={ready} active={active} />
    </Section>
  )
  const readyHome = (
    <Section id="Text: ready" title={t('text.sec.ready')} testid="dock.text.sec.ready" className="text-sec">
      <div className="hint">{t('text.sec.ready.hint')}</div>
      <TextReady items={READY} active={active && sub === 'templates'} />
    </Section>
  )
  return (
    <div className="dock-text">
      <div className="dock-text-head">
        <Tabs size="sm" value={sub} label={t('dock.text.tabs')} idBase="dock-text" testid="dock.text.tab" tabs={[{ value: 'text', label: t('dock.text.tab.text') }, { value: 'templates', label: t('dock.text.tab.templates') }]} onChange={choose} />
      </div>
      {sub === 'text' ? (
        <div className="dock-page-body dock-scroll" id="dock-text-text" role="tabpanel" aria-labelledby="dock-text-tab-text">
          {/* Drawn only while shown: its thirty-odd pictures are not made for
              a page nobody sees (the dock keeps every page mounted). */}
          {active && <>
          {/* The page's main action: not folded (one button folded saves nothing). */}
          <Tooltip content={t('dock.text.add.hint')}>
            <Button variant="secondary" icon="type" testid="dock.text.add" className="dock-wide" onPointerDown={(e) => startCardDrag(e, { name: t('dock.text.add'), look: null })} onClick={() => addTitle(null)}>
              {t('dock.text.add')}
            </Button>
          </Tooltip>
          <div className="text-find">
            <Icon name="search" size={14} className="text-find-icon" />
            <TextField className="text-find-field" size="sm" value={query} placeholder={t('text.find')} label={t('text.find')} onChange={setQuery} testid="dock.text.find" />
            <IconButton icon="bookmark" size="sm" label={t('text.mode.fav')} pressed={mode === 'fav'} testid="dock.text.mode.fav" onClick={() => setMode(mode === 'fav' ? 'all' : 'fav')} />
            <IconButton icon="rotate-ccw-clock" size="sm" label={t('text.mode.recent')} pressed={mode === 'recent'} testid="dock.text.mode.recent" onClick={() => setMode(mode === 'recent' ? 'all' : 'recent')} />
          </div>
          <div className="hint is-state text-target" data-testid="dock.text.target">
            {selected === 0 ? t('text.target.none') : selected === 1 ? t('text.anim.target.sel') : t('text.anim.target.many', { n: selected })}
          </div>
          {mode === 'recent' ? (
            recent.length ? (
              <div className="text-styles" role="group" aria-label={t('text.mode.recent')} data-testid="dock.text.recent">
                {recent.map((id) => {
                  if (id.startsWith('ready:')) {
                    const r = READY.find((x) => `ready:${x.id}` === id)
                    return r && <ReadyCard key={id} ready={r} active={active} />
                  }
                  if (id.startsWith('style:')) {
                    const l = TEXT_LOOKS.find((x) => `style:${x.id}` === id)
                    return l && <StyleCard key={id} item={l} />
                  }
                  const card = ANIM_BY_ID.get(id)
                  return card && <AnimCard key={id} card={card} on={animOn(card)} />
                })}
              </div>
            ) : (
              <div className="dock-empty" data-testid="dock.text.empty">{q ? t('text.find.none') : t('text.recent.none')}</div>
            )
          ) : (
            <>
              {nothing && <div className="dock-empty" data-testid="dock.text.empty">{mode === 'fav' && !q ? t('text.fav.none') : t('text.find.none')}</div>}
              {readyFound}
              {looks.length > 0 && (
                <Section id="Text: styles" title={t('text.sec.styles')} testid="dock.text.sec.styles" className="text-sec">
                  <div className="hint">{t('text.sec.styles.hint')}</div>
                  <TextStyles items={looks} />
                </Section>
              )}
              {anyAnim && (
                <Section id="Text: animations" title={t('text.sec.anims')} testid="dock.text.sec.anims" className="text-sec">
                  <div className="hint">{t('text.sec.anims.hint')}</div>
                  <TextAnims show={showAnim} />
                </Section>
              )}
              {shapesShown && (
                <Section id="Text: shapes" title={t('text.sec.shapes')} testid="dock.text.sec.shapes" className="text-sec">
                  <ShapesTab show={(k) => !q || inShapes || matches(q, [k])} />
                </Section>
              )}
              {fontsShown && (
                <Section id="Text: font" title={t('text.sec.font')} testid="dock.text.sec.font" className="text-sec">
                  <div className="hint">{t('text.sec.font.hint')}</div>
                  <TextFonts show={(f) => !q || inFonts || fold(f).includes(q)} />
                </Section>
              )}
            </>
          )}
          </>}
        </div>
      ) : (
        <div className="dock-text-templates" id="dock-text-templates" role="tabpanel" aria-labelledby="dock-text-tab-templates">
          <TemplatePanel active={active} top={readyHome} />
        </div>
      )}
    </div>
  )
}
