package server

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

type projectNativeStaticSourceGraph struct {
	SchemaVersion int                        `json:"schemaVersion"`
	ProducedBy    string                     `json:"producedBy"`
	Capabilities  []string                   `json:"capabilities"`
	Shards        []projectNativeStaticShard `json:"shards"`
}

type projectNativeStaticShard struct {
	ID           string   `json:"id"`
	Root         string   `json:"root"`
	Name         string   `json:"name,omitempty"`
	PackageFile  string   `json:"packageFile,omitempty"`
	ConfigFile   string   `json:"configFile,omitempty"`
	DiscoveredBy string   `json:"discoveredBy,omitempty"`
	References   []string `json:"references,omitempty"`
}

func projectNativeStaticBuildSourceGraph(root string) projectNativeStaticSourceGraph {
	shards := projectNativeStaticDiscoverShards(root)
	return projectNativeStaticSourceGraph{
		SchemaVersion: 1,
		ProducedBy:    "@crux/indexer",
		Capabilities: []string{
			"source-dependencies",
			"source-dependents",
			"definition-ownership",
			"diagnostic-ownership",
			"project-shards",
		},
		Shards: shards,
	}
}

func projectNativeStaticDiscoverShards(root string) []projectNativeStaticShard {
	roots := append([]string{root}, projectNativeStaticWorkspacePackageRoots(root)...)
	seen := map[string]bool{}
	shards := make([]projectNativeStaticShard, 0, len(roots))
	for _, packageRoot := range roots {
		if seen[packageRoot] {
			continue
		}
		seen[packageRoot] = true
		shard := projectNativeStaticShardFromRoot(root, packageRoot)
		shards = append(shards, shard)
	}
	idByRoot := map[string]string{}
	for _, shard := range shards {
		idByRoot[shard.Root] = shard.ID
	}
	for i := range shards {
		shards[i].References = projectNativeStaticShardReferences(shards[i].ConfigFile, idByRoot)
	}
	sort.Slice(shards, func(i, j int) bool { return shards[i].ID < shards[j].ID })
	return shards
}

func projectNativeStaticShardFromRoot(projectRoot string, packageRoot string) projectNativeStaticShard {
	packageFile := filepath.Join(packageRoot, "package.json")
	packageJSON := projectNativeStaticReadJSONObject(packageFile)
	configFile := projectNativeStaticSelectedTSConfig(packageRoot)
	name, _ := packageJSON["name"].(string)
	shard := projectNativeStaticShard{
		ID:   projectNativeStaticShardID(projectRoot, packageRoot),
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

func projectNativeStaticWorkspacePackageRoots(root string) []string {
	roots := []string{}
	for _, pattern := range projectNativeStaticWorkspacePatterns(root) {
		for _, packageRoot := range projectNativeStaticPackageRootsFromPattern(root, pattern) {
			roots = appendUniqueSorted(roots, packageRoot)
		}
	}
	return roots
}

func projectNativeStaticWorkspacePatterns(root string) []string {
	patterns := projectNativeStaticPNPMWorkspacePatterns(filepath.Join(root, "pnpm-workspace.yaml"))
	packageJSON := projectNativeStaticReadJSONObject(filepath.Join(root, "package.json"))
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

func projectNativeStaticPNPMWorkspacePatterns(file string) []string {
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

func projectNativeStaticPackageRootsFromPattern(root string, pattern string) []string {
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

func projectNativeStaticShardReferences(configFile string, idByRoot map[string]string) []string {
	if configFile == "" {
		return nil
	}
	config := projectNativeStaticReadJSONObject(configFile)
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

func projectNativeStaticSelectedTSConfig(root string) string {
	for _, name := range []string{"tsconfig.json", "jsconfig.json"} {
		candidate := filepath.Join(root, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return ""
}

func projectNativeStaticShardID(root string, packageRoot string) string {
	relative, err := filepath.Rel(root, packageRoot)
	if err != nil || relative == "." {
		return "."
	}
	return filepath.ToSlash(relative)
}

func projectNativeStaticReadJSONObject(file string) map[string]any {
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
