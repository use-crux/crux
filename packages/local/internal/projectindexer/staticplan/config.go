package staticplan

import (
	"os"
	"path/filepath"
)

var configNameOrder = []string{"crux.config.ts", "crux.config.js", "crux.config.mjs"}

var configNames = map[string]bool{
	"crux.config.ts":  true,
	"crux.config.js":  true,
	"crux.config.mjs": true,
}

func ConfigMayRequireNode(root string, configPath string) bool {
	if configPath != "" {
		return true
	}
	return findConfigFile(root) != ""
}

func findConfigFile(root string) string {
	for _, name := range configNameOrder {
		candidate := filepath.Join(root, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	found := ""
	visited := 0
	_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil || found != "" {
			return nil
		}
		if entry.IsDir() {
			if path != root && ignoredDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		visited++
		if visited > 5000 {
			return filepath.SkipAll
		}
		if configNames[entry.Name()] {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	return found
}
