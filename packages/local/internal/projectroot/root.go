package projectroot

import (
	"os"
	"path/filepath"
)

var ConfigNames = []string{"crux.config.ts", "crux.config.js", "crux.config.mjs"}

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

// Dir resolves a local project root for commands that can operate from source
// conventions when no Crux config exists.
func Dir() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	if configDir := NearestConfigDirFrom(cwd); configDir != "" {
		return configDir
	}
	if packageDir := PackageDirFrom(cwd); packageDir != "" {
		return packageDir
	}
	return cwd
}
