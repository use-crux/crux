import assert from "node:assert/strict";
import test from "node:test";

import {
  nightlyReleaseNotes,
  stableReleaseNotes,
} from "./release/release-notes.mjs";

const INSTALL_URL = "https://cruxjs.dev/docs/reference/lsp#install-the-extension-and-cli";

test("stable release notes link the lockstep installation instructions", () => {
  const notes = stableReleaseNotes("### Minor Changes\n\n- Added editor support.");

  assert.match(notes, /Added editor support/);
  assert.match(notes, /VSIX, native archives, and checksums/);
  assert.match(notes, new RegExp(INSTALL_URL.replaceAll("/", "\\/")));
});

test("nightly notes identify the exact source and link installation", () => {
  const notes = nightlyReleaseNotes({
    version: "1.2.3-nightly.20260723.shaabcdef0",
    sourceCommit: "abcdef0123456789",
  });

  assert.match(notes, /1\.2\.3-nightly\.20260723\.shaabcdef0/);
  assert.match(notes, /abcdef0123456789/);
  assert.match(notes, /@use-crux\/local@nightly/);
  assert.match(notes, new RegExp(INSTALL_URL.replaceAll("/", "\\/")));
});
