// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Asked before a save writes over a file a newer Snipp saved (phase Ç2a.1,
// model/format.ts): what this version does not know would be lost.
import { Button, Dialog, useT } from '../../ui'
import { CURRENT_FORMAT } from '../../model/format'

export function NewerFileDialog({ format, onSaveOver, onSaveAs, onCancel }: { format: number; onSaveOver: () => void; onSaveAs: () => void; onCancel: () => void }): JSX.Element {
  const t = useT()
  return (
    <Dialog
      open
      title={t('project.newer.title')}
      onClose={onCancel}
      testid="ask.newer-file"
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} testid="ask.newer-file.cancel">
            {t('project.newer.cancel')}
          </Button>
          <Button onClick={onSaveAs} testid="ask.newer-file.save-as">
            {t('project.newer.saveAs')}
          </Button>
          <Button variant="primary" onClick={onSaveOver} testid="ask.newer-file.save-over">
            {t('project.newer.saveOver')}
          </Button>
        </>
      }
    >
      <p>{t('project.newer.message', { file: format, mine: CURRENT_FORMAT })}</p>
    </Dialog>
  )
}
