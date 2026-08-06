package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

func (s *Index) renderList(width, height int) string {
	snapshot := s.snapshot.Snapshot()
	status := sanitizeIndexInline(resourceStatus(snapshot))
	meta := appendResourceStatus(indexListPosition(s.definitions.Position()), status)
	if status == "" {
		meta = appendResourceStatus(meta, s.indexStatusStrip())
	}
	meta = appendResourceStatus(meta, s.currentExportState())
	subtitle := fmt.Sprintf("%d · by %s", len(snapshot.Value.Definitions), s.groupAxisLabel())
	if compactStatus := s.indexCompactStatusStrip(); width < 64 && status == "" && compactStatus != "" {
		// Compact panes have room for the title or the status, but not the
		// duplicated count, grouping label, position, and status together.
		// Preserve whole state names instead of rendering ambiguous fragments
		// such as "index read…".
		subtitle = ""
		meta = compactStatus
	}
	header := overviewPaneHeader(width, focusTitle("Definitions", s.focus == indexFocusDefinitions),
		subtitle, meta)
	hdrH := strings.Count(header, "\n") + 1
	bodyRows := height - hdrH

	var b strings.Builder
	b.WriteString(header)
	b.WriteString("\n")

	rows := s.definitions.Render(func(d api.ProjectDefinition, index int, selected bool, rowWidth int) string {
		row := s.renderListRow(d, rowWidth, selected && s.focus == indexFocusDefinitions)
		if s.groupStartIDs[d.ID] {
			return s.renderDefinitionGroupHeader(d, rowWidth) + "\n" + row
		}
		return row
	})
	count := 0
	for _, row := range rows {
		if count >= bodyRows {
			break
		}
		b.WriteString(row)
		b.WriteString("\n")
		count++
	}
	for ; count < bodyRows; count++ {
		b.WriteString(strings.Repeat(" ", width))
		b.WriteString("\n")
	}
	return strings.TrimRight(b.String(), "\n")
}

func (s *Index) renderListRow(d api.ProjectDefinition, width int, selected bool) string {
	bar := "  "
	if selected {
		bar = shell.SelectionBar(shell.ColorTeal) + " "
	}
	kindGlyph := indexKindGlyph(d.Kind)
	name := shell.Text.Render(sanitizeIndexInline(d.Name))
	if d.Name == "" {
		name = shell.Text.Render(sanitizeIndexInline(d.ID))
	}
	parts := []string{bar, kindGlyph, " ", name}
	if d.Fidelity != "" && d.Fidelity != "resolved" {
		parts = append(parts, " ", indexFidelityChip(d.Fidelity))
	}
	if count := s.activeLintCounts[d.ID]; count > 0 {
		parts = append(parts, " ", kit.ChipState(fmt.Sprintf("lint %d", count), shell.ColorAmber))
	}
	return padRow(strings.Join(parts, ""), width)
}

func (s *Index) renderDefinitionGroupHeader(definition api.ProjectDefinition, width int) string {
	group := s.definitionGroup(definition)
	count := s.groupCount(group)
	label := shell.SectionTag.Render(strings.ToUpper(sanitizeIndexInline(group)))
	meta := shell.TextMuted.Render(fmt.Sprintf(" %d", count))
	return padRow(" "+label+meta, width)
}
