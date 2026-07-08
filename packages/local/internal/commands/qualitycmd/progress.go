package qualitycmd

// During-run progress strategies for `crux quality run` (spec 02 §3). A run must
// never look hung (clig.dev R3), but the right feedback differs by destination:
// an interactive terminal wants a single, animated, in-place status line; a pipe
// or CI log wants timestamp-friendly plain lines and zero carriage returns.
//
// runProgress isolates that *transient* feedback from the reporter's *durable*
// output (per-evaluation tables + the summary banner, in quality_render.go /
// quality_reporter.go). The reporter owns state and final rendering and simply
// delegates "work is happening" to whichever strategy was selected; it calls
// clear() before any durable output so a completed evaluation scrolls cleanly
// above the live line.

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/commandui"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// runProgress renders transient progress for a quality run. Two implementations
// back it — [liveProgress] (in-place status line on a TTY) and [plainProgress]
// (line-per-event, CI- and pipe-safe) — selected by [useLiveProgress]. Every
// method is safe to call in any order and any number of times; clear() is
// idempotent so the reporter can tear the line down at each durable-output point.
type runProgress interface {
	// start paints initial feedback so the tool shows life within ~100ms of
	// launch, before the first evaluation is even discovered (R3).
	start()
	// collected reports how many evaluations the worker discovered (collect:done).
	collected(count int)
	// evalStart begins tracking one evaluation and its total cell count (eval:start).
	evalStart(evaluationID string, cells int)
	// cellStart advances feedback when a cell begins executing (cell:start).
	cellStart(evaluationID string)
	// cellDone advances feedback when a cell finishes, tallying its outcome (cell:done).
	cellDone(cell *domain.QualityCell)
	// clear tears down any transient line so durable output can print above it.
	// It is a no-op for the plain strategy and idempotent for the live one.
	clear()
}

type silentProgress struct{}

func (silentProgress) start()                       {}
func (silentProgress) collected(int)                {}
func (silentProgress) evalStart(string, int)        {}
func (silentProgress) cellStart(string)             {}
func (silentProgress) cellDone(*domain.QualityCell) {}
func (silentProgress) clear()                       {}

// useLiveProgress decides whether a run gets the animated live reporter. It is
// the binding selection rule from spec 02 §3: animate only on an interactive
// stderr that is not under an explicit `--ci` override, not in a detected CI
// environment, and not silenced by `--quiet`. Any of those falls back to plain.
func useLiveProgress(io *output.IO, opts *qualityRunOpts) bool {
	return io.IsStderrTTY() && !opts.ci && !io.IsCI() && !opts.quiet
}

// ── Plain strategy (CI / pipes / --quiet) ─────────────────────────

// plainProgress emits one line per milestone to stderr with no carriage returns,
// so piped output and CI logs stay clean and timestamp-friendly. It announces
// each evaluation as it starts (R3 — visible progress in logs) and, under
// --verbose, prints a per-cell result line. --quiet suppresses the progress
// chatter, leaving only failures and the summary banner.
type plainProgress struct {
	io      *output.IO
	quiet   bool
	verbose bool
}

func newPlainProgress(io *output.IO, opts *qualityRunOpts) *plainProgress {
	return &plainProgress{io: io, quiet: opts.quiet, verbose: opts.verbose}
}

func (p *plainProgress) start() {}

func (p *plainProgress) collected(count int) {
	if p.quiet {
		return
	}
	fmt.Fprintf(p.io.Err, "collected %d evaluation(s)\n", count)
}

func (p *plainProgress) evalStart(evaluationID string, cells int) {
	if p.quiet {
		return
	}
	fmt.Fprintf(p.io.Err, "▶ %s (%d cells)\n", evaluationID, cells)
}

func (p *plainProgress) cellStart(string) {}

func (p *plainProgress) cellDone(cell *domain.QualityCell) {
	if !p.verbose {
		return
	}
	fmt.Fprintf(p.io.Err, "  %s %s %s\n",
		p.io.Status(boolStatusKey(cell.Status == "passed")),
		cellLabel(cell),
		p.io.Sprint(output.Dim, fmt.Sprintf("(trial %d) %.1fs", cell.Trial+1, cell.DurationMs/1000)))
}

func (p *plainProgress) clear() {}

// ── Live strategy (interactive TTY) ───────────────────────────────

// liveProgress maintains a single rewritable status line on stderr (spec 01 §3),
// updated in place as cells start and finish: a spinner, the current
// evaluation's done/total counter, colored pass/fail tallies, and elapsed wall-
// clock. It holds only the *current* evaluation's running counts; completed
// evaluations are rendered durably by the reporter after clear().
type liveProgress struct {
	io   *output.IO
	line *output.StatusLine
	// elapsedSeconds reports seconds since the run started, shared with the
	// reporter's clock so the live line and the summary banner agree.
	elapsedSeconds func() float64

	frame int

	evaluationID string
	total        int
	done         int
	passed       int
	failed       int
}

func newLiveProgress(io *output.IO, elapsedSeconds func() float64) *liveProgress {
	return &liveProgress{io: io, line: io.NewStatusLine(), elapsedSeconds: elapsedSeconds}
}

func (l *liveProgress) start() { l.message("starting…") }

func (l *liveProgress) collected(count int) {
	l.message(fmt.Sprintf("collected %d evaluation(s)", count))
}

func (l *liveProgress) evalStart(evaluationID string, cells int) {
	l.evaluationID, l.total, l.done, l.passed, l.failed = evaluationID, cells, 0, 0, 0
	l.repaint()
}

func (l *liveProgress) cellStart(string) { l.repaint() }

func (l *liveProgress) cellDone(cell *domain.QualityCell) {
	l.done++
	switch cell.Status {
	case "passed":
		l.passed++
	case "failed", "errored":
		l.failed++
	}
	l.repaint()
}

func (l *liveProgress) clear() { l.line.Clear() }

// spinner returns the next spinner frame, advancing the cycle. It is the only
// place l.frame is mutated, keeping motion deterministic per event.
func (l *liveProgress) spinner() string {
	frames := []rune(commandui.SpinnerFrames)
	glyph := string(frames[l.frame%len(frames)])
	l.frame++
	return l.io.Sprint(output.Accent, glyph)
}

// message paints a spinner-led status with no per-evaluation counts, for the
// pre-evaluation phases (start, collect).
func (l *liveProgress) message(text string) {
	l.line.Set(l.spinner() + " " + text)
}

// repaint redraws the in-place line for the current evaluation: spinner, id,
// done/total counter, green✓/red✗ tallies, and dim elapsed. StatusLine.Set
// truncates to terminal width so a long id never wraps and corrupts the redraw.
func (l *liveProgress) repaint() {
	tally := l.io.Sprint(output.Green, fmt.Sprintf("%d✓", l.passed)) +
		" " + l.io.Sprint(output.Red, fmt.Sprintf("%d✗", l.failed))
	l.line.Set(fmt.Sprintf("%s %s   %d/%d cells · %s · %s",
		l.spinner(),
		l.evaluationID,
		l.done, l.total,
		tally,
		l.io.Sprint(output.Dim, fmt.Sprintf("%.1fs", l.elapsedSeconds()))))
}
