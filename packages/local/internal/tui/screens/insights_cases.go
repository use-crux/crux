package screens

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

type insightEvalCase struct {
	EvalID    string
	RunID     string
	StartedAt int64
	Cell      evalCell
}

func (s *Insights) linkedEvalCases(insight api.InspectInsightRecord) []insightEvalCase {
	caseIDs := insightStringSet(insight.LinkedCaseIDs)
	traceIDs := insightStringSet(insight.LinkedTraceIDs)
	caseEvalIDs := make(map[string]map[string]bool)
	for _, run := range s.evalRuns {
		for _, cell := range run.Cells {
			if _, linked := caseIDs[cell.CaseID]; !linked {
				continue
			}
			if caseEvalIDs[cell.CaseID] == nil {
				caseEvalIDs[cell.CaseID] = make(map[string]bool)
			}
			caseEvalIDs[cell.CaseID][run.EvalID] = true
		}
	}
	matches := make(map[string]insightEvalCase)
	add := func(run evalRunItem, cell evalCell) {
		key := fmt.Sprintf("%s\x00%s\x00%s", run.EvalID, cell.CaseID, cell.Variant)
		candidate := insightEvalCase{EvalID: run.EvalID, RunID: run.RunID, StartedAt: run.StartedAt, Cell: cell}
		current, found := matches[key]
		if !found || candidate.StartedAt > current.StartedAt ||
			(candidate.StartedAt == current.StartedAt && candidate.RunID > current.RunID) {
			matches[key] = candidate
		}
	}

	for _, run := range s.evalRuns {
		for row, caseID := range run.Cases {
			if _, linked := caseIDs[caseID]; !linked {
				continue
			}
			if len(caseEvalIDs[caseID]) > 1 {
				continue
			}
			for _, variant := range run.Variants {
				if cell, found := run.representativeCell(run.Cases[row], variant); found {
					add(run, cell)
				}
			}
		}
		observed := map[string]bool{}
		for _, cell := range run.Cells {
			if anyStringInSet(cell.RunIDs, traceIDs) {
				key := cell.CaseID + "\x00" + cell.Variant
				if observed[key] {
					continue
				}
				observed[key] = true
				if representative, found := representativeObservedCell(run, cell.CaseID, cell.Variant, traceIDs); found {
					add(run, representative)
				}
			}
		}
	}

	items := make([]insightEvalCase, 0, len(matches))
	for _, item := range matches {
		items = append(items, item)
	}
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].StartedAt != items[j].StartedAt {
			return items[i].StartedAt > items[j].StartedAt
		}
		if items[i].EvalID != items[j].EvalID {
			return items[i].EvalID < items[j].EvalID
		}
		if items[i].Cell.CaseID != items[j].Cell.CaseID {
			return items[i].Cell.CaseID < items[j].Cell.CaseID
		}
		if items[i].Cell.Variant != items[j].Cell.Variant {
			return items[i].Cell.Variant < items[j].Cell.Variant
		}
		return items[i].Cell.Trial < items[j].Cell.Trial
	})
	return items
}

func representativeObservedCell(
	run evalRunItem,
	caseID, variant string,
	traceIDs map[string]bool,
) (evalCell, bool) {
	var representative evalCell
	found := false
	for _, cell := range run.Cells {
		if cell.CaseID != caseID || cell.Variant != variant || !anyStringInSet(cell.RunIDs, traceIDs) {
			continue
		}
		if !found || evalCellPrecedes(cell, representative) {
			representative = cell
			found = true
		}
	}
	return representative, found
}

func (s *Insights) renderEvalCases(insight api.InspectInsightRecord, width, height int) []string {
	cases := s.linkedEvalCases(insight)
	lines := []string{padRow(" "+insightsStyles.Accent.Render(fmt.Sprintf("LINKED CASES · %d", len(cases))), width)}
	if len(cases) == 0 {
		message := "No linked eval case evidence yet — run `crux eval` to collect matching cases."
		if s.evalEvidenceErr != "" {
			message = "Eval evidence unavailable — linked cases could not be resolved."
		}
		lines = append(lines, padRow(" "+shell.TextMuted.Render(message), width))
		return clampLines(lines, width, height)
	}

	for index, item := range cases {
		if index > 0 {
			lines = append(lines, horizontalRuleDim(width))
		}
		cell := item.Cell
		title := fmt.Sprintf("%s · %s · %s · trial %d",
			kit.SanitizeInline(cell.CaseID), kit.SanitizeInline(item.EvalID),
			kit.SanitizeInline(cell.Variant), cell.Trial,
		)
		lines = append(lines, padRow(" "+evalCellGlyph(cell.Status)+"  "+shell.Text.Render(title), width))
		if input := insightEvalSummary(cell.Input); input != "" {
			lines = append(lines, insightCaseField("input", input, width))
		}
		expected, actual := insightEvalVerdict(cell.Expected), insightEvalVerdict(cell.Output)
		if expected != "" || actual != "" {
			verdict := make([]string, 0, 2)
			if expected != "" {
				verdict = append(verdict, "expected "+expected)
			}
			if actual != "" {
				verdict = append(verdict, "actual "+actual)
			}
			lines = append(lines, insightCaseField("verdict", strings.Join(verdict, " · "), width))
		}
		for _, score := range cell.Scores {
			if row := insightEvalScoreLabel(score); row != "" {
				lines = append(lines, insightCaseField("score", row, width))
			}
		}
	}
	return clampLines(lines, width, height)
}

func insightCaseField(label, value string, width int) string {
	return padRow("   "+shell.TextMuted.Render(label)+"  "+shell.Text.Render(kit.SanitizeInline(value)), width)
}

func insightEvalVerdict(value any) string {
	if value == nil {
		return ""
	}
	if values, ok := value.(map[string]any); ok {
		if verdict, found := values["verdict"]; found {
			return insightEvalValue(verdict)
		}
	}
	return insightEvalSummary(value)
}

func insightEvalSummary(value any) string {
	if value == nil {
		return ""
	}
	values, ok := value.(map[string]any)
	if !ok {
		return insightEvalValue(value)
	}
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	parts := make([]string, 0, len(keys))
	for _, key := range keys {
		value := insightEvalValue(values[key])
		if value != "" {
			parts = append(parts, kit.SanitizeInline(key)+"="+value)
		}
	}
	return strings.Join(parts, ", ")
}

func insightEvalValue(value any) string {
	raw, err := json.Marshal(sanitizeInsightEvalValue(value))
	if err != nil {
		return ""
	}
	return kit.SanitizeInline(string(raw))
}

func sanitizeInsightEvalValue(value any) any {
	switch typed := value.(type) {
	case string:
		return kit.SanitizeInline(typed)
	case []any:
		safe := make([]any, len(typed))
		for index, item := range typed {
			safe[index] = sanitizeInsightEvalValue(item)
		}
		return safe
	case map[string]any:
		safe := make(map[string]any, len(typed))
		for key, item := range typed {
			safe[kit.SanitizeInline(key)] = sanitizeInsightEvalValue(item)
		}
		return safe
	default:
		return value
	}
}

func insightEvalScoreLabel(score evalCellScore) string {
	parts := make([]string, 0, 3)
	if score.Name != "" {
		parts = append(parts, kit.SanitizeInline(score.Name))
	}
	if score.Value != nil {
		parts = append(parts, fmt.Sprintf("%g", *score.Value))
	}
	if score.Status != "" {
		parts = append(parts, kit.SanitizeInline(score.Status))
	}
	return strings.Join(parts, " · ")
}

func insightStringSet(values []string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		if value != "" {
			set[value] = true
		}
	}
	return set
}

func anyStringInSet(values []string, set map[string]bool) bool {
	for _, value := range values {
		if set[value] {
			return true
		}
	}
	return false
}
