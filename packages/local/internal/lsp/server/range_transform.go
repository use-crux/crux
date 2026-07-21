package server

import (
	"strings"
	"unicode/utf16"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func applyDocumentChanges(
	uri protocol.DocumentURI,
	diagnostics []protocol.Diagnostic,
	changes []protocol.TextDocumentContentChangeEvent,
) ([]protocol.Diagnostic, bool) {
	transformed := cloneDiagnostics(diagnostics)
	changed := false
	for _, change := range changes {
		if change.Range == nil {
			continue
		}
		for index := range transformed {
			next, moved := transformRange(transformed[index].Range, *change.Range, change.Text)
			if moved {
				transformed[index].Range = next
				changed = true
			}
			for relatedIndex := range transformed[index].RelatedInformation {
				related := &transformed[index].RelatedInformation[relatedIndex]
				if related.Location.URI != uri {
					continue
				}
				next, moved := transformRange(related.Location.Range, *change.Range, change.Text)
				if moved {
					related.Location.Range = next
					changed = true
				}
			}
		}
	}
	return transformed, changed
}

func hasFullDocumentChange(changes []protocol.TextDocumentContentChangeEvent) bool {
	for _, change := range changes {
		if change.Range == nil {
			return true
		}
	}
	return false
}

func cloneDiagnostics(diagnostics []protocol.Diagnostic) []protocol.Diagnostic {
	cloned := append([]protocol.Diagnostic(nil), diagnostics...)
	for index := range cloned {
		cloned[index].RelatedInformation = append(
			[]protocol.DiagnosticRelatedInformation(nil),
			diagnostics[index].RelatedInformation...,
		)
	}
	return cloned
}

func transformRange(target, edit protocol.Range, text string) (protocol.Range, bool) {
	insertedLines, endCharacter := replacementEnd(edit.Start.Character, text)
	if comparePosition(edit.End, target.Start) <= 0 {
		deletedLines := int64(edit.End.Line) - int64(edit.Start.Line)
		lineDelta := int64(insertedLines) - deletedLines
		result := target
		result.Start.Line = addClamped(result.Start.Line, lineDelta)
		result.End.Line = addClamped(result.End.Line, lineDelta)
		if edit.End.Line == target.Start.Line {
			characterDelta := int64(endCharacter) - int64(edit.End.Character)
			result.Start.Character = addClamped(result.Start.Character, characterDelta)
			if target.Start.Line == target.End.Line {
				result.End.Character = addClamped(result.End.Character, characterDelta)
			}
		}
		return result, result != target
	}
	if comparePosition(edit.Start, target.End) >= 0 {
		return target, false
	}

	position := protocol.Position{
		Line:      addClamped(edit.Start.Line, int64(insertedLines)),
		Character: endCharacter,
	}
	collapsed := protocol.Range{Start: position, End: position}
	return collapsed, collapsed != target
}

func replacementEnd(startCharacter uint32, text string) (uint32, uint32) {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := strings.Split(normalized, "\n")
	insertedLines := uint32(len(lines) - 1)
	lastLength := uint32(len(utf16.Encode([]rune(lines[len(lines)-1]))))
	if insertedLines > 0 {
		return insertedLines, lastLength
	}
	return 0, startCharacter + lastLength
}

func comparePosition(left, right protocol.Position) int {
	if left.Line < right.Line || left.Line == right.Line && left.Character < right.Character {
		return -1
	}
	if left == right {
		return 0
	}
	return 1
}

func addClamped(value uint32, delta int64) uint32 {
	next := int64(value) + delta
	if next < 0 {
		return 0
	}
	return uint32(next)
}
