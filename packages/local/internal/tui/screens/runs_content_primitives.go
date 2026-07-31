package screens

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

const (
	maxExpandedPayloadBytes = 4096
	maxExpandedPayloadLines = 20
)

func renderPrimitiveDepth(node *api.ObservabilityRunDetailNode, width int, expanded bool) string {
	if node == nil {
		return ""
	}
	sections := []string{
		renderGenerationDepth(node, width),
		renderToolDepth(node, width, expanded),
		renderMemoryCaptureDepth(node, width),
		renderMediaDepth(node, width),
		renderSequenceDepth(node, width),
	}
	visible := sections[:0]
	for _, section := range sections {
		if strings.TrimSpace(section) != "" {
			visible = append(visible, strings.TrimRight(section, "\n"))
		}
	}
	return strings.Join(visible, "\n\n")
}

func renderToolDepth(node *api.ObservabilityRunDetailNode, width int, expanded bool) string {
	if node.Family != "tool" || node.Primitive != "tool.call" {
		return ""
	}
	var args, result any
	for _, artifact := range node.Artifacts {
		preview := decodeRawObject(artifact.Preview)
		switch artifact.Kind {
		case "tool.request", "tool.args":
			if value, ok := preview["args"]; ok {
				args = value
			} else if artifact.Kind == "tool.args" && len(preview) > 0 {
				args = preview
			}
		case "tool.response", "tool.result":
			if value, ok := preview["result"]; ok {
				result = value
			} else if len(preview) > 0 {
				result = preview
			}
		}
	}
	if args == nil && result == nil {
		return ""
	}
	var b strings.Builder
	hint := "collapsed · p expand"
	if expanded {
		hint = "expanded · p collapse"
	}
	if args != nil {
		b.WriteString(diagnosisSection("ARGS · " + hint))
		b.WriteString(renderBoundedPayload(args, width, expanded))
	}
	if result != nil {
		if b.Len() > 0 {
			b.WriteString("\n")
		}
		b.WriteString(diagnosisSection("RESULT · " + hint))
		b.WriteString(renderBoundedPayload(result, width, expanded))
	}
	return strings.TrimRight(b.String(), "\n")
}

func renderBoundedPayload(value any, width int, expanded bool) string {
	value = sanitizeRunsRenderValue(value)
	if !expanded {
		return kvRow("preview", valuePreview(value, previewMax(width)), width)
	}
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return kvRow("payload", valuePreview(value, previewMax(width)), width)
	}
	truncatedBytes := false
	encodedRunes := []rune(string(encoded))
	if len(encodedRunes) > maxExpandedPayloadBytes {
		encoded = []byte(string(encodedRunes[:maxExpandedPayloadBytes]))
		truncatedBytes = true
	}
	lines := strings.Split(string(encoded), "\n")
	truncatedLines := len(lines) > maxExpandedPayloadLines
	if truncatedLines {
		lines = lines[:maxExpandedPayloadLines]
	}
	for index := range lines {
		lines[index] = kit.Fit(" │ "+sanitizeRunsInline(lines[index]), width, "…")
	}
	if truncatedBytes || truncatedLines {
		lines = append(lines, kit.Fit(" │ … bounded payload · inspect raw for source", width, "…"))
	}
	return strings.Join(lines, "\n") + "\n"
}

func renderMemoryCaptureDepth(node *api.ObservabilityRunDetailNode, width int) string {
	if node.Primitive != "memory.capture" {
		return ""
	}
	content := projectMemoryCapture(*node)
	if content.RequestedMode == "" && content.Disposition == "" && content.Outcome == "" {
		return ""
	}
	var b strings.Builder
	b.WriteString(diagnosisSection("MEMORY CAPTURE"))
	if content.MemoryID != "" {
		b.WriteString(kvRow("memory", content.MemoryID, width))
	}
	stages := make([]string, 0, 3)
	for _, stage := range []string{content.RequestedMode, content.Disposition, content.Outcome} {
		if stage != "" {
			stages = append(stages, stage)
		}
	}
	journey := strings.Join(stages, " → ")
	if journey != "" {
		b.WriteString(kvRowColored("disposition", journey, shell.ColorTeal, width))
	}
	return strings.TrimRight(b.String(), "\n")
}

func renderMediaDepth(node *api.ObservabilityRunDetailNode, width int) string {
	if node.Family != "media" {
		return ""
	}
	descriptors := projectMediaDescriptors(*node)
	if len(descriptors) == 0 {
		return ""
	}
	var b strings.Builder
	b.WriteString(diagnosisSection("MEDIA DESCRIPTORS · SANITIZED"))
	for _, descriptor := range descriptors {
		label := descriptor.Kind
		value := descriptor.ContentType
		if descriptor.SizeBytes > 0 {
			value = strings.TrimSpace(value + fmt.Sprintf(" · %d bytes", descriptor.SizeBytes))
		}
		if descriptor.Source != "" {
			value = strings.TrimSpace(value + " · " + descriptor.Source)
		}
		b.WriteString(kvRow(label, value, width))
		if descriptor.Lineage != "" {
			b.WriteString(kvRow("lineage", descriptor.Lineage, width))
		}
	}
	return strings.TrimRight(b.String(), "\n")
}

func renderSequenceDepth(node *api.ObservabilityRunDetailNode, width int) string {
	content := projectSequence(*node)
	if content.Summary == "" {
		return ""
	}
	return diagnosisSection(strings.ToUpper(node.Family)+" STRUCTURE") +
		strings.TrimRight(kvRow(content.Label, content.Summary, width), "\n")
}
