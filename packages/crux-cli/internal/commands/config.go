package commands

import (
	"os"
	"path/filepath"
)

var configNames = []string{"crux.config.ts", "crux.config.js", "crux.config.mjs"}

// findConfigDir walks up from CWD looking for crux.config.ts.
// If not found in parent dirs, scans packages/* subdirectories (monorepo pattern).
func findConfigDir() string {
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}

	// 1. Walk up from CWD.
	dir := cwd
	for {
		for _, name := range configNames {
			if _, err := os.Stat(filepath.Join(dir, name)); err == nil {
				return dir
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}

	// 2. Scan packages/* from CWD (monorepo pattern).
	for _, packagesDir := range []string{"packages", "apps"} {
		entries, err := os.ReadDir(filepath.Join(cwd, packagesDir))
		if err != nil {
			continue
		}
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			for _, name := range configNames {
				candidate := filepath.Join(cwd, packagesDir, entry.Name(), name)
				if _, err := os.Stat(candidate); err == nil {
					return filepath.Join(cwd, packagesDir, entry.Name())
				}
			}
		}
	}

	return ""
}
