# @use-crux/ingest

Source loaders for Crux. Each loader turns text, files, or URLs into a `SourceLoader` that streams
`IngestDocument` results for indexing. This package handles loading and parsing only; `@use-crux/core`
owns the index contracts that consume these documents.

## Install

```sh
pnpm add @use-crux/ingest @use-crux/core
```

## Usage

```ts
import { textSource } from '@use-crux/ingest'
import { filesSource } from '@use-crux/ingest/files'
import { urlsSource } from '@use-crux/ingest/urls'

// Load and parse files from a directory into IngestDocument results.
const source = filesSource({ directory: './docs', recursive: true }, { namespace: 'docs' })

for await (const result of source.load()) {
  if (result.ok) {
    console.log(result.document.title, result.document.content)
  } else {
    console.error(result.error.code, result.error.message)
  }
}
```

The package exposes three entry points:

- `.` (`@use-crux/ingest`) — shared types, `textSource`, `deriveContent`, `builtInParsers`, plus the
  loaders re-exported from the subpaths below.
- `./files` (`@use-crux/ingest/files`) — `fileSource` and `filesSource` for local files, directories,
  and globs.
- `./urls` (`@use-crux/ingest/urls`) — `urlSource` and `urlsSource` for fetching remote documents.

Loaders auto-detect format (txt, md, html, pdf, csv, json, docx, xlsx) and parse with the built-in
parsers. Each yielded result is either a parsed `IngestDocument` or a typed `IngestError`.

See the [`@use-crux/core` reference](https://cruxjs.dev/docs/reference/crux-core) and the [Crux docs](https://cruxjs.dev) for the full API.
