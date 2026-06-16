package output

import (
	"fmt"

	"github.com/charmbracelet/x/ansi"
)

// eraseLine returns the cursor to column 0 and clears to end of line. Combined
// with text-without-newline this overwrites the current line in place, which
// composes with normal scrollback (unlike a full-screen bubbletea program).
const eraseLine = "\r\x1b[K"

// StatusLine is a single, rewritable progress line on the IO's Err (stderr)
// stream. It is intentionally not a bubbletea program: it owns exactly one line
// — the current one — and updates it with carriage-return + erase-to-EOL, so it
// interleaves cleanly with ordinary log output and survives terminal scrollback.
//
// On a non-TTY stderr every method is a no-op and [StatusLine.Active] is false;
// callers must check Active and emit plain, non-animated log lines instead (see
// spec 02 §3) so piped and CI output never accumulates carriage returns.
type StatusLine struct {
	io     *IO
	active bool
}

// NewStatusLine creates a status line bound to this IO's Err stream. It is
// active only when Err is a TTY; otherwise it is an inert no-op the caller can
// still call freely.
func (io *IO) NewStatusLine() *StatusLine {
	return &StatusLine{io: io, active: io.stderrTTY}
}

// Active reports whether the status line will actually render. It is true only
// when the IO's Err stream is a terminal. Callers branch on this to choose
// between in-place animation and plain log lines.
func (s *StatusLine) Active() bool { return s.active }

// Set redraws the line in place with text (no trailing newline). text is
// truncated to Width()-1 display columns (ANSI- and wide-character-aware) so a
// long line can never wrap and corrupt the in-place update. No-op when inactive.
func (s *StatusLine) Set(text string) {
	if !s.active {
		return
	}
	if max := s.io.Width() - 1; max > 0 {
		text = ansi.Truncate(text, max, "")
	}
	fmt.Fprint(s.io.Err, eraseLine+text)
}

// Clear erases the line and leaves the cursor at column 0 (no newline), ready
// for the caller to print final output above it. No-op when inactive.
func (s *StatusLine) Clear() {
	if !s.active {
		return
	}
	fmt.Fprint(s.io.Err, eraseLine)
}
