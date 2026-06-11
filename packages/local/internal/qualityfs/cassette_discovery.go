package qualityfs

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
)

func discoverProjectCassettePaths(root string) ([]string, error) {
	if root == "" {
		return []string{}, nil
	}
	if _, err := os.Stat(root); err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	paths := []string{}
	err := filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() {
			if shouldSkipDiscoveryDir(entry.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		if strings.HasSuffix(entry.Name(), ".cassette.json") {
			paths = append(paths, path)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	sort.Strings(paths)
	return paths, nil
}

func shouldSkipDiscoveryDir(name string) bool {
	switch name {
	case "node_modules", ".git", ".cache", ".next", ".turbo", "dist", "build", "coverage", "generated":
		return true
	default:
		return false
	}
}
