// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The Templates panel's "Code templates" part (phase 5f, decision 1): six
// working pages the USER adds (the agent is never offered them by a tool).
import { useState } from 'react'
import { addCodeTemplate, CODE_TEMPLATE_NAME, CODE_TEMPLATES, type CodeTemplate } from '../media/code-templates'
import { Icon, Tooltip, useT, type IconName } from '../ui'
import { ToolButton } from './ToolButton'

const ICON: Record<CodeTemplate, IconName> = {
  blank: 'square',
  'lower-third': 'captions',
  'bar-chart': 'layout-grid',
  counter: 'hourglass',
  arrow: 'move-up-right',
  'title-card': 'type'
}

export function CodeTemplates(): JSX.Element {
  const t = useT()
  const [busy, setBusy] = useState<CodeTemplate | null>(null)
  const add = async (id: CodeTemplate): Promise<void> => {
    setBusy(id)
    try {
      await addCodeTemplate(id)
    } finally {
      setBusy(null)
    }
  }
  return (
    <section className="code-tpl" data-testid="codetpl">
      <div className="code-tpl-head">
        <Icon name="code" size={16} />
        <strong>{t('codeTpl.title')}</strong>
        {/* What these are: in the tip of the mark (the visual polish). */}
        <Tooltip content={t('codeTpl.note')}>
          <span className="ui-section-info" role="note" tabIndex={0} aria-label={t('codeTpl.note')}>
            <Icon name="info" size={14} />
          </span>
        </Tooltip>
      </div>
      <div className="code-tpl-list">
        {CODE_TEMPLATES.map((id) => (
          <div className="code-tpl-row" key={id}>
            <Icon name={ICON[id]} size={16} />
            <span className="code-tpl-name">{t(CODE_TEMPLATE_NAME[id])}</span>
            <ToolButton
              size="sm"
              icon={busy === id ? 'loader-circle' : 'plus'}
              label={t('codeTpl.add')}
              hint={t('codeTpl.addHint', { name: t(CODE_TEMPLATE_NAME[id]) })}
              aria-label={t('codeTpl.addHint', { name: t(CODE_TEMPLATE_NAME[id]) })}
              disabled={busy !== null}
              onClick={() => void add(id)}
              testid={`codetpl.add.${id}`}
            />
          </div>
        ))}
      </div>
    </section>
  )
}
