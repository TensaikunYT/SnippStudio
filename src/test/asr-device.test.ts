// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Phase 10b.2 (FAZ10-PLAN.md; report M4): the speech model's device is
// decided on a real adapter, not on `'gpu' in navigator`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { chooseDevice, gpuAdapterGiven } from '../renderer/src/subtitles/device'

test('chooseDevice: the table', () => {
  // Today's one model: CPU only, whatever the GPU says (Windows as before).
  assert.deepEqual(chooseDevice({ modelRuns: ['wasm'], gpuAdapter: true }), { device: 'wasm' })
  assert.deepEqual(chooseDevice({ modelRuns: ['wasm'], gpuAdapter: false }), { device: 'wasm' })
  // A model with both builds: the GPU only with a real adapter.
  assert.deepEqual(chooseDevice({ modelRuns: ['webgpu', 'wasm'], gpuAdapter: true }), { device: 'webgpu' })
  assert.deepEqual(chooseDevice({ modelRuns: ['webgpu', 'wasm'], gpuAdapter: false }), { device: 'wasm' })
  // GPU only and no adapter (Linux with navigator.gpu but no adapter): a clear error, not a crash.
  const r = chooseDevice({ modelRuns: ['webgpu'], gpuAdapter: false })
  assert.ok('error' in r && /graphics card/.test(r.error) && /CPU/.test(r.error))
  assert.ok('error' in chooseDevice({ modelRuns: [], gpuAdapter: true }))
})

test('gpuAdapterGiven: an adapter, not merely navigator.gpu', async () => {
  assert.equal(await gpuAdapterGiven(undefined), false)
  assert.equal(await gpuAdapterGiven({}), false)
  assert.equal(await gpuAdapterGiven({ gpu: { requestAdapter: async () => null } }), false, 'Linux: gpu exists, no adapter')
  assert.equal(await gpuAdapterGiven({ gpu: { requestAdapter: async () => { throw new Error('blocked') } } }), false)
  assert.equal(await gpuAdapterGiven({ gpu: { requestAdapter: async () => ({}) } }), true)
})
