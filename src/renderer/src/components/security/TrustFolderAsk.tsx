// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "Run the code in this folder?" (security patch, item 6): the one question
// the editor asks before a code clip's folder it does not trust runs
// (security/trust.ts keeps the list; main/film-trust.ts decides). One folder
// at a time; closing the window of the question is "Don't run".
// Built of the building blocks only (ui/), its words from t().
import { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { answerTrust, askToShow, startTrustAsks, subscribeTrust, trustAsks, type TrustAsk } from '../../security/trust'
import { useStore } from '../../state/store'
import { Button, Dialog, notify, useT } from '../../ui'

export function TrustFolderAsk(): JSX.Element | null {
  const t = useT()
  const asks = useSyncExternalStore(subscribeTrust, trustAsks)
  const assets = useStore((s) => s.project.assets)
  const [busy, setBusy] = useState(false)
  const ask = askToShow(asks, assets)
  if (!ask) return null
  const waiting = asks.filter((a) => a !== ask && askToShow([a], assets)).length

  const answer = (which: TrustAsk, run: boolean): void => {
    if (busy) return
    setBusy(true)
    void answerTrust(which, run)
      .then((ok) => {
        if (!run) notify({ text: t('trust.kept'), kind: 'info' })
        else if (!ok) notify({ text: t('trust.failed'), kind: 'error' })
      })
      .finally(() => setBusy(false))
  }

  return (
    <Dialog
      open
      testid="trust.ask"
      title={t('trust.title')}
      width="md"
      closeOnBackdrop={false}
      onClose={() => answer(ask, false)}
      actions={
        <>
          <Button variant="ghost" testid="trust.ask.dont" disabled={busy} data-autofocus onClick={() => answer(ask, false)}>
            {t('trust.dontRun')}
          </Button>
          <Button variant="primary" testid="trust.ask.run" disabled={busy} onClick={() => answer(ask, true)}>
            {t('trust.run')}
          </Button>
        </>
      }
    >
      <p>{t(ask.why === 'launch' ? 'trust.body.launch' : 'trust.body.project')}</p>
      <p>
        {t('trust.folder')}
        <br />
        <code data-testid="trust.ask.folder" style={{ userSelect: 'text', wordBreak: 'break-all' }}>
          {ask.folder}
        </code>
      </p>
      <p>{t('trust.reach')}</p>
      {waiting > 0 && <p data-testid="trust.ask.more">{t('trust.more', { n: waiting })}</p>}
    </Dialog>
  )
}

/** Mounts the question beside the editor (its own small root: the editor's
 *  own tree is untouched) and starts listening for the main process's asks. */
export function mountTrustFolderAsk(): void {
  startTrustAsks()
  const host = document.createElement('div')
  host.dataset.part = 'trust-ask'
  document.body.appendChild(host)
  createRoot(host).render(<TrustFolderAsk />)
}
