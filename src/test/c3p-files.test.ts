// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase Ç3 patch (haritalar/_fazc3-denetim-dayaniklilik.md R-1, R-2): an
// export never loses the user's old file of that name. The whole-file write
// goes beside its target and is put in place only when complete; a job whose
// file has been put in place is done, whatever Cancel said after it.
// (The app-level cases: e2e 58 "export-keeps-old-file".)
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, existsSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeViaPart } from '../main/safe-write'
import { runExportJob } from '../renderer/src/export/run-job'
import { cancelExportJob } from '../renderer/src/export/job'
import { useStore } from '../renderer/src/state/store'
import { plainFileError } from '../renderer/src/export/file-target'
import { t } from '../renderer/src/ui/strings'

test('R-2: a write that fails part-way leaves the old file byte for byte, and no .part', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'snipp-c3p-'))
  try {
    const target = join(dir, 'old-sound.wav')
    const old = Buffer.alloc(1_000_000, 0x41)
    writeFileSync(target, old)
    const failing = async (fh: import('node:fs/promises').FileHandle, data: Uint8Array): Promise<void> => {
      await fh.write(data, 0, 4096, 0)
      throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
    }
    await assert.rejects(writeViaPart(target, Buffer.alloc(2_000_000, 0x42), { write: failing }), /ENOSPC/)
    assert.ok(readFileSync(target).equals(old), 'the old file is whole')
    assert.equal(existsSync(`${target}.part`), false, 'no .part left')
    // A write that completes replaces it.
    await writeViaPart(target, Buffer.alloc(10, 0x43))
    assert.ok(readFileSync(target).equals(Buffer.alloc(10, 0x43)))
    assert.equal(existsSync(`${target}.part`), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('R-2: a full disk or a refused file on a sound or frame is said as a plain sentence', () => {
  assert.equal(plainFileError(new Error('Error: ENOSPC: no space left on device, write'), 'file').message, t('export.disk.full.file'))
  assert.equal(plainFileError("Error: EPERM: operation not permitted, open 'x.wav.part'", 'file').message, t('export.disk.denied.file'))
})

test('R-1: a job whose file was put in place is Done, even if Cancel came after; before that it is Cancelled', async () => {
  const placed = await runExportJob('video', { target: 'x.mp4' }, async () => {
    // The file is in place; then the Cancel button.
    cancelExportJob()
    return { path: 'x.mp4' }
  })
  assert.equal(placed, true)
  assert.equal(useStore.getState().exportStatus?.label, 'Done')
  assert.notEqual(useStore.getState().exportStatus?.cancelled, true)
  const dropped = await runExportJob('video', { target: 'x.mp4' }, async (signal) => {
    cancelExportJob()
    if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError')
    return { path: 'x.mp4' }
  })
  assert.equal(dropped, false)
  assert.equal(useStore.getState().exportStatus?.cancelled, true)
})
