//go:build !darwin && !dragonfly && !freebsd && !linux && !netbsd && !openbsd && !solaris && !zos

package main

import "testing"

func runCruxPTYHelp(t testing.TB) string {
	t.Helper()
	t.Skip("Unix PTY acceptance is unavailable on this platform")
	return ""
}

func runCruxPTY(t testing.TB, _ []string, _ []string) string {
	t.Helper()
	t.Skip("Unix PTY acceptance is unavailable on this platform")
	return ""
}
