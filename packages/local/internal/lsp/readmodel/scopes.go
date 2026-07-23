package readmodel

import (
	"path/filepath"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectroot"
)

// Scope identifies one configured workspace folder.
type Scope struct {
	ID         string
	Root       string
	ConfigFile string
}

// DetectScopes selects file-backed workspace folders containing a compiler-
// supported Crux config. Folders without a config intentionally produce no
// read model and no diagnostics.
func DetectScopes(folders []protocol.WorkspaceFolder) []Scope {
	result := make([]Scope, 0, len(folders))
	for _, folder := range folders {
		root, ok := workspacePath(folder.URI)
		if !ok {
			continue
		}
		configFile := projectroot.ConfigFileFrom(root)
		if configFile == "" {
			continue
		}
		result = append(result, Scope{ID: root, Root: root, ConfigFile: configFile})
	}
	return result
}

func workspacePath(uri protocol.DocumentURI) (string, bool) {
	root, err := mapping.URIToPath(string(uri))
	if err != nil {
		return "", false
	}
	if !mapping.IsAbsolutePath(root) {
		root, err = filepath.Abs(root)
		if err != nil {
			return "", false
		}
	}
	return filepath.Clean(root), true
}
