// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The top bar's "Transcribe" (kullanım, item 7: "it is hard to find"): one
// press opens the left panel's Captions page, where the source is picked and
// the transcription started. No flow of its own.
import { Button, Tooltip, useT } from '../ui'
import { requestShell } from './app/requests'

export function TranscribeButton(): JSX.Element {
  const t = useT()
  return (
    <Tooltip content={t('kullanim.transcribe.hint')}>
      <Button variant="ghost" size="sm" icon="captions" testid="topbar.transcribe" onClick={() => requestShell('dock:captions')}>
        {t('kullanim.transcribe')}
      </Button>
    </Tooltip>
  )
}
