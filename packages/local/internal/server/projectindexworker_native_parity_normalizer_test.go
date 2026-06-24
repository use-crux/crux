package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/devtools"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func normalizeProjectIndexFactsForParity(facts devtools.IndexPatchFacts) (string, error) {
	encoded, err := json.Marshal(facts)
	if err != nil {
		return "", err
	}
	var value any
	if err := json.Unmarshal(encoded, &value); err != nil {
		return "", err
	}
	normalized := normalizeProjectIndexParityValue("", value)
	out, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func normalizedProjectIndexFactsEqual(left, right devtools.IndexPatchFacts) bool {
	leftNormalized, leftErr := normalizeProjectIndexFactsForParity(left)
	rightNormalized, rightErr := normalizeProjectIndexFactsForParity(right)
	return leftErr == nil && rightErr == nil && leftNormalized == rightNormalized
}

func assertProjectIndexFactsEqual(t *testing.T, label string, want, got devtools.IndexPatchFacts) {
	t.Helper()
	wantNormalized, wantErr := normalizeProjectIndexFactsForParity(want)
	if wantErr != nil {
		t.Fatalf("normalize expected %s facts: %v", label, wantErr)
	}
	gotNormalized, gotErr := normalizeProjectIndexFactsForParity(got)
	if gotErr != nil {
		t.Fatalf("normalize actual %s facts: %v", label, gotErr)
	}
	if wantNormalized == gotNormalized {
		return
	}
	dir := os.Getenv("CRUX_INDEXER_PARITY_DIFF_DIR")
	if dir == "" {
		dir = t.TempDir()
	} else if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("create %s parity diff dir: %v", label, err)
	}
	wantPath := filepath.Join(dir, "typescript-facts.json")
	gotPath := filepath.Join(dir, "native-facts.json")
	if err := os.WriteFile(wantPath, []byte(wantNormalized), 0o600); err != nil {
		t.Fatalf("write expected %s facts: %v", label, err)
	}
	if err := os.WriteFile(gotPath, []byte(gotNormalized), 0o600); err != nil {
		t.Fatalf("write actual %s facts: %v", label, err)
	}
	t.Fatalf("normalized %s facts mismatch\nTypeScript facts: %s\nNative facts: %s", label, wantPath, gotPath)
}

func projectIndexStaticGraphFactsForParity(facts devtools.IndexPatchFacts) devtools.IndexPatchFacts {
	facts.LintFindings = nil
	facts.Diagnostics = projectIndexStaticGraphDiagnosticsForParity(facts.Diagnostics)
	facts.Sources = projectIndexStaticGraphSourcesForParity(facts.Sources)
	return facts
}

func projectIndexStaticGraphDiagnosticsForParity(diagnostics []store.IndexDiagnostic) []store.IndexDiagnostic {
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

func projectIndexStaticGraphSourcesForParity(sources []store.IndexSourceFile) []store.IndexSourceFile {
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

func normalizeProjectIndexParityValue(path string, value any) any {
	switch typed := value.(type) {
	case map[string]any:
		normalized := make(map[string]any, len(typed))
		for key, item := range typed {
			normalized[key] = normalizeProjectIndexParityValue(projectIndexParityChildPath(path, key), item)
		}
		return normalized
	case []any:
		normalized := make([]any, 0, len(typed))
		for _, item := range typed {
			normalized = append(normalized, normalizeProjectIndexParityValue(projectIndexParityArrayItemPath(path), item))
		}
		if projectIndexParityUnorderedArrayPath(path) {
			sort.SliceStable(normalized, func(i, j int) bool {
				return projectIndexParitySortKey(normalized[i]) < projectIndexParitySortKey(normalized[j])
			})
		}
		return normalized
	case string:
		if projectIndexParityPathField(path) {
			return strings.ReplaceAll(typed, "\\", "/")
		}
		return typed
	default:
		return typed
	}
}

func projectIndexParityChildPath(parentPath, key string) string {
	if parentPath == "" {
		return key
	}
	return parentPath + "." + key
}

func projectIndexParityArrayItemPath(path string) string {
	if path == "" {
		return "[]"
	}
	return path + "[]"
}

func projectIndexParityUnorderedArrayPath(path string) bool {
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

func projectIndexParityPathField(path string) bool {
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

func projectIndexParitySortKey(value any) string {
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
