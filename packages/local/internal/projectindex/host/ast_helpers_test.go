package host

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
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

func nativeStaticAnalyzeFilesContain(files []protocol.AnalyzeFile, want string) bool {
	for _, file := range files {
		if file.File == want {
			return true
		}
	}
	return false
}

func nativeStaticPrepareFilesContain(files []protocol.SourceFile, want string) bool {
	for _, file := range files {
		if file.File == want && file.SourceHash != "" {
			return true
		}
	}
	return false
}
