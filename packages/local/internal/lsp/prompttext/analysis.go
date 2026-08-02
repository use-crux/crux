package prompttext

import (
	"path/filepath"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/use-crux/crux/packages/local/internal/api"
	promptview "github.com/use-crux/crux/packages/local/internal/lsp/prompttext/view"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
)

func canonicalTemplateRanges(
	publication readmodel.Publication,
	root string,
	file string,
	text string,
) map[protocol.Range]struct{} {
	ranges := make(map[protocol.Range]struct{})
	for _, definition := range publication.DefinitionsByID {
		if definition.ID == "" {
			continue
		}
		for _, sourceRef := range definition.SourceRefs {
			sourceRange, ok := canonicalSourceRefRange(sourceRef, root, file, text)
			if ok {
				ranges[sourceRange] = struct{}{}
			}
		}
	}
	return ranges
}

func canonicalSourceRefRange(
	sourceRef api.ProjectSourceRef,
	root string,
	file string,
	text string,
) (protocol.Range, bool) {
	if sourceRef.ID == "" || sourceRef.Fidelity != "resolved" ||
		sourceRef.Snippet == nil || sourceRef.Snippet.Truncated ||
		!sameFile(root, sourceRef.Source.File, file) ||
		!sameFile(root, sourceRef.Snippet.Range.File, file) ||
		!canonicalMarkdownSourceRef(sourceRef) {
		return protocol.Range{}, false
	}
	sourceRange, start, end, ok := exactSourceRange(sourceRef.Snippet.Range, text)
	if !ok || sourceRef.Snippet.Source != text[start:end] {
		return protocol.Range{}, false
	}
	return sourceRange, true
}

func canonicalMarkdownSourceRef(sourceRef api.ProjectSourceRef) bool {
	_, ok := canonicalMarkdownSourceKind(sourceRef)
	return ok
}

func canonicalMarkdownSourceKind(
	sourceRef api.ProjectSourceRef,
) (promptview.PromptTextSourceKind, bool) {
	promptText, ok := sourceRef.Metadata["promptText"].(map[string]any)
	if !ok {
		return "", false
	}
	tag, tagOK := promptText["tag"].(string)
	language, languageOK := promptText["language"].(string)
	lifecycle, lifecycleOK := promptText["lifecycle"].(string)
	sourceKind, sourceKindOK := promptText["sourceKind"].(string)
	if !tagOK || !languageOK || !lifecycleOK || !sourceKindOK ||
		tag != "md" || language != "markdown" ||
		(lifecycle != "static" && lifecycle != "dynamic") ||
		sourceRef.Role != sourceRef.Property ||
		(sourceRef.Role != "prompt" && sourceRef.Role != "system") {
		return "", false
	}
	kind := promptview.PromptTextSourceKind(sourceKind)
	switch kind {
	case promptview.PromptTextSourceNamedFragment:
		return kind, sourceRef.Symbol != ""
	case promptview.PromptTextSourceOwner,
		promptview.PromptTextSourceAnonymousFragment:
		return kind, sourceRef.Symbol == ""
	default:
		return "", false
	}
}

func sameFile(root, left, right string) bool {
	return filepath.Clean(resolveFile(root, left)) == filepath.Clean(resolveFile(root, right))
}

func resolveFile(root, file string) string {
	if filepath.IsAbs(file) {
		return file
	}
	return filepath.Join(root, file)
}

func exactSourceRange(
	source api.SourceRange,
	text string,
) (protocol.Range, int, int, bool) {
	if source.EndLine == nil || source.StartColumn == nil || source.EndColumn == nil {
		return protocol.Range{}, 0, 0, false
	}
	startPosition, start, ok := sourcePosition(text, source.StartLine, *source.StartColumn)
	if !ok {
		return protocol.Range{}, 0, 0, false
	}
	endPosition, end, ok := sourcePosition(text, *source.EndLine, *source.EndColumn)
	if !ok || end < start {
		return protocol.Range{}, 0, 0, false
	}
	return protocol.Range{Start: startPosition, End: endPosition}, start, end, true
}

func sourcePosition(text string, oneBasedLine, oneBasedUTF16Column int) (protocol.Position, int, bool) {
	if oneBasedLine < 1 || oneBasedUTF16Column < 1 {
		return protocol.Position{}, 0, false
	}
	lineStart := 0
	for line := 1; line < oneBasedLine; line++ {
		next := strings.IndexByte(text[lineStart:], '\n')
		if next < 0 {
			return protocol.Position{}, 0, false
		}
		lineStart += next + 1
	}
	lineEnd := len(text)
	if next := strings.IndexByte(text[lineStart:], '\n'); next >= 0 {
		lineEnd = lineStart + next
	}
	targetUnits := oneBasedUTF16Column - 1
	if uint64(oneBasedLine-1) > uint64(^uint32(0)) ||
		uint64(targetUnits) > uint64(^uint32(0)) {
		return protocol.Position{}, 0, false
	}
	units := 0
	for offset := lineStart; offset < lineEnd; {
		if units == targetUnits {
			return protocol.Position{
				Line: uint32(oneBasedLine - 1), Character: uint32(targetUnits),
			}, offset, true
		}
		r, size := utf8.DecodeRuneInString(text[offset:lineEnd])
		if r == utf8.RuneError && size == 1 {
			return protocol.Position{}, 0, false
		}
		nextUnits := units + utf16.RuneLen(r)
		if nextUnits > targetUnits {
			return protocol.Position{}, 0, false
		}
		units = nextUnits
		offset += size
	}
	if units != targetUnits {
		return protocol.Position{}, 0, false
	}
	return protocol.Position{
		Line: uint32(oneBasedLine - 1), Character: uint32(targetUnits),
	}, lineEnd, true
}
