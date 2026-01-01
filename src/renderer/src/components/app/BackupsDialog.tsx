// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// File → Earlier versions… (phase Ç2a.2, decision 4): the copies of the
// project file taken before an autosave wrote over it (main/backups.ts), the
// newest first. One opens as a copy; the project file is not touched.
import { useEffect, useState } from 'react'
import { Button, Dialog, getLang, useT } from '../../ui'
import { listBackups } from '../../media/projectio'

export interface BackupEntry {
  name: string
  at: number
  size: number
}

/** A copy's time, in the interface's language. */
export const backupTime = (at: number): string => new Date(at).toLocaleString(getLang() === 'tr' ? 'tr-TR' : 'en-GB')

export function BackupsDialog({ uid, onOpen, onClose }: { uid: string | undefined; onOpen: (entry: BackupEntry) => void; onClose: () => void }): JSX.Element {
  const t = useT()
  const [list, setList] = useState<BackupEntry[] | null>(null)
  useEffect(() => {
    let live = true
    void listBackups(uid).then((l) => live && setList(l))
    return () => {
      live = false
    }
  }, [uid])
  return (
    <Dialog
      open
      title={t('backups.title')}
      onClose={onClose}
      testid="dialog.backups"
      actions={
        <Button variant="ghost" onClick={onClose} testid="backups.close">
          {t('backups.close')}
        </Button>
      }
    >
      <p>{t('backups.note')}</p>
      {list && list.length === 0 && <p data-testid="backups.empty">{t('backups.empty')}</p>}
      {list && list.length > 0 && (
        <ul className="ui-versions">
          {list.map((b, i) => (
            <li key={b.name} className="ui-versions-row" data-testid={`backups.row.${i}`}>
              <span className="ui-versions-when">{backupTime(b.at)}</span>
              <span className="ui-versions-size">{t('backups.size', { kb: Math.max(1, Math.round(b.size / 1024)) })}</span>
              <Button size="sm" onClick={() => onOpen(b)} testid={`backups.open.${i}`}>
                {t('backups.open')}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
