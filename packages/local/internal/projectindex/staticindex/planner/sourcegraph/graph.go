package sourcegraph

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type graph struct {
	SchemaVersion int      `json:"schemaVersion"`
	ProducedBy    string   `json:"producedBy"`
	Capabilities  []string `json:"capabilities"`
	Shards        []shard  `json:"shards"`
}

type shard struct {
	ID           string   `json:"id"`
	Root         string   `json:"root"`
	Name         string   `json:"name,omitempty"`
	PackageFile  string   `json:"packageFile,omitempty"`
	ConfigFile   string   `json:"configFile,omitempty"`
	DiscoveredBy string   `json:"discoveredBy,omitempty"`
	References   []string `json:"references,omitempty"`
}

func Marshal(root string) (json.RawMessage, error) {
	data, err := json.Marshal(build(root))
	if err != nil {
		return nil, fmt.Errorf("encode Static Index source graph: %w", err)
	}
	return data, nil
}

func build(root string) graph {
	return graph{
		SchemaVersion: 1,
		ProducedBy:    "@use-crux/indexer",
		Capabilities: []string{
			"source-dependencies",
			"source-dependents",
			"definition-ownership",
			"diagnostic-ownership",
			"project-shards",
		},
		Shards: discoverShards(root),
	}
}

func discoverShards(root string) []shard {
	roots := append([]string{root}, workspacePackageRoots(root)...)
	seen := map[string]bool{}
	shards := make([]shard, 0, len(roots))
	for _, packageRoot := range roots {
		if seen[packageRoot] {
			continue
		}
		seen[packageRoot] = true
		shards = append(shards, shardFromRoot(root, packageRoot))
	}
	idByRoot := map[string]string{}
	for _, shard := range shards {
		idByRoot[shard.Root] = shard.ID
	}
	for i := range shards {
		shards[i].References = shardReferences(shards[i].ConfigFile, idByRoot)
	}
	sort.Slice(shards, func(i, j int) bool { return shards[i].ID < shards[j].ID })
	return shards
}

func shardFromRoot(projectRoot string, packageRoot string) shard {
	packageFile := filepath.Join(packageRoot, "package.json")
	packageJSON := readJSONObject(packageFile)
	configFile := selectedTSConfig(packageRoot)
	name, _ := packageJSON["name"].(string)
	shard := shard{
		ID:   shardID(projectRoot, packageRoot),
		Root: packageRoot,
		Name: name,
	}
	if _, err := os.Stat(packageFile); err == nil {
		shard.PackageFile = packageFile
		shard.DiscoveredBy = packageFile
	}
	if configFile != "" {
		shard.ConfigFile = configFile
	}
	return shard
}

func workspacePackageRoots(root string) []string {
	roots := []string{}
	for _, pattern := range workspacePatterns(root) {
		for _, packageRoot := range packageRootsFromPattern(root, pattern) {
			roots = appendUniqueSorted(roots, packageRoot)
		}
	}
	return roots
}

func workspacePatterns(root string) []string {
	patterns := pnpmWorkspacePatterns(filepath.Join(root, "pnpm-workspace.yaml"))
	packageJSON := readJSONObject(filepath.Join(root, "package.json"))
	if workspaces, ok := packageJSON["workspaces"].([]any); ok {
		for _, value := range workspaces {
			if pattern, ok := value.(string); ok {
				patterns = append(patterns, pattern)
			}
		}
	}
	if workspaces, ok := packageJSON["workspaces"].(map[string]any); ok {
		if packages, ok := workspaces["packages"].([]any); ok {
			for _, value := range packages {
				if pattern, ok := value.(string); ok {
					patterns = append(patterns, pattern)
				}
			}
		}
	}
	sort.Strings(patterns)
	return patterns
}

func pnpmWorkspacePatterns(file string) []string {
	source, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	patterns := []string{}
	inPackages := false
	for _, line := range strings.Split(string(source), "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "packages:") {
			inPackages = true
			continue
		}
		if !inPackages {
			continue
		}
		if strings.HasPrefix(trimmed, "-") {
			value := strings.TrimSpace(strings.TrimPrefix(trimmed, "-"))
			value = strings.Trim(value, `"'`)
			if value != "" {
				patterns = append(patterns, value)
			}
			continue
		}
		if trimmed != "" && !strings.HasPrefix(line, " ") && !strings.HasPrefix(line, "\t") {
			break
		}
	}
	return patterns
}

func packageRootsFromPattern(root string, pattern string) []string {
	if pattern == "" || strings.HasPrefix(pattern, "!") {
		return nil
	}
	matches, err := filepath.Glob(filepath.Join(root, strings.TrimRight(pattern, "/"), "package.json"))
	if err != nil {
		return nil
	}
	out := make([]string, 0, len(matches))
	for _, match := range matches {
		out = append(out, filepath.Dir(match))
	}
	sort.Strings(out)
	return out
}

func shardReferences(configFile string, idByRoot map[string]string) []string {
	if configFile == "" {
		return nil
	}
	config := readJSONObject(configFile)
	values, ok := config["references"].([]any)
	if !ok {
		return nil
	}
	refs := []string{}
	for _, value := range values {
		object, ok := value.(map[string]any)
		if !ok {
			continue
		}
		refPath, ok := object["path"].(string)
		if !ok {
			continue
		}
		if id := idByRoot[filepath.Clean(filepath.Join(filepath.Dir(configFile), refPath))]; id != "" {
			refs = appendUniqueSorted(refs, id)
		}
	}
	return refs
}

func selectedTSConfig(root string) string {
	for _, name := range []string{"tsconfig.json", "jsconfig.json"} {
		candidate := filepath.Join(root, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func shardID(root string, packageRoot string) string {
	relative, err := filepath.Rel(root, packageRoot)
	if err != nil || relative == "." {
		return "."
	}
	return filepath.ToSlash(relative)
}

func readJSONObject(file string) map[string]any {
	source, err := os.ReadFile(file)
	if err != nil {
		return nil
	}
	var object map[string]any
	if err := json.Unmarshal(source, &object); err != nil {
		return nil
	}
	return object
}

func appendUniqueSorted(values []string, next string) []string {
	if next == "" {
		return values
	}
	index := sort.SearchStrings(values, next)
	if index < len(values) && values[index] == next {
		return values
	}
	values = append(values, "")
	copy(values[index+1:], values[index:])
	values[index] = next
	return values
}
