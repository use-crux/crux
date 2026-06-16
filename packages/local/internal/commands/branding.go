package commands

// Shared branding for the non-quality "observe" commands (cost, index, lint,
// inspect, traces, flows). They render a "◇ crux <command>" mark and route every
// styled span through output.IO so `--no-color`/non-TTY output stays byte-clean,
// matching the look the Quality renderers established in Phase 2/4 (spec 03 §3).

import (
	"github.com/use-crux/crux/packages/local/internal/output"
)

// brandedHeader renders the "◇ crux <command>" section mark, color-gated through
// io. It is the IO-aware counterpart to output.Header: with color disabled it
// returns the bare "◇ crux <command>" text (no ANSI), so the colorless invariant
// holds on a pipe, under NO_COLOR, or with --no-color.
func brandedHeader(io *output.IO, command string) string {
	return io.Sprint(output.BoldCyan, output.LogoMark+" crux "+command)
}
