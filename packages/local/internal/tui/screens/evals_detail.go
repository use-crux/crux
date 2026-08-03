package screens

import (
	"fmt"
	"image/color"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/resource"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

type evalsDocument struct {
	content    string
	cellAnchor kit.DocumentAnchor
}

func (s *Evals) renderDetailLines(rect kit.Rect) []string {
	return blockLines(s.renderDetail(rect.W, rect.H), rect)
}

func (s *Evals) renderDetail(width, height int) string {
	item, _, ok := s.catalog.Selected()
	if !ok {
		return centerMsg(Size{Width: width, Height: height}, "no Eval focused")
	}
	status := resourceStatus(s.runResource.Snapshot())
	meta := appendResourceStatus(indexDocumentPosition(s.detail.Position()), status)
	subtitle := "latest run"
	if s.selectedRunID != "" {
		subtitle = kit.TruncateMiddle(sanitizeEvals(s.selectedRunID), max(8, width/2), "…")
	}
	header := overviewPaneHeader(
		width,
		focusTitle(sanitizeEvals(item.ID), s.focus == evalsFocusGrid),
		subtitle,
		meta,
	)
	if s.selectedRunID != "" && !s.runResource.Snapshot().HasValue {
		return header + "\n" + centerMsg(
			Size{Width: width, Height: max(0, height-3)},
			resourceStateMessage(s.runResource.Snapshot().State, s.runResource.Snapshot().Err, "Eval run"),
		)
	}
	return header + "\n" + strings.Join(s.detail.Render(), "\n")
}

func (s *Evals) syncDetail(anchorCell bool) {
	if s.layout.detail.W <= 0 {
		return
	}
	document := s.buildDocument(s.layout.detail.W)
	documentID := s.selectedEvalID() + "/" + s.selectedRunID
	s.detail.SetContent(documentID, document.content)
	if anchorCell && document.content != "" {
		s.detail.RestoreAnchor(document.cellAnchor)
	}
}

func (s *Evals) buildDocument(width int) evalsDocument {
	if s.run.RunID == "" {
		return evalsDocument{}
	}
	lines := make([]string, 0, 48)
	section := func(title string) {
		lines = append(lines, " "+shell.SectionTag.Render(title))
	}
	field := func(label, value string) {
		if value == "" {
			return
		}
		rows := strings.TrimRight(labelValueRows(label, value, width, shell.ColorText), "\n")
		lines = append(lines, strings.Split(rows, "\n")...)
	}
	fieldTone := func(label, value string, tone color.Color) {
		if value == "" {
			return
		}
		rows := strings.TrimRight(labelValueRows(label, value, width, tone), "\n")
		lines = append(lines, strings.Split(rows, "\n")...)
	}

	section("EVAL RUN")
	field("run", s.run.RunID)
	fieldTone("status", s.runStatusLabel(s.run), evalRunStatusTone(s.run))
	if s.run.StartedAt > 0 {
		field("started", evalRunAge(s.now(), s.run.StartedAt)+" ago")
	}

	section("CASE × VARIANT")
	gridStart := len(lines)
	lines = append(lines, s.renderGrid(width)...)
	document := evalsDocument{cellAnchor: kit.DocumentAnchor{
		SourceLine: gridStart + 1 + s.cellRow,
	}}

	cell := s.run.cell(s.cellRow, s.cellColumn)
	section("SELECTED CELL")
	identity := cell.CaseID + " × " + cell.Variant
	if s.run.trialCount(cell.CaseID, cell.Variant) > 1 {
		identity += fmt.Sprintf(" · trial %d", cell.Trial)
	}
	field("identity", identity)
	fieldTone("status", normalizeEvalCellStatus(cell.Status), evalCellTone(cell.Status))
	for _, score := range cell.Scores {
		if score.Value == nil {
			continue
		}
		gate, hasGate := s.gateForCell(cell, score.Name)
		fieldTone("score · "+score.Name, fmt.Sprintf("%.3f", *score.Value), evalScoreTone(score, gate, hasGate))
		if gate, ok := s.gateForCell(cell, score.Name); ok && gate.Passed != nil {
			label := "fail"
			tone := shell.ColorRose
			if *gate.Passed {
				label, tone = "pass", shell.ColorGreen
			}
			value := label
			if gate.Threshold != nil {
				value += fmt.Sprintf(" · threshold %.3f", *gate.Threshold)
			}
			fieldTone("gate · "+score.Name, value, tone)
		}
	}
	if cell.Task.Status == "reused" && cell.Task.Reason != "" {
		field("reuse", cell.Task.Reason)
	}
	if cell.Metrics.DurationMs != nil {
		field("duration", formatEvalDuration(*cell.Metrics.DurationMs))
	}
	if cell.Metrics.CostUSD != nil {
		field("cost", fmt.Sprintf("$%.4f", *cell.Metrics.CostUSD))
	}
	s.appendObservedRun(field, cell)
	s.appendRunHistory(&lines, width)
	s.appendBaseline(&lines, width)

	document.content = strings.Join(lines, "\n")
	return document
}

func (s *Evals) renderGrid(width int) []string {
	if len(s.run.Cases) == 0 || len(s.run.Variants) == 0 {
		return []string{" " + shell.TextDim.Render("no cells recorded")}
	}
	caseWidth := min(18, max(8, width/4))
	cellWidth := max(10, (width-caseWidth-2)/len(s.run.Variants))
	cellWidth = min(16, cellWidth)
	header := " " + strings.Repeat(" ", caseWidth)
	for _, variant := range s.run.Variants {
		header += " " + padEvalGridCell(shell.TextDim.Render(sanitizeEvals(variant)), cellWidth)
	}
	lines := []string{kit.Fit(header, width, "…")}
	for row, caseID := range s.run.Cases {
		line := " " + padEvalGridCell(shell.Text.Render(sanitizeEvals(caseID)), caseWidth)
		for column := range s.run.Variants {
			cell := s.run.cell(row, column)
			value := evalCellGlyph(cell.Status)
			if row == s.cellRow && column == s.cellColumn {
				value = shell.TealBold.Render("›") + value
			} else {
				value = " " + value
			}
			line += " " + padEvalGridCell(value, cellWidth)
		}
		lines = append(lines, kit.Fit(line, width, "…"))
	}
	return lines
}

func (s *Evals) appendObservedRun(field func(string, string), cell evalCell) {
	if len(cell.RunIDs) == 0 {
		return
	}
	runID := cell.RunIDs[0]
	snapshot := s.localRunResource.Snapshot()
	if snapshot.Token.Owner != evalLocalRunOwner(runID) ||
		snapshot.State == resource.ResourceLoading || snapshot.Refreshing {
		field("observed run", sanitizeEvals(runID)+" · checking")
		return
	}
	if snapshot.Err != nil {
		field("observed run", "availability check failed")
		return
	}
	if !snapshot.HasValue || !snapshot.Value.Available {
		field("observed run", "not recorded locally")
		return
	}
	field("observed run", sanitizeEvals(runID)+" · Enter to open")
}

func (s *Evals) appendRunHistory(lines *[]string, width int) {
	history := s.historyForEval(s.selectedEvalID())
	if len(history) == 0 {
		return
	}
	*lines = append(*lines, " "+shell.SectionTag.Render("RECENT RUNS"))
	for _, run := range history {
		passed, failed := run.passFailCounts()
		marker := " "
		if run.RunID == s.selectedRunID {
			marker = shell.Teal.Render("›")
		}
		row := fmt.Sprintf(" %s %s  %s  %d/%d  %s ago",
			marker, sanitizeEvals(run.RunID), s.runStatusLabel(run), passed, failed,
			evalRunAge(s.now(), run.StartedAt),
		)
		*lines = append(*lines, kit.Fit(row, width, "…"))
	}
}

func (s *Evals) appendBaseline(lines *[]string, width int) {
	baseline := s.baselineForEval(s.selectedEvalID())
	if baseline.BaselineID == "" {
		return
	}
	*lines = append(*lines, " "+shell.SectionTag.Render("BASELINE"))
	appendField := func(label, value string, tone color.Color) {
		if value == "" {
			return
		}
		rows := strings.TrimRight(labelValueRows(label, value, width, tone), "\n")
		*lines = append(*lines, strings.Split(rows, "\n")...)
	}
	appendField("arm", baseline.SelectedArm, shell.ColorText)
	if baseline.PromotedAt > 0 {
		appendField("promoted", evalRunAge(s.now(), baseline.PromotedAt)+" ago", shell.ColorText)
	}
	appendField("by", baseline.PromotedBy, shell.ColorText)
	for _, compatibility := range baseline.Compatibility.Cases {
		tone := shell.ColorGreen
		if compatibility.Status != "compatible" {
			tone = shell.ColorRose
		}
		value := compatibility.Status
		if compatibility.Reason != "" {
			value += " · " + compatibility.Reason
		}
		appendField("case · "+compatibility.CaseID, value, tone)
	}
}

func (s *Evals) gateForCell(cell evalCell, name string) (evalGate, bool) {
	for _, gate := range s.run.Gates {
		if gate.VariantName == cell.Variant && (gate.Name == name || name == "") {
			return gate, true
		}
	}
	return evalGate{}, false
}
