# Anydoc fixture provenance

The checked-in bytes under `fixtures/` are the canonical eval inputs. Their
lengths and SHA-256 hashes are enforced by `fixture-manifest.test.ts`. The
generator is convenience provenance only: rerunning LibreOffice or the pinned
JavaScript generators is not promised to reproduce the canonical archive bytes.

Project-authored fixtures are licensed under this repository's Apache-2.0
license. Eval-only generators are exactly pinned: PptxGenJS 4.0.1 (MIT), SheetJS
`xlsx` 0.18.5 (Apache-2.0), and JSZip 3.10.1 (MIT). They are development
dependencies and do not enter the published runtime dependency graph.

The XLS fixture preserves two ordered sheets and a merge. The ODS fixture
preserves two ordered sheets, an `of:=[.B2]*1.2` formula, and a merge. The PPTX
fixture contains two ordered slides, per-slide notes, a table, and an embedded
PNG. DOCX contains a footnote and embedded PNG.

## Explicitly unavailable cases

- Office encryption remains unavailable. The removed candidate was only a
  password-protected ZIP containing a DOCX, not an encrypted Office document.
- DOCM remains unavailable. A macro-enabled OOXML shell with marker bytes is not
  a valid VBA CFB project, while Apache POI's `SimpleMacro.docm` contains a
  callable `MsgBox` macro and is therefore not an inert substitute.
- Legacy PPT remains unavailable. LibreOffice 7.3.7.2 could load the authored
  FODP source but its `MS PowerPoint 97` export failed. Apache POI was then
  inspected at commit `1b7c4dca03b40623a183ab8b4d4dd6b1a20bb926`. Its
  [SampleShow.ppt](https://github.com/apache/poi/blob/1b7c4dca03b40623a183ab8b4d4dd6b1a20bb926/test-data/slideshow/SampleShow.ppt)
  is 125,440 bytes with SHA-256
  `64275a6685b8f267827178037dcc59de927475e56385725916f4c6039c7ce7f6`
  and has ordered slide text and two note strings, but inspection did not prove
  both a real table and embedded image. Separate `table_test.ppt` and
  `pictures.ppt` files exist, but using a set whose members individually fail
  the presentation required-fact contract would weaken the manifest. No bytes
  were copied. Apache POI's repository is Apache-2.0; its pinned
  [LICENSE](https://github.com/apache/poi/blob/1b7c4dca03b40623a183ab8b4d4dd6b1a20bb926/LICENSE)
  and [NOTICE](https://github.com/apache/poi/blob/1b7c4dca03b40623a183ab8b4d4dd6b1a20bb926/NOTICE)
  would govern a future imported fixture after its complete facts are proven.
