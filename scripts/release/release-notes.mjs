const INSTALL_URL =
  "https://cruxjs.dev/docs/reference/lsp#install-the-extension-and-cli";

/** Appends the public editor/CLI installation contract to stable notes. */
export function stableReleaseNotes(changelogSection) {
  return `${changelogSection.trim()}\n\n## Editor and CLI assets\n\n` +
    `This release includes a lockstep VSIX, native archives, and checksums. ` +
    `See the [installation instructions](${INSTALL_URL}).\n`;
}

/** Builds immutable-source nightly notes with the shared installation link. */
export function nightlyReleaseNotes({ version, sourceCommit }) {
  return `Automated Crux nightly ${version} from source commit ${sourceCommit}.\n\n` +
    `Install the CLI with \`npm install --global @use-crux/local@nightly\`, ` +
    `then install the attached lockstep VSIX. ` +
    `See the [installation instructions](${INSTALL_URL}).\n`;
}
