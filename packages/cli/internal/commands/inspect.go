package commands

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/cli/internal/api"
	"github.com/use-crux/crux/packages/cli/internal/cli"
	"github.com/use-crux/crux/packages/cli/internal/output"
)

// NewInspectCmd creates the "crux inspect" command for showing token breakdowns.
func NewInspectCmd(f *cli.Factory) *cobra.Command {
	var jsonOutput bool

	cmd := &cobra.Command{
		Use:   "inspect <prompt-id>",
		Short: "Show token breakdown for a prompt from recent traces",
		Long: `Show the token breakdown for a prompt by finding the most recent trace
for that prompt ID and displaying its inspect data (system parts, token
counts, dropped contexts).`,
		Args: cobra.ExactArgs(1),
		RunE: func(cmd *cobra.Command, args []string) error {
			ctx := cmd.Context()
			c := f.Client()
			promptID := args[0]

			runs, err := c.ObservabilityRuns(ctx)
			if err != nil {
				return err
			}

			var found *api.ObservabilityRunSummary
			for i := range runs {
				run := &runs[i]
				if run.PromptID == promptID && normalizeObservabilityStatus(run.Status) == "success" {
					found = run
					break
				}
			}

			if found == nil {
				return fmt.Errorf("no completed trace found for prompt %q.\nRun the prompt first, then inspect.", promptID)
			}

			detail, ok, err := c.ObservabilityRunDetail(ctx, found.RunID)
			if err != nil {
				return err
			}
			if !ok {
				return fmt.Errorf("run %q not found", found.RunID)
			}

			if jsonOutput {
				return output.JSON(detail)
			}

			fmt.Printf("%s %s\n", output.Bold.Render("Inspect:"), output.BoldCyan.Render(promptID))
			fmt.Printf("  %s %s\n", output.Dim.Render("From run:"), found.RunID)
			fmt.Printf("  %s %s\n\n", output.Dim.Render("Model:"), found.Model)

			inspectSpans := inspectablePromptDetails(detail.Root)
			if len(inspectSpans) > 0 {
				fmt.Printf("  %s\n", output.Bold.Render("Prompt and Context Spans"))
				for _, span := range inspectSpans {
					attrs := jsonObject(span.attributes)
					status := output.Status(normalizeObservabilityStatus(span.status))
					included := ""
					if value, ok := attrs["included"].(bool); ok {
						if value {
							included = output.Green.Render(" included")
						} else {
							included = output.Red.Render(" excluded")
						}
					}
					reason := ""
					if text, ok := attrs["reason"].(string); ok && text != "" {
						reason = output.Dim.Render(" " + text)
					}
					fmt.Printf("    %s %-18s %-32s %s%s\n", status, span.primitive, span.name, included, reason)
				}
			}

			contextArtifacts := contextArtifactsFromRunDetail(detail.Root)
			if len(contextArtifacts) > 0 {
				fmt.Printf("\n  %s\n", output.Bold.Render("Context Artifacts"))
				for _, artifact := range contextArtifacts {
					attrs := jsonObject(artifact.Attributes)
					source := artifact.Kind
					if text, ok := attrs["source"].(string); ok && text != "" {
						source = text
					}
					tokens := intMetric(attrs, "tokens")
					tokenText := ""
					if tokens > 0 {
						tokenText = output.FormatTokens(tokens)
					}
					fmt.Printf("    %-30s  %s\n", output.Cyan.Render(source), tokenText)
				}
			}

			metrics := jsonObject(detail.Run.Metrics)
			if promptTokens := intMetric(metrics, "totalTokens"); promptTokens > 0 {
				fmt.Printf("\n  %s %s\n",
					output.Bold.Render("Total prompt tokens:"),
					output.Bold.Render(output.FormatTokens(promptTokens)),
				)
			}

			fmt.Println()
			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	return cmd
}

type inspectPromptDetail struct {
	primitive  string
	name       string
	status     string
	attributes []byte
}

func inspectablePromptDetails(root api.ObservabilityRunDetailNode) []inspectPromptDetail {
	var spans []inspectPromptDetail
	var visit func(api.ObservabilityRunDetailNode)
	visit = func(node api.ObservabilityRunDetailNode) {
		if isInspectablePromptSpan(node.Family) {
			spans = append(spans, inspectPromptDetail{
				primitive:  firstNonEmptyString(node.Primitive, node.Family),
				name:       firstNonEmptyString(node.Name, node.Display.Label, node.SpanID),
				status:     node.Status,
				attributes: node.Attributes,
			})
		}
		for _, detail := range node.Details {
			if isInspectablePromptSpan(detail.Family) {
				spans = append(spans, inspectPromptDetail{
					primitive:  firstNonEmptyString(detail.Primitive, detail.Family),
					name:       firstNonEmptyString(detail.Name, detail.Label, detail.SpanID),
					status:     detail.Status,
					attributes: detail.Attributes,
				})
			}
		}
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(root)
	return spans
}

func isInspectablePromptSpan(family string) bool {
	switch family {
	case "prompt", "context", "constraint", "guardrail":
		return true
	default:
		return false
	}
}

func contextArtifactsFromRunDetail(root api.ObservabilityRunDetailNode) []api.ObservabilityArtifactSummary {
	var artifacts []api.ObservabilityArtifactSummary
	var visit func(api.ObservabilityRunDetailNode)
	visit = func(node api.ObservabilityRunDetailNode) {
		artifacts = appendContextArtifacts(artifacts, node.Artifacts)
		for _, detail := range node.Details {
			artifacts = appendContextArtifacts(artifacts, detail.Artifacts)
		}
		for _, child := range node.Children {
			visit(child)
		}
	}
	visit(root)
	return artifacts
}

func appendContextArtifacts(dst []api.ObservabilityArtifactSummary, artifacts []api.ObservabilityArtifactSummary) []api.ObservabilityArtifactSummary {
	for _, artifact := range artifacts {
		if artifact.Kind == "context" || artifact.Kind == "prompt" || artifact.Kind == "constraint.report" || artifact.Kind == "guardrail.report" {
			dst = append(dst, artifact)
		}
	}
	return dst
}
