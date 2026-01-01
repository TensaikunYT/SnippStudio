// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
import { useEffect, useState } from 'react'
import { FONT_FAMILIES, FONT_LABELS } from '../fonts'
import { importMediaFiles } from '../media/import'
import { useStore } from '../state/store'
import {
  addTemplateItem,
  deleteTemplate,
  findTemplate,
  moveTemplateItem,
  removeTemplateItem,
  homeOpens,
  mapDesign,
  wordsCaptions,
  isDarkStyle,
  ownVariant,
  palettesFor,
  placeable,
  placeAt,
  mapPlaces,
  territoryStages,
  terminalDesign,
  type TerminalDesign,
  setTemplateStyle,
  syncHomes,
  TEMPLATE_INFO,
  TEMPLATE_KINDS,
  updateTemplate,
  updateTemplateItem, setTemplateCut, chapterDesign, cleanWordsLook, boxesDesign, boxesTimes, setBoxTime, cleanRevolverLook } from '../templates/model'
import { uid, type Asset, type Project, type TemplateBlock, type TemplateItem, type TemplateKind, type TemplateStyle, type WordsLook, type RevolverLook } from '../types'
import { FloatingMenu } from './FloatingMenu'
import { Button, Field, Icon, IconButton, Section, Select, TextField, Tooltip, notify, t, useT, type StringKey } from '../ui'
import { paletteName, templateName } from '../ui/data-names'
import { EmptyState } from './EmptyState'
import { requestShell } from './app/requests'
import { Choice, ColourField, Readout, Switch } from './inspector/parts'
import { UndoNumber, UndoSlider } from './inspector/sliders'
import { ChessFields } from './ChessFields'
import { AtlasFields, MapPickBar, MapWindow } from './AtlasFields'
import { PlayerFields } from './PlayerFields'
import { wordsDefaults, wordsDesign } from '../templates/words'
import { BareButton } from '../ui/Button'
import { fmtPct } from '../ui/format'

function edit(fn: (p: Project) => void, commit = true, mergeKey?: string): void {
  useStore.getState().editTemplates((p) => {
    fn(p)
    // Every home screen is the same home: an edit to one goes to all.
    const sel = useStore.getState().templateSel
    const b = sel ? findTemplate(p, sel) : undefined
    if (b?.kind === 'home' || b?.kind === 'chapter') syncHomes(p, b.id)
  }, commit, mergeKey)
}

/** The mark a poll's answer carries in its note (typed by the user: content, not an icon). */
const TICK = String.fromCodePoint(0x2713)

// (Phase 9 audit patch D12: every name below is a word of t(), ui/strings-f9y-d.ts.)
const HEADLINE: Partial<Record<TemplateKind, StringKey>> = {
  quote: 'tplf.head.quote',
  checklist: 'tplf.head.checklist',
  domino: 'tplf.head.domino',
  post: 'tplf.head.post',
  poll: 'tplf.head.poll',
  compare: 'tplf.head.compare',
  home: 'tplf.head.home',
  terminal: 'tplf.head.terminal',
  chess: 'tplf.head.chess',
  news: 'tplf.head.news',
  chapter: 'tplf.head.chapter'
}
const ITEMS: Partial<Record<TemplateKind, StringKey>> = {
  quote: 'tplf.items.quote',
  home: 'tplf.items.chapters',
  map: 'tplf.items.map',
  store: 'tplf.items.store',
  chapter: 'tplf.items.chapters',
  boxes: 'tplf.items.boxes',
  domino: 'tplf.items.domino',
  terminal: 'tplf.items.terminal'
}

/** What each field means in each template, so the rows speak its language. */
function labels(kind: TemplateKind, index: number, design?: string): { title: string; note?: string; value?: string; value2?: string; image?: string } {
  const n = index + 1
  const photo = t('tplf.photo')
  const picture = t('tplf.picture')
  switch (kind) {
    case 'steps':
      return { title: t('tplf.step', { n }), note: t('tplf.detail'), image: photo }
    case 'ranking':
      return { title: `#${n}`, note: t('tplf.why'), value: t('tplf.score'), image: photo }
    case 'versus':
      if (index < 2) return { title: index === 0 ? t('tplf.leftSide') : t('tplf.rightSide'), image: photo }
      return { title: t('tplf.stat'), value: t('tplf.left'), value2: t('tplf.right') }
    case 'stat':
      if (index === 0) return { title: t('tplf.label'), value: t('tplf.number'), note: t('tplf.unit'), image: t('tplf.background') }
      return { title: t('tplf.chip'), value: t('tplf.number') }
    case 'timeline':
      return { title: t('tplf.event', { n }), note: t('tplf.date'), image: photo }
    case 'gallery':
      return { title: t('tplf.photoN', { n }), note: t('tplf.photoCaption'), image: photo }
    case 'count':
      return { title: t('tplf.item', { n }) }
    case 'focus':
      return { title: t('tplf.card', { n }), note: t('tplf.photoCaption'), image: photo }
    case 'home':
      return { title: t('tplf.chapter', { n }), note: t('tplf.smallLabel'), image: picture }
    case 'atlas':
      return { title: t('tplf.place', { n }), note: t('tplf.label'), value: t('tplf.lat'), value2: t('tplf.lon'), image: photo }
    case 'map':
      if (design === 'territory') return { title: t('tplf.phase', { n }), note: t('tplf.placesItAdds'), value: t('tplf.sizeDeg') }
      return { title: t('tplf.place', { n }), note: t('tplf.label'), value: t('tplf.lat'), value2: t('tplf.lon'), image: photo }
    case 'terminal':
      if (design === 'chat') return { title: t('tplf.chat.line', { n }), note: t('tplf.chat.note'), value: t('tplf.chat.value') }
      if (design === 'notes') return { title: t('tplf.line', { n }), note: t('tplf.notes.note'), value: t('tplf.notes.value') }
      if (design === 'search') return { title: t('tplf.search.line', { n }), note: t('tplf.search.note'), value: t('tplf.search.value') }
      if (design === 'browser') return { title: t('tplf.browser.line', { n }), note: t('tplf.browser.note'), value: t('tplf.browser.value'), image: t('tplf.browser.image') }
      return { title: t('tplf.line', { n }), note: t('tplf.terminal.note'), value: t('tplf.terminal.value') }
    case 'quote':
      return index === 0 ? { title: t('tplf.reference'), note: t('tplf.quote.note') } : { title: t('tplf.quote.original') }
    case 'cutout':
      return { title: t('tplf.word', { n }), value: t('tplf.sizePct') }
    case 'compare':
      return index === 0 ? { title: t('tplf.compare.beforeLabel'), image: t('tplf.compare.before') } : { title: t('tplf.compare.afterLabel'), image: t('tplf.compare.after') }
    case 'checklist':
      return { title: t('tplf.item', { n }), note: t('tplf.detail') }
    case 'domino':
      return { title: t('tplf.tile', { n }) }
    case 'boxes':
      return index === 0 ? { title: t('tplf.mainBox'), note: t('tplf.lineUnder') } : { title: t('tplf.box', { n: index }), note: t('tplf.lineUnder') }
    case 'post':
      return { title: t('tplf.comment'), note: t('tplf.name'), value: t('tplf.likes') }
    case 'cards':
      return { title: t('tplf.cardLabel', { n }), image: picture }
    case 'chess':
      return { title: t('tplf.move', { n }), note: t('tplf.comment') }
    case 'words':
      return { title: t('tplf.line', { n }) }
    case 'store':
      return { title: t('tplf.store.name', { n }), note: t('tplf.store.kind'), value: t('tplf.store.stars'), image: t('tplf.store.icon') }
    case 'player':
      return { title: t('tplf.player.event', { n }), note: t('tplf.player.note'), value: t('tplf.player.at') }
    case 'list':
      return { title: t('tplf.list.item', { n }), note: t('tplf.list.note'), image: picture }
    case 'chapter':
      return { title: t('tplf.chapter', { n }), note: t('tplf.chapter.note'), image: picture }
    case 'news':
      return { title: t('tplf.news.headline', { n }), note: t('tplf.news.note'), image: picture }
    case 'poll':
      return { title: t('tplf.poll.answer', { n }), value: t('tplf.poll.votes'), note: t('tplf.poll.tick', { tick: TICK }) }
    case 'bars':
      return index === 0 ? { title: t('tplf.bar', { n }), value: t('tplf.value'), note: t('tplf.bars.unit') } : { title: t('tplf.bar', { n }), value: t('tplf.value') }
    case 'pie':
      return { title: t('tplf.slice', { n }), value: t('tplf.value') }
    case 'line':
      return index === 0 ? { title: t('tplf.line.first'), value: t('tplf.value'), value2: t('tplf.line.second'), note: t('tplf.unit') } : { title: t('tplf.point', { n }), value: t('tplf.value'), value2: t('tplf.line.second') }
  }
}

function ImagePicker({ value, onPick, label }: { value?: string; onPick: (id: string | undefined) => void; label: string }): JSX.Element {
  const t = useT()
  const assets = useStore((s) => s.project.assets)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const close = (): void => setMenu(null)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [menu])
  const images = assets.filter((a) => a.kind === 'image' && !a.missing)
  const current = value ? assets.find((a) => a.id === value) : undefined
  const importOne = async (): Promise<void> => {
    setMenu(null)
    const res = await importMediaFiles()
    const pics = res.assets.filter((a) => a.kind === 'image')
    if (res.errors.length) notify({ text: res.errors[0], kind: 'error' })
    if (pics.length === 0) return
    useStore.getState().addAssets(pics)
    const held = useStore.getState().project.assets
    const first = held.find((a) => a.id === pics[0].id) ?? held.find((a) => !!pics[0].path && a.path === pics[0].path)
    if (first) onPick(first.id)
  }
  const name = current ? t('tpl.pic.change', { label, name: current.name }) : t('tpl.pic.add', { label: label.toLowerCase() })
  return (
    <>
      {/* A thumbnail tile, not a control of the kit: the picture itself is the button. */}
      <Tooltip content={name}>
        <BareButton type="button" className={`tpl-pic${current ? '' : ' empty'}`} aria-label={name} onPointerDown={(e) => e.stopPropagation()} onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })}>
          {current?.thumbnail ? <img src={current.thumbnail} alt="" draggable={false} /> : <Icon name={current ? 'image' : 'plus'} size={16} />}
        </BareButton>
      </Tooltip>
      {menu && (
        <FloatingMenu x={menu.x} y={menu.y} className="ctx-menu tpl-pic-menu" onPointerDown={(e) => e.stopPropagation()}>
          <div className="ctx-title">{label}</div>
          <Button size="sm" variant="ghost" icon="plus" onClick={() => void importOne()}>{t('tpl.pic.import')}</Button>
          {value && (
            <Button
              size="sm"
              variant="ghost"
              icon="x"
              onClick={() => {
                onPick(undefined)
                setMenu(null)
              }}
            >
              {t('tpl.pic.none')}
            </Button>
          )}
          {images.length > 0 && <div className="ctx-title">{t('tpl.pic.fromProject')}</div>}
          <div className="tpl-pic-grid">
            {images.map((a: Asset) => (
              <Tooltip key={a.id} content={a.name}>
                <BareButton
                  type="button"
                  aria-label={a.name}
                  className={a.id === value ? 'on' : ''}
                  onClick={() => {
                    onPick(a.id)
                    setMenu(null)
                  }}
                >
                  {a.thumbnail ? <img src={a.thumbnail} alt="" draggable={false} /> : <span>{a.name.slice(0, 2)}</span>}
                </BareButton>
              </Tooltip>
            ))}
          </div>
        </FloatingMenu>
      )}
    </>
  )
}

function ItemRow({ b, item, index }: { b: TemplateBlock; item: TemplateItem; index: number }): JSX.Element {
  const t = useT()
  const l = labels(b.kind, index, b.design)
  const set = (patch: Partial<Omit<TemplateItem, 'id'>>, key?: string): void =>
    edit((p) => updateTemplateItem(p, b.id, item.id, patch), true, key)
  const fixedSide = b.kind === 'versus' && index < 2
  // (Each of these edits is its own undo step: the store's editTemplates.)
  const num = (v: number | undefined, onCommit: (n: number | undefined) => void, title: string): JSX.Element => (
    <UndoNumber undo={false} name={title} value={v ?? 0} step={1} digits={Number.isInteger(v ?? 0) ? 0 : 2} onChange={(n) => onCommit(Number.isFinite(n) ? n : undefined)} />
  )
  return (
    <div className="tpl-item">
      <div className="tpl-item-head">
        <span className="tpl-item-label">{l.title}</span>
        {!fixedSide && (
          <span className="tpl-item-tools">
            <IconButton icon="chevron-up" size="sm" variant="ghost" label={t('tpl.item.up')} onClick={() => edit((p) => moveTemplateItem(p, b.id, item.id, -1))} />
            <IconButton icon="chevron-down" size="sm" variant="ghost" label={t('tpl.item.down')} onClick={() => edit((p) => moveTemplateItem(p, b.id, item.id, 1))} />
            <IconButton icon="x" size="sm" variant="danger" label={t('insp.remove')} onClick={() => edit((p) => removeTemplateItem(p, b.id, item.id))} />
          </span>
        )}
      </div>
      <div className="tpl-item-body">
        {l.image && <ImagePicker value={item.assetId} label={l.image} onPick={(id) => set({ assetId: id })} />}
        <div className="tpl-item-fields">
          <TextField value={item.title} placeholder={l.title} label={l.title} onChange={(v) => set({ title: v }, `tpl-title:${item.id}`)} />
          {l.note && <TextField value={item.note ?? ''} placeholder={l.note} label={l.note} onChange={(v) => set({ note: v || undefined }, `tpl-note:${item.id}`)} />}
          {b.kind === 'boxes' && <BoxTime b={b} index={index} />}
          {(l.value || l.value2) && (
            <div className="tpl-item-nums">
              {l.value && (
                <label>
                  {l.value} {num(item.value, (n) => set({ value: n }), l.value)}
                </label>
              )}
              {l.value2 && (
                <label>
                  {l.value2} {num(item.value2, (n) => set({ value2: n }), l.value2)}
                </label>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const BACKDROPS: TemplateStyle['backdrop'][] = ['none', 'dim', 'blur', 'paper', 'card']

export function TemplateInspector(): JSX.Element {
  const t = useT()
  const project = useStore((s) => s.project)
  const sel = useStore((s) => s.templateSel)
  const b = sel ? findTemplate(project, sel) : undefined
  if (!b) {
    return <EmptyState className="empty-hint" text={t('tpl.none')} action={t('empty.templates.action')} icon="layout-grid" onAction={() => requestShell('dock:templates')} testid="templates.empty" />
  }
  const info = TEMPLATE_INFO[b.kind]
  const style = (patch: Partial<TemplateStyle>, commit = true, key?: string): void =>
    edit((p) => setTemplateStyle(p, b.id, patch), commit, key)
  const canAdd = b.items.length < info.max + (b.kind === 'versus' ? 2 : 0)
  const dark = isDarkStyle(b.style)
  return (
    <div className="tpl-inspector">
      <Tooltip content={t('tpl.kind.hint')}>
        <Select value={b.kind} label={t('tpl.kind')} options={TEMPLATE_KINDS.map((k) => ({ value: k, label: templateName(k) }))} onChange={(v) => edit((p) => updateTemplate(p, b.id, { kind: v as TemplateKind }))} />
      </Tooltip>
      {b.kind === 'home' && <HomeFields b={b} project={project} />}
      {b.kind === 'chapter' && <ChapterOpens b={b} project={project} />}
      {b.kind === 'boxes' && <BoxesFields b={b} />}
      {b.kind === 'cards' && <CardsFields b={b} />}
      {b.kind === 'words' && <WordsFields b={b} project={project} />}
      {(b.kind === 'list' || b.kind === 'store') && (
        <Switch label={t('tpl.countdown')} hint={t('tpl.countdown.hint')} checked={!!b.countdown} onChange={(on) => edit((p) => { const tp = findTemplate(p, b.id); if (tp) { if (on) tp.countdown = true; else delete tp.countdown } })} />
      )}
      {b.kind === 'map' && <MapFound b={b} />}
      {b.kind === 'map' && <MapTiming b={b} />}
      {b.kind === 'atlas' && <AtlasFields b={b} />}
      {b.kind === 'atlas' && b.follow && <MapTiming b={b} />}
      {(b.kind === 'map' || b.kind === 'atlas') && mapDesign(b) !== 'territory' && <MapPickBar b={b} />}
      {(b.kind === 'map' || b.kind === 'atlas') && <MapWindow b={b} />}
      {b.kind === 'terminal' && <TerminalFields b={b} />}
      {b.kind === 'quote' && <QuoteFields b={b} />}
      {b.kind === 'cutout' && <CutoutFields b={b} />}
      {b.kind !== 'map' && b.kind !== 'atlas' && b.kind !== 'cutout' && b.kind !== 'words' && (
        <div className="insp-stack">
          <span className="insp-stack-label">{(b.kind === 'terminal' ? t(SCREEN_HEADLINE[terminalDesign(b)]) : undefined) ?? (HEADLINE[b.kind] ? t(HEADLINE[b.kind]!) : t('tpl.headline'))}</span>
          <TextField value={b.title} label={t('tpl.headline')} placeholder={t('tpl.headline.none')} onChange={(v) => edit((p) => updateTemplate(p, b.id, { title: v }), true, `tpl-headline:${b.id}`)} />
        </div>
      )}
      <UndoNumber undo={false} label={t('tpl.startsAt')} value={b.start} step={0.1} digits={2} suffix="s" onChange={(v) => edit((p) => updateTemplate(p, b.id, { start: v }))} />
      <UndoSlider
        label={t('tpl.length')}
        testid="template.length"
        value={b.duration}
        min={1}
        max={60}
        step={0.1}
        fmt={(v) => `${v.toFixed(1)}s`}
        onChange={(v) => edit((p) => updateTemplate(p, b.id, { duration: v }), false)}
      />
      <TemplateEnding b={b} />
      {b.kind === 'player' ? (
        <Section id="What happens" icon="play" title={t('tpl.sec.player')} count={b.items.length} data-section="template-items">
          <PlayerFields b={b} />
        </Section>
      ) : b.kind === 'words' && !b.own && wordsCaptions(project, b).length > 0 ? null : b.kind === 'chess' ? (
        <Section id="The game" icon="square" title={t('tpl.sec.chess')} count={b.items.length} data-section="template-items">
          <ChessFields b={b} />
        </Section>
      ) : (
        <Section id="Items" icon="layout-list" title={(b.kind === 'terminal' ? t(SCREEN_ITEMS[terminalDesign(b)]) : undefined) ?? (ITEMS[b.kind] ? t(ITEMS[b.kind]!) : t('tpl.sec.items'))} count={b.items.length} data-section="template-items">
          {b.items.map((it, i) => (
            <ItemRow key={it.id} b={b} item={it} index={i} />
          ))}
          {canAdd && (
            <div className="insp-row">
              <Button size="sm" icon="plus" onClick={() => edit((p) => void addTemplateItem(p, b.id))}>{b.kind === 'versus' ? t('tpl.addStat') : t('tpl.addItem')}</Button>
            </div>
          )}
        </Section>
      )}
      {placeable(b.kind) && <PlaceFields b={b} project={project} />}
      <Section id="Look" icon="palette" title={t('insp.color.look')} data-section="template-look">
        <Choice stack label={t('tpl.look.behind')} value={b.style.backdrop} options={BACKDROPS.map((v) => ({ value: v, label: t(`tpl.look.backdrop.${v}`) }))} onChange={(v) => style({ backdrop: v })} />
        <Field label={t('insp.font')}>
          <Select value={b.style.font} options={FONT_FAMILIES.map((f) => ({ value: f, label: FONT_LABELS[f] ?? f, fontFamily: f }))} onChange={(v) => style({ font: v })} />
        </Field>
        <Choice
          label={t('tpl.look.theme')}
          hint={t('tpl.look.theme.hint')}
          value={dark ? 'dark' : 'light'}
          options={[
            { value: 'light', label: t('tpl.look.theme.light'), icon: 'sun' },
            { value: 'dark', label: t('tpl.look.theme.dark'), icon: 'moon' }
          ]}
          onChange={(mode) => {
            if ((mode === 'dark') === dark) return
            const own = palettesFor(b.kind)[0]
            const alt = ownVariant(b.kind)
            const ownDark = isDarkStyle(own)
            const pick = (mode === 'dark') === ownDark ? own : alt
            style({ accent: pick.accent, ink: pick.ink, card: pick.card, ...(mode === 'dark' && b.style.backdrop === 'paper' ? { backdrop: 'dim' as const } : {}) })
          }}
        />
        <div className="insp-stack">
          <span className="insp-stack-label">{t('tpl.look.palette')}</span>
          <div className="tpl-palettes">
            {palettesFor(b.kind).map((pal) => {
              const on = pal.accent === b.style.accent && pal.ink === b.style.ink && pal.card === b.style.card
              return (
                <Tooltip key={pal.name} content={paletteName(pal.name)}>
                  {/* A swatch of the palette's own colours, not a control of the kit. */}
                  <BareButton
                    type="button"
                    className={on ? 'on' : ''}
                    aria-label={t('tpl.look.paletteNamed', { name: paletteName(pal.name) })}
                    aria-pressed={on}
                    style={{ background: pal.card, borderColor: pal.ink, boxShadow: `2px 2px 0 ${pal.ink}` }}
                    onClick={() => style({ accent: pal.accent, ink: pal.ink, card: pal.card })}
                  >
                    <span className="dot" style={{ background: pal.accent, borderColor: pal.ink }} />
                    <span className="bar" style={{ background: pal.ink }} />
                  </BareButton>
                </Tooltip>
              )
            })}
          </div>
        </div>
        <ColourField label={t('tpl.look.accent')} value={b.style.accent} onChange={(accent) => style({ accent }, true, `tpl-accent:${b.id}`)} />
        <ColourField label={t('tpl.look.text')} value={b.style.ink} onChange={(ink) => style({ ink }, true, `tpl-ink:${b.id}`)} />
        <ColourField label={t('tpl.look.cards')} value={b.style.card} onChange={(card) => style({ card }, true, `tpl-card:${b.id}`)} />
        <Switch label={t('tpl.look.hand')} hint={t('tpl.look.hand.hint')} checked={b.style.hand} onChange={(hand) => style({ hand })} />
        {b.style.hand && (
          <div className="insp-row">
            <Button size="sm" icon="rotate-cw" onClick={() => edit((p) => updateTemplate(p, b.id, { seed: Math.floor(Math.random() * 1e6) }))}>{t('tpl.look.shuffle')}</Button>
          </div>
        )}
      </Section>
      <div className="insp-row">
        <Button
          size="sm"
          variant="danger"
          icon="trash"
          onClick={() => {
            edit((p) => deleteTemplate(p, b.id))
            useStore.getState().selectTemplate(null)
          }}
        >
          {t('tpl.delete')}
        </Button>
      </div>
    </div>
  )
}

const WORD_STYLES = ['apple', 'stack', 'punch', 'karaoke'] as const
const WORD_BLENDS = ['normal', 'overlay', 'soft', 'difference', 'window'] as const

/** Big words: its look, where its words come from, the subtitles under it. */
function WordsFields({ b, project }: { b: TemplateBlock; project: Project }): JSX.Element {
  const t = useT()
  const design = wordsDesign(b)
  const subs = wordsCaptions(project, b)
  const set = (fn: (tp: TemplateBlock) => void): void => edit((p) => { const tp = findTemplate(p, b.id); if (tp) fn(tp) })
  const portrait = project.mode === 'shorts' || project.settings.width < project.settings.height
  const def = wordsDefaults(design, portrait)
  const look = b.big ?? {}
  // A setting of its look; a slider's drag is one undo step.
  const setLook = (patch: Partial<WordsLook>, commit = true): void =>
    edit(
      (p) => {
        const tp = findTemplate(p, b.id)
        if (!tp) return
        const next: Record<string, unknown> = { ...(tp.big ?? {}), ...patch }
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
        if (Object.keys(next).length) tp.big = cleanWordsLook(next)
        else delete tp.big
      },
      commit,
      commit ? undefined : `words-look:${b.id}`
    )
  return (
    <>
      <Choice stack label={t('insp.style')} value={design} options={WORD_STYLES.map((v) => ({ value: v, label: t(`tpl.words.style.${v}`) }))} onChange={(v) => set((tp) => (tp.design = v))} />
      <Section id="How the words are set" icon="type" title={t('tpl.words.sec')} data-section="template-words-look">
        {design !== 'punch' && (
          <UndoSlider label={look.per === undefined ? t('tpl.words.perOwn') : t('tpl.words.per')} value={look.per ?? def.per} min={1} max={8} step={1} fmt={(v) => String(Math.round(v))} onChange={(v) => setLook({ per: Math.round(v) }, false)} />
        )}
        {(design === 'stack' || design === 'karaoke') && (
          <Switch label={t('tpl.words.band')} hint={design === 'stack' ? t('tpl.words.band.stack') : t('tpl.words.band.karaoke')} checked={look.band !== false} onChange={(on) => setLook({ band: on ? undefined : false })} />
        )}
        <UndoSlider label={t('insp.size')} value={look.size ?? 1} min={0.4} max={2.5} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => setLook({ size: v }, false)} />
        {(design === 'stack' || design === 'karaoke') && (
          <UndoSlider
            label={design === 'stack' ? t('tpl.words.dim.stack') : t('tpl.words.dim.karaoke')}
            value={look.dim ?? def.dim}
            min={0}
            max={1}
            step={0.01}
            fmt={(v) => fmtPct(v)}
            onChange={(v) => setLook({ dim: v }, false)}
          />
        )}
        <UndoSlider label={t('tpl.words.height')} value={look.y ?? def.y} min={0.1} max={0.92} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => setLook({ y: v }, false)} />
        <div className="insp-stack">
          <span className="insp-stack-label">{t('tpl.words.blend')}</span>
          <Select value={look.blend ?? 'normal'} label={t('tpl.words.blend')} options={WORD_BLENDS.map((v) => ({ value: v, label: t(`tpl.words.blend.${v}`), hint: t(`tpl.words.blend.${v}.hint`) }))} onChange={(v) => setLook({ blend: v === 'normal' ? undefined : (v as WordsLook['blend']) })} />
          <div className="hint">{t(`tpl.words.blend.${look.blend ?? 'normal'}.hint`)}</div>
        </div>
        <Switch label={t('tpl.words.click')} hint={t('tpl.words.click.hint')} checked={look.click !== false} onChange={(on) => setLook({ click: on ? undefined : false })} />
        {look.click !== false && (
          <UndoSlider label={t('tpl.clickVolume')} value={look.clickVol ?? 0.7} min={0} max={1} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => setLook({ clickVol: Math.abs(v - 0.7) < 0.005 ? undefined : v }, false)} />
        )}
        {b.big && (
          <div className="insp-row">
            <Button size="sm" icon="rotate-ccw" onClick={() => set((tp) => delete tp.big)}>{t('tpl.words.reset')}</Button>
          </div>
        )}
      </Section>
      <Choice
        stack
        label={t('tpl.words.from')}
        value={b.own ? 'own' : 'subs'}
        options={[
          { value: 'subs', label: t('tpl.words.from.subs') },
          { value: 'own', label: t('tpl.words.from.own') }
        ]}
        onChange={(v) => set((tp) => { if (v === 'own') tp.own = true; else delete tp.own })}
      />
      {!b.own && <Switch label={t('tpl.words.keepSubs')} hint={t('tpl.words.keepSubs.hint')} checked={!!b.keepSubs} onChange={(on) => set((tp) => { if (on) tp.keepSubs = true; else delete tp.keepSubs })} />}
      <div className="hint">
        {t(`tpl.words.about.${design}`)}{' '}
        {b.own ? t('tpl.words.ownHelp') : subs.length ? t(subs.length === 1 ? 'tpl.words.subsHelp' : 'tpl.words.subsHelpN', { n: subs.length }) : t('tpl.words.noSubs')}
      </div>
    </>
  )
}

const EXITS = ['drop', 'fade', 'slide', 'cut'] as const

/**
 * Where a template ends and how it leaves: it plays to its end, or it ends
 * early wherever you choose — its pace still that of its whole length — and
 * goes the way you pick: dropped off the frame, faded, slid away, or simply
 * gone. (Ctrl+B and the lane's right edge do the same.)
 */
function TemplateEnding({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const now = useStore((s) => s.currentTime)
  const local = now - b.start
  const inside = local >= 0.3 && local <= b.duration - 0.25
  const cut = b.cut !== undefined
  const exit = b.cutExit ?? 'drop'
  return (
    <div className="tpl-ending">
      <Tooltip content={t('tpl.ends.hint')}>
        <div>
          <Readout label={t('tpl.ends')}>{cut ? t('tpl.ends.early', { t: b.cut!.toFixed(1) }) : t('tpl.ends.atEnd')}</Readout>
        </div>
      </Tooltip>
      <div className="insp-row">
        <Tooltip content={inside ? t('tpl.ends.here.hint') : t('tpl.playheadFirst')}>
          <Button size="sm" icon="scissors" disabled={!inside} onClick={() => edit((p) => setTemplateCut(p, b.id, local))}>{t('tpl.ends.here')}</Button>
        </Tooltip>
        {cut && <UndoNumber undo={false} name={t('tpl.ends.where')} value={b.cut!} step={0.1} digits={1} suffix="s" onChange={(v) => edit((p) => setTemplateCut(p, b.id, v))} />}
        {cut && (
          <Tooltip content={t('tpl.ends.whole.hint')}>
            <Button size="sm" icon="rotate-ccw" className="insp-fixed" onClick={() => edit((p) => setTemplateCut(p, b.id, undefined))}>{t('tpl.ends.whole')}</Button>
          </Tooltip>
        )}
      </div>
      {cut && (
        <Choice
          stack
          label={t('tpl.leaves')}
          value={exit}
          options={EXITS.map((v) => ({ value: v, label: t(`tpl.leaves.${v}`), hint: t(`tpl.leaves.${v}.hint`) }))}
          onChange={(v) => edit((p) => { const tp = findTemplate(p, b.id); if (!tp) return; if (v === 'drop') delete tp.cutExit; else tp.cutExit = v })}
        />
      )}
    </div>
  )
}

const BOX_DESIGNS = ['hub', 'flow', 'chain'] as const

/** Box to box: its shape, and a word on timing the glows. */
function BoxesFields({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const design = boxesDesign(b)
  return (
    <>
      <Choice
        label={t('tpl.design')}
        value={design}
        options={BOX_DESIGNS.map((v) => ({ value: v, label: t(`tpl.boxes.${v}`), hint: t(`tpl.boxes.${v}.hint`) }))}
        onChange={(v) => edit((p) => { const tp = findTemplate(p, b.id); if (!tp) return; if (v === 'hub') delete tp.design; else tp.design = v })}
      />
      <div className="hint">{design === 'chain' ? t('tpl.boxes.help.chain') : t('tpl.boxes.help.main')}</div>
    </>
  )
}

/** Card deck: dealt face down or up, and the card picked at the end. */
function CardsFields({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const setDeal = (patch: { up?: boolean; pick?: number | null }): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (!tp) return
      const d = { ...tp.deal }
      if (patch.up !== undefined) {
        if (patch.up) d.up = true
        else delete d.up
      }
      if (patch.pick !== undefined) {
        if (patch.pick === null) delete d.pick
        else d.pick = patch.pick
      }
      if (d.up || d.pick !== undefined) tp.deal = d
      else delete tp.deal
    })
  return (
    <>
      <Choice
        label={t('tpl.cards.dealt')}
        value={b.deal?.up ? 'up' : 'down'}
        options={[
          { value: 'down', label: t('tpl.cards.down'), hint: t('tpl.cards.down.hint') },
          { value: 'up', label: t('tpl.cards.up'), hint: t('tpl.cards.up.hint') }
        ]}
        onChange={(v) => setDeal({ up: v === 'up' })}
      />
      <Choice
        stack
        label={t('tpl.cards.picks')}
        hint={t('tpl.cards.picks.hint')}
        value={b.deal?.pick === undefined ? 'none' : String(b.deal.pick)}
        options={[{ value: 'none', label: t('insp.none') }, ...b.items.map((it, i) => ({ value: String(i), label: String(i + 1), hint: it.title || t('tpl.cards.nth', { n: i + 1 }) }))]}
        onChange={(v) => setDeal({ pick: v === 'none' ? null : Number(v) })}
      />
    </>
  )
}

/** When one box lights: seconds into the block, set to the playhead, or by itself. */
function BoxTime({ b, index }: { b: TemplateBlock; index: number }): JSX.Element {
  const t = useT()
  const at = boxesTimes(b).light[index] ?? 0
  const own = b.items[index]?.at !== undefined
  return (
    <div className="insp-move-row">
      <Tooltip content={t('tpl.boxes.lights.hint')}>
        <span className="insp-move-name">{t('tpl.boxes.lights')}</span>
      </Tooltip>
      <UndoNumber undo={false} name={t('tpl.boxes.lights.hint')} value={at} step={0.1} digits={2} suffix="s" onChange={(v) => edit((p) => setBoxTime(p, b.id, index, v))} />
      <IconButton
        icon="crosshair"
        size="sm"
        label={t('tpl.boxes.lightHere')}
        onClick={() => {
          const s = useStore.getState()
          edit((p) => setBoxTime(p, b.id, index, s.currentTime - b.start))
        }}
      />
      {own && <IconButton icon="rotate-ccw" size="sm" label={t('tpl.boxes.even')} onClick={() => edit((p) => setBoxTime(p, b.id, index, undefined))} />}
    </div>
  )
}

const DRUMS = ['right', 'left', 'none'] as const

/** How a revolver chapter turns: how many chapters it clicks through, its
 *  pace, the drum's side, the numbers, the click. */
function RevolverFields({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const r = b.rev ?? {}
  const setRev = (patch: Partial<RevolverLook>, commit = true): void =>
    edit(
      (p) => {
        const tp = findTemplate(p, b.id)
        if (!tp) return
        const next: Record<string, unknown> = { ...(tp.rev ?? {}), ...patch }
        for (const k of Object.keys(next)) if (next[k] === undefined) delete next[k]
        if (Object.keys(next).length) tp.rev = cleanRevolverLook(next)
        else delete tp.rev
      },
      commit,
      commit ? undefined : `rev:${b.id}`
    )
  return (
    <>
      <UndoSlider label={t('tpl.rev.past')} value={r.past ?? 3} min={0} max={6} step={1} fmt={(v) => String(Math.round(v))} onChange={(v) => setRev({ past: Math.round(v) === 3 ? undefined : Math.round(v) }, false)} />
      <UndoSlider label={t('tpl.rev.pace')} value={r.speed ?? 1} min={0.5} max={2} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => setRev({ speed: Math.abs(v - 1) < 0.01 ? undefined : v }, false)} />
      <Choice label={t('tpl.rev.drum')} value={r.drum ?? 'right'} options={DRUMS.map((v) => ({ value: v, label: v === 'none' ? t('insp.none') : t(`insp.align.${v}`) }))} onChange={(v) => setRev({ drum: v === 'right' ? undefined : v })} />
      <Switch label={t('tpl.rev.roman')} checked={!!r.roman} onChange={(on) => setRev({ roman: on ? true : undefined })} />
      <Switch label={t('tpl.rev.click')} hint={t('tpl.rev.click.hint')} checked={r.click !== false} onChange={(on) => setRev({ click: on ? undefined : false })} />
      {r.click !== false && <UndoSlider label={t('tpl.clickVolume')} value={r.clickVol ?? 0.7} min={0} max={1} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => setRev({ clickVol: Math.abs(v - 0.7) < 0.005 ? undefined : v }, false)} />}
    </>
  )
}

/** Which chapter a block opens: the next one by itself, or a chosen one. */
function OpensSelect({ b, opens, label, auto }: { b: TemplateBlock; opens: number; label: string; auto: 'tpl.opens.auto' | 'tpl.opens.autoThe' }): JSX.Element {
  const t = useT()
  const nth = (i: number): string => t('insp.chapters.nth', { n: i + 1 })
  return (
    <div className="insp-stack">
      <span className="insp-stack-label">{label}</span>
      <Select
        value={b.open === undefined ? 'auto' : String(b.open)}
        label={label}
        options={[{ value: 'auto', label: t(auto, { name: b.items[opens]?.title || nth(opens).toLowerCase() }) }, ...b.items.map((it, i) => ({ value: String(i), label: `${i + 1}. ${it.title || nth(i)}` }))]}
        onChange={(v) =>
          edit((p) => {
            const tp = findTemplate(p, b.id)
            if (!tp) return
            if (v === 'auto') delete tp.open
            else tp.open = Number(v)
          })
        }
      />
    </div>
  )
}

const CHAPTER_DESIGNS = ['revolver', 'scope', 'reel'] as const

/** A chapter block: how it looks, which chapter it brings in. */
function ChapterOpens({ b, project }: { b: TemplateBlock; project: Project }): JSX.Element {
  const t = useT()
  const opens = homeOpens(project, b)
  const design = chapterDesign(b)
  return (
    <>
      <Choice
        stack
        label={t('tpl.design')}
        value={design}
        options={CHAPTER_DESIGNS.map((v) => ({ value: v, label: t(`tpl.chapter.${v}`), hint: t(`tpl.chapter.${v}.hint`) }))}
        onChange={(v) => edit((p) => { const tp = findTemplate(p, b.id); if (!tp) return; if (v === 'revolver') delete tp.design; else tp.design = v })}
      />
      {design === 'revolver' && <RevolverFields b={b} />}
      <OpensSelect b={b} opens={opens} label={t('tpl.chapter.bringsIn')} auto="tpl.opens.autoThe" />
      <div className="hint">
        {t('tpl.chapter.help.lead')} {design === 'scope' ? t('tpl.chapter.help.scope') : t('tpl.chapter.help.reel')} {t('tpl.chapter.help.shared')}
      </div>
    </>
  )
}

const HOME_DESIGNS = ['apps', 'deck', 'slider', 'timeline'] as const

/** A home screen's own settings: its design, which chapter it opens. */
function HomeFields({ b, project }: { b: TemplateBlock; project: Project }): JSX.Element {
  const t = useT()
  const design = (b.design ?? 'apps') as (typeof HOME_DESIGNS)[number]
  const opens = homeOpens(project, b)
  return (
    <>
      <Choice stack label={t('tpl.design')} value={design} options={HOME_DESIGNS.map((v) => ({ value: v, label: t(`tpl.home.${v}`) }))} onChange={(v) => edit((p) => { const tp = findTemplate(p, b.id); if (tp) tp.design = v })} />
      <OpensSelect b={b} opens={opens} label={t('tpl.home.opens')} auto="tpl.opens.auto" />
      <div className="hint">{t('tpl.home.help')}</div>
    </>
  )
}

const MAP_DESIGNS = ['tour', 'turkey', 'territory'] as const

/** Which of the map's places were found by name. */
function MapFound({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const design = mapDesign(b)
  const setDesign = (v: 'tour' | 'turkey' | 'territory'): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (!tp) return
      if (v === 'tour') delete tp.design
      else tp.design = v
    })
  const fill = (items: { title: string; note?: string }[]): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (tp) tp.items = items.map((it) => ({ id: uid(), ...it }))
    })
  let hint: string
  if (design === 'territory') {
    const missing = territoryStages(b).flatMap((s) => s.missing)
    hint = missing.length ? t('tpl.map.missing.territory', { names: missing.join(', ') }) : t('tpl.map.help.territory')
  } else {
    const found = mapPlaces(b)
    const missing = b.items.filter((_, i) => !found[i]).map((it) => it.title || t('tpl.empty'))
    hint = missing.length
      ? t(design === 'turkey' ? 'tpl.map.missing.turkey' : 'tpl.map.missing.tour', { names: missing.join(', ') })
      : t(design === 'turkey' ? 'tpl.map.help.turkey' : 'tpl.map.help.tour')
  }
  return (
    <>
      <Choice stack label={t('tpl.map')} value={design as (typeof MAP_DESIGNS)[number]} options={MAP_DESIGNS.map((v) => ({ value: v, label: t(`tpl.map.design.${v}`) }))} onChange={setDesign} />
      {design === 'turkey' && (
        <div className="insp-row">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              fill([
                { title: 'Troya', note: t('tplf.site.troy') },
                { title: 'Efes', note: t('tplf.site.ephesus') },
                { title: 'Kapadokya', note: t('tplf.site.cappadocia') },
                { title: 'Göbeklitepe', note: t('tplf.site.gobekli') }
              ])
            }
          >
            {t('tpl.map.fill.sites')}
          </Button>
        </div>
      )}
      {design === 'territory' && (
        <div className="insp-row">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              fill([
                { title: '264 BC', note: 'Italy' },
                { title: '146 BC', note: 'Spain, Greece, Tunisia' },
                { title: '30 BC', note: 'France, Türkiye, Egypt, Syria' },
                { title: '117 AD', note: 'United Kingdom, Romania, Iraq' }
              ])
            }
          >
            {t('tpl.map.fill.rome')}
          </Button>
        </div>
      )}
      <div className="hint">{hint}</div>
    </>
  )
}

const SCREENS = ['terminal', 'browser', 'chat', 'notes', 'search'] as const
const SCREEN_HEADLINE: Record<TerminalDesign, StringKey> = {
  terminal: 'tplf.head.terminal',
  browser: 'tplf.head.browser',
  chat: 'tplf.head.chat',
  notes: 'tplf.head.notes',
  search: 'tplf.head.search'
}
const SCREEN_ITEMS: Record<TerminalDesign, StringKey> = {
  terminal: 'tplf.items.terminal',
  browser: 'tplf.items.browser',
  chat: 'tplf.items.chat',
  notes: 'tplf.items.notes',
  search: 'tplf.items.search'
}

/** The typing template's screen, and what its lines mean there. */
function TerminalFields({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const design = terminalDesign(b)
  return (
    <>
      <Choice
        stack
        label={t('tpl.screen')}
        value={design}
        options={SCREENS.map((v) => ({ value: v, label: t(`tpl.screen.${v}`) }))}
        onChange={(v) =>
          edit((p) => {
            const tp = findTemplate(p, b.id)
            if (!tp) return
            if (v === 'terminal') delete tp.design
            else tp.design = v
          })
        }
      />
      <div className="hint">
        {t(`tpl.screen.${design}.help`)} {t('tpl.screen.keyboard')}
      </div>
    </>
  )
}
/** The map's pace: each flight, and each place's light spreading. */
function MapTiming({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const set = (patch: Partial<TemplateBlock>): void =>
    edit(
      (p) => {
        const tp = findTemplate(p, b.id)
        if (tp) Object.assign(tp, patch)
      },
      true,
      `tpl-map-timing:${b.id}`
    )
  return (
    <>
      <UndoSlider label={t('tpl.map.travel')} value={b.travel ?? 0.9} min={0.3} max={4} step={0.01} fmt={(v) => `${v.toFixed(2)} s`} onChange={(v) => set({ travel: v })} />
      <UndoSlider label={t('tpl.map.spread')} value={b.spread ?? 0.6} min={0.1} max={4} step={0.01} fmt={(v) => `${v.toFixed(2)} s`} onChange={(v) => set({ spread: v })} />
      <div className="hint">{t('tpl.map.timing.help')}</div>
    </>
  )
}
/** A verse or a quote: which it is, and where its panel comes from. */
function QuoteFields({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const set = (fn: (tp: TemplateBlock) => void): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (tp) fn(tp)
    })
  const verse = b.design === 'verse'
  const from = b.from ?? 'left'
  return (
    <>
      <Choice
        label={t('tpl.quote.kind')}
        value={verse ? 'verse' : 'quote'}
        options={[
          { value: 'quote', label: t('tpl.quote.quote') },
          { value: 'verse', label: t('tpl.quote.verse') }
        ]}
        onChange={(v) => set((tp) => { if (v === 'verse') tp.design = 'verse'; else delete tp.design })}
      />
      <Choice
        label={t('tpl.quote.from')}
        value={from}
        options={(['left', 'top', 'right'] as const).map((v) => ({ value: v, label: v === 'top' ? t('tpl.place.top') : t(`insp.align.${v}`) }))}
        onChange={(v) => set((tp) => { if (v === 'left') delete tp.from; else tp.from = v })}
      />
      <UndoSlider
        label={t('insp.size')}
        value={b.size ?? 1}
        min={0.3}
        max={1}
        step={0.01}
        fmt={(v) => (v >= 0.999 ? t('f9y.tpl.fullPanel') : t('f9y.tpl.cardSize', { pct: fmtPct(v) }))}
        onChange={(v) =>
          edit(
            (p) => {
              const tp = findTemplate(p, b.id)
              if (!tp) return
              if (v >= 0.999) delete tp.size
              else tp.size = v
            },
            false
          )
        }
      />
      <div className="hint">{verse ? t('tpl.quote.help.verse') : t('tpl.quote.help.quote')}</div>
    </>
  )
}
/** The cutout title: typed as a line, split into its words (each keeps its
 *  size by position); Shuffle picks other papers and types. */
function CutoutFields({ b }: { b: TemplateBlock }): JSX.Element {
  const t = useT()
  const [line, setLine] = useState(() => b.items.map((it) => it.title).join(' '))
  const apply = (text: string): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (!tp) return
      const words = text.split(/\s+/).filter(Boolean).slice(0, 12)
      tp.items = words.map((w, i) => ({ id: tp.items[i]?.id ?? uid(), title: w, ...(tp.items[i]?.value !== undefined ? { value: tp.items[i].value } : {}) }))
    })
  return (
    <>
      <div className="insp-stack">
        <span className="insp-stack-label">{t('tpl.cutout.title')}</span>
        <TextField value={line} label={t('tpl.cutout.title')} onChange={setLine} onBlur={() => apply(line)} onCommit={apply} />
        <div className="hint">{t('tpl.cutout.help')}</div>
      </div>
      <div className="insp-row">
        <Button
          size="sm"
          icon="rotate-cw"
          onClick={() =>
            edit((p) => {
              const tp = findTemplate(p, b.id)
              if (tp) tp.seed = Math.floor(Math.random() * 1e6)
            })
          }
        >
          {t('tpl.cutout.shuffle')}
        </Button>
      </div>
    </>
  )
}
/** Where the whole template sits and how big: sliders, the three usual
 *  places, and a reset — or drag it in the preview (its corner scales). */
function PlaceFields({ b, project }: { b: TemplateBlock; project: Project }): JSX.Element {
  const t = useT()
  const pl = b.place ?? { x: 0, y: 0, s: 1 }
  const put = (next: { x: number; y: number; s: number }, commit = true): void =>
    edit((p) => {
      const tp = findTemplate(p, b.id)
      if (!tp) return
      if (Math.abs(next.x) < 1e-4 && Math.abs(next.y) < 1e-4 && Math.abs(next.s - 1) < 1e-4) delete tp.place
      else tp.place = { x: next.x, y: next.y, s: next.s }
    }, commit)
  const { width: W, height: H } = project.settings
  const pct = (v: number): string => fmtPct(v)
  return (
    <Section id="Place" icon="move" title={t('tpl.place')} data-section="template-place">
      <div className="insp-row">
        {(['top', 'middle', 'bottom'] as const).map((v) => (
          <Button key={v} size="sm" onClick={() => put(placeAt(b, v, 0, W, H))}>{t(`tpl.place.${v}`)}</Button>
        ))}
      </div>
      <UndoSlider label={t('insp.clip.scale')} value={pl.s} min={0.25} max={2} step={0.01} fmt={(v) => fmtPct(v)} onChange={(v) => put({ ...pl, s: v }, false)} />
      <UndoSlider label={t('tpl.place.across')} value={pl.x} min={-0.6} max={0.6} step={0.005} fmt={pct} onChange={(v) => put({ ...pl, x: v }, false)} />
      <UndoSlider label={t('tpl.place.upDown')} value={pl.y} min={-0.6} max={0.6} step={0.005} fmt={pct} onChange={(v) => put({ ...pl, y: v }, false)} />
      {b.place && (
        <div className="insp-row">
          <Button size="sm" icon="rotate-ccw" onClick={() => put({ x: 0, y: 0, s: 1 })}>{t('tpl.place.reset')}</Button>
        </div>
      )}
      <div className="hint">{t('tpl.place.help')}</div>
    </Section>
  )
}
