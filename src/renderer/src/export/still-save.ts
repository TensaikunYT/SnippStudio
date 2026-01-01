// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// "This frame": the frame at the playhead as a picture file (phase Ç3a,
// decision 9; report R26), chosen in the export window's Frame part (phase
// Ç3b, decision 9: Ç3a's small dialog of its own is gone). Its size (the
// project's or 4K), PNG or JPEG, the subtitles and texts or a clean picture;
// a Shorts project's still is its 9:16 window, drawn at its size.
import { stillFrame, stillSize, preloadImagesForExport, type StillSize } from './exporter'
import { checkRenderCancelled } from './cancel'
import { runExportJob } from './run-job'
import { safeFileName } from './formats'
import { plainFileError, saveWholeFile } from './file-target'
import { api, downloadBlob } from '../platform'
import { useStore } from '../state/store'
import { t } from '../ui/strings'

export interface StillChoice {
  size: StillSize
  format: 'png' | 'jpeg'
  captions: boolean
}

/** Draws and saves the frame at the playhead with these choices. `at`: its
 *  file already chosen (the export window's several outputs in one run,
 *  DENEME-4 worker W: beside the video), and the moment it is of. True when
 *  the file is in place. */
export async function saveStillFrame(choice: StillChoice, at: { path?: string; time?: number } = {}): Promise<boolean> {
  const s = useStore.getState()
  const project = s.project
  const time = at.time ?? s.currentTime
  const shorts = project.mode === 'shorts'
  const { w, h } = stillSize(project, { size: choice.size, shorts })
  const ext = choice.format === 'jpeg' ? 'jpg' : 'png'
  const name = `${safeFileName(project.name, 'frame')}-${time.toFixed(2)}s.${ext}`
  let savePath: string | null = at.path ?? null
  if (api && !savePath) {
    savePath = await api.chooseSavePath({ defaultName: name, filterName: choice.format === 'jpeg' ? 'JPEG image' : 'PNG image', extensions: choice.format === 'jpeg' ? ['jpg', 'jpeg'] : ['png'] })
    if (!savePath) return false
  }
  const detail = t(choice.captions ? 'still.detail' : 'still.detail.clean', { w, h, format: choice.format.toUpperCase(), time: time.toFixed(2) })
  return runExportJob('frame', { detail, target: savePath ?? name }, async (signal, progress) => {
    progress(0.1, t('still.job.loading'))
    await preloadImagesForExport(project)
    checkRenderCancelled(signal)
    progress(0.5, t('still.job.drawing'))
    const leftOut: string[] = []
    const data = await stillFrame(project, time, { size: choice.size, shorts, format: choice.format, captions: choice.captions, leftOut })
    // A clip left out of the saved frame is said (5a/5b patch, C-6).
    if (leftOut.length) void import('../ui').then((m) => m.notify({ text: leftOut.join(' ') })).catch(() => {})
    checkRenderCancelled(signal)
    progress(0.9, t('still.job.saving'))
    if (api && savePath) {
      // Beside its target, then put in place (phase Ç3 patch, R-2): a failed
      // write used to leave an old picture of that name emptied.
      if (api.streamFile) {
        await saveWholeFile(savePath, data, signal)
        return { path: savePath, bytes: data.byteLength }
      }
      const r = await api.writeChosenFile(savePath, data)
      if (!r.saved) throw plainFileError(r.error ?? 'could not write file', 'file')
      return { path: r.path ?? savePath, bytes: data.byteLength }
    }
    downloadBlob(new Blob([data as BlobPart], { type: choice.format === 'jpeg' ? 'image/jpeg' : 'image/png' }), name)
    return { bytes: data.byteLength }
  })
}
