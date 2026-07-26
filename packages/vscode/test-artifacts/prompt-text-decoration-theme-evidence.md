# PromptText mapped-decoration evidence

Date: 2026-07-26  
Host: VS Code 1.90.2 on Linux  
Fixture: CRLF TypeScript template with Unicode, all seven roles, and an
interpolation barrier

The extension-host harness creates real `TextEditorDecorationType` instances.
It captures the built-in TypeScript semantic-token bytes before and after
applying the fixture with `editor.semanticHighlighting.enabled` set to both
`true` and `false`. Both non-empty, tuple-valid streams are byte-identical.
Completion, hover, and definition results inside `${name}` are also non-empty
and structurally identical before and after decoration.

## Theme matrix

Each row was visually inspected from a capture of only the Extension
Development Host window. Decoration types were created and applied under the
opposite base theme, then the target theme was selected without recreating the
types. Each run also advances the real document version with an editor edit,
clears stale ranges, and reapplies all roles before the theme change. The
role-update count does not change during the theme transition.

| Theme | Roles and interpolation | Selection, cursor, diagnostics | Result |
| --- | --- | --- | --- |
| Dark+ | Heading, strong, emphasis, link, code, list, and blockquote remain legible; `${name}` keeps native TypeScript colors. | Heading selection, second cursor in code, warning underline, and Problems count remain visible. | Pass |
| Light+ | All roles remain distinguishable against the light editor background; interpolation remains untouched. | Selection, cursor, warning, and editor chrome remain legible. | Pass |
| Dark High Contrast | All roles remain visible after the code role uses `editor.foreground`; interpolation remains untouched. | High-contrast selection, cursor, warning underline, and focus borders remain visible. | Pass |
| Light High Contrast | All roles remain visible against the white background; interpolation remains untouched. | Selection, cursor, warning underline, and focus borders remain visible. | Pass |

The first Dark High Contrast capture exposed `textPreformat.foreground`
rendering inline-code content black on black. The role now uses the registered
`editor.foreground` theme color; the repeated capture passed without a fixed
RGB value.

## Update and flicker observations

| Transition | `setDecorations` replacements | Observation |
| --- | ---: | --- |
| Open/apply | 7 | No visible flicker or native-token change. |
| Real editor edit | 14 (7 clear + 7 apply) | Document version advanced; no visible retained stale range or persistent blank state. |
| Theme change | 0 | Colors changed without reload, type recreation, or visible flash. |
| Disable | 7 empty replacements | All roles cleared immediately. |

The count is an extension API update count, not a claim about VS Code's
internal compositor repaint count.
