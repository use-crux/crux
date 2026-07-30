package screens

import (
	"fmt"
	"strings"
	"time"

	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

const maxDiagnosisItemsPerSection = 12

func renderDiagnosisOverview(diagnosis *RunDiagnosis, width int) string {
	if diagnosis == nil {
		return ""
	}
	var b strings.Builder
	b.WriteString(diagnosisSection("RUN SUMMARY"))
	b.WriteString(kvRow("status", diagnosis.Summary.Status, width))
	if diagnosis.Summary.DurationMs > 0 {
		b.WriteString(kvRow("duration", formatSpanDuration(diagnosis.Summary.DurationMs), width))
	}
	if diagnosis.Summary.StartedAt != "" {
		b.WriteString(kvRow("started", compactDiagnosisTime(diagnosis.Summary.StartedAt), width))
	}
	if model := providerModel(diagnosis.Summary.Provider, diagnosis.Summary.Model); model != "" {
		b.WriteString(kvRow("model", model, width))
	}
	if diagnosis.Summary.SpanCount > 0 {
		b.WriteString(kvRow("spans", fmt.Sprintf("%d", diagnosis.Summary.SpanCount), width))
	}
	failures := diagnosis.Failures
	if len(failures) == 0 && diagnosis.Summary.Failure != "" {
		failures = []FailureItem{{Message: diagnosis.Summary.Failure}}
	}
	if len(failures) > 0 {
		b.WriteString("\n" + diagnosisSection("FAILURE EVIDENCE"))
		for _, item := range failures[:diagnosisRenderLimit(len(failures))] {
			label := "run"
			if item.NodeID != "" {
				label = diagnosisActivityName(diagnosis.Timeline, item.NodeID)
			}
			b.WriteString(kvRow(label, boundedDiagnosisText(item.Message, diagnosisTextLimit), width))
		}
		writeDiagnosisRemainder(&b, len(failures), width)
	}

	if len(diagnosis.CriticalPath) > 0 {
		b.WriteString("\n" + diagnosisSection("CRITICAL PATH · TIMING INFERENCE"))
		for _, row := range diagnosis.CriticalPath[:diagnosisRenderLimit(len(diagnosis.CriticalPath))] {
			value := firstNonEmpty(row.Span.Name, row.ID)
			if row.Span.DurationMs != nil {
				value += " · " + formatSpanDuration(*row.Span.DurationMs)
			}
			b.WriteString(kvRow("activity", boundedDiagnosisText(value, diagnosisTextLimit), width))
		}
		writeDiagnosisRemainder(&b, len(diagnosis.CriticalPath), width)
	}

	if len(diagnosis.Operations) > 0 {
		b.WriteString("\n" + diagnosisSection("ATTENTION"))
		for _, operation := range diagnosis.Operations[:diagnosisRenderLimit(len(diagnosis.Operations))] {
			b.WriteString(kvRow("activity", boundedDiagnosisText(firstNonEmpty(operation.Name, operation.NodeID), diagnosisTextLimit), width))
			b.WriteString(kvRow("evidence", boundedDiagnosisText(operation.Evidence, diagnosisTextLimit), width))
		}
		writeDiagnosisRemainder(&b, len(diagnosis.Operations), width)
	}

	if len(diagnosis.Diagnostics) > 0 {
		b.WriteString("\n" + diagnosisSection("DIAGNOSTICS"))
		for _, item := range diagnosis.Diagnostics[:diagnosisRenderLimit(len(diagnosis.Diagnostics))] {
			diagnostic := item.Diagnostic
			label := firstNonEmpty(diagnostic.Code, "diagnostic")
			if diagnostic.Severity != "" {
				label += " · " + diagnostic.Severity
			}
			b.WriteString(kvRow("evidence", boundedDiagnosisText(label, diagnosisTextLimit), width))
			writeDiagnosisActivity(&b, diagnosis, item.NodeID, width)
			if diagnostic.Message != "" {
				b.WriteString(kvRow("message", boundedDiagnosisText(diagnostic.Message, diagnosisTextLimit), width))
			}
			if diagnostic.SuggestedFix != "" {
				b.WriteString(kvRow("suggested fix", boundedDiagnosisText(diagnostic.SuggestedFix, diagnosisTextLimit), width))
			}
		}
		writeDiagnosisRemainder(&b, len(diagnosis.Diagnostics), width)
	}

	if len(diagnosis.Artifacts) > 0 {
		b.WriteString("\n" + diagnosisSection("ARTIFACTS"))
		for _, item := range diagnosis.Artifacts[:diagnosisRenderLimit(len(diagnosis.Artifacts))] {
			artifact := item.Artifact
			value := firstNonEmpty(artifact.ArtifactID, artifact.Kind)
			if artifact.Kind != "" && artifact.Kind != value {
				value += " · " + artifact.Kind
			}
			if artifact.SizeBytes > 0 {
				value += fmt.Sprintf(" · %d bytes", artifact.SizeBytes)
			}
			b.WriteString(kvRow("artifact", boundedDiagnosisText(value, diagnosisTextLimit), width))
			writeDiagnosisActivity(&b, diagnosis, item.NodeID, width)
		}
		writeDiagnosisRemainder(&b, len(diagnosis.Artifacts), width)
	}

	if len(diagnosis.Events) > 0 {
		b.WriteString("\n" + diagnosisSection("EVENTS"))
		for _, item := range diagnosis.Events[:diagnosisRenderLimit(len(diagnosis.Events))] {
			event := item.Event
			value := firstNonEmpty(event.EventID, event.Name)
			if event.Name != "" && event.Name != value {
				value += " · " + event.Name
			}
			b.WriteString(kvRow("event", boundedDiagnosisText(value, diagnosisTextLimit), width))
			writeDiagnosisActivity(&b, diagnosis, item.NodeID, width)
		}
		writeDiagnosisRemainder(&b, len(diagnosis.Events), width)
	}

	if len(diagnosis.DefinitionRefs) > 0 {
		b.WriteString("\n" + diagnosisSection("DEFINITION REFS"))
		for _, ref := range diagnosis.DefinitionRefs[:diagnosisRenderLimit(len(diagnosis.DefinitionRefs))] {
			value := ref.ID
			if ref.Kind != "" || ref.Role != "" {
				value += " · " + strings.Trim(strings.Join([]string{ref.Kind, ref.Role}, " "), " ")
			}
			b.WriteString(kvRow("definition", boundedDiagnosisText(value, diagnosisTextLimit), width))
			if ref.Source != nil && ref.Source.File != "" {
				b.WriteString(kvRow("source", boundedDiagnosisText(fmt.Sprintf("%s:%d", ref.Source.File, ref.Source.Line), diagnosisTextLimit), width))
			}
		}
		writeDiagnosisRemainder(&b, len(diagnosis.DefinitionRefs), width)
	}
	return strings.TrimRight(b.String(), "\n")
}

func writeDiagnosisActivity(b *strings.Builder, diagnosis *RunDiagnosis, nodeID string, width int) {
	if nodeID == "" {
		return
	}
	b.WriteString(kvRow("activity", boundedDiagnosisText(diagnosisActivityName(diagnosis.Timeline, nodeID), diagnosisTextLimit), width))
}

func diagnosisRenderLimit(length int) int {
	return min(length, maxDiagnosisItemsPerSection)
}

func writeDiagnosisRemainder(b *strings.Builder, length, width int) {
	if remaining := length - diagnosisRenderLimit(length); remaining > 0 {
		b.WriteString(kvRow("more", fmt.Sprintf("+%d more · inspect/export for raw", remaining), width))
	}
}

func compactDiagnosisTime(value string) string {
	parsed, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return value
	}
	return parsed.Format("15:04:05Z07:00")
}

func diagnosisSection(label string) string {
	return " " + shell.SectionTag.Render(label) + "\n"
}

func providerModel(provider, model string) string {
	if provider == "" {
		return model
	}
	if model == "" {
		return provider
	}
	return provider + "/" + model
}
