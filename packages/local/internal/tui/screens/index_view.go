package screens

import (
	"fmt"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

func (s *Index) renderListLines(rect kit.Rect) []string {
	return blockLines(s.renderList(rect.W, rect.H), rect)
}

func (s *Index) renderDetailLines(rect kit.Rect) []string {
	return blockLines(s.renderDetail(rect.W, rect.H), rect)
}

func (s *Index) renderDetail(width, height int) string {
	definition, _, ok := s.definitions.Selected()
	if !ok {
		return centerMsg(Size{Width: width, Height: height}, "no definition focused")
	}
	status := sanitizeIndexInline(resourceStatus(s.snapshot.Snapshot()))
	meta := appendResourceStatus(indexDocumentPosition(s.detail.Position()), status)
	meta = appendResourceStatus(meta, s.currentExportState())
	header := overviewPaneHeader(
		width,
		focusTitle(sanitizeIndexInline(definition.Name), s.focus == indexFocusDetail),
		sanitizeIndexInline(definition.Kind),
		meta,
	)
	return header + "\n" + strings.Join(s.detail.Render(), "\n")
}

func indexListPosition(position kit.ListPosition) string {
	if position.Total == 0 {
		return "0/0"
	}
	return fmt.Sprintf("%d/%d", position.SelectedIndex+1, position.Total)
}

func indexDocumentPosition(position kit.DocumentPosition) string {
	if position.TotalLines == 0 {
		return "0/0"
	}
	return fmt.Sprintf("%d–%d/%d", position.FirstLine, position.LastLine, position.TotalLines)
}

func (s *Index) syncDetail() indexDefinitionDocument {
	definition, _, ok := s.definitions.Selected()
	if !ok {
		s.detail.SetContent("", "")
		return indexDefinitionDocument{}
	}
	document := s.definitionDocument(definition)
	s.detail.SetContent(definition.ID, document.content)
	return document
}

func (s *Index) definitionDocument(definition api.ProjectDefinition) indexDefinitionDocument {
	return buildIndexDefinitionDocument(s.indexData(), definition, s.layout.detail.W)
}
