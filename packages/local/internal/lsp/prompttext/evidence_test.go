package prompttext

import (
	"crypto/sha256"
	"encoding/hex"
	"reflect"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	indexprompttext "github.com/use-crux/crux/packages/local/internal/projectindex/prompttext"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestSemanticPreviewEvidenceBuildsExactReachableJoin(t *testing.T) {
	t.Parallel()

	const (
		root         = "/repo"
		documentFile = "/repo/src/writer.ts"
		documentText = "const value = md`A ${shared} Z`\n"
		fragmentFile = "/repo/src/shared.ts"
		fragmentText = "export const shared = md`Shared`\n"
		ownerID      = "prompt:writer:source:prompt:body"
		targetID     = "prompt:writer:source:system:shared"
	)
	ownerRange := sourceRange(documentFile, documentText, "md`A ${shared} Z`")
	expressionRange := sourceRange(documentFile, documentText, "shared")
	targetRange := sourceRange(fragmentFile, fragmentText, "md`Shared`")
	publication := readmodel.Publication{
		DefinitionsByID: map[string]api.ProjectDefinition{
			"prompt:writer": {
				ID: "prompt:writer",
				SourceRefs: []api.ProjectSourceRef{
					promptTextSourceRef(
						ownerID, "prompt", "", documentText, ownerRange,
						[]map[string]any{{
							"kind":                "named-fragment",
							"ownerSourceRefId":    ownerID,
							"ownerTemplateRange":  rangeMetadata(ownerRange),
							"interpolationIndex":  float64(0),
							"expressionRange":     rangeMetadata(expressionRange),
							"targetSourceRefId":   targetID,
							"targetTemplateRange": rangeMetadata(targetRange),
							"proof":               "semantic-exact",
						}},
					),
					promptTextSourceRef(
						targetID, "prompt", "shared", fragmentText, targetRange, nil,
					),
				},
			},
		},
		SourcesByFile: map[string]api.IndexSourceFile{
			documentFile: {File: documentFile, SourceHash: sourceHash(documentText)},
			fragmentFile: {File: fragmentFile, SourceHash: sourceHash(fragmentText)},
		},
	}

	fragments, joins := semanticPreviewEvidence(
		publication, root, documentFile, documentText,
	)
	wantFragments := []indexprompttext.Fragment{{
		ID: targetID, Symbol: "shared", File: fragmentFile,
		SourceHash: sourceHash(fragmentText),
		Range:      protocolRange(targetRange),
		Snippet:    "md`Shared`",
	}}
	wantJoins := []indexprompttext.FragmentJoin{{
		Key: staticprotocol.PromptTextInterpolationJoinKey{
			File: documentFile, SourceHash: sourceHash(documentText),
			TemplateRange:   protocolRange(ownerRange),
			Interpolation:   0,
			ExpressionRange: protocolRange(expressionRange),
		},
		FragmentID: targetID,
		Proof:      staticprotocol.PromptTextProofSemanticExact,
	}}
	if !reflect.DeepEqual(fragments, wantFragments) ||
		!reflect.DeepEqual(joins, wantJoins) {
		t.Fatalf(
			"evidence = (%#v, %#v), want (%#v, %#v)",
			fragments, joins, wantFragments, wantJoins,
		)
	}
}

func TestSemanticPreviewEvidenceRejectsAmbiguousOccurrence(t *testing.T) {
	t.Parallel()

	const (
		file   = "/repo/writer.ts"
		source = "const value = md`${shared}`\nconst shared = md`Shared`\n"
	)
	ownerRange := sourceRange(file, source, "md`${shared}`")
	expressionRange := sourceRange(file, source, "shared")
	targetRange := sourceRange(file, source, "md`Shared`")
	owner := promptTextSourceRef("owner", "prompt", "", source, ownerRange, nil)
	target := promptTextSourceRef("target", "prompt", "shared", source, targetRange, nil)
	join := map[string]any{
		"kind": "named-fragment", "ownerSourceRefId": "owner",
		"ownerTemplateRange":  rangeMetadata(ownerRange),
		"interpolationIndex":  float64(0),
		"expressionRange":     rangeMetadata(expressionRange),
		"targetSourceRefId":   "target",
		"targetTemplateRange": rangeMetadata(targetRange),
		"proof":               "semantic-exact",
	}
	owner.Metadata["promptText"].(map[string]any)["fragmentJoins"] =
		[]map[string]any{join, join}
	publication := readmodel.Publication{
		DefinitionsByID: map[string]api.ProjectDefinition{
			"prompt": {ID: "prompt", SourceRefs: []api.ProjectSourceRef{owner, target}},
		},
		SourcesByFile: map[string]api.IndexSourceFile{
			file: {File: file, SourceHash: sourceHash(source)},
		},
	}

	fragments, joins := semanticPreviewEvidence(publication, "/repo", file, source)
	if len(fragments) != 0 || len(joins) != 0 {
		t.Fatalf("ambiguous evidence = (%#v, %#v), want empty", fragments, joins)
	}
}

func TestSemanticPreviewEvidenceRejectsCyclicJoins(t *testing.T) {
	t.Parallel()

	const (
		file   = "/repo/writer.ts"
		source = "const first = md`${second}`\nconst second = md`${first}`\n"
	)
	firstRange := sourceRange(file, source, "md`${second}`")
	secondRange := sourceRange(file, source, "md`${first}`")
	firstExpression := sourceRange(file, source, "second")
	secondExpression := sourceRangeOccurrence(file, source, "first", 2)
	first := promptTextSourceRef(
		"first", "prompt", "first", source, firstRange,
		[]map[string]any{fragmentJoinMetadata(
			"first", firstRange, firstExpression, "second", secondRange,
		)},
	)
	second := promptTextSourceRef(
		"second", "prompt", "second", source, secondRange,
		[]map[string]any{fragmentJoinMetadata(
			"second", secondRange, secondExpression, "first", firstRange,
		)},
	)
	publication := readmodel.Publication{
		DefinitionsByID: map[string]api.ProjectDefinition{
			"prompt": {ID: "prompt", SourceRefs: []api.ProjectSourceRef{first, second}},
		},
		SourcesByFile: map[string]api.IndexSourceFile{
			file: {File: file, SourceHash: sourceHash(source)},
		},
	}

	fragments, joins := semanticPreviewEvidence(publication, "/repo", file, source)
	if len(fragments) != 0 || len(joins) != 0 {
		t.Fatalf("cyclic evidence = (%#v, %#v), want empty", fragments, joins)
	}
}

func promptTextSourceRef(
	id, role, symbol, fullText string,
	source api.SourceRange,
	joins []map[string]any,
) api.ProjectSourceRef {
	_, start, end, ok := exactSourceRange(source, fullText)
	if !ok {
		panic("invalid test range")
	}
	promptText := map[string]any{
		"tag": "md", "language": "markdown", "lifecycle": "static",
	}
	if joins != nil {
		promptText["fragmentJoins"] = joins
	}
	return api.ProjectSourceRef{
		ID: id, Role: role, Property: role, Symbol: symbol,
		Source: api.SourceLoc{File: source.File, Line: source.StartLine},
		Snippet: &api.SourceSnippet{
			Source: fullText[start:end], Language: "typescript", Range: source,
		},
		Fidelity: "resolved",
		Metadata: map[string]any{"promptText": promptText},
	}
}

func sourceRange(file, source, snippet string) api.SourceRange {
	return sourceRangeOccurrence(file, source, snippet, 1)
}

func sourceRangeOccurrence(
	file, source, snippet string,
	occurrence int,
) api.SourceRange {
	start, offset := -1, 0
	for index := 0; index < occurrence; index++ {
		next := strings.Index(source[offset:], snippet)
		if next < 0 {
			break
		}
		start = offset + next
		offset = start + len(snippet)
	}
	if start < 0 {
		panic("snippet missing from test source")
	}
	line := 1 + strings.Count(source[:start], "\n")
	lineStart := strings.LastIndex(source[:start], "\n") + 1
	startColumn := start - lineStart + 1
	endLine := line + strings.Count(snippet, "\n")
	endColumn := startColumn + len(snippet)
	if endLine != line {
		endColumn = len(snippet) - strings.LastIndex(snippet, "\n")
	}
	return api.SourceRange{
		File: file, StartLine: line, StartColumn: &startColumn,
		EndLine: &endLine, EndColumn: &endColumn,
	}
}

func rangeMetadata(source api.SourceRange) map[string]any {
	return map[string]any{
		"file": source.File, "startLine": float64(source.StartLine),
		"startColumn": float64(*source.StartColumn),
		"endLine":     float64(*source.EndLine), "endColumn": float64(*source.EndColumn),
	}
}

func fragmentJoinMetadata(
	ownerID string,
	ownerRange api.SourceRange,
	expressionRange api.SourceRange,
	targetID string,
	targetRange api.SourceRange,
) map[string]any {
	return map[string]any{
		"kind": "named-fragment", "ownerSourceRefId": ownerID,
		"ownerTemplateRange":  rangeMetadata(ownerRange),
		"interpolationIndex":  float64(0),
		"expressionRange":     rangeMetadata(expressionRange),
		"targetSourceRefId":   targetID,
		"targetTemplateRange": rangeMetadata(targetRange),
		"proof":               "semantic-exact",
	}
}

func protocolRange(source api.SourceRange) staticprotocol.PromptTextRange {
	return staticprotocol.PromptTextRange{
		Start: staticprotocol.PromptTextPosition{
			Line: uint32(source.StartLine - 1), Character: uint32(*source.StartColumn - 1),
		},
		End: staticprotocol.PromptTextPosition{
			Line: uint32(*source.EndLine - 1), Character: uint32(*source.EndColumn - 1),
		},
	}
}

func sourceHash(source string) string {
	sum := sha256.Sum256([]byte(source))
	return hex.EncodeToString(sum[:])
}
