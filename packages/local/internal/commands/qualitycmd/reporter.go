package qualitycmd

// Terminal reporter for `crux quality run` (spec 02 §1, §2). The reporter owns
// run state accumulated from the NDJSON event stream and the summary banner;
// the per-evaluation rendering lives in qualityRenderer (quality_render.go), the
// --json/--junit artifact writers in quality_records.go / quality_junit.go.

import (
	"fmt"
	"strings"
	"time"

	"charm.land/lipgloss/v2"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
)

type qualityEvalState struct {
	evaluationID      string
	experimentID      string
	configFingerprint string
	cells             []domain.QualityCell
	aggregates        *domain.QualityAggregates
	gates             *domain.QualityGates
	filteredRun       bool
	replay            *domain.QualityReplay
	comparison        *domain.QualityComparison
	baselineRef       *domain.QualityBaselineRef
}

type qualityReporter struct {
	io       *output.IO
	render   *qualityRenderer
	progress runProgress
	quiet    bool
	verbose  bool

	evals       map[string]*qualityEvalState
	order       []string
	recordPaths []string
	hadErrors   bool

	// startedAt anchors the banner's wall-clock duration; nowFn is the clock
	// (overridable in tests for a deterministic elapsed).
	startedAt time.Time
	nowFn     func() time.Time
}

// newQualityReporter builds a reporter bound to an output.IO (color/stream/width
// decisions) and the devtools port (clickable trace links). It selects the
// during-run progress strategy here — the constructor the run driver already
// calls — so the first paint lands within ~100ms of launch (spec 02 §3, R3).
//
// `--ci` (opts.ci) forces the plain strategy *and* color off for the whole run,
// even on a color-capable TTY: an explicit override for piping to a file while
// attached to a terminal. The monotonic start is captured here so the live line
// and the summary banner share one clock.
func newQualityReporter(opts *qualityRunOpts, io *output.IO, port int) *qualityReporter {
	if opts.ci {
		io = io.WithColorDisabled()
	}
	r := &qualityReporter{
		io:        io,
		render:    newQualityRenderer(io, port),
		quiet:     opts.quiet,
		verbose:   opts.verbose,
		evals:     map[string]*qualityEvalState{},
		startedAt: time.Now(),
		nowFn:     time.Now,
	}
	if useLiveProgress(io, opts) {
		r.progress = newLiveProgress(io, r.elapsedSeconds)
	} else {
		r.progress = newPlainProgress(io, opts)
	}
	r.progress.start()
	return r
}

// elapsedSeconds returns the run's wall-clock so far. It is the single clock the
// live status line and the summary banner both read, so their durations agree.
func (r *qualityReporter) elapsedSeconds() float64 {
	return r.nowFn().Sub(r.startedAt).Seconds()
}

func (r *qualityReporter) state(evaluationID string) *qualityEvalState {
	state, ok := r.evals[evaluationID]
	if !ok {
		state = &qualityEvalState{evaluationID: evaluationID}
		r.evals[evaluationID] = state
		r.order = append(r.order, evaluationID)
	}
	return state
}

// handle dispatches one NDJSON event. It owns durable state and final rendering;
// transient "work is happening" feedback is delegated to the selected progress
// strategy (r.progress), and the live line is cleared before any durable output
// so completed evaluations scroll cleanly above it. Stream discipline (spec 02
// §1): diagnostics and progress to stderr, results (eval tables, promote) to
// stdout.
func (r *qualityReporter) handle(ev *domain.QualityEvent) {
	switch ev.Type {
	case "collect:done":
		r.progress.collected(len(ev.Evaluations))
	case "eval:start":
		r.progress.evalStart(ev.EvaluationID, ev.Cells)
	case "cell:start":
		r.progress.cellStart(ev.EvaluationID)
	case "cell:done":
		if ev.Cell == nil {
			return
		}
		state := r.state(ev.EvaluationID)
		state.cells = append(state.cells, *ev.Cell)
		r.progress.cellDone(ev.Cell)
	case "eval:done":
		state := r.state(ev.EvaluationID)
		state.experimentID = ev.ExperimentID
		state.configFingerprint = ev.ConfigFingerprint
		state.aggregates = ev.Aggregates
		state.gates = ev.Gates
		state.filteredRun = ev.FilteredRun
		state.replay = ev.Replay
		state.comparison = ev.Comparison
		state.baselineRef = ev.BaselineRef
		if ev.RecordPath != "" {
			r.recordPaths = append(r.recordPaths, ev.RecordPath)
		}
		r.progress.clear()
		r.render.evaluation(state, r.quiet)
	case "promote:done":
		r.progress.clear()
		out := r.io.Out
		fmt.Fprintf(out, "  %s promoted %s → baseline %s (%s)\n",
			r.io.Status("success"), ev.ExperimentID, ev.BaselineID, ev.EvaluationID)
		fmt.Fprintf(out, "    %s\n", r.io.Sprint(output.Dim, "committed: "+ev.Path))
		if ev.PinHint != "" {
			fmt.Fprintf(out, "    %s\n", r.io.Sprint(output.Dim, "pin the id in source: "+ev.PinHint))
		}
	case "error":
		r.hadErrors = true
		r.progress.clear()
		location := ""
		if ev.File != "" {
			location = " (" + ev.File + ")"
		}
		fmt.Fprintf(r.io.Err, "%s\n",
			r.io.Sprint(output.Red, fmt.Sprintf("ERROR [%s]%s: %s", ev.Scope, location, ev.Message)))
	case "run:done":
		r.progress.clear()
	}
}

// banner renders the jest/playwright-style run summary (spec 02 §2): a width-
// sized divider, a status token (PASS/FAIL/ERROR) colored by exit code with the
// cell tallies summed across every evaluation, and the evaluation count, gate
// failures, wall-clock, and exit code. With color off it emits the same text
// with no escape bytes.
func (r *qualityReporter) banner(exitCode int) {
	r.progress.clear() // idempotent: ensure no live line lingers under the banner
	out := r.io.Out

	var passed, failed, errored, skipped, gateFailures int
	for _, id := range r.order {
		state := r.evals[id]
		if state.aggregates != nil {
			for _, agg := range state.aggregates.PerVariant {
				passed += agg.Passed
				failed += agg.Failed
				errored += agg.Errored
				skipped += agg.Skipped
			}
		}
		if state.gates != nil {
			for _, result := range state.gates.Results {
				if !result.Passed && !result.Informational {
					gateFailures++
				}
			}
		}
	}

	width := r.io.Width()
	if width > bannerWidthCap {
		width = bannerWidthCap
	}
	fmt.Fprintln(out, "  "+r.io.Sprint(output.Divider, strings.Repeat("─", width)))

	token, style := bannerToken(exitCode)
	fmt.Fprintf(out, "  %s  %s   %d passed · %d failed · %d errored · %d skipped\n",
		r.io.Status(boolStatusKey(exitCode == 0)),
		r.io.Sprint(style, token),
		passed, failed, errored, skipped)

	elapsedMs := float64(r.nowFn().Sub(r.startedAt).Milliseconds())
	fmt.Fprintf(out, "            %s\n", r.io.Sprint(output.Dim, fmt.Sprintf(
		"%d evaluations · %d gates failed · %s · exit %d",
		len(r.order), gateFailures, output.FormatDuration(elapsedMs), exitCode)))
}

// bannerWidthCap bounds the summary divider so it never spans an ultra-wide
// terminal; matches the pre-rework fixed rule length.
const bannerWidthCap = 56

// bannerToken maps an exit code to the banner's status word and its style:
// 0→PASS (green), 1→FAIL (red), anything else→ERROR (red). All bold.
func bannerToken(exitCode int) (string, lipgloss.Style) {
	switch exitCode {
	case 0:
		return "PASS", output.Green.Bold(true)
	case 1:
		return "FAIL", output.Red.Bold(true)
	default:
		return "ERROR", output.Red.Bold(true)
	}
}
