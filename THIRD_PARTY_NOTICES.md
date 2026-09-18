# Third-party notices

Emboss continues a Create T3 App starter and uses Next.js, React, OpenNext,
Drizzle, Radix UI, Tailwind CSS, CodeMirror, qrcode, unified/remark/rehype,
Lucide, image-size, and their dependencies. Package licenses remain in their
installed distributions; `pnpm licenses list --prod` reports the pinned dependency
inventory. Preserve their notices when redistributing packaged builds.

## Copied component source

`src/components/ui` and the mobile hook originate from the official shadcn/ui
Radix registry, generated with CLI 4.21.0 (`radix-nova`). Local changes set Emboss
colors, compact dimensions, square corners, explicit active-state attributes,
and a hydration-safe mobile media subscription. Review upstream changes before
replacing these customized files.

Source: https://github.com/shadcn-ui/ui

MIT License

Copyright (c) 2023 shadcn

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Bundled fonts

Unmodified Latin WOFF2 subsets from Fontsource 5.3.0 are self-hosted. They retain
SIL Open Font License 1.1 terms; these licenses are separate from Emboss's MIT license.

- IBM Plex Sans (400, 500, 600): [license](public/licenses/ibm-plex-sans.txt).
- IBM Plex Mono (400): [license](public/licenses/ibm-plex-mono.txt).
- Barlow Condensed (600): [license](public/licenses/barlow-condensed.txt).
