package screens

import (
	"strconv"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/tui/kit"
)

func encodeDocumentAnchor(pane *kit.DocumentPane) string {
	anchor, ok := pane.Anchor()
	if !ok {
		return ""
	}
	return strconv.Itoa(anchor.SourceLine) + ":" + strconv.Itoa(anchor.SourceCell)
}

func restoreDocumentAnchor(pane *kit.DocumentPane, encoded string) bool {
	line, cell, ok := strings.Cut(encoded, ":")
	if !ok {
		return false
	}
	sourceLine, lineErr := strconv.Atoi(line)
	sourceCell, cellErr := strconv.Atoi(cell)
	if lineErr != nil || cellErr != nil || sourceLine < 0 || sourceCell < 0 {
		return false
	}
	return pane.RestoreAnchor(kit.DocumentAnchor{SourceLine: sourceLine, SourceCell: sourceCell})
}
