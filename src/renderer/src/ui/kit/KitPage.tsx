// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The building blocks page (#ui-kit; SnippStudio phase 3a.2): every block in
// every state, live. Only a build that is not packaged opens it (a
// development or test run: main.tsx asks the main process, which answers only
// when !app.isPackaged). The e2e run takes its picture and drives its keys.
import { useState, type ReactNode } from 'react'
import { useStore } from '../../state/store'
import { Button, IconButton } from '../Button'
import { Chip } from '../Chip'
import { Checkbox, Segmented, Tabs, Toggle } from '../choice'
import { Dialog } from '../Dialog'
import { Field, NumberField, Select, TextArea, TextField } from '../fields'
import { Icon } from '../Icon'
import { ICONS, type IconName } from '../icons/lucide'
import { Menu, MenuTrigger, type MenuItem } from '../Menu'
import { InspectorCard, Section, SubSection } from '../Section'
import { ScrubField } from '../ScrubField'
import { Slider } from '../Slider'
import { useT, type Lang, type StringKey } from '../strings'
import { ToastStack, ToastView, notify } from '../Toasts'
import { TooltipBubble } from '../Tooltip'

function Card({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }): JSX.Element {
  return (
    <section className={wide ? 'kit-card is-wide' : 'kit-card'}>
      <h3 className="kit-card-title">{title}</h3>
      {children}
    </section>
  )
}

const Row = ({ children }: { children: ReactNode }): JSX.Element => <div className="kit-row">{children}</div>
const Col = ({ children }: { children: ReactNode }): JSX.Element => <div className="kit-col">{children}</div>

type Fit = 'fit' | 'fill' | 'stretch'
type Tab = 'clip' | 'look' | 'subs' | 'notes' | 'agent'

export function KitPage(): JSX.Element {
  const t = useT()
  const lang = useStore((s) => s.uiLang)
  const setLang = useStore((s) => s.setUiLang)
  const [clicks, setClicks] = useState(0)
  const [locked, setLocked] = useState(true)
  const [name, setName] = useState(t('kit.projectName.value'))
  const [search, setSearch] = useState('')
  const [fps, setFps] = useState('60')
  const [duration, setDuration] = useState(4.5)
  const [scale, setScale] = useState(120)
  const [opacity, setOpacity] = useState(85)
  const [grain, setGrain] = useState(0.5)
  const [cardPart, setCardPart] = useState<'a' | 'b'>('a')
  const [posX, setPosX] = useState(0)
  const [posY, setPosY] = useState(0)
  const [volume, setVolume] = useState(-6)
  const [agentOn, setAgentOn] = useState(true)
  const [snapOn, setSnapOn] = useState(false)
  const [edges, setEdges] = useState(true)
  const [all, setAll] = useState(false)
  const [fit, setFit] = useState<Fit>('fit')
  const [tab, setTab] = useState<Tab>('clip')
  const [chose, setChose] = useState('')
  const [dialog, setDialog] = useState(false)
  const [filter, setFilter] = useState(true)
  const [chips, setChips] = useState(true)

  const menuItems = (prefix: string): MenuItem[] => [
    { id: 'split', label: t('kit.menu.split'), icon: 'scissors', shortcut: 's', onSelect: () => setChose(t('kit.menu.split')), testid: `${prefix}.split` },
    { id: 'duplicate', label: t('kit.menu.duplicate'), icon: 'copy', shortcut: 'ctrl+d', onSelect: () => setChose(t('kit.menu.duplicate')), testid: `${prefix}.duplicate` },
    { id: 'paste', label: t('kit.menu.disabled'), icon: 'clipboard-paste', disabled: true, testid: `${prefix}.paste` },
    { id: 'link', label: t('kit.menu.link'), checked: true, onSelect: () => setChose(t('kit.menu.link')), testid: `${prefix}.link` },
    { id: 'delete', label: t('kit.menu.delete'), icon: 'trash', shortcut: 'del', danger: true, separatorBefore: true, onSelect: () => setChose(t('kit.menu.delete')), testid: `${prefix}.delete` }
  ]
  const fpsOptions = ['60', '30', '25', '24'].map((n) => ({ value: n, label: t('kit.fps', { n }) }))
  const langs: { value: Lang; label: string }[] = [
    { value: 'en', label: t('kit.lang.en') },
    { value: 'tr', label: t('kit.lang.tr') }
  ]
  const names = Object.keys(ICONS) as IconName[]
  const section = (k: StringKey, params?: Record<string, number>): string => t(k, params)

  return (
    <div className="kit-page" data-testid="ui-kit">
      <header className="kit-head">
        <div className="kit-head-text">
          <h1 className="kit-title" data-testid="kit.title">
            {t('kit.title')}
          </h1>
          <p className="kit-lead">{t('kit.lead')}</p>
        </div>
        <div className="kit-lang">
          <Segmented value={lang} options={langs} onChange={setLang} label={t('kit.lang')} testid="kit.lang" />
        </div>
      </header>

      <div className="kit-grid">
        <Card title={section('kit.section.buttons')}>
          <Row>
            <Button variant="primary" icon="download" testid="kit.button.primary" onClick={() => setClicks((n) => n + 1)}>
              {t('kit.export')}
            </Button>
            <Button variant="secondary" testid="kit.button.secondary" onClick={() => setClicks((n) => n + 1)}>
              {t('kit.secondary')}
            </Button>
            <Button variant="ghost" testid="kit.button.ghost" onClick={() => setClicks((n) => n + 1)}>
              {t('kit.plain')}
            </Button>
            <Button variant="danger" icon="trash" testid="kit.button.danger" onClick={() => setClicks((n) => n + 1)}>
              {t('kit.delete')}
            </Button>
          </Row>
          <Row>
            <Button variant="primary" size="sm" testid="kit.button.primary-sm">
              {t('kit.export')}
            </Button>
            <Button size="sm" icon="plus">
              {t('kit.import')}
            </Button>
            <Button variant="ghost" size="sm" iconEnd="chevron-down">
              {t('kit.more')}
            </Button>
            <Button variant="danger" size="sm">
              {t('kit.delete')}
            </Button>
          </Row>
          <Row>
            <Button icon="magnet" pressed testid="kit.button.pressed">
              {t('kit.snap')}
            </Button>
            <Button disabled testid="kit.button.disabled" onClick={() => setClicks((n) => n + 1)}>
              {t('kit.disabled')}
            </Button>
            <Button variant="primary" disabled>
              {t('kit.disabled')}
            </Button>
            <span className="kit-mono" data-testid="kit.clicks">
              {clicks}
            </span>
          </Row>
        </Card>

        <Card title={section('kit.section.iconButtons')}>
          <Row>
            <IconButton icon="scissors" label={t('kit.split')} shortcut="s" testid="kit.iconbutton.split" onClick={() => setClicks((n) => n + 1)} />
            <IconButton icon={locked ? 'lock' : 'lock-open'} label={t('kit.lock')} pressed={locked} testid="kit.iconbutton.lock" onClick={() => setLocked((v) => !v)} />
            <IconButton icon="ellipsis" label={t('kit.more')} variant="ghost" />
            <IconButton icon="trash" label={t('kit.delete')} variant="danger" shortcut="del" />
            <IconButton icon="undo-2" label={t('kit.undo')} disabled />
          </Row>
          <Row>
            <IconButton icon="mouse-pointer-2" label={t('kit.tab.clip')} size="sm" pressed />
            <IconButton icon="scissors" label={t('kit.split')} size="sm" />
            <IconButton icon="magnet" label={t('kit.snap')} size="sm" />
            <IconButton icon="zoom-in" label={t('kit.scale')} size="sm" variant="ghost" />
          </Row>
          <h3 className="kit-card-title">{section('kit.section.tooltip')}</h3>
          <Row>
            <IconButton icon="scissors" label={t('kit.tooltip.split')} shortcut="s" testid="kit.tooltip.host" />
            <TooltipBubble content={t('kit.tooltip.split')} shortcut="s" />
          </Row>
        </Card>

        <Card title={section('kit.section.fields')}>
          <Col>
            <Field label={t('kit.projectName')}>
              <TextField value={name} onChange={setName} testid="kit.field.name" />
            </Field>
            <Field label={t('kit.search')}>
              <TextField value={search} onChange={setSearch} placeholder={t('kit.search.placeholder')} testid="kit.field.search" />
            </Field>
            <Field label={t('kit.frameRate')}>
              <Select value={fps} options={fpsOptions} onChange={setFps} testid="kit.field.fps" />
            </Field>
            <Field label={t('kit.duration')}>
              <NumberField value={duration} onChange={setDuration} min={0.1} max={60} step={0.1} unit="s" testid="kit.field.duration" />
            </Field>
            <Field label={t('kit.locked')}>
              <TextField value={name} onChange={setName} disabled />
            </Field>
            <TextArea value={search} onChange={setSearch} label={t('kit.search')} placeholder={t('kit.search.placeholder')} rows={2} testid="kit.field.text" />
          </Col>
        </Card>

        <Card title={section('kit.section.sliders')}>
          <Col>
            <Slider label={t('kit.scale')} value={scale} min={0} max={200} unit="%" onChange={setScale} testid="kit.slider.scale" />
            <Slider label={t('kit.opacity')} value={opacity} min={0} max={100} unit="%" onChange={setOpacity} testid="kit.slider.opacity" />
            <Slider label={t('kit.volume')} value={volume} min={-60} max={12} step={0.5} unit="dB" onChange={setVolume} testid="kit.slider.volume" />
            <Slider label={t('kit.blur')} value={20} min={0} max={100} unit="px" onChange={() => undefined} disabled />
          </Col>
        </Card>
        {/* Arayüz v4: the Inspector's card, its small tabs, a two-row slider
            (Shift: ten steps, Alt: a tenth), a number with its name as a handle. */}
        <Card title={section('kit.section.card')}>
          <div className="ui-sliders-stacked">
            <InspectorCard id="kit.card" icon="move" title={t('kit.card.title')} testid="kit.card" aside={<IconButton icon="diamond" size="sm" label={t('kit.card.key')} />}>
              <Tabs size="sm" value={cardPart} label={t('kit.card.title')} testid="kit.card.part" onChange={setCardPart} tabs={[{ value: 'a', label: t('kit.card.partA') }, { value: 'b', label: t('kit.card.partB') }]} />
              <Slider label={t('kit.grain')} value={grain} min={0} max={1} step={0.01} scale={100} unit="%" decimals={0} onChange={setGrain} testid="kit.slider.grain" />
              <div className="insp-pos-fields">
                <ScrubField short={t('insp.axis.x')} label={t('insp.clip.x')} value={posX} onChange={setPosX} testid="kit.scrub.x" />
                <ScrubField short={t('insp.axis.y')} label={t('insp.clip.y')} value={posY} onChange={setPosY} testid="kit.scrub.y" />
              </div>
            </InspectorCard>
          </div>
        </Card>
        <Card title={section('kit.section.sections')}>
          <Section id="kit.demo" title={t('kit.sectionDemo.title')} count={3} testid="kit.section">
            <div className="hint">{t('kit.sectionDemo.body')}</div>
            <SubSection id="kit.demo" title={t('kit.sectionDemo.sub')} hint={t('kit.sectionDemo.subHint')}>
              <div className="ui-section-hint">{t('kit.sectionDemo.body')}</div>
            </SubSection>
          </Section>
        </Card>

        <Card title={section('kit.section.choices')}>
          <Col>
            <Toggle label={t('kit.agentAccess')} checked={agentOn} onChange={setAgentOn} testid="kit.toggle.agent" />
            <Toggle label={t('kit.snapping')} checked={snapOn} onChange={setSnapOn} testid="kit.toggle.snap" />
            <Toggle label={t('kit.proxies')} checked={false} onChange={() => undefined} disabled />
            <Checkbox label={t('kit.snapEdges')} checked={edges} onChange={setEdges} testid="kit.check.edges" />
            <Checkbox label={t('kit.allClips')} checked={all} onChange={setAll} testid="kit.check.all" />
            <Checkbox label={t('kit.someClips')} checked={false} indeterminate onChange={() => undefined} />
            <Checkbox label={t('kit.disabled')} checked onChange={() => undefined} disabled />
          </Col>
        </Card>

        <Card title={section('kit.section.segmented')}>
          <Col>
            <Segmented
              value={fit}
              options={[
                { value: 'fit', label: t('kit.fit') },
                { value: 'fill', label: t('kit.fill') },
                { value: 'stretch', label: t('kit.stretch') }
              ]}
              onChange={setFit}
              label={t('kit.picture')}
              testid="kit.seg"
            />
            <Segmented
              value="fit"
              options={[
                { value: 'fit', label: t('kit.fit'), icon: 'maximize-2' },
                { value: 'fill', label: t('kit.fill'), icon: 'square' }
              ]}
              onChange={() => undefined}
              label={t('kit.disabled')}
              disabled
            />
          </Col>
          <h3 className="kit-card-title">{section('kit.section.tabs')}</h3>
          <Tabs
            value={tab}
            tabs={[
              { value: 'clip', label: t('kit.tab.clip') },
              { value: 'look', label: t('kit.tab.look') },
              { value: 'subs', label: t('kit.tab.subs') },
              { value: 'notes', label: t('kit.tab.notes'), badge: 2 },
              { value: 'agent', label: t('kit.tab.agent'), agent: true }
            ]}
            onChange={setTab}
            label={t('kit.tabs')}
            testid="kit.tabs"
          />
        </Card>

        <Card title={section('kit.section.menu')}>
          <Row>
            <MenuTrigger label={t('kit.menu.open')} items={menuItems('kit.menu.item')} testid="kit.menu" />
            <MenuTrigger icon="ellipsis" iconLabel={t('kit.more')} items={menuItems('kit.menu.more')} variant="ghost" />
            <span className="kit-dim" data-testid="kit.menu.result">
              {chose ? t('kit.menu.chose', { item: chose }) : ''}
            </span>
          </Row>
          <div className="kit-static-menu">
            <Menu items={menuItems('kit.menu.static')} label={t('kit.menu.open')} focus="none" testid="kit.menu.static" />
          </div>
        </Card>

        <Card title={section('kit.section.dialog')}>
          <Row>
            <Button testid="kit.dialog.open" onClick={() => setDialog(true)}>
              {t('kit.dialog.open')}
            </Button>
          </Row>
          <Dialog
            inline
            open
            title={t('kit.dialog.title')}
            onClose={() => undefined}
            width="sm"
            actions={
              <>
                <Button variant="ghost">{t('kit.cancel')}</Button>
                <Button variant="primary">{t('kit.export')}</Button>
              </>
            }
          >
            {t('kit.dialog.body')}
          </Dialog>
          <Dialog
            open={dialog}
            title={t('kit.dialog.title')}
            onClose={() => setDialog(false)}
            testid="kit.dialog"
            actions={
              <>
                <Button variant="ghost" testid="kit.dialog.cancel" onClick={() => setDialog(false)}>
                  {t('kit.cancel')}
                </Button>
                <Button variant="primary" testid="kit.dialog.ok" onClick={() => setDialog(false)}>
                  {t('kit.export')}
                </Button>
              </>
            }
          >
            <Col>
              <p>{t('kit.dialog.body')}</p>
              <Field label={t('kit.projectName')}>
                <TextField value={name} onChange={setName} testid="kit.dialog.name" />
              </Field>
            </Col>
          </Dialog>
        </Card>

        <Card title={section('kit.section.toasts')}>
          <Row>
            <Button
              testid="kit.toast.show"
              onClick={() => notify({ text: t('kit.toast.cuts', { n: 14 }), action: { label: t('kit.undo'), run: () => notify({ text: t('kit.undone') }) } })}
            >
              {t('kit.toast.show')}
            </Button>
          </Row>
          <Col>
            <ToastView toast={{ text: t('kit.toast.cuts', { n: 14 }), kind: 'info', action: { label: t('kit.undo'), run: () => undefined } }} />
            <ToastView toast={{ text: t('kit.toast.saved'), kind: 'info' }} />
            <ToastView toast={{ text: t('kit.toast.failed'), kind: 'error' }} />
          </Col>
        </Card>

        <Card title={section('kit.section.chips')}>
          <Row>
            <Chip>{t('kit.chip.plain')}</Chip>
            <Chip tone="accent" pulse>
              {t('kit.chip.live')}
            </Chip>
            <Chip tone="agent" pulse icon="bot">
              {t('kit.chip.agent')}
            </Chip>
            <Chip tone="note" icon="pencil">
              {t('kit.chip.note')}
            </Chip>
            <Chip tone="danger">{t('kit.chip.error')}</Chip>
          </Row>
          <Row>
            <Chip icon="video" onClick={() => setFilter((v) => !v)} pressed={filter} testid="kit.chip.filter">
              {t('kit.chip.filter')}
            </Chip>
            {chips && (
              <Chip onRemove={() => setChips(false)} testid="kit.chip.removable">
                {t('kit.chip.plain')}
              </Chip>
            )}
          </Row>
        </Card>

        <Card title={section('kit.section.icons', { count: names.length })} wide>
          <div className="kit-icons">
            {names.map((n) => (
              <div key={n} className="kit-icon">
                <Icon name={n} size={16} />
                <span className="kit-icon-name">{n}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <ToastStack />
    </div>
  )
}
