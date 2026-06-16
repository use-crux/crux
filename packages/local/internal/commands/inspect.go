package commands

import (
	"fmt"

	"github.com/spf13/cobra"
	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
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
		Example: `  crux inspect my.prompt.id
  crux inspect my.prompt.id --json`,
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

			printInspect(f.Streams(), promptID, found, detail)
			return nil
		},
	}

	cmd.Flags().BoolVar(&jsonOutput, "json", false, "Output as JSON")
	return cmd
}

// printInspect renders the token breakdown for a prompt under a branded header:
// the source run identity, prompt/context spans (with inclusion + reason),
// context artifacts with token counts, and the total prompt-token figure. Every
// styled span funnels through io.Sprint/io.Status so `--no-color`/non-TTY output
// stays byte-clean; results go to io.Out (stdout).
func printInspect(io *output.IO, promptID string, found *api.ObservabilityRunSummary, detail api.ObservabilityRunDetail) {
	fmt.Fprintf(io.Out, "%s  %s\n", brandedHeader(io, "inspect"), io.Sprint(output.BoldCyan, promptID))
	fmt.Fprintf(io.Out, "  %s %s\n", io.Sprint(output.Dim, "From run:"), found.RunID)
	fmt.Fprintf(io.Out, "  %s %s\n\n", io.Sprint(output.Dim, "Model:"), found.Model)

	inspectSpans := inspectablePromptDetails(detail.Root)
	if len(inspectSpans) > 0 {
		fmt.Fprintf(io.Out, "  %s\n", io.Sprint(output.Bold, "Prompt and Context Spans"))
		for _, span := range inspectSpans {
			attrs := jsonObject(span.attributes)
			status := io.Status(normalizeObservabilityStatus(span.status))
			included := ""
			if value, ok := attrs["included"].(bool); ok {
				if value {
					included = io.Sprint(output.Green, " included")
				} else {
					included = io.Sprint(output.Red, " excluded")
				}
			}
			reason := ""
			if text, ok := attrs["reason"].(string); ok && text != "" {
				reason = io.Sprint(output.Dim, " "+text)
			}
			fmt.Fprintf(io.Out, "    %s %-18s %-32s %s%s\n", status, span.primitive, span.name, included, reason)
		}
	}

	contextArtifacts := contextArtifactsFromRunDetail(detail.Root)
	if len(contextArtifacts) > 0 {
		fmt.Fprintf(io.Out, "\n  %s\n", io.Sprint(output.Bold, "Context Artifacts"))
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
			fmt.Fprintf(io.Out, "    %-30s  %s\n", io.Sprint(output.Cyan, source), tokenText)
		}
	}

	metrics := jsonObject(detail.Run.Metrics)
	if promptTokens := intMetric(metrics, "totalTokens"); promptTokens > 0 {
		fmt.Fprintf(io.Out, "\n  %s %s\n",
			io.Sprint(output.Bold, "Total prompt tokens:"),
			io.Sprint(output.Bold, output.FormatTokens(promptTokens)),
		)
	}

	fmt.Fprintln(io.Out)
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
