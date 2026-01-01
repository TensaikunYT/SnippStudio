// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Where the speech model runs (phase 10b.2; report M4). The old test was
// `'gpu' in navigator`, but on Linux Chromium often has a navigator.gpu whose
// requestAdapter() answers null (WebGPU is rolled out per graphics card):
// a model that needs the GPU then failed to load with no word why. Since
// phase 9 the one model runs on the CPU (WASM), so this is a guard: the GPU
// only when the model can use it AND an adapter was really given, the CPU
// when the model has a CPU build, otherwise a clear error.
// Pure: the worker asks for the adapter (gpuAdapterGiven) only when it matters.

export type AsrDevice = 'webgpu' | 'wasm'

export interface DeviceAsk {
  /** The devices the installed model has a build for. */
  modelRuns: readonly AsrDevice[]
  /** navigator.gpu.requestAdapter() gave an adapter (not merely: navigator.gpu exists). */
  gpuAdapter: boolean
}

export type DeviceAnswer = { device: AsrDevice } | { error: string }

export function chooseDevice({ modelRuns, gpuAdapter }: DeviceAsk): DeviceAnswer {
  if (modelRuns.includes('webgpu') && gpuAdapter) return { device: 'webgpu' }
  if (modelRuns.includes('wasm')) return { device: 'wasm' }
  if (modelRuns.includes('webgpu')) return { error: 'This speech model needs a graphics card WebGPU can use, and this computer gave none (WebGPU is off or not offered for this card). The multilingual model runs on the CPU: use it instead.' }
  return { error: 'The speech model has no build this computer can run.' }
}

/** A real WebGPU adapter in this context (false where there is none). */
export async function gpuAdapterGiven(nav: { gpu?: { requestAdapter: () => Promise<unknown> } } | undefined): Promise<boolean> {
  try {
    return !!(nav?.gpu && (await nav.gpu.requestAdapter()))
  } catch {
    return false
  }
}
