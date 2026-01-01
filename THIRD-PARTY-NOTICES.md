# Third-Party Notices

SnippStudio itself is licensed under the GNU General Public License v3.0 or
later (see `LICENSE`). It redistributes the third-party components below under
their own licences: MIT, Apache-2.0, BSD-3-Clause, ISC and MPL-2.0 (the code
it ships), LGPL-2.0-or-later (the LAME MP3 encoder), OFL-1.1 and Apache-2.0
(the fonts), MIT and Apache-2.0 (the speech model). All of them are compatible
with GPLv3. The table of every production package below also names licences of
packages that are installed but never shipped (BlueOak-1.0.0, 0BSD,
LGPL-3.0-or-later, CC0-1.0); none of those conflicts with GPLv3 either.

Note: Apache-2.0 (used by `@huggingface/transformers`) is compatible with
GPL **v3** but not with GPLv2, which is one reason this project targets v3.

**The full licence texts** are in `licenses/` (beside the program in a
package, in the repository's root otherwise): `Apache-2.0.txt`,
`MIT.txt`, `MPL-2.0.txt`, `LGPL-2.1.txt`, `OFL-1.1.txt`, and `node-packages.txt`, which
holds the licence file of every package whose code ships, word for word
(made by `scripts/yayin/notices.mjs`).

## Bundled fonts

The caption/title fonts in `src/renderer/src/assets/fonts/` are redistributed
with this software, under the licence named beside each (the licence each font
file itself declares). The full texts are `licenses/OFL-1.1.txt` and
`licenses/Apache-2.0.txt`; the copyright lines below are the ones the files
carry.

| Font | Licence | Upstream | Copyright |
| --- | --- | --- | --- |
| Anton | OFL-1.1 | https://fonts.google.com/specimen/Anton | Copyright 2020 The Anton Project Authors (https://github.com/googlefonts/AntonFont.git) |
| Archivo Black | OFL-1.1 | https://fonts.google.com/specimen/Archivo+Black | Copyright 2017 The Archivo Black Project Authors (https://github.com/Omnibus-Type/ArchivoBlack) |
| Bangers | OFL-1.1 | https://fonts.google.com/specimen/Bangers | Copyright 2010 The Bangers Project Authors (https://github.com/googlefonts/bangers) |
| Bebas Neue | OFL-1.1 | https://fonts.google.com/specimen/Bebas+Neue | Copyright 2019 The Bebas Neue Project Authors (https://github.com/dharmatype/Bebas-Neue) |
| Inter | OFL-1.1 | https://fonts.google.com/specimen/Inter | Copyright 2016 The Inter Project Authors (https://github.com/rsms/inter) |
| Luckiest Guy | Apache-2.0 | https://fonts.google.com/specimen/Luckiest+Guy | Copyright (c) 2010 by Brian J. Bonislawsky DBA Astigmatic (AOETI). All rights reserved. |
| Merriweather | OFL-1.1 | https://fonts.google.com/specimen/Merriweather | Copyright 2024 The Merriweather Project Authors (https://github.com/EbenSorkin/Merriweather4) with Reserved Font Name "Merriweather". |
| Oswald | OFL-1.1 | https://fonts.google.com/specimen/Oswald | Copyright 2016 The Oswald Project Authors (https://github.com/googlefonts/OswaldFont) |
| Permanent Marker | Apache-2.0 | https://fonts.google.com/specimen/Permanent+Marker | Copyright (c) 2010 by Font Diner, Inc. All rights reserved. |
| Rock Salt | Apache-2.0 | https://fonts.google.com/specimen/Rock+Salt | Copyright (c) 2010 by Font Diner, Inc DBA Sideshow. All rights reserved. |

Permanent Marker and Rock Salt are shown in the font list as "Handwritten
(marker)" and "Handwritten (pen)". The family names themselves are unchanged —
those are what the licence attributes and what the files declare.

`SnippDisplay.ttf` (shown as "Snipp Display") is this project's own, drawn in
code, under the project's licence.

The interface itself is set in Inter (the same file, `Inter-Variable.ttf`,
declared to the page as "Inter UI") and, for numbers, time codes and
shortcuts, in JetBrains Mono:

| Font | Licence | Upstream | File |
| --- | --- | --- | --- |
| JetBrains Mono (variable; Latin and Latin Extended subsets) | OFL-1.1 | https://github.com/JetBrains/JetBrainsMono | `src/renderer/src/ui/fonts/` |

Note: the OFL permits redistribution and bundling, but **Reserved Font Names
may not be reused for modified versions**. Do not rename or re-release modified
copies of these fonts under their original names.

## Runtime dependencies

| Component | License |
| --- | --- |
| Electron | MIT |
| React / React DOM | MIT |
| Zustand | MIT |
| [mediabunny](https://github.com/Vanilagy/mediabunny) 1.50.8 (bundled into the interface code; its source: the link) | MPL-2.0 |
| [@mediabunny/mp3-encoder](https://github.com/Vanilagy/mediabunny/tree/main/packages/mp3-encoder) 1.50.8 | MPL-2.0 (contains LAME, LGPL-2.0) |
| [@huggingface/transformers](https://github.com/huggingface/transformers.js) | Apache-2.0 |
| [three.js](https://github.com/mrdoob/three.js) 0.170.0 (`vendor/three`, shipped as `resources/three`: `build/three.module.js` and `examples/jsm/` without its `libs/` folder of other projects' code; served only to code film pages that ask a CDN for this version) | MIT (Copyright © 2010-2024 three.js authors; the full text is `vendor/three/LICENSE`) |

### Every production package

<!-- generated:dependencies:start (scripts/yayin/notices.mjs) -->

Every package `package-lock.json` installs for production (93), made by `scripts/yayin/notices.mjs`. The packaged app carries no module of its own (`electron-builder.config.cjs`); the interface's libraries (React, Zustand, mediabunny, transformers.js with onnxruntime-web) are bundled into its code. `onnxruntime-node` and `sharp` with its `@img` binaries are installed by transformers.js but never shipped.

| Package | Version | Licence | Source |
| --- | --- | --- | --- |
| @emnapi/runtime | 1.11.3 | MIT | https://www.npmjs.com/package/@emnapi/runtime (platform package; not installed on Windows x64) |
| @huggingface/jinja | 0.5.9 | MIT | https://github.com/huggingface/huggingface.js |
| @huggingface/transformers | 3.8.1 | Apache-2.0 | https://github.com/huggingface/transformers.js |
| @img/colour | 1.1.0 | MIT | https://github.com/lovell/colour |
| @img/sharp-darwin-arm64 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-darwin-arm64 (platform package; not installed on Windows x64) |
| @img/sharp-darwin-x64 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-darwin-x64 (platform package; not installed on Windows x64) |
| @img/sharp-freebsd-wasm32 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-freebsd-wasm32 (platform package; not installed on Windows x64) |
| @img/sharp-libvips-darwin-arm64 | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-darwin-arm64 (platform package; not installed on Windows x64) |
| @img/sharp-libvips-darwin-x64 | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-darwin-x64 (platform package; not installed on Windows x64) |
| @img/sharp-libvips-linux-arm | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linux-arm (platform package; not installed on Windows x64) |
| @img/sharp-libvips-linux-arm64 | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linux-arm64 (platform package; not installed on Windows x64) |
| @img/sharp-libvips-linux-ppc64 | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linux-ppc64 (platform package; not installed on Windows x64) |
| @img/sharp-libvips-linux-riscv64 | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linux-riscv64 (platform package; not installed on Windows x64) |
| @img/sharp-libvips-linux-s390x | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linux-s390x (platform package; not installed on Windows x64) |
| @img/sharp-libvips-linux-x64 | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linux-x64 (platform package; not installed on Windows x64) |
| @img/sharp-libvips-linuxmusl-arm64 | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linuxmusl-arm64 (platform package; not installed on Windows x64) |
| @img/sharp-libvips-linuxmusl-x64 | 1.3.3 | LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-libvips-linuxmusl-x64 (platform package; not installed on Windows x64) |
| @img/sharp-linux-arm | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linux-arm (platform package; not installed on Windows x64) |
| @img/sharp-linux-arm64 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linux-arm64 (platform package; not installed on Windows x64) |
| @img/sharp-linux-ppc64 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linux-ppc64 (platform package; not installed on Windows x64) |
| @img/sharp-linux-riscv64 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linux-riscv64 (platform package; not installed on Windows x64) |
| @img/sharp-linux-s390x | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linux-s390x (platform package; not installed on Windows x64) |
| @img/sharp-linux-x64 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linux-x64 (platform package; not installed on Windows x64) |
| @img/sharp-linuxmusl-arm64 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linuxmusl-arm64 (platform package; not installed on Windows x64) |
| @img/sharp-linuxmusl-x64 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-linuxmusl-x64 (platform package; not installed on Windows x64) |
| @img/sharp-wasm32 | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later AND MIT | https://www.npmjs.com/package/@img/sharp-wasm32 (platform package; not installed on Windows x64) |
| @img/sharp-webcontainers-wasm32 | 0.35.4 | Apache-2.0 | https://www.npmjs.com/package/@img/sharp-webcontainers-wasm32 (platform package; not installed on Windows x64) |
| @img/sharp-win32-arm64 | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-win32-arm64 (platform package; not installed on Windows x64) |
| @img/sharp-win32-ia32 | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later | https://www.npmjs.com/package/@img/sharp-win32-ia32 (platform package; not installed on Windows x64) |
| @img/sharp-win32-x64 | 0.35.4 | Apache-2.0 AND LGPL-3.0-or-later | https://github.com/lovell/sharp |
| @isaacs/fs-minipass | 4.0.1 | ISC | https://github.com/npm/fs-minipass |
| @mediabunny/mp3-encoder | 1.50.8 | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
| @protobufjs/aspromise | 1.1.2 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/base64 | 1.1.2 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/codegen | 2.0.5 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/eventemitter | 1.1.1 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/fetch | 1.1.1 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/float | 1.0.2 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/path | 1.1.2 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/pool | 1.1.0 | BSD-3-Clause | https://github.com/dcodeIO/protobuf.js |
| @protobufjs/utf8 | 1.1.2 | BSD-3-Clause | https://github.com/protobufjs/protobuf.js |
| @types/dom-mediacapture-transform | 0.1.12 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/dom-webcodecs | 0.1.13 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/node | 26.1.1 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/prop-types | 15.7.15 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| @types/react | 18.3.31 | MIT | https://github.com/DefinitelyTyped/DefinitelyTyped |
| boolean | 3.2.0 | MIT | https://github.com/thenativeweb/boolean |
| chownr | 3.0.0 | BlueOak-1.0.0 | https://github.com/isaacs/chownr |
| csstype | 3.2.3 | MIT | https://github.com/frenic/csstype |
| define-data-property | 1.1.4 | MIT | https://github.com/ljharb/define-data-property |
| define-properties | 1.2.1 | MIT | https://github.com/ljharb/define-properties |
| detect-libc | 2.1.2 | Apache-2.0 | https://github.com/lovell/detect-libc |
| detect-node | 2.1.0 | MIT | https://github.com/iliakan/detect-node |
| es-define-property | 1.0.1 | MIT | https://github.com/ljharb/es-define-property |
| es-errors | 1.3.0 | MIT | https://github.com/ljharb/es-errors |
| es6-error | 4.1.1 | MIT | https://github.com/bjyoungblood/es6-error |
| escape-string-regexp | 4.0.0 | MIT | https://github.com/sindresorhus/escape-string-regexp |
| flatbuffers | 25.9.23 | Apache-2.0 | https://github.com/google/flatbuffers |
| global-agent | 3.0.0 | BSD-3-Clause | https://github.com/gajus/global-agent |
| globalthis | 1.0.4 | MIT | https://github.com/ljharb/System.global |
| gopd | 1.2.0 | MIT | https://github.com/ljharb/gopd |
| guid-typescript | 1.0.9 | ISC | https://github.com/NicolasDeveloper/guid-typescript |
| has-property-descriptors | 1.0.2 | MIT | https://github.com/inspect-js/has-property-descriptors |
| js-tokens | 4.0.0 | MIT | https://github.com/lydell/js-tokens |
| json-stringify-safe | 5.0.1 | ISC | https://github.com/isaacs/json-stringify-safe |
| long | 5.3.2 | Apache-2.0 | https://github.com/dcodeIO/long.js |
| loose-envify | 1.4.0 | MIT | https://github.com/zertosh/loose-envify |
| matcher | 3.0.0 | MIT | https://github.com/sindresorhus/matcher |
| mediabunny | 1.50.8 | MPL-2.0 | https://github.com/Vanilagy/mediabunny |
| minipass | 7.1.3 | BlueOak-1.0.0 | https://github.com/isaacs/minipass |
| minizlib | 3.1.0 | MIT | https://github.com/isaacs/minizlib |
| object-keys | 1.1.1 | MIT | https://github.com/ljharb/object-keys |
| onnxruntime-common | 1.21.0 | MIT | https://github.com/Microsoft/onnxruntime |
| onnxruntime-common | 1.22.0-dev.20250409-89f8206ba4 | MIT | https://github.com/Microsoft/onnxruntime |
| onnxruntime-node | 1.21.0 | MIT | https://github.com/Microsoft/onnxruntime |
| onnxruntime-web | 1.22.0-dev.20250409-89f8206ba4 | MIT | https://github.com/Microsoft/onnxruntime |
| platform | 1.3.6 | MIT | https://github.com/bestiejs/platform.js |
| protobufjs | 7.6.5 | BSD-3-Clause | https://github.com/protobufjs/protobuf.js |
| react | 18.3.1 | MIT | https://github.com/facebook/react |
| react-dom | 18.3.1 | MIT | https://github.com/facebook/react |
| roarr | 2.15.4 | BSD-3-Clause | git@github.com:gajus/roarr |
| scheduler | 0.23.2 | MIT | https://github.com/facebook/react |
| semver | 7.8.5 | ISC | https://github.com/npm/node-semver |
| semver-compare | 1.0.0 | MIT | https://github.com/substack/semver-compare |
| serialize-error | 7.0.1 | MIT | https://github.com/sindresorhus/serialize-error |
| sharp | 0.35.4 | Apache-2.0 | https://github.com/lovell/sharp |
| sprintf-js | 1.1.3 | BSD-3-Clause | https://github.com/alexei/sprintf.js |
| tar | 7.5.22 | BlueOak-1.0.0 | https://github.com/isaacs/node-tar |
| tslib | 2.8.1 | 0BSD | https://github.com/Microsoft/tslib |
| type-fest | 0.13.1 | (MIT OR CC0-1.0) | https://github.com/sindresorhus/type-fest |
| undici-types | 8.3.0 | MIT | https://github.com/nodejs/undici |
| yallist | 5.0.0 | BlueOak-1.0.0 | https://github.com/isaacs/yallist |
| zustand | 5.0.14 | MIT | https://github.com/pmndrs/zustand |

<!-- generated:dependencies:end -->

## Interface icons

The interface's icons are the shapes of [Lucide](https://lucide.dev)
(`lucide-static` 1.72.0, a development dependency only), copied into
`src/renderer/src/ui/icons/lucide.ts` by `scripts/icons/make.mjs`; no icon
package ships with the app.

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

Some of these icons (among those used here: `arrow-*`, `check`,
`chevron-*`, `code`, `crosshair`, `external-link`, `info`, `link`, `lock`,
`minus`, `moon`, `plus`, `search`, `smartphone`, `square`, `terminal`,
`trash`, `type`, `upload`, `download`, `x`, `zoom-in`, `zoom-out`) are derived
from the Feather project: The MIT License (MIT), Copyright (c) 2013-present
Cole Bemis. Permission is hereby granted, free of charge, to any person
obtaining a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including without
limitation the rights to use, copy, modify, merge, publish, distribute,
sublicense, and/or sell copies of the Software, and to permit persons to whom
the Software is furnished to do so, subject to the following conditions: The
above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software. THE SOFTWARE IS PROVIDED "AS
IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT
LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE
AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF
CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

## Speech model

Subtitles use OpenAI's Whisper through the ONNX conversion published by
`onnx-community`: the package carries one model, the pinned
[`whisper-medium_timestamped`](https://huggingface.co/onnx-community/whisper-medium_timestamped/tree/9fe933aaa6b0244316eb961f36d33dfedf0c0b0c)
conversion (CPU pair, quantized) of
[OpenAI Whisper Medium](https://huggingface.co/openai/whisper-medium). It
transcribes Turkish, English and the other Whisper languages. Development
checkouts may also hold the English
[`whisper-medium.en_timestamped`](https://huggingface.co/onnx-community/whisper-medium.en_timestamped)
set; it is not packaged.

Licence (read on the official pages on 20 November 2026):

- the ONNX conversion, at the pinned revision: **MIT** (the `license: mit`
  line of its model card,
  https://huggingface.co/onnx-community/whisper-medium_timestamped/blob/9fe933aaa6b0244316eb961f36d33dfedf0c0b0c/README.md,
  which names `openai/whisper-medium` as its base model);
- the original weights, OpenAI Whisper Medium: **Apache-2.0** (the
  `license: apache-2.0` line of https://huggingface.co/openai/whisper-medium,
  `README.md`). The full text is `licenses/Apache-2.0.txt`.

The MIT text is `licenses/MIT.txt` (the model card names no holder beyond its
publisher, onnx-community). Model files are not in the source repository; packages bundle
the local weights in `resources/models`. The app never contacts the Hub.

## Media codecs

Encoding and decoding are performed by the codecs already present in
Chromium/Electron and the host operating system through the WebCodecs API. This
project bundles no codec binaries of its own (no ffmpeg, no x264), with one
exception: MP3 export, which Chromium cannot encode.

MP3 export uses `@mediabunny/mp3-encoder` (Mediabunny's MP3 extension, MPL-2.0,
https://github.com/Vanilagy/mediabunny), which contains a WebAssembly build of
the LAME MP3 encoder 3.100 (https://lame.sourceforge.io/), licensed under the GNU
Library General Public License v2 (LGPL-2.0-or-later). It is loaded only when
an MP3 is exported. The source of both is available at the URLs above (and in
`node_modules/@mediabunny/mp3-encoder/src` of a development checkout); under
the MPL and the LGPL you may replace or modify them. Both are compatible with
SnippStudio's GPL-3.0-or-later. The licence texts are `licenses/MPL-2.0.txt`
and `licenses/LGPL-2.1.txt` (LAME's "version 2 or any later version" covers
2.1).


## Agent program names and marks

Program adları ve işaretleri sahiplerinin markalarıdır; yalnız bağlı programı belirtmek için gösterilir.
(The agent programs' names and marks belong to their owners; they are shown only to say which program is connected.)
