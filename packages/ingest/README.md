# @crux/ingest

Source loaders for Crux. Each loader turns text, files, or URLs into a `SourceLoader` that streams
`IngestDocument` results for indexing. This package handles loading and parsing only; `@crux/core`
owns the index contracts that consume these documents.

## Install

```sh
pnpm add @crux/ingest @crux/core
```

## Usage

```ts
import { textSource } from '@crux/ingest'
import { filesSource } from '@crux/ingest/files'
import { urlsSource } from '@crux/ingest/urls'

// Load and parse files from a directory into IngestDocument results.
const source = filesSource(
  { directory: './docs', recursive: true },
  { namespace: 'docs' },
)

for await (const result of source.load()) {
  if (result.ok) {
    console.log(result.document.title, result.document.content)
  } else {
    console.error(result.error.code, result.error.message)
  }
}
```

The package exposes three entry points:

- `.` (`@crux/ingest`) — shared types, `textSource`, `deriveContent`, `builtInParsers`, plus the
  loaders re-exported from the subpaths below.
- `./files` (`@crux/ingest/files`) — `fileSource` and `filesSource` for local files, directories,
  and globs.
- `./urls` (`@crux/ingest/urls`) — `urlSource` and `urlsSource` for fetching remote documents.

Loaders auto-detect format (txt, md, html, pdf, csv, json, docx, xlsx) and parse with the built-in
parsers. Each yielded result is either a parsed `IngestDocument` or a typed `IngestError`.

See [@crux/core](../core) and the [Crux docs](https://cruxjs.dev) for the full API.
