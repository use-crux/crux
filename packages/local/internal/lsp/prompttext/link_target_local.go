package prompttext

import (
	"net/url"
	"path/filepath"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/lsp/mapping"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
)

func resolveLocalTarget(
	parsed *url.URL,
	sourceFile string,
	scopeRoot string,
) (protocol.DocumentURI, bool) {
	escapedPath := parsed.EscapedPath()
	if parsed.Scheme != "" || parsed.Host != "" || parsed.Opaque != "" ||
		parsed.RawQuery != "" || parsed.ForceQuery || escapedPath == "" ||
		hasEncodedSeparator(escapedPath) ||
		!validEscapedComponent(escapedPath) ||
		!validEscapedComponent(parsed.EscapedFragment()) {
		return "", false
	}
	decodedPath, err := url.PathUnescape(escapedPath)
	if err != nil || filepath.IsAbs(decodedPath) ||
		mapping.IsAbsolutePath(decodedPath) || isWindowsDrivePath(decodedPath) {
		return "", false
	}
	cleanRoot := filepath.Clean(scopeRoot)
	cleanSource := filepath.Clean(sourceFile)
	if !filepath.IsAbs(cleanRoot) || !filepath.IsAbs(cleanSource) ||
		!lexicallyContained(cleanRoot, cleanSource) {
		return "", false
	}
	target := filepath.Clean(filepath.Join(
		filepath.Dir(cleanSource),
		filepath.FromSlash(decodedPath),
	))
	if !lexicallyContained(cleanRoot, target) {
		return "", false
	}
	return localFileTargetURI(target, parsed.Fragment)
}

func localFileTargetURI(
	target string,
	fragment string,
) (protocol.DocumentURI, bool) {
	targetURI, err := url.Parse(mapping.FileURI("", target))
	if err != nil || targetURI.Scheme != "file" {
		return "", false
	}
	targetURI.Fragment = fragment
	targetURI.RawFragment = ""
	return protocol.DocumentURI(targetURI.String()), true
}

func isWindowsDrivePath(path string) bool {
	return len(path) >= 2 &&
		(path[0] >= 'a' && path[0] <= 'z' ||
			path[0] >= 'A' && path[0] <= 'Z') &&
		path[1] == ':'
}

func hasEncodedSeparator(escapedPath string) bool {
	for index := 0; index+2 < len(escapedPath); index++ {
		if escapedPath[index] != '%' {
			continue
		}
		high, highOK := hexValue(escapedPath[index+1])
		low, lowOK := hexValue(escapedPath[index+2])
		if highOK && lowOK {
			decoded := high<<4 | low
			if decoded == '/' || decoded == '\\' {
				return true
			}
		}
		index += 2
	}
	return false
}

func lexicallyContained(root, candidate string) bool {
	relative, err := filepath.Rel(root, candidate)
	if err != nil || filepath.IsAbs(relative) {
		return false
	}
	return relative != ".." &&
		!strings.HasPrefix(relative, ".."+string(filepath.Separator))
}
