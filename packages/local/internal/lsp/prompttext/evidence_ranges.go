package prompttext

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func exactSnippetRange(
	source api.SourceRange,
	snippet string,
) (staticprotocol.PromptTextRange, bool) {
	if source.StartColumn == nil || source.EndLine == nil || source.EndColumn == nil ||
		source.StartLine < 1 || *source.StartColumn < 1 {
		return staticprotocol.PromptTextRange{}, false
	}
	line, character := source.StartLine-1, *source.StartColumn-1
	if uint64(line) > math.MaxUint32 || uint64(character) > math.MaxUint32 {
		return staticprotocol.PromptTextRange{}, false
	}
	start := staticprotocol.PromptTextPosition{
		Line: uint32(line), Character: uint32(character),
	}
	for _, r := range snippet {
		if r == '\n' {
			line++
			character = 0
		} else {
			character += utf16.RuneLen(r)
		}
		if uint64(line) > math.MaxUint32 || uint64(character) > math.MaxUint32 {
			return staticprotocol.PromptTextRange{}, false
		}
	}
	end := staticprotocol.PromptTextPosition{
		Line: uint32(line), Character: uint32(character),
	}
	if *source.EndLine-1 != line || *source.EndColumn-1 != character {
		return staticprotocol.PromptTextRange{}, false
	}
	return staticprotocol.PromptTextRange{
		Start: start,
		End:   end,
	}, utf8.ValidString(snippet) && start != end
}

func sourceProtocolRange(source api.SourceRange) staticprotocol.PromptTextRange {
	return staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{
			Line: uint32(source.StartLine - 1), Character: uint32(*source.StartColumn - 1),
		},
		End: staticprotocol.PromptTextPosition{
			Line: uint32(*source.EndLine - 1), Character: uint32(*source.EndColumn - 1),
		},
	}
}

func sourceHashForFile(
	publication readmodel.Publication,
	root, file string,
) (string, bool) {
	var result string
	for rowFile, source := range publication.SourcesByFile {
		if !sameFile(root, rowFile, file) {
			continue
		}
		if !sameFile(root, source.File, file) ||
			!canonicalSHA256(source.SourceHash) {
			return "", false
		}
		if result != "" {
			return "", false
		}
		result = source.SourceHash
	}
	return result, result != ""
}

func canonicalSHA256(value string) bool {
	decoded, err := hex.DecodeString(value)
	return err == nil && len(decoded) == sha256.Size &&
		hex.EncodeToString(decoded) == value
}

func sha256String(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func sourceRangesEqual(left, right api.SourceRange) bool {
	return left.File == right.File && left.StartLine == right.StartLine &&
		intPointersEqual(left.StartColumn, right.StartColumn) &&
		intPointersEqual(left.EndLine, right.EndLine) &&
		intPointersEqual(left.EndColumn, right.EndColumn)
}

func intPointersEqual(left, right *int) bool {
	return left != nil && right != nil && *left == *right
}

func sourceRangeWithin(inner, outer api.SourceRange) bool {
	if inner.File != outer.File {
		return false
	}
	innerRange, innerOK := exactSnippetRangeShape(inner)
	outerRange, outerOK := exactSnippetRangeShape(outer)
	return innerOK && outerOK &&
		comparePromptPosition(outerRange.Start, innerRange.Start) <= 0 &&
		comparePromptPosition(innerRange.End, outerRange.End) <= 0
}

func exactSnippetRangeShape(source api.SourceRange) (staticprotocol.PromptTextRange, bool) {
	if source.StartColumn == nil || source.EndLine == nil || source.EndColumn == nil ||
		source.StartLine < 1 || *source.StartColumn < 1 ||
		*source.EndLine < 1 || *source.EndColumn < 1 {
		return staticprotocol.PromptTextRange{}, false
	}
	if uint64(source.StartLine-1) > math.MaxUint32 ||
		uint64(*source.StartColumn-1) > math.MaxUint32 ||
		uint64(*source.EndLine-1) > math.MaxUint32 ||
		uint64(*source.EndColumn-1) > math.MaxUint32 {
		return staticprotocol.PromptTextRange{}, false
	}
	result := sourceProtocolRange(source)
	return result, comparePromptPosition(result.Start, result.End) < 0
}

func comparePromptPosition(
	left, right staticprotocol.PromptTextPosition,
) int {
	if left.Line < right.Line ||
		left.Line == right.Line && left.Character < right.Character {
		return -1
	}
	if left == right {
		return 0
	}
	return 1
}

func compareWorkerJoin(left, right indexprompttext.FragmentJoin) int {
	leftKey, rightKey := left.Key, right.Key
	if value := bytes.Compare([]byte(leftKey.File), []byte(rightKey.File)); value != 0 {
		return value
	}
	if value := comparePromptPosition(
		leftKey.TemplateRange.Start, rightKey.TemplateRange.Start,
	); value != 0 {
		return value
	}
	if leftKey.Interpolation < rightKey.Interpolation {
		return -1
	}
	if leftKey.Interpolation > rightKey.Interpolation {
		return 1
	}
	return bytes.Compare([]byte(left.FragmentID), []byte(right.FragmentID))
}
