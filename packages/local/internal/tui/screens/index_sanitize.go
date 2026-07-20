package screens

import "github.com/use-crux/crux/packages/local/internal/tui/kit"

// sanitizeIndexInline removes terminal control sequences from one authored
// Project Index value and collapses structural whitespace into safe cells.
func sanitizeIndexInline(value string) string {
	return kit.SanitizeInline(value)
}

// sanitizeIndexMultiline removes escape and control sequences while retaining
// authored line structure. Tabs expand to spaces so terminal-cell bounds stay
// deterministic across emulators.
func sanitizeIndexMultiline(value string) string {
	return kit.SanitizeMultiline(value)
}
