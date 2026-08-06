package projectroot

import (
	"io/fs"
	"os"
	"path/filepath"
)

var ConfigNames = []string{"crux.config.ts", "crux.config.js", "crux.config.mjs"}

var ignoredConfigDirs = map[string]bool{
	"node_modules": true,
	".git":         true,
	".next":        true,
	".turbo":       true,
	".tmp":         true,
	"dist":         true,
	"build":        true,
	"coverage":     true,
	"generated":    true,
	".venv":        true,
	".cache":       true,
}

// ConfigFileFrom returns the compiler-supported config selected within root.
// Root-level names use compiler preference order, followed by a deterministic
// bounded recursive search for monorepo workspace folders.
func ConfigFileFrom(root string) string {
	for _, name := range ConfigNames {
		candidate := filepath.Join(root, name)
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}

	configName := make(map[string]bool, len(ConfigNames))
	for _, name := range ConfigNames {
		configName[name] = true
	}
	visited := 0
	found := ""
	_ = filepath.WalkDir(root, func(path string, entry fs.DirEntry, err error) error {
		if err != nil || found != "" {
			return nil
		}
		if entry.IsDir() {
			if path != root && ignoredConfigDirs[entry.Name()] {
				return filepath.SkipDir
			}
			return nil
		}
		visited++
		if visited > 5000 {
			return filepath.SkipAll
		}
		if configName[entry.Name()] {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	return found
}

func NearestConfigDirFrom(start string) string {
	dir := start
	for {
		for _, name := range ConfigNames {
			if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// ConfigDir walks up from CWD looking for crux.config.ts.
// If not found in parent dirs, it scans packages/* and apps/* subdirectories.
func ConfigDir() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}

	if configDir := NearestConfigDirFrom(cwd); configDir != "" {
		return configDir
	}

	for _, packagesDir := range []string{"packages", "apps"} {
		entries, err := os.ReadDir(filepath.Join(cwd, packagesDir))
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			for _, name := range ConfigNames {
				candidate := filepath.Join(cwd, packagesDir, entry.Name(), name)
				if _, err := os.Stat(candidate); err == nil {
					return filepath.Join(cwd, packagesDir, entry.Name())
				}
			}
		}
	}

	return ""
}

func PackageDirFrom(start string) string {
	dir := start
	for {
		if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return ""
		}
		dir = parent
	}
}

// DirFrom resolves the nearest project boundary in one upward walk. A config
// wins over package.json only when both exist in the same directory; a distant
// monorepo config must not eclipse a nearer package root.
func DirFrom(start string) string {
	dir := start
	for {
		for _, name := range ConfigNames {
			if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
				return dir
			}
		}
		if _, err := os.Stat(filepath.Join(dir, "package.json")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return start
		}
		dir = parent
	}
}

// Dir resolves a local project root from the nearest config or package
// boundary.
func Dir() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	return DirFrom(cwd)
}
