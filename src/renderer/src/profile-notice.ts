// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The first start of a new profile folder (phase 9a, decision 3): when the
// main process copied the older app's settings (main/profile-inherit.ts), the
// first editor window says so in one notice. Asked once; later windows and
// later starts get null.
import { api } from './platform'
import { notify } from './ui/toast-core'
import { t } from './ui/strings'

export function tellInheritedProfile(): void {
  void Promise.resolve(api?.profileInherited?.())
    .catch(() => null)
    .then((r) => {
      if (!r || !r.copied.length) return
      notify({ text: t('profile.inherited', { from: r.from }), timeout: 12_000 })
    })
}
