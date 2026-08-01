package screens

import (
	"fmt"
	"image/color"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Index) currentDefinitionActivity() api.CatalogRuntimeActivityV1 {
	snapshot := s.activity.Snapshot()
	if !snapshot.HasValue || snapshot.Value.DefinitionID != s.SelectedDefinitionID() {
		return api.CatalogRuntimeActivityV1{}
	}
	return snapshot.Value
}

func formatDefinitionActivity(activity api.CatalogRuntimeActivityV1) string {
	if activity.RunCount <= 0 {
		return ""
	}
	parts := make([]string, 0, 3)
	if relative := relTime(activity.LastRunAt); relative != "" {
		parts = append(parts, "last run "+relative)
	}
	parts = append(parts, fmt.Sprintf("%d %s", activity.RunCount, kit.Pluralize(activity.RunCount, "run")))
	if activity.LastStatus != "" {
		parts = append(parts, sanitizeIndexInline(activity.LastStatus))
	}
	return strings.Join(parts, " · ")
}

func definitionActivityTone(status string) color.Color {
	if strings.TrimSpace(status) == "" {
		return shell.ColorText
	}
	switch normalizeObservabilityStatus(status) {
	case "ok":
		return shell.ColorText
	case "fail":
		return shell.ColorRose
	default:
		return shell.ColorAmber
	}
}

func (s *Index) indexStatusStrip() string {
	parts := make([]string, 0, 3)
	if indexing := s.indexData().Indexing; indexing != nil {
		parts = append(parts, indexStatusPart("index", indexing.Status, "ready"))
		if indexing.Semantic.Status != "" {
			parts = append(parts, indexStatusPart("semantic", indexing.Semantic.Status, "ready"))
		}
	}
	watch := s.watch.Snapshot()
	if watch.HasValue && watch.Value.State != "" {
		parts = append(parts, indexStatusPart("watch", watch.Value.State, "idle", "ready"))
	}
	return strings.Join(parts, shell.TextMuted.Render(" · "))
}

func (s *Index) indexCompactStatusStrip() string {
	parts := make([]string, 0, 2)
	if indexing := s.indexData().Indexing; indexing != nil {
		parts = append(parts, compactIndexStatusPart("index", indexing.Status, "ready"))
		if indexing.Semantic.Status != "" {
			semanticStatus := indexing.Semantic.Status
			switch semanticStatus {
			case "disabled":
				semanticStatus = "off"
			case "degraded":
				semanticStatus = "warn"
			}
			if semanticStatus == "ready" {
				parts = append(parts, compactIndexStatusPart("semantic", semanticStatus, "ready"))
			} else {
				parts = append(parts, compactIndexStatusPart("semantic", semanticStatus))
			}
		}
	}
	return strings.Join(parts, shell.TextMuted.Render("·"))
}

func compactIndexStatusPart(label, status string, nominal ...string) string {
	status = sanitizeIndexInline(status)
	display := status
	if status == "ready" && label == "semantic" {
		display = "ok"
	}
	value := strings.TrimSpace(label + " " + display)
	for _, expected := range nominal {
		if status == expected {
			return shell.TextMuted.Render(value)
		}
	}
	if status == "failed" || status == "error" {
		return shell.Rose.Render(value)
	}
	return shell.Amber.Render(value)
}

func indexStatusPart(label, status string, nominal ...string) string {
	status = sanitizeIndexInline(status)
	display := status
	if status == "ready" && label == "semantic" {
		display = "ok"
	}
	value := strings.TrimSpace(label + " " + display)
	for _, expected := range nominal {
		if status == expected {
			return shell.TextMuted.Render(value)
		}
	}
	color := shell.ColorAmber
	switch status {
	case "failed", "error":
		color = shell.ColorRose
	}
	return kit.ChipState(value, color)
}
