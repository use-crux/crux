package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
	"github.com/use-crux/crux/packages/local/internal/tui/shell"
)

type indexRelationRef struct {
	relation api.ProjectRelation
	target   string
}

func indexRelations(index api.IndexData, definitionID string) (incoming, outgoing []indexRelationRef) {
	for _, relation := range index.Relations {
		switch {
		case relation.To == definitionID:
			incoming = append(incoming, indexRelationRef{relation: relation, target: relation.From})
		case relation.From == definitionID:
			outgoing = append(outgoing, indexRelationRef{relation: relation, target: relation.To})
		}
	}
	return incoming, outgoing
}

func (s *Index) relationCount() int {
	incoming, outgoing := indexRelations(s.indexData(), s.SelectedDefinitionID())
	return len(incoming) + len(outgoing)
}

func (s *Index) selectedRelationTarget() string {
	incoming, outgoing := indexRelations(s.indexData(), s.SelectedDefinitionID())
	all := append(incoming, outgoing...)
	if s.relationCursor < 0 || s.relationCursor >= len(all) {
		return ""
	}
	return all[s.relationCursor].target
}

func (s *Index) moveRelation(key string) bool {
	if s.focus != indexFocusDetail || s.relationCount() == 0 {
		return false
	}
	switch key {
	case "j", "down":
		s.relationCursor = min(s.relationCursor+1, s.relationCount()-1)
	case "k", "up":
		s.relationCursor = max(s.relationCursor-1, 0)
	default:
		return false
	}
	document := s.syncDetail()
	if document.hasRelation {
		s.detail.RestoreAnchor(document.relationAnchor)
	}
	return true
}

func (b *indexDocumentBuilder) renderRelations(cursor int) {
	incoming, outgoing := indexRelations(b.index, b.definition.ID)
	if len(incoming)+len(outgoing) == 0 {
		return
	}
	b.section("RELATIONS · ↵ open")
	if b.width < 64 {
		b.renderRelationStack("USED BY", incoming, 0, cursor)
		b.renderRelationStack("DEPENDS ON", outgoing, len(incoming), cursor)
		return
	}
	leftWidth := max(22, (b.width-3)/2)
	rightWidth := max(22, b.width-leftWidth-3)
	b.lines = append(b.lines,
		" "+kit.Fit(shell.TextMuted.Render(fmt.Sprintf("USED BY · %d", len(incoming))), leftWidth, "…")+
			" │ "+
			kit.Fit(shell.TextMuted.Render(fmt.Sprintf("DEPENDS ON · %d", len(outgoing))), rightWidth, "…"),
	)
	rows := max(len(incoming), len(outgoing))
	for row := 0; row < rows; row++ {
		left, right := "", ""
		selected := false
		if row < len(incoming) {
			left = b.relationText(incoming[row], cursor == row, leftWidth)
			selected = selected || cursor == row
		}
		outgoingCursor := len(incoming) + row
		if row < len(outgoing) {
			right = b.relationText(outgoing[row], cursor == outgoingCursor, rightWidth)
			selected = selected || cursor == outgoingCursor
		}
		if selected {
			b.document.relationAnchor = kit.DocumentAnchor{SourceLine: len(b.lines)}
			b.document.hasRelation = true
		}
		b.lines = append(b.lines,
			" "+kit.Fit(left, leftWidth, "…")+" │ "+kit.Fit(right, rightWidth, "…"),
		)
	}
}

func (b *indexDocumentBuilder) renderRelationStack(
	title string,
	relations []indexRelationRef,
	cursorOffset int,
	cursor int,
) {
	b.lines = append(b.lines, " "+shell.TextMuted.Render(fmt.Sprintf("%s · %d", title, len(relations))))
	for index, relation := range relations {
		selected := cursor == cursorOffset+index
		if selected {
			b.document.relationAnchor = kit.DocumentAnchor{SourceLine: len(b.lines)}
			b.document.hasRelation = true
		}
		b.lines = append(b.lines, " "+b.relationText(relation, selected, max(1, b.width-1)))
	}
}

func (b *indexDocumentBuilder) relationText(ref indexRelationRef, selected bool, width int) string {
	target := definitionName(b.index, ref.target)
	prefix := "  "
	if selected {
		prefix = shell.Teal.Render("▸") + " "
	}
	text := prefix + indexKindGlyph(definitionKind(b.index, ref.target)) + " " +
		sanitizeIndexInline(target) + "  " + shell.TextMuted.Render(sanitizeIndexInline(ref.relation.Type))
	if ref.relation.Fidelity != "" && ref.relation.Fidelity != "resolved" {
		text += " " + indexFidelityChip(ref.relation.Fidelity)
	}
	return kit.Fit(text, width, "…")
}

func definitionName(index api.IndexData, definitionID string) string {
	for _, definition := range index.Definitions {
		if definition.ID == definitionID {
			return firstNonEmpty(definition.Name, definition.ID)
		}
	}
	return definitionID
}

func definitionKind(index api.IndexData, definitionID string) string {
	for _, definition := range index.Definitions {
		if definition.ID == definitionID {
			return definition.Kind
		}
	}
	kind, _, _ := strings.Cut(definitionID, ":")
	return kind
}
