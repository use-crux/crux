package projectindexer

import (
	"os"
	"path/filepath"
	"testing"
)

func writeNativeStaticEnabledConfig(t testing.TB, root string) string {
	t.Helper()
	configFile := filepath.Join(root, "crux.config.ts")
	source := []byte("import { config } from '@crux/core'\nexport default config({ experimental: { indexer: { nativeAst: true } } })\n")
	if err := os.WriteFile(configFile, source, 0o600); err != nil {
		t.Fatalf("write native static config: %v", err)
	}
	return configFile
}

func nativeStaticAnalyzeFilesContain(files []projectNativeStaticAnalyzeFile, want string) bool {
	for _, file := range files {
		if file.File == want {
			return true
		}
	}
	return false
}

func nativeStaticPrepareFilesContain(files []projectNativeStaticSourceFile, want string) bool {
	for _, file := range files {
		if file.File == want && file.SourceHash != "" {
			return true
		}
	}
	return false
}
