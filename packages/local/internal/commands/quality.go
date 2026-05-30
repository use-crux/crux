package commands

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

func NewQualityCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool
	var exportOut string
	var exportCaseID string
	var exportSuiteID string
	var exportTag string
	var includeActual bool
	var comparisonID string
	var baselineRef string
	var candidateRef string
	var baselineLabel string
	var candidateLabel string
	var promoteAs string
	var promoteLabel string

	var seedDir string
	var seedDemo bool
	cmd := &cobra.Command{
		Use:   "quality [overview|runs|suites|insights|experiments|comparisons|baselines|feedback|memory-proposals|cassettes|compare|promote|export-trace|export-feedback|seed]",
		Short: "List local quality workbench records",
		Args:  cobra.ArbitraryArgs,
		RunE: func(cmd *cobra.Command, args []string) error {
			section := "overview"
			if len(args) > 0 {
				section = args[0]
			}
			switch section {
			case "seed":
				if !seedDemo {
					return fmt.Errorf("usage: crux quality seed --demo")
				}
				return runQualitySeed(seedDir)
			case "overview":
				return showQualityOverview(cmd.Context(), f.Client(), jsonOutput)
			case "runs":
				return listQualityRuns(cmd.Context(), f.Client(), jsonOutput)
			case "suites":
				return listQualitySuites(cmd.Context(), f.Client(), jsonOutput)
			case "insights":
				return listQualityInsights(cmd.Context(), f.Client(), jsonOutput)
			case "experiments":
				return listQualityExperiments(cmd.Context(), f.Client(), jsonOutput)
			case "comparisons":
				return listQualityComparisons(cmd.Context(), f.Client(), jsonOutput)
			case "baselines":
				return listQualityBaselines(cmd.Context(), f.Client(), jsonOutput)
			case "feedback":
				return listQualityFeedback(cmd.Context(), f.Client(), jsonOutput)
			case "memory-proposals":
				return listQualityMemoryProposals(cmd.Context(), f.Client(), jsonOutput)
			case "cassettes":
				return listQualityCassettes(cmd.Context(), f.Client(), jsonOutput)
			case "compare":
				return createQualityComparison(cmd.Context(), f.Client(), qualityCompareOptions{
					id:             comparisonID,
					baseline:       baselineRef,
					candidate:      candidateRef,
					baselineLabel:  baselineLabel,
					candidateLabel: candidateLabel,
					jsonOut:        jsonOutput,
				})
			case "promote":
				if len(args) != 2 {
					return fmt.Errorf("usage: crux quality promote <experiment[:variant]> --as <baseline-id>")
				}
				return promoteQualityBaseline(cmd.Context(), f.Client(), qualityPromoteOptions{
					ref:     args[1],
					as:      promoteAs,
					label:   promoteLabel,
					jsonOut: jsonOutput,
				})
			case "export-trace":
				if len(args) != 2 {
					return fmt.Errorf("usage: crux quality export-trace <trace-id> --out <path>")
				}
				return exportTraceSuiteCase(cmd.Context(), f.Client(), exportTraceOptions{
					traceID:       args[1],
					out:           exportOut,
					caseID:        exportCaseID,
					suiteID:       exportSuiteID,
					tag:           exportTag,
					includeActual: includeActual,
				})
			case "export-feedback":
				if len(args) != 2 {
					return fmt.Errorf("usage: crux quality export-feedback <feedback-id> --out <path>")
				}
				return exportFeedbackSuiteCase(cmd.Context(), f.Client(), exportTraceOptions{
					traceID:       args[1],
					out:           exportOut,
					caseID:        exportCaseID,
					suiteID:       exportSuiteID,
					tag:           exportTag,
					includeActual: includeActual,
				})
			default:
				return fmt.Errorf("unknown quality section %q; use overview, runs, suites, insights, experiments, comparisons, baselines, feedback, memory-proposals, cassettes, compare, promote, export-trace, or export-feedback", section)
			}
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	cmd.Flags().StringVar(&exportOut, "out", "", "Output suite JSON path for export commands")
	cmd.Flags().StringVar(&exportCaseID, "case-id", "", "Case id for export commands")
	cmd.Flags().StringVar(&exportSuiteID, "suite-id", "local-regressions", "Suite id for export commands")
	cmd.Flags().StringVar(&exportTag, "tag", "regression", "Tag to add to exported cases")
	cmd.Flags().BoolVar(&includeActual, "include-actual", false, "Include bounded actual output metadata in exported trace cases or feedback metadata in exported feedback cases")
	cmd.Flags().StringVar(&comparisonID, "id", "", "Comparison id for `quality compare`")
	cmd.Flags().StringVar(&baselineRef, "baseline", "", "Baseline experiment ref for `quality compare` (experiment[:variant])")
	cmd.Flags().StringVar(&candidateRef, "candidate", "", "Candidate experiment ref for `quality compare` (experiment[:variant])")
	cmd.Flags().StringVar(&baselineLabel, "baseline-label", "", "Human label for the baseline side")
	cmd.Flags().StringVar(&candidateLabel, "candidate-label", "", "Human label for the candidate side")
	cmd.Flags().StringVar(&promoteAs, "as", "", "Baseline id for `quality promote`")
	cmd.Flags().StringVar(&promoteLabel, "label", "", "Human label for the promoted baseline")
	cmd.Flags().BoolVar(&seedDemo, "demo", false, "(with `seed`) populate .crux/quality with realistic demo fixtures")
	cmd.Flags().StringVar(&seedDir, "dir", "", "(with `seed`) target .crux/quality directory (default: ./.crux/quality)")
	return cmd
}

func showQualityOverview(ctx context.Context, c *api.Client, jsonOut bool) error {
	var overview api.QualityOverviewRecord
	if err := c.GetJSON(ctx, "/api/quality/overview", &overview); err != nil {
		return err
	}

	if jsonOut {
		return output.JSON(overview)
	}

	fmt.Printf("%s\n\n", output.Header("quality"))
	fmt.Printf("  Runs:        %d\n", overview.RunCount)
	fmt.Printf("  Suites:      %d\n", overview.SuiteCount)
	fmt.Printf("  Experiments: %d\n", overview.ExperimentCount)
	fmt.Printf("  Comparisons: %d\n", overview.ComparisonCount)
	fmt.Printf("  Baselines:   %d\n", overview.BaselineCount)
	fmt.Printf("  Feedback:    %d (%d needing review)\n", overview.FeedbackCount, overview.FeedbackNeedingReviewCount)
	fmt.Printf("  Cassettes:   %d (%d with issues)\n", overview.CassetteCount, overview.CassetteIssueCount)
	fmt.Printf("  Insights:    %d\n", overview.InsightCount)
	if overview.LatestExperimentID != "" && overview.LatestExperimentPassRate != nil {
		fmt.Printf("\n  Latest experiment: %s (%s pass rate)\n", overview.LatestExperimentID, output.FormatPercent(*overview.LatestExperimentPassRate))
	}
	fmt.Printf("\n  %s\n", output.Dim.Render("Use `crux quality runs`, `crux quality suites`, `crux quality insights`, or `crux quality experiments` for details."))
	return nil
}

func listQualityRuns(ctx context.Context, c *api.Client, jsonOut bool) error {
	var runs []api.QualityRunRecord
	if err := c.GetJSON(ctx, "/api/quality/runs", &runs); err != nil {
		return err
	}
	if jsonOut {
		return output.JSON(runs)
	}
	if len(runs) == 0 {
		fmt.Println(output.Dim.Render("No quality runs found."))
		return nil
	}

	tbl := &output.Table{Headers: []string{"TRACE", "TARGET", "STATUS", "MODEL", "DURATION", "TOOLS", "FEEDBACK"}}
	for _, run := range runs {
		duration := ""
		if run.DurationMs != nil {
			duration = fmt.Sprintf("%.0fms", *run.DurationMs)
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Dim.Render(truncate(run.TraceID, 24)),
			run.TargetID,
			renderQualityStatus(run.Status),
			run.Model,
			duration,
			fmt.Sprintf("%d", run.ToolCallCount),
			fmt.Sprintf("%d", len(run.FeedbackIDs)),
		})
	}
	tbl.Print()
	return nil
}

func listQualitySuites(ctx context.Context, c *api.Client, jsonOut bool) error {
	var suites []api.QualitySuiteRecord
	if err := c.GetJSON(ctx, "/api/quality/suites", &suites); err != nil {
		return err
	}
	if jsonOut {
		return output.JSON(suites)
	}
	if len(suites) == 0 {
		fmt.Println(output.Dim.Render("No quality suites found."))
		return nil
	}

	tbl := &output.Table{Headers: []string{"SUITE", "SOURCE", "CASES", "LAST EXPERIMENT", "PASS RATE"}}
	for _, suite := range suites {
		passRate := ""
		if suite.LastPassRate != nil {
			passRate = output.FormatPercent(*suite.LastPassRate)
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Dim.Render(truncate(suite.SuiteID, 24)),
			suite.Source,
			fmt.Sprintf("%d", suite.CaseCount),
			suite.LastExperimentID,
			passRate,
		})
	}
	tbl.Print()
	return nil
}

func listQualityInsights(ctx context.Context, c *api.Client, jsonOut bool) error {
	var insights []api.QualityInsightRecord
	if err := c.GetJSON(ctx, "/api/quality/insights", &insights); err != nil {
		return err
	}
	if jsonOut {
		return output.JSON(insights)
	}
	if len(insights) == 0 {
		fmt.Println(output.Dim.Render("No quality insights found."))
		return nil
	}

	tbl := &output.Table{Headers: []string{"SEVERITY", "TITLE", "TARGET", "LINKS", "STATUS"}}
	for _, insight := range insights {
		links := len(insight.LinkedTraceIDs) + len(insight.LinkedExperimentIDs) + len(insight.LinkedCaseIDs) + len(insight.LinkedCassettePaths)
		tbl.Rows = append(tbl.Rows, []string{
			renderInsightSeverity(insight.Severity),
			truncate(insight.Title, 44),
			insight.TargetID,
			fmt.Sprintf("%d", links),
			insight.Status,
		})
	}
	tbl.Print()
	return nil
}

func listQualityExperiments(ctx context.Context, c *api.Client, jsonOut bool) error {
	var experiments []api.QualityExperimentRecord
	if err := c.GetJSON(ctx, "/api/quality/experiments", &experiments); err != nil {
		return err
	}
	if jsonOut {
		return output.JSON(experiments)
	}
	if len(experiments) == 0 {
		fmt.Println(output.Dim.Render("No quality experiments found."))
		return nil
	}

	tbl := &output.Table{Headers: []string{"ID", "SUITE", "STATUS", "CASES", "PASS RATE", "VARIANTS"}}
	for _, experiment := range experiments {
		tbl.Rows = append(tbl.Rows, []string{
			output.Dim.Render(truncate(experiment.ID, 24)),
			experiment.Suite.ID,
			renderQualityStatus(experiment.Status),
			fmt.Sprintf("%d", experiment.Suite.CaseCount),
			output.FormatPercent(passRate(experiment.Summary.Passed, experiment.Summary.Total)),
			fmt.Sprintf("%d", len(experiment.Variants)),
		})
	}
	tbl.Print()
	return nil
}

func listQualityComparisons(ctx context.Context, c *api.Client, jsonOut bool) error {
	var comparisons []api.QualityComparisonRecord
	if err := c.GetJSON(ctx, "/api/quality/comparisons", &comparisons); err != nil {
		return err
	}
	if jsonOut {
		return output.JSON(comparisons)
	}
	if len(comparisons) == 0 {
		fmt.Println(output.Dim.Render("No quality comparisons found."))
		return nil
	}

	tbl := &output.Table{Headers: []string{"ID", "STATUS", "BASELINE", "CANDIDATE", "PASS DELTA", "GATES"}}
	for _, comparison := range comparisons {
		gates := "-"
		if comparison.Gates != nil {
			gates = renderGateStatus(comparison.Gates.Status)
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Dim.Render(truncate(comparison.ID, 24)),
			renderComparisonStatus(comparison.Status),
			sideLabel(comparison.Baseline),
			sideLabel(comparison.Candidate),
			renderDelta(comparison.Metrics.PassRateDelta),
			gates,
		})
	}
	tbl.Print()
	return nil
}

func listQualityBaselines(ctx context.Context, c *api.Client, jsonOut bool) error {
	var baselines []api.QualityBaselineRecord
	if err := c.GetJSON(ctx, "/api/quality/baselines", &baselines); err != nil {
		return err
	}
	if jsonOut {
		return output.JSON(baselines)
	}
	if len(baselines) == 0 {
		fmt.Println(output.Dim.Render("No quality baselines found."))
		return nil
	}

	tbl := &output.Table{Headers: []string{"ID", "EXPERIMENT", "VARIANT", "PASS RATE", "LABEL"}}
	for _, baseline := range baselines {
		variant := ""
		if baseline.VariantID != nil {
			variant = *baseline.VariantID
		}
		label := ""
		if baseline.Label != nil {
			label = *baseline.Label
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Dim.Render(truncate(baseline.ID, 24)),
			baseline.ExperimentID,
			variant,
			output.FormatPercent(baseline.Summary.PassRate),
			label,
		})
	}
	tbl.Print()
	return nil
}

func listQualityFeedback(ctx context.Context, c *api.Client, jsonOut bool) error {
	var feedback []api.QualityFeedbackRecord
	if err := c.GetJSON(ctx, "/api/quality/feedback", &feedback); err != nil {
		return err
	}
	if jsonOut {
		return output.JSON(feedback)
	}
	if len(feedback) == 0 {
		fmt.Println(output.Dim.Render("No quality feedback found."))
		return nil
	}

	tbl := &output.Table{Headers: []string{"ID", "STATUS", "RATING", "TRACE", "CASE", "TAGS", "COMMENT"}}
	for _, item := range feedback {
		traceID := ""
		if item.TraceID != nil {
			traceID = *item.TraceID
		}
		caseID := ""
		if item.CaseID != nil {
			caseID = *item.CaseID
		}
		rating := ""
		if item.Rating != nil {
			rating = renderFeedbackRating(*item.Rating)
		}
		comment := ""
		if item.Comment != nil {
			comment = truncate(*item.Comment, 48)
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Dim.Render(truncate(item.ID, 20)),
			item.Status,
			rating,
			traceID,
			caseID,
			strings.Join(item.Tags, ","),
			comment,
		})
	}
	tbl.Print()
	return nil
}

func listQualityMemoryProposals(ctx context.Context, c *api.Client, jsonOut bool) error {
	var proposals []api.QualityFeedbackMemoryProposalRecord
	if err := c.GetJSON(ctx, "/api/quality/feedback/memory-proposals", &proposals); err != nil {
		return err
	}
	if jsonOut {
		return output.JSON(proposals)
	}
	if len(proposals) == 0 {
		fmt.Println(output.Dim.Render("No quality memory proposals found."))
		return nil
	}

	tbl := &output.Table{Headers: []string{"ID", "FEEDBACK", "STATUS", "MEMORY", "KIND", "TAGS", "REASON"}}
	for _, item := range proposals {
		memoryID := ""
		if item.MemoryID != nil {
			memoryID = *item.MemoryID
		}
		memoryKind := ""
		if item.MemoryKind != nil {
			memoryKind = *item.MemoryKind
		}
		reason := ""
		if item.Reason != nil {
			reason = truncate(*item.Reason, 48)
		}
		tbl.Rows = append(tbl.Rows, []string{
			output.Dim.Render(truncate(item.ID, 20)),
			output.Dim.Render(truncate(item.FeedbackID, 20)),
			item.Status,
			memoryID,
			memoryKind,
			strings.Join(item.Tags, ","),
			reason,
		})
	}
	tbl.Print()
	return nil
}

func listQualityCassettes(ctx context.Context, c *api.Client, jsonOut bool) error {
	var cassettes []api.QualityCassetteRecord
	if err := c.GetJSON(ctx, "/api/quality/cassettes", &cassettes); err != nil {
		return err
	}
	if jsonOut {
		return output.JSON(cassettes)
	}
	if len(cassettes) == 0 {
		fmt.Println(output.Dim.Render("No quality cassettes found."))
		return nil
	}

	tbl := &output.Table{Headers: []string{"PATH", "MODE", "ENTRIES", "MISSING", "MISMATCH", "AVOIDED", "RECORDED"}}
	for _, item := range cassettes {
		tbl.Rows = append(tbl.Rows, []string{
			item.Path,
			item.Mode,
			fmt.Sprintf("%d", item.EntryCount),
			fmt.Sprintf("%d", item.MissingCount),
			fmt.Sprintf("%d", item.MismatchCount),
			fmt.Sprintf("%d", item.ProviderCallsAvoided),
			item.RecordedAt,
		})
	}
	tbl.Print()
	return nil
}

type qualityCompareOptions struct {
	id             string
	baseline       string
	candidate      string
	baselineLabel  string
	candidateLabel string
	jsonOut        bool
}

type qualityPromoteOptions struct {
	ref     string
	as      string
	label   string
	jsonOut bool
}

type qualitySideRequest struct {
	Experiment string  `json:"experiment"`
	VariantID  *string `json:"variantId,omitempty"`
	Label      *string `json:"label,omitempty"`
}

func createQualityComparison(ctx context.Context, c *api.Client, opts qualityCompareOptions) error {
	if opts.baseline == "" || opts.candidate == "" {
		return fmt.Errorf("usage: crux quality compare --baseline <experiment[:variant]> --candidate <experiment[:variant]>")
	}
	req := struct {
		ID        string             `json:"id,omitempty"`
		Baseline  qualitySideRequest `json:"baseline"`
		Candidate qualitySideRequest `json:"candidate"`
	}{
		ID:        opts.id,
		Baseline:  qualitySideFromRef(opts.baseline, opts.baselineLabel),
		Candidate: qualitySideFromRef(opts.candidate, opts.candidateLabel),
	}
	var comparison api.QualityComparisonRecord
	if err := c.PostJSON(ctx, "/api/quality/comparisons", req, &comparison); err != nil {
		return err
	}
	if opts.jsonOut {
		return output.JSON(comparison)
	}
	fmt.Printf("Created quality comparison %s: %s vs %s (%s)\n",
		output.Bold.Render(comparison.ID),
		sideLabel(comparison.Baseline),
		sideLabel(comparison.Candidate),
		renderComparisonStatus(comparison.Status),
	)
	return nil
}

func promoteQualityBaseline(ctx context.Context, c *api.Client, opts qualityPromoteOptions) error {
	if opts.as == "" {
		return fmt.Errorf("quality promote requires --as <baseline-id>")
	}
	side := qualitySideFromRef(opts.ref, opts.label)
	req := struct {
		ID         string  `json:"id"`
		Experiment string  `json:"experiment"`
		VariantID  *string `json:"variantId,omitempty"`
		Label      *string `json:"label,omitempty"`
	}{
		ID:         opts.as,
		Experiment: side.Experiment,
		VariantID:  side.VariantID,
		Label:      side.Label,
	}
	var baseline api.QualityBaselineRecord
	if err := c.PostJSON(ctx, "/api/quality/baselines", req, &baseline); err != nil {
		return err
	}
	if opts.jsonOut {
		return output.JSON(baseline)
	}
	fmt.Printf("Promoted %s as baseline %s\n", sideLabel(baseline.Summary), output.Bold.Render(baseline.ID))
	return nil
}

func qualitySideFromRef(ref string, label string) qualitySideRequest {
	experiment, variant, hasVariant := strings.Cut(ref, ":")
	side := qualitySideRequest{Experiment: experiment}
	if hasVariant && variant != "" {
		side.VariantID = &variant
	}
	if label != "" {
		side.Label = &label
	}
	return side
}

func renderQualityStatus(status string) string {
	switch status {
	case "passed":
		return output.Green.Render(status)
	case "failed", "error":
		return output.Red.Render(status)
	default:
		return output.Yellow.Render(status)
	}
}

func renderInsightSeverity(severity string) string {
	switch severity {
	case "high":
		return output.Red.Render(severity)
	case "medium":
		return output.Yellow.Render(severity)
	case "low":
		return output.Green.Render(severity)
	default:
		return output.Dim.Render(severity)
	}
}

func renderComparisonStatus(status string) string {
	switch status {
	case "candidate_better":
		return output.Green.Render("better")
	case "candidate_worse":
		return output.Red.Render("worse")
	case "mixed":
		return output.Yellow.Render("mixed")
	default:
		return output.Dim.Render(status)
	}
}

func renderGateStatus(status string) string {
	if status == "passed" {
		return output.Green.Render(status)
	}
	return output.Red.Render(status)
}

func renderFeedbackRating(rating int) string {
	if rating > 0 {
		return output.Green.Render("+1")
	}
	if rating < 0 {
		return output.Red.Render("-1")
	}
	return output.Dim.Render("0")
}

func sideLabel(side api.QualityComparisonSummary) string {
	if side.Label != nil {
		return *side.Label
	}
	if side.VariantID != nil {
		return side.ExperimentID + "/" + *side.VariantID
	}
	return side.ExperimentID
}

func renderDelta(value float64) string {
	rendered := output.FormatPercent(value)
	if value > 0 {
		rendered = "+" + rendered
		return output.Green.Render(rendered)
	}
	if value < 0 {
		return output.Red.Render(rendered)
	}
	return output.Dim.Render(rendered)
}

func passRate(passed int, total int) float64 {
	if total == 0 {
		return 0
	}
	return float64(passed) / float64(total)
}

type exportTraceOptions struct {
	traceID       string
	out           string
	caseID        string
	suiteID       string
	tag           string
	includeActual bool
}

type portableQualitySuite struct {
	ID    string                     `json:"id"`
	Cases []portableQualitySuiteCase `json:"cases"`
}

type portableQualitySuiteCase struct {
	ID       string         `json:"id"`
	Name     string         `json:"name,omitempty"`
	Input    map[string]any `json:"input"`
	Expected map[string]any `json:"expected,omitempty"`
	Tags     []string       `json:"tags,omitempty"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

func exportTraceSuiteCase(ctx context.Context, c *api.Client, opts exportTraceOptions) error {
	if opts.out == "" {
		return fmt.Errorf("quality export-trace requires --out")
	}
	graph, found, err := observabilityGraphByRunOrTraceID(ctx, c, opts.traceID)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("quality export-trace: run or trace %q not found", opts.traceID)
	}

	suite := portableQualitySuite{ID: opts.suiteID}
	if content, err := os.ReadFile(opts.out); err == nil && len(content) > 0 {
		if err := json.Unmarshal(content, &suite); err != nil {
			return fmt.Errorf("failed to parse existing suite %s: %w", opts.out, err)
		}
	}
	if suite.ID == "" {
		suite.ID = opts.suiteID
	}

	testCase := suiteCaseFromGraph(graph, opts)
	replaced := false
	for index, existing := range suite.Cases {
		if existing.ID == testCase.ID {
			suite.Cases[index] = testCase
			replaced = true
			break
		}
	}
	if !replaced {
		suite.Cases = append(suite.Cases, testCase)
	}

	data, err := json.MarshalIndent(suite, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(opts.out, append(data, '\n'), 0644); err != nil {
		return err
	}
	fmt.Printf("Exported run %s to %s as case %s\n", output.Dim.Render(graph.Run.RunID), opts.out, output.Bold.Render(testCase.ID))
	return nil
}

func exportFeedbackSuiteCase(ctx context.Context, c *api.Client, opts exportTraceOptions) error {
	if opts.out == "" {
		return fmt.Errorf("quality export-feedback requires --out")
	}
	var feedback []api.QualityFeedbackRecord
	if err := c.GetJSON(ctx, "/api/quality/feedback", &feedback); err != nil {
		return err
	}
	var selected *api.QualityFeedbackRecord
	for index := range feedback {
		if feedback[index].ID == opts.traceID {
			selected = &feedback[index]
			break
		}
	}
	if selected == nil {
		return fmt.Errorf("quality export-feedback: feedback %q not found", opts.traceID)
	}
	if selected.TraceID == nil || *selected.TraceID == "" {
		return fmt.Errorf("quality export-feedback: feedback %q has no linked trace input", selected.ID)
	}
	graph, found, err := observabilityGraphByRunOrTraceID(ctx, c, *selected.TraceID)
	if err != nil {
		return err
	}
	if !found {
		return fmt.Errorf("quality export-feedback: linked run or trace %q not found", *selected.TraceID)
	}

	suite := portableQualitySuite{ID: opts.suiteID}
	if content, err := os.ReadFile(opts.out); err == nil && len(content) > 0 {
		if err := json.Unmarshal(content, &suite); err != nil {
			return fmt.Errorf("failed to parse existing suite %s: %w", opts.out, err)
		}
	}
	if suite.ID == "" {
		suite.ID = opts.suiteID
	}

	testCase := suiteCaseFromFeedback(*selected, graph, opts)
	replaced := false
	for index, existing := range suite.Cases {
		if existing.ID == testCase.ID {
			suite.Cases[index] = testCase
			replaced = true
			break
		}
	}
	if !replaced {
		suite.Cases = append(suite.Cases, testCase)
	}

	data, err := json.MarshalIndent(suite, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(opts.out, append(data, '\n'), 0644); err != nil {
		return err
	}
	fmt.Printf("Exported feedback %s to %s as case %s\n", output.Dim.Render(selected.ID), opts.out, output.Bold.Render(testCase.ID))
	return nil
}

func suiteCaseFromGraph(graph api.ObservabilityGraph, opts exportTraceOptions) portableQualitySuiteCase {
	caseID := opts.caseID
	if caseID == "" {
		caseID = graph.Run.RunID
	}
	tags := []string{}
	if opts.tag != "" {
		tags = append(tags, opts.tag)
	}
	metadata := map[string]any{
		"runId":    graph.Run.RunID,
		"traceId":  graph.Run.TraceID,
		"status":   graph.Run.Status,
		"model":    graph.Run.Model,
		"provider": graph.Run.Provider,
	}
	if graph.Run.PromptID != "" {
		metadata["promptId"] = graph.Run.PromptID
	}
	if opts.includeActual {
		if actual, ok := outputArtifactPreview(graph); ok {
			metadata["actual"] = actual
		}
	}
	return portableQualitySuiteCase{
		ID:       caseID,
		Name:     caseID,
		Input:    inputArtifactPreview(graph),
		Tags:     tags,
		Metadata: metadata,
	}
}

func suiteCaseFromFeedback(feedback api.QualityFeedbackRecord, graph api.ObservabilityGraph, opts exportTraceOptions) portableQualitySuiteCase {
	caseID := opts.caseID
	if caseID == "" && feedback.CaseID != nil {
		caseID = *feedback.CaseID
	}
	if caseID == "" {
		caseID = feedback.ID
	}
	tags := append([]string{}, feedback.Tags...)
	if opts.tag != "" {
		tags = appendUnique(tags, opts.tag)
	}
	metadata := map[string]any{}
	if opts.includeActual {
		metadata["qualityFeedbackId"] = feedback.ID
		if feedback.TraceID != nil {
			metadata["traceId"] = *feedback.TraceID
		}
		metadata["runId"] = graph.Run.RunID
		if feedback.Rating != nil {
			metadata["rating"] = *feedback.Rating
		}
		if feedback.Comment != nil {
			metadata["comment"] = truncate(*feedback.Comment, 500)
		}
	}
	testCase := portableQualitySuiteCase{
		ID:       caseID,
		Name:     caseID,
		Input:    inputArtifactPreview(graph),
		Expected: feedback.Expected,
		Tags:     tags,
	}
	if len(metadata) > 0 {
		testCase.Metadata = metadata
	}
	return testCase
}

func observabilityGraphByRunOrTraceID(ctx context.Context, c *api.Client, id string) (api.ObservabilityGraph, bool, error) {
	graph, found, err := c.ObservabilityGraph(ctx, id)
	if err != nil || found {
		return graph, found, err
	}
	runs, err := c.ObservabilityRuns(ctx)
	if err != nil {
		return api.ObservabilityGraph{}, false, err
	}
	for _, run := range runs {
		if run.TraceID != id {
			continue
		}
		return c.ObservabilityGraph(ctx, run.RunID)
	}
	return api.ObservabilityGraph{}, false, nil
}

func inputArtifactPreview(graph api.ObservabilityGraph) map[string]any {
	for _, artifact := range graph.Artifacts {
		if artifact.Kind != "input" && artifact.Kind != "messages" && artifact.Kind != "prompt" {
			continue
		}
		if preview := jsonObject(artifact.Preview); len(preview) > 0 {
			return preview
		}
	}
	return map[string]any{}
}

func outputArtifactPreview(graph api.ObservabilityGraph) (map[string]any, bool) {
	for _, artifact := range graph.Artifacts {
		if artifact.Kind != "output" {
			continue
		}
		preview := jsonObject(artifact.Preview)
		if len(preview) == 0 {
			continue
		}
		return preview, true
	}
	return nil, false
}

func appendUnique(values []string, next string) []string {
	for _, value := range values {
		if value == next {
			return values
		}
	}
	return append(values, next)
}
