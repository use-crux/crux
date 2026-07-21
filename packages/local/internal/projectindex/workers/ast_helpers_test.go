package workers

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func writeStaticIndexConfig(t testing.TB, root string) string {
	t.Helper()
	configFile := filepath.Join(root, "crux.config.ts")
	source := []byte("import { config } from '@use-crux/core'\nexport default config({})\n")
	if err := os.WriteFile(configFile, source, 0o600); err != nil {
		t.Fatalf("write Static Index config: %v", err)
	}
	return configFile
}

func staticIndexAnalyzeFilesContain(files []protocol.AnalyzeFile, want string) bool {
	for _, file := range files {
		if file.File == want {
			return true
		}
	}
	return false
}

func staticIndexPrepareFilesContain(files []protocol.SourceFile, want string) bool {
	for _, file := range files {
		if file.File == want && file.SourceHash != "" {
			return true
		}
	}
	return false
}
