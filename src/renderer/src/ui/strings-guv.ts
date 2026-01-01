// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 SnippStudio contributors
// The words of the security patch (tarifler\GUVENLIK-YAMA.md, 20 Nov 2026).
// Each key is written in both languages (English is the default, Turkish is
// chosen in the settings); the type below asks for both and
// src/test/strings-guv.test.ts checks it. Spread into STRINGS (ui/strings.ts).

/** One text of the security patch: English and Turkish both. */
interface Both {
  en: string
  tr: string
}

export const STRINGS_GUV = {
  // ---- item 6: "Run the code in this folder?" (components/security/TrustFolderAsk.tsx) ----
  'trust.title': { en: 'Run the code in this folder?', tr: 'Bu klasördeki kod çalıştırılsın mı?' },
  'trust.body.project': {
    en: 'This project has a code clip whose folder is outside the project folder, and you have not added that folder on this computer. A code clip is a web page that runs inside the editor. It has not run.',
    tr: 'Bu projede, klasörü proje klasörünün dışında olan bir kod klibi var ve bu klasörü bu bilgisayarda sen eklemedin. Kod klibi, editörün içinde çalışan bir web sayfasıdır. Henüz çalışmadı.'
  },
  'trust.body.launch': {
    en: 'Another program asked to open this folder as a code clip. A code clip is a web page that runs inside the editor. It has not run, and nothing was written into the folder.',
    tr: 'Başka bir program bu klasörün kod klibi olarak açılmasını istedi. Kod klibi, editörün içinde çalışan bir web sayfasıdır. Henüz çalışmadı ve klasöre hiçbir şey yazılmadı.'
  },
  'trust.reach': {
    en: 'If it runs, the page can read every file in this folder. It cannot reach the internet or your other folders.',
    tr: 'Çalışırsa sayfa bu klasördeki her dosyayı okuyabilir. İnternete ve diğer klasörlerine ulaşamaz.'
  },
  'trust.folder': { en: 'Folder', tr: 'Klasör' },
  'trust.more': { en: '{n} more folder(s) will be asked after this one.', tr: 'Bundan sonra {n} klasör daha sorulacak.' },
  'trust.run': { en: 'Run the code in this folder', tr: 'Bu klasördeki kodu çalıştır' },
  'trust.dontRun': { en: "Don't run", tr: 'Çalıştırma' },
  'trust.kept': {
    en: 'The code clip stays empty. Open the project again to be asked about its folder again.',
    tr: 'Kod klibi boş kalır. Klasörü yeniden sorulsun diye projeyi tekrar aç.'
  },
  'trust.failed': { en: 'The folder could not be opened as a code clip.', tr: 'Klasör kod klibi olarak açılamadı.' },

  // ---- item 9: a project file with absurd numbers opens repaired (model/repair.ts) ----
  'project.repair.limits': {
    en: '{n} value(s) beyond what a project can hold brought back within limits (canvas size, frame rate, a length)',
    tr: 'bir projenin taşıyabileceğinin ötesindeki {n} değer sınıra çekildi (tuval boyutu, kare hızı, süre)'
  }
} satisfies Record<string, Both>
