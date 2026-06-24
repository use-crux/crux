package staticparity

import (
	"encoding/json"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func NormalizeFacts(facts projectindex.IndexPatchFacts) (string, error) {
	encoded, err := json.Marshal(facts)
	if err != nil {
		return "", err
	}
	var value any
	if err := json.Unmarshal(encoded, &value); err != nil {
		return "", err
	}
	normalized := normalizeValue("", value)
	out, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func FactsEqual(left, right projectindex.IndexPatchFacts) bool {
	leftNormalized, leftErr := NormalizeFacts(left)
	rightNormalized, rightErr := NormalizeFacts(right)
	return leftErr == nil && rightErr == nil && leftNormalized == rightNormalized
}

func StaticGraphFacts(facts projectindex.IndexPatchFacts) projectindex.IndexPatchFacts {
	facts.LintFindings = nil
	facts.Diagnostics = staticGraphDiagnostics(facts.Diagnostics)
	facts.Sources = staticGraphSources(facts.Sources)
	return facts
}

func staticGraphDiagnostics(diagnostics []store.IndexDiagnostic) []store.IndexDiagnostic {
	if len(diagnostics) == 0 {
		return nil
	}
	out := make([]store.IndexDiagnostic, 0, len(diagnostics))
	for _, diagnostic := range diagnostics {
		if diagnostic.Code == "index.source_only" ||
			strings.HasPrefix(diagnostic.Code, "index.lint_") ||
			strings.HasPrefix(diagnostic.ID, "index.lint_") {
			continue
		}
		out = append(out, diagnostic)
	}
	return out
}

func staticGraphSources(sources []store.IndexSourceFile) []store.IndexSourceFile {
	if len(sources) == 0 {
		return nil
	}
	out := make([]store.IndexSourceFile, 0, len(sources))
	for _, source := range sources {
		if source.Status == "partial" && len(source.Diagnostics) == 1 && source.Diagnostics[0] == "diagnostic:index:source-only" {
			continue
		}
		out = append(out, source)
	}
	return out
}

func normalizeValue(path string, value any) any {
	switch typed := value.(type) {
	case map[string]any:
		normalized := make(map[string]any, len(typed))
		for key, item := range typed {
			normalized[key] = normalizeValue(childPath(path, key), item)
		}
		return normalized
	case []any:
		normalized := make([]any, 0, len(typed))
		for _, item := range typed {
			normalized = append(normalized, normalizeValue(arrayItemPath(path), item))
		}
		if unorderedArrayPath(path) {
			sort.SliceStable(normalized, func(i, j int) bool {
				return sortKey(normalized[i]) < sortKey(normalized[j])
			})
		}
		return normalized
	case string:
		if pathField(path) {
			return strings.ReplaceAll(typed, "\\", "/")
		}
		return typed
	default:
		return typed
	}
}

func childPath(parentPath, key string) string {
	if parentPath == "" {
		return key
	}
	return parentPath + "." + key
}

func arrayItemPath(path string) string {
	if path == "" {
		return "[]"
	}
	return path + "[]"
}

func unorderedArrayPath(path string) bool {
	switch path {
	case "definitions",
		"relations",
		"sourceRefs",
		"diagnostics",
		"lintFindings",
		"ruleDescriptors",
		"sources",
		"prompts",
		"contexts",
		"tools",
		"sourceGraph.capabilities",
		"sourceGraph.shards",
		"sourceGraph.shards[].references",
		"definitions[].sourceRefs",
		"diagnostics[].relatedDefinitionIds",
		"lintFindings[].profiles",
		"lintFindings[].relatedDefinitionIds",
		"lintFindings[].affectedDefinitionIds",
		"lintFindings[].propagatedDefinitionIds",
		"ruleDescriptors[].profiles",
		"ruleDescriptors[].requires",
		"ruleDescriptors[].messageIds",
		"sources[].definitionIds",
		"sources[].dependencies",
		"sources[].dependents",
		"sources[].diagnostics":
		return true
	default:
		return false
	}
}

func pathField(path string) bool {
	switch path {
	case "sources[].file",
		"sourceGraph.shards[].root",
		"sourceGraph.shards[].packageFile",
		"sourceGraph.shards[].configFile",
		"sourceGraph.shards[].references[]",
		"sources[].dependencies[]",
		"sources[].dependents[]":
		return true
	default:
		return strings.HasSuffix(path, ".source.file") ||
			strings.HasSuffix(path, ".range.file") ||
			strings.HasSuffix(path, ".cassettePaths[]")
	}
}

func sortKey(value any) string {
	if object, ok := value.(map[string]any); ok {
		if definitionID, ok := object["definitionId"].(string); ok {
			refID := ""
			if ref, ok := object["ref"].(map[string]any); ok {
				refID, _ = ref["id"].(string)
			}
			return definitionID + "/" + refID
		}
		for _, key := range []string{"id", "file", "name", "type"} {
			if item, ok := object[key].(string); ok {
				return item
			}
		}
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(encoded)
}
