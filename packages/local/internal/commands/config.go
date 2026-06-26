package commands

import "github.com/use-crux/crux/packages/local/internal/projectroot"

func findNearestConfigDirFrom(start string) string {
	return projectroot.NearestConfigDirFrom(start)
}

// findConfigDir walks up from CWD looking for crux.config.ts.
// If not found in parent dirs, scans packages/* subdirectories (monorepo pattern).
func findConfigDir() string {
	return projectroot.ConfigDir()
}

func findPackageDirFrom(start string) string {
	return projectroot.PackageDirFrom(start)
}

// findProjectDir resolves a local project root for commands that can operate
// from source conventions when no Crux config exists.
func findProjectDir() string {
	return projectroot.Dir()
}
