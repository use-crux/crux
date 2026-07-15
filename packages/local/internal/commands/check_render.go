package commands

import (
	"fmt"

	"github.com/use-crux/crux/packages/local/internal/output"
)

func printCheckReport(io *output.IO, report checkJSONV1, profile string) {
	fmt.Fprintf(io.Out, "%s\n\n", brandedHeader(io, "check"))
	fmt.Fprintf(io.Out, "  Project: %s\n", report.Project.Root)
	fmt.Fprintf(io.Out, "  Indexing: %s (static %s, semantic %s", report.Indexing.Status, report.Indexing.Static, report.Indexing.Semantic)
	if report.Indexing.Cache != "" {
		fmt.Fprintf(io.Out, ", cache %s", report.Indexing.Cache)
	}
	fmt.Fprintln(io.Out, ")")

	fmt.Fprintln(io.Out, "\n  Compiler diagnostics")
	if len(report.Diagnostics) == 0 {
		fmt.Fprintln(io.Out, "    None")
	}
	for _, diagnostic := range report.Diagnostics {
		fmt.Fprintf(io.Out, "    %s %s: %s\n", diagnostic.Severity, diagnostic.Code, diagnostic.Message)
	}

	fmt.Fprintf(io.Out, "\n  Authored-system findings (%s)\n", profile)
	if len(report.Findings) == 0 {
		fmt.Fprintln(io.Out, "    None")
	}
	for _, finding := range report.Findings {
		fmt.Fprintf(io.Out, "    %s %s: %s\n", finding.Severity, finding.RuleID, finding.Title)
	}

	gate := "passed"
	if report.Summary.GateFailed {
		gate = "failed"
	}
	fmt.Fprintf(io.Out, "\n  Summary: %d definitions, %d relations, %d diagnostics, %d findings; gate %s\n",
		report.Summary.Definitions,
		report.Summary.Relations,
		report.Summary.Diagnostics,
		report.Summary.Findings,
		gate,
	)
}
