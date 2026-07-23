package readmodel

import (
	"net/url"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func TestDetectScopesUsesCompilerConfigNames(t *testing.T) {
	configured := t.TempDir()
	config := filepath.Join(configured, "packages", "app", "crux.config.mjs")
	if err := os.MkdirAll(filepath.Dir(config), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config, []byte("export default {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	unconfigured := t.TempDir()

	scopes := DetectScopes([]protocol.WorkspaceFolder{
		{URI: fileURI(configured), Name: "configured"},
		{URI: fileURI(unconfigured), Name: "unconfigured"},
		{URI: "untitled:ignored", Name: "not-a-file"},
	})
	if len(scopes) != 1 {
		t.Fatalf("scopes = %#v, want one", scopes)
	}
	if scopes[0].Root != configured || scopes[0].ConfigFile != config || scopes[0].ID != configured {
		t.Fatalf("scope = %#v", scopes[0])
	}
}

func TestWorkspacePathDecodesWindowsFileURI(t *testing.T) {
	path, ok := workspacePath("file:///C:/repo%20space")
	if want := filepath.Clean("C:/repo space"); !ok || path != want {
		t.Fatalf("workspacePath = (%q, %v), want %q", path, ok, want)
	}
}

func fileURI(path string) protocol.DocumentURI {
	return protocol.DocumentURI((&url.URL{Scheme: "file", Path: filepath.ToSlash(path)}).String())
}
