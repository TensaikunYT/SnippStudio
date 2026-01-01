// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Whether the Settings window is open, and on which page
// (TERMINAL-YOK-PLAN.md, 6). Opened by the top bar's gear, File → Settings,
// Ctrl+, (⌘, on a Mac), File → Keyboard shortcuts (its page) and the Agent
// tab's "Open settings" (the agent connection page).
import { create } from 'zustand'

export const SETTINGS_PAGES = ['general', 'agent', 'keys', 'help', 'about'] as const
export type SettingsPage = typeof SETTINGS_PAGES[number]

interface SettingsUi {
  open: boolean
  page: SettingsPage
  show: (page?: SettingsPage) => void
  setPage: (page: SettingsPage) => void
  close: () => void
}

export const useSettings = create<SettingsUi>((set) => ({
  open: false,
  page: 'general',
  show: (page) => set((s) => ({ open: true, page: page ?? s.page })),
  setPage: (page) => set({ page }),
  close: () => set({ open: false })
}))

export const openSettings = (page?: SettingsPage): void => useSettings.getState().show(page)
