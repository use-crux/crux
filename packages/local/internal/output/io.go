package output

import (
	"bytes"
	"io"
	"os"

	"charm.land/lipgloss/v2"
	"github.com/charmbracelet/colorprofile"
	xterm "github.com/charmbracelet/x/term"
	"github.com/mattn/go-isatty"
)

// IO centralizes terminal-capability detection and styled-output decisions for
// the CLI. It is the single source of truth for "is this a TTY?", "is color
// enabled?", and "how wide is the terminal?" — commands ask it instead of
// re-detecting, so the answers stay consistent across every reporter.
//
// Modeled on the GitHub CLI's iostreams package: one value is constructed in
// main (via [NewIO]) and threaded through the command factory. Tests construct
// a deterministic instance with [NewTestIO] that skips all env/TTY probing.
//
// Color discipline is deliberate: when [IO.ColorEnabled] is false, every
// styling path routed through [IO.Sprint] (or the IO-aware helpers built on it)
// emits zero ANSI bytes, so `--no-color`, `NO_COLOR`, a non-TTY pipe, and
// `TERM=dumb` all yield byte-clean plain text.
type IO struct {
	// In is the interactive input stream (default os.Stdin). Bubble Tea and
	// commands that prompt the user read from this injected boundary.
	In io.Reader
	// Out is the primary, machine-readable stream (default os.Stdout). Results
	// and `--json` records go here so `| jq` and `> file` stay clean.
	Out io.Writer
	// Err is the diagnostic stream (default os.Stderr). Logs, progress, status
	// lines, and errors go here so they never pollute piped Out.
	Err io.Writer

	colorEnabled bool
	colorProfile colorprofile.Profile
	stdinTTY     bool
	stdoutTTY    bool
	stderrTTY    bool
	ci           bool
	term         string

	// fixedWidth, when > 0, pins Width() to a constant (test IO). When 0, Width
	// queries outFile live so terminal resizes are reflected.
	fixedWidth int
	// outFile is the *os.File backing Out when one exists, used for live width
	// queries. It is nil for buffer-backed (test) streams.
	outFile *os.File
}

// NewIO builds an IO from the real process streams (os.Stdout/os.Stderr) and the
// surrounding environment. noColor mirrors the root `--no-color` flag and, when
// true, forces [IO.ColorEnabled] to false regardless of TTY state.
//
// Detection follows clig.dev: color is enabled only on a capable TTY that has
// not opted out via NO_COLOR/TERM=dumb, unless explicitly forced via
// CLICOLOR_FORCE or CRUX_FORCE_TTY. See the detection helpers below.
func NewIO(noColor bool) *IO {
	stdinFileTTY := isFileTTY(os.Stdin)
	stdoutFileTTY := isFileTTY(os.Stdout)
	stderrFileTTY := isFileTTY(os.Stderr)
	force := forceTTY()
	return &IO{
		In:           os.Stdin,
		Out:          os.Stdout,
		Err:          os.Stderr,
		colorEnabled: colorEnabledFor(noColor, stdoutFileTTY || stderrFileTTY),
		colorProfile: colorprofile.Detect(os.Stdout, os.Environ()),
		stdinTTY:     stdinFileTTY || force,
		stdoutTTY:    stdoutFileTTY || force,
		stderrTTY:    stderrFileTTY || force,
		ci:           detectCI(),
		term:         os.Getenv("TERM"),
		outFile:      os.Stdout,
	}
}

// TestIOOptions declares the terminal capabilities a [NewTestIO] instance should
// report. Every field is explicit so tests are deterministic and never depend on
// the host's real TTY or environment.
type TestIOOptions struct {
	In           io.Reader
	StdinTTY     bool
	StdoutTTY    bool
	StderrTTY    bool
	ColorEnabled bool
	ColorProfile colorprofile.Profile
	CI           bool
	Term         string
	// Width is the reported terminal width. Zero defaults to 80. The value is
	// still clamped to [40, 200] by Width().
	Width int
}

// NewTestIO builds an IO over the supplied buffers with capabilities taken
// verbatim from opts — no environment or TTY probing. Use it to pin reporter
// output in tests (e.g. assert the colorless invariant or a status-line redraw).
func NewTestIO(out, err io.Writer, opts TestIOOptions) *IO {
	input := opts.In
	if input == nil {
		input = bytes.NewReader(nil)
	}
	width := opts.Width
	if width == 0 {
		width = 80
	}
	return &IO{
		In:           input,
		Out:          out,
		Err:          err,
		colorEnabled: opts.ColorEnabled,
		colorProfile: testColorProfile(opts.ColorProfile),
		stdinTTY:     opts.StdinTTY,
		stdoutTTY:    opts.StdoutTTY,
		stderrTTY:    opts.StderrTTY,
		ci:           opts.CI,
		term:         opts.Term,
		fixedWidth:   width,
	}
}

// IsStdinTTY reports whether the interactive input stream is a terminal (or a
// force override is set). Bubble Tea requires terminal input before it may own
// the process UI.
func (io *IO) IsStdinTTY() bool { return io.stdinTTY }

// IsStdoutTTY reports whether the primary stream is an interactive terminal (or
// a force override is set). Drives whether stdout-bound hyperlinks are emitted.
func (io *IO) IsStdoutTTY() bool { return io.stdoutTTY }

// IsStderrTTY reports whether the diagnostic stream is an interactive terminal
// (or a force override is set). Drives whether live status lines animate.
func (io *IO) IsStderrTTY() bool { return io.stderrTTY }

// ColorEnabled reports whether styled output should emit ANSI color. When false,
// every helper routed through [IO.Sprint] must return raw, unstyled text.
func (io *IO) ColorEnabled() bool { return io.colorEnabled }

// IsCI reports whether the process appears to run under a recognized CI system.
// Reporters use it to prefer plain, non-animated output even on a pseudo-TTY.
func (io *IO) IsCI() bool { return io.ci }

// Terminal returns the TERM value captured when this IO boundary was created.
// Capturing it once keeps mode selection deterministic for the command run.
func (io *IO) Terminal() string { return io.term }

// Width returns the terminal column count of the Out stream, clamped to
// [40, 200]. It falls back to 80 for a non-TTY stream or on query error.
func (io *IO) Width() int {
	if io.fixedWidth > 0 {
		return clampWidth(io.fixedWidth)
	}
	if io.outFile != nil {
		if w, _, err := xterm.GetSize(io.outFile.Fd()); err == nil && w > 0 {
			return clampWidth(w)
		}
	}
	return 80
}

// Sprint applies a lipgloss style only when color is enabled; otherwise it
// returns s unchanged. All command rendering must funnel styling through this
// (or IO-aware helpers built on it) rather than calling style.Render directly,
// so `--no-color`, a non-TTY, and NO_COLOR all produce byte-clean plain text.
func (io *IO) Sprint(style lipgloss.Style, s string) string {
	if !io.colorEnabled {
		return s
	}
	rendered := style.Render(s)
	var buf bytes.Buffer
	writer := &colorprofile.Writer{Forward: &buf, Profile: io.colorProfile}
	_, _ = writer.WriteString(rendered)
	return buf.String()
}

// WithColorDisabled returns a shallow copy of io with color forced off, keeping
// the same streams, TTY status, CI flag, and width. It lets a single command
// (e.g. a CI-oriented command) render byte-clean plain output even on a color-
// capable TTY, without mutating the shared factory IO or any global env state.
func (io *IO) WithColorDisabled() *IO {
	clone := *io
	clone.colorEnabled = false
	return &clone
}

func testColorProfile(profile colorprofile.Profile) colorprofile.Profile {
	if profile == colorprofile.Unknown {
		return colorprofile.TrueColor
	}
	return profile
}

// Status renders the status glyph for key (✓/✗/●/⊘/…), colored only when color
// is enabled. It is the color-gated counterpart to the package-level [Status]:
// with color off it returns the bare glyph, so the same codepoint appears in
// plain and rich output and the colorless invariant holds. Map domain statuses
// to keys at the call site (e.g. passed→"success", failed/errored→"error",
// skipped→"cancelled").
func (io *IO) Status(key string) string {
	return io.Sprint(statusStyle(key), statusGlyph(key))
}

// ── Detection helpers (pure where testable) ───────────────────────

// colorEnabledFor resolves the clig.dev color rule. Color is enabled iff the
// user has not opted out (noColor flag, NO_COLOR env, TERM=dumb) AND either the
// stream is a real TTY or a force override (CLICOLOR_FORCE!=0, CRUX_FORCE_TTY)
// is set. The opt-outs take precedence over the force overrides.
//
// streamTTY is the raw, pre-force TTY status so this function alone owns the
// force semantics and stays unit-testable without a real terminal.
func colorEnabledFor(noColor, streamTTY bool) bool {
	if noColor || os.Getenv("NO_COLOR") != "" || os.Getenv("TERM") == "dumb" {
		return false
	}
	return streamTTY || forceTTY()
}

// forceTTY reports whether a TTY/color force override is set: CLICOLOR_FORCE to
// any non-"0" value, or CRUX_FORCE_TTY to any non-empty value (mirrors gh's
// GH_FORCE_TTY). Used to drive both color and IsStdout/StderrTTY in tests/CI.
func forceTTY() bool {
	if v := os.Getenv("CLICOLOR_FORCE"); v != "" && v != "0" {
		return true
	}
	return os.Getenv("CRUX_FORCE_TTY") != ""
}

// detectCI reports whether a recognized CI environment variable is set to a
// meaningful (non-empty, non-"false") value.
func detectCI() bool {
	for _, key := range []string{
		"CI", "GITHUB_ACTIONS", "BUILDKITE", "GITLAB_CI", "CIRCLECI", "TEAMCITY_VERSION",
	} {
		if v := os.Getenv(key); v != "" && v != "false" {
			return true
		}
	}
	return false
}

// isFileTTY reports whether w is an *os.File that the OS considers a terminal
// (including Cygwin/MSYS pseudo-terminals on Windows). Buffer writers are never
// TTYs, which is what keeps test output deterministic.
func isFileTTY(stream any) bool {
	f, ok := stream.(*os.File)
	if !ok {
		return false
	}
	fd := f.Fd()
	return isatty.IsTerminal(fd) || isatty.IsCygwinTerminal(fd)
}

// clampWidth bounds a terminal width to a sane render range. Below 40 the
// summary banner and tables stop being legible; above 200 padding is wasteful.
func clampWidth(w int) int {
	switch {
	case w < 40:
		return 40
	case w > 200:
		return 200
	default:
		return w
	}
}
