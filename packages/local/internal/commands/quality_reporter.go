package commands

// Terminal reporter for `crux quality run` (spec 03 §3) plus the --json and
// --junit artifact writers (spec 03 §6, spec 02 §1).

import (
	"encoding/json"
	"encoding/xml"
	"fmt"
	"os"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/domain"
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
	quiet       bool
	verbose     bool
	evals       map[string]*qualityEvalState
	order       []string
	recordPaths []string
	hadErrors   bool
}

func newQualityReporter(opts *qualityRunOpts) *qualityReporter {
	return &qualityReporter{
		quiet:   opts.quiet,
		verbose: opts.verbose,
		evals:   map[string]*qualityEvalState{},
	}
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

func (r *qualityReporter) handle(ev *domain.QualityEvent) {
	switch ev.Type {
	case "collect:done":
		if !r.quiet {
			fmt.Fprintf(os.Stderr, "collected %d evaluation(s)\n", len(ev.Evaluations))
		}
	case "eval:start":
		if r.verbose {
			fmt.Fprintf(os.Stderr, "▶ %s (%d cells)\n", ev.EvaluationID, ev.Cells)
		}
	case "cell:done":
		if ev.Cell == nil {
			return
		}
		state := r.state(ev.EvaluationID)
		state.cells = append(state.cells, *ev.Cell)
		if r.verbose {
			fmt.Fprintf(os.Stderr, "  %s %s (trial %d) %.1fs\n",
				statusGlyph(ev.Cell.Status == "passed"), cellLabel(ev.Cell), ev.Cell.Trial+1, ev.Cell.DurationMs/1000)
		}
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
		r.printEvaluation(state)
	case "promote:done":
		fmt.Printf("  ✓ promoted %s → baseline %s (%s)\n", ev.ExperimentID, ev.BaselineID, ev.EvaluationID)
		fmt.Printf("    committed: %s\n", ev.Path)
		if ev.PinHint != "" {
			fmt.Printf("    pin the id in source: %s\n", ev.PinHint)
		}
	case "error":
		r.hadErrors = true
		location := ""
		if ev.File != "" {
			location = " (" + ev.File + ")"
		}
		fmt.Fprintf(os.Stderr, "ERROR [%s]%s: %s\n", ev.Scope, location, ev.Message)
	}
}

// printEvaluation renders the per-evaluation tree (spec 03 §3 reference
// rendering), with Δ ±SEM columns per score when a comparison exists.
func (r *qualityReporter) printEvaluation(state *qualityEvalState) {
	if state.aggregates == nil {
		return
	}
	caseCount := countDistinctCases(state.cells)
	header := fmt.Sprintf("\n  %-50s %d cases", state.evaluationID, caseCount)
	if state.filteredRun {
		header += "   gates informational (filtered run)"
	}
	fmt.Println(header)

	names := make([]string, 0, len(state.aggregates.PerVariant))
	for name := range state.aggregates.PerVariant {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		aggregate := state.aggregates.PerVariant[name]
		passedAll := aggregate.Failed == 0 && aggregate.Errored == 0
		line := fmt.Sprintf("  %s %-12s %2d/%-2d   pass %.2f%s   %.1fs",
			statusGlyph(passedAll), name, aggregate.Passed, aggregate.Cells-aggregate.Skipped,
			aggregate.PassRate, formatScores(aggregate, variantDeltas(state.comparison, name)),
			aggregate.Latency.MeanMs/1000)
		if aggregate.CostUsd > 0 {
			line += fmt.Sprintf("  $%.2f", aggregate.CostUsd)
		}
		fmt.Println(line)
	}
	printReplayNotes(state.replay)
	printComparisonNotes(state.comparison)

	if !r.quiet || hasFailures(state) {
		for i := range state.cells {
			printCellFailure(&state.cells[i], "      ")
		}
	}
	if state.gates != nil && len(state.gates.Results) > 0 {
		printGates(state.gates, state.filteredRun)
	}
}

// variantDeltas indexes a comparison's deltas for one variant by score name.
func variantDeltas(comparison *domain.QualityComparison, variantName string) map[string]string {
	if comparison == nil {
		return nil
	}
	deltas := map[string]string{}
	for _, delta := range comparison.Deltas {
		if delta.VariantName != variantName {
			continue
		}
		deltas[delta.ScoreName] = fmt.Sprintf("Δ %+.2f ±%.2f", delta.MeanDelta, delta.Sem)
	}
	return deltas
}

// printReplayNotes renders cassette provenance for non-live runs: mode,
// cassette name, the trials-collapsed note, and the staleness warning.
func printReplayNotes(replay *domain.QualityReplay) {
	if replay == nil || replay.Mode == "" || replay.Mode == "live" {
		return
	}
	line := fmt.Sprintf("      replay: %s", replay.Mode)
	if replay.Cassette != "" {
		line += fmt.Sprintf(" · cassette %s", replay.Cassette)
	}
	if replay.TrialsCollapsed {
		line += " (trials collapsed under strict replay)"
	}
	fmt.Println(line)
	if replay.StaleSince != "" {
		fmt.Printf("      ⚠ cassette recorded %s — older than 90 days, re-record with --replay refresh\n", replay.StaleSince)
	}
}

// printComparisonNotes renders baseline provenance, drift demotion, and
// unmatched-case honesty lines under the variant table.
func printComparisonNotes(comparison *domain.QualityComparison) {
	if comparison == nil {
		return
	}
	if comparison.Kind == "promoted" {
		fmt.Printf("      compared against promoted baseline %s\n", comparison.Baseline)
	}
	if comparison.Demoted != nil {
		fmt.Printf("      comparison informational: %s\n", comparison.Demoted.Reason)
	}
	if len(comparison.UnmatchedCases.BaselineOnly) > 0 || len(comparison.UnmatchedCases.CandidateOnly) > 0 {
		fmt.Printf("      unmatched cases excluded from pairing — baseline-only: %s · candidate-only: %s\n",
			joinOrDash(comparison.UnmatchedCases.BaselineOnly), joinOrDash(comparison.UnmatchedCases.CandidateOnly))
	}
}

func joinOrDash(items []string) string {
	if len(items) == 0 {
		return "—"
	}
	return strings.Join(items, ", ")
}

func (r *qualityReporter) summary(exitCode int) {
	evalCount := len(r.order)
	gateFailures := 0
	for _, id := range r.order {
		if gates := r.evals[id].gates; gates != nil {
			for _, result := range gates.Results {
				if !result.Passed && !result.Informational {
					gateFailures++
				}
			}
		}
	}
	fmt.Println("  " + strings.Repeat("─", 56))
	fmt.Printf("  %d evaluation(s) · %d gate(s) failed · exit %d\n", evalCount, gateFailures, exitCode)
}

func hasFailures(state *qualityEvalState) bool {
	for i := range state.cells {
		if state.cells[i].Status == "failed" || state.cells[i].Status == "errored" {
			return true
		}
	}
	return false
}

func printCellFailure(cell *domain.QualityCell, indent string) {
	if cell.Status != "failed" && cell.Status != "errored" {
		return
	}
	fmt.Printf("%s✗ %s (trial %d)\n", indent, cellLabel(cell), cell.Trial+1)
	for _, failure := range cell.Assertions.Failures {
		fmt.Printf("%s    %s\n", indent, failure.Message)
		if failure.ExpectedPreview != "" {
			fmt.Printf("%s      Expected: %s\n", indent, failure.ExpectedPreview)
		}
		if failure.ActualPreview != "" {
			fmt.Printf("%s      Received: %s\n", indent, failure.ActualPreview)
		}
		if failure.SourceRef != "" {
			fmt.Printf("%s      at %s\n", indent, failure.SourceRef)
		}
	}
	if cell.Assertions.NotEvaluated > 0 {
		fmt.Printf("%s    %d ran · %d not evaluated\n", indent, cell.Assertions.Ran, cell.Assertions.NotEvaluated)
	}
	if cell.Error != nil {
		fmt.Printf("%s    error (%s): %s\n", indent, cell.Error.Phase, cell.Error.Message)
		if cell.Error.MissingCassetteKey != "" {
			fmt.Printf("%s      missing cassette key: %s\n", indent, cell.Error.MissingCassetteKey)
			fmt.Printf("%s      re-record with: crux quality run %s --replay record-new\n", indent, cell.CaseID)
		}
	}
	for _, traceID := range cell.TraceIDs {
		fmt.Printf("%s    trace → http://localhost:4400/runs/%s\n", indent, traceID)
	}
}

func printGates(gates *domain.QualityGates, filtered bool) {
	label := "Gates"
	if filtered || gates.Informational {
		label = "Gates (informational — filtered run)"
	}
	fmt.Printf("\n  %s\n", label)
	for _, result := range gates.Results {
		name := result.Gate
		if result.VariantName != "" {
			name += " [" + result.VariantName + "]"
		}
		suffix := ""
		if result.Informational {
			suffix = "   (informational — no blocking baseline)"
		}
		fmt.Printf("    %s %-36s threshold %s · actual %s%s\n",
			statusGlyph(result.Passed), name, formatGateValue(result.Threshold), formatGateValue(result.Actual), suffix)
	}
}

// formatGateValue renders a gate threshold/actual: numbers rounded to two
// decimals (engine float arithmetic would otherwise leak 0.30000000000000004),
// booleans and anything else verbatim.
func formatGateValue(raw json.RawMessage) string {
	var number float64
	if err := json.Unmarshal(raw, &number); err == nil {
		return fmt.Sprintf("%.2f", number)
	}
	return string(raw)
}

func cellLabel(cell *domain.QualityCell) string {
	if cell.CaseName != "" {
		return cell.CaseName
	}
	return cell.CaseID
}

func statusGlyph(passed bool) string {
	if passed {
		return "✓"
	}
	return "✗"
}

func formatScores(aggregate domain.QualityVariantAggregate, deltas map[string]string) string {
	names := make([]string, 0, len(aggregate.Scores))
	for name := range aggregate.Scores {
		if name == "pass" {
			continue
		}
		names = append(names, name)
	}
	sort.Strings(names)
	var builder strings.Builder
	for _, name := range names {
		score := aggregate.Scores[name]
		builder.WriteString(fmt.Sprintf("   %s %.2f ±%.2f", name, score.Mean, score.Sem))
		if delta, ok := deltas[name]; ok {
			builder.WriteString("  " + delta)
		}
	}
	return builder.String()
}

func countDistinctCases(cells []domain.QualityCell) int {
	seen := map[string]bool{}
	for i := range cells {
		seen[cells[i].CaseID] = true
	}
	return len(seen)
}

// --- --json: the persisted Experiment records (spec 02 §1) ---

func writeQualityRecords(pathOrDash string, recordPaths []string) error {
	records := make([]json.RawMessage, 0, len(recordPaths))
	for _, recordPath := range recordPaths {
		data, err := os.ReadFile(recordPath)
		if err != nil {
			return fmt.Errorf("failed to read record %s: %w", recordPath, err)
		}
		records = append(records, json.RawMessage(data))
	}
	out, err := json.MarshalIndent(records, "", "  ")
	if err != nil {
		return err
	}
	if pathOrDash == "-" || pathOrDash == "" {
		fmt.Println(string(out))
		return nil
	}
	return os.WriteFile(pathOrDash, append(out, '\n'), 0o644)
}

// --- --junit (spec 03 §6) ---

type junitTestsuites struct {
	XMLName xml.Name         `xml:"testsuites"`
	Suites  []junitTestsuite `xml:"testsuite"`
}

type junitTestsuite struct {
	Name       string          `xml:"name,attr"`
	Tests      int             `xml:"tests,attr"`
	Failures   int             `xml:"failures,attr"`
	Errors     int             `xml:"errors,attr"`
	Skipped    int             `xml:"skipped,attr"`
	Time       float64         `xml:"time,attr"`
	Properties []junitProperty `xml:"properties>property"`
	Cases      []junitTestcase `xml:"testcase"`
}

type junitProperty struct {
	Name  string `xml:"name,attr"`
	Value string `xml:"value,attr"`
}

type junitTestcase struct {
	Name    string        `xml:"name,attr"`
	Time    float64       `xml:"time,attr"`
	Failure *junitMessage `xml:"failure,omitempty"`
	Error   *junitMessage `xml:"error,omitempty"`
	Skipped *junitMessage `xml:"skipped,omitempty"`
}

type junitMessage struct {
	Message string `xml:"message,attr"`
	Body    string `xml:",chardata"`
}

// writeQualityJUnit maps the run to JUnit XML: one <testsuite> per
// (evaluationId, variantName), one <testcase> per case with trials
// aggregated; gate failures append a synthetic "gates" testcase.
func writeQualityJUnit(path string, reporter *qualityReporter) error {
	var suites junitTestsuites
	for _, evaluationID := range reporter.order {
		state := reporter.evals[evaluationID]
		byVariant := map[string][]domain.QualityCell{}
		for _, cell := range state.cells {
			byVariant[cell.VariantName] = append(byVariant[cell.VariantName], cell)
		}
		variantNames := make([]string, 0, len(byVariant))
		for name := range byVariant {
			variantNames = append(variantNames, name)
		}
		sort.Strings(variantNames)

		for _, variantName := range variantNames {
			suite := junitTestsuite{Name: evaluationID + "." + variantName}
			suite.Properties = append(suite.Properties, junitProperty{Name: "experimentId", Value: state.experimentID})
			if state.configFingerprint != "" {
				suite.Properties = append(suite.Properties, junitProperty{Name: "configFingerprint", Value: state.configFingerprint})
			}
			if state.aggregates != nil {
				if aggregate, ok := state.aggregates.PerVariant[variantName]; ok {
					for scoreName, score := range aggregate.Scores {
						suite.Properties = append(suite.Properties, junitProperty{
							Name:  "score." + scoreName,
							Value: fmt.Sprintf("%.4f", score.Mean),
						})
					}
				}
			}
			sort.Slice(suite.Properties, func(i, j int) bool { return suite.Properties[i].Name < suite.Properties[j].Name })

			for _, group := range groupCellsByCase(byVariant[variantName]) {
				testcase := junitTestcase{Name: caseGroupName(group), Time: meanDurationSeconds(group)}
				if cell := firstWithStatus(group, "errored"); cell != nil {
					testcase.Error = &junitMessage{Message: cell.Error.Message}
				} else if cell := firstWithStatus(group, "failed"); cell != nil {
					if len(cell.Assertions.Failures) > 0 {
						failure := cell.Assertions.Failures[0]
						body := failure.Message
						if failure.SourceRef != "" {
							body += "\nat " + failure.SourceRef
						}
						testcase.Failure = &junitMessage{Message: failure.Matcher, Body: body}
					} else {
						testcase.Failure = &junitMessage{Message: "failed"}
					}
				} else if cell := firstWithStatus(group, "skipped"); cell != nil && len(group) == 1 {
					testcase.Skipped = &junitMessage{Message: cell.SkipReason}
				}
				suite.Tests++
				if testcase.Failure != nil {
					suite.Failures++
				}
				if testcase.Error != nil {
					suite.Errors++
				}
				if testcase.Skipped != nil {
					suite.Skipped++
				}
				suite.Time += testcase.Time
				suite.Cases = append(suite.Cases, testcase)
			}

			if state.gates != nil && !state.gates.Informational {
				gatesCase := junitTestcase{Name: "gates"}
				if !state.gates.Passed {
					var failed []string
					for _, result := range state.gates.Results {
						if !result.Passed && !result.Informational {
							failed = append(failed, result.Gate)
						}
					}
					gatesCase.Failure = &junitMessage{Message: "gate failure", Body: strings.Join(failed, ", ")}
					suite.Failures++
				}
				suite.Tests++
				suite.Cases = append(suite.Cases, gatesCase)
			}
			suites.Suites = append(suites.Suites, suite)
		}
	}

	out, err := xml.MarshalIndent(suites, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append([]byte(xml.Header), append(out, '\n')...), 0o644)
}

func groupCellsByCase(cells []domain.QualityCell) [][]domain.QualityCell {
	order := []string{}
	groups := map[string][]domain.QualityCell{}
	for _, cell := range cells {
		if _, ok := groups[cell.CaseID]; !ok {
			order = append(order, cell.CaseID)
		}
		groups[cell.CaseID] = append(groups[cell.CaseID], cell)
	}
	result := make([][]domain.QualityCell, 0, len(order))
	for _, caseID := range order {
		result = append(result, groups[caseID])
	}
	return result
}

func caseGroupName(group []domain.QualityCell) string {
	if group[0].CaseName != "" {
		return group[0].CaseName
	}
	return group[0].CaseID
}

func meanDurationSeconds(group []domain.QualityCell) float64 {
	if len(group) == 0 {
		return 0
	}
	total := 0.0
	for _, cell := range group {
		total += cell.DurationMs
	}
	return total / float64(len(group)) / 1000
}

func firstWithStatus(group []domain.QualityCell, status string) *domain.QualityCell {
	for i := range group {
		if group[i].Status == status {
			return &group[i]
		}
	}
	return nil
}
