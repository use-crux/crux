package view

import (
	"math"
	"strings"
	"unicode/utf16"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

// transformRange applies one ordered incremental edit to a half-open UTF-16
// record range. Boundary edits remain transformable; every overlap fails
// closed so semantic records can never collapse onto unrelated source.
func transformRange(
	target protocol.Range,
	edit protocol.Range,
	text string,
) (protocol.Range, bool) {
	if comparePosition(edit.End, target.Start) <= 0 {
		return shiftRange(target, edit, text)
	}
	if comparePosition(edit.Start, target.End) >= 0 {
		return target, true
	}
	return protocol.Range{}, false
}

func shiftRange(
	target protocol.Range,
	edit protocol.Range,
	text string,
) (protocol.Range, bool) {
	insertedLines, endCharacter, valid := replacementEnd(edit.Start.Character, text)
	if !valid {
		return protocol.Range{}, false
	}
	deletedLines := int64(edit.End.Line) - int64(edit.Start.Line)
	lineDelta := int64(insertedLines) - deletedLines
	result := target
	if result.Start.Line, valid = addPositionDelta(result.Start.Line, lineDelta); !valid {
		return protocol.Range{}, false
	}
	if result.End.Line, valid = addPositionDelta(result.End.Line, lineDelta); !valid {
		return protocol.Range{}, false
	}
	if edit.End.Line == target.Start.Line {
		characterDelta := int64(endCharacter) - int64(edit.End.Character)
		if result.Start.Character, valid = addPositionDelta(
			result.Start.Character,
			characterDelta,
		); !valid {
			return protocol.Range{}, false
		}
		if target.Start.Line == target.End.Line {
			if result.End.Character, valid = addPositionDelta(
				result.End.Character,
				characterDelta,
			); !valid {
				return protocol.Range{}, false
			}
		}
	}
	return result, true
}

func replacementEnd(startCharacter uint32, text string) (uint32, uint32, bool) {
	normalized := strings.ReplaceAll(text, "\r\n", "\n")
	normalized = strings.ReplaceAll(normalized, "\r", "\n")
	lines := strings.Split(normalized, "\n")
	if uint64(len(lines)-1) > math.MaxUint32 {
		return 0, 0, false
	}
	insertedLines := uint32(len(lines) - 1)
	lastLength := uint64(len(utf16.Encode([]rune(lines[len(lines)-1]))))
	if lastLength > math.MaxUint32 {
		return 0, 0, false
	}
	if insertedLines > 0 {
		return insertedLines, uint32(lastLength), true
	}
	endCharacter := uint64(startCharacter) + lastLength
	if endCharacter > math.MaxUint32 {
		return 0, 0, false
	}
	return 0, uint32(endCharacter), true
}

func comparePosition(left, right protocol.Position) int {
	switch {
	case left.Line < right.Line:
		return -1
	case left.Line > right.Line:
		return 1
	case left.Character < right.Character:
		return -1
	case left.Character > right.Character:
		return 1
	default:
		return 0
	}
}

func addPositionDelta(value uint32, delta int64) (uint32, bool) {
	next := int64(value) + delta
	if next < 0 || next > math.MaxUint32 {
		return 0, false
	}
	return uint32(next), true
}
