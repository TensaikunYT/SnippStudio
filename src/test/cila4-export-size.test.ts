// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// cila4, 1: an export streamed into its file returns an empty array, so the
// done card's size comes from the file kept, asked through the stream's own
// door (file:stream-size) just before it is closed and put in place.
import './api-stub'
import './dom-stub'
import assert from 'node:assert/strict'
import test from 'node:test'
import { stubApi } from './api-stub'
import { fileTarget } from '../renderer/src/export/file-target'

function bridge(size: () => Promise<number>): { calls: string[] } {
  const calls: string[] = []
  stubApi({
    streamFile: {
      open: async () => 'id1',
      write: async () => true,
      close: async (_id: string, keep: boolean) => {
        calls.push(`close:${keep}`)
        return keep
      },
      size: async () => {
        calls.push('size')
        return size()
      },
      read: async () => new Uint8Array(0)
    } as unknown as () => unknown
  })
  return { calls }
}

test('a kept file says its real size, asked before it is closed', async () => {
  const { calls } = bridge(async () => 123456)
  const f = await fileTarget('C:/x/film.mp4')
  assert.equal(f.bytes(), 0, 'nothing kept yet')
  await f.done(true)
  assert.equal(f.bytes(), 123456)
  assert.deepEqual(calls, ['size', 'close:true'])
  await f.done(true)
  assert.deepEqual(calls, ['size', 'close:true'], 'closed once')
})

test('a dropped file says nothing and is not asked', async () => {
  const { calls } = bridge(async () => 99)
  const f = await fileTarget('C:/x/film.mp4')
  await f.done(false)
  assert.equal(f.bytes(), 0)
  assert.deepEqual(calls, ['close:false'])
})

test('a size that cannot be read falls back to the furthest byte written', async () => {
  bridge(async () => {
    throw new Error('no such stream')
  })
  const f = await fileTarget('C:/x/film.mp4')
  const w = (f.target as unknown as { _writable: WritableStream<{ type: 'write'; data: Uint8Array; position: number }> })._writable
  const writer = w.getWriter()
  await writer.write({ type: 'write', data: new Uint8Array(10), position: 0 })
  await writer.write({ type: 'write', data: new Uint8Array(5), position: 100 })
  await writer.write({ type: 'write', data: new Uint8Array(4), position: 20 })
  writer.releaseLock()
  await f.done(true)
  assert.equal(f.bytes(), 105)
})
