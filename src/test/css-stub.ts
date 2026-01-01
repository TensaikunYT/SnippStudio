// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// Lets a test import a component whose module pulls in a stylesheet (e.g.
// the Settings window's own sheet): Node gets an empty module for .css.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
;(require as any).extensions['.css'] = (): void => undefined
export {}
