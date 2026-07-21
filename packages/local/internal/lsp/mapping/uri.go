// Package mapping converts Project Index lint findings into LSP diagnostics.
package mapping

import (
	"fmt"
	"net/url"
	"path/filepath"
	"regexp"
	"strings"
)

var windowsAbsolutePath = regexp.MustCompile(`^[A-Za-z]:[\\/]`)

// IsAbsolutePath reports whether path is absolute in native or Windows drive
// syntax, including when a Windows URI is decoded on another platform.
func IsAbsolutePath(path string) bool {
	return filepath.IsAbs(path) || windowsAbsolutePath.MatchString(path)
}

// FileURI resolves file against root and returns an RFC 3986-escaped file URI.
func FileURI(root, file string) string {
	if windowsAbsolutePath.MatchString(file) || windowsAbsolutePath.MatchString(root) {
		path := strings.ReplaceAll(file, `\`, "/")
		if !windowsAbsolutePath.MatchString(file) {
			path = strings.TrimRight(strings.ReplaceAll(root, `\`, "/"), "/") + "/" + strings.TrimLeft(path, "/")
		}
		return (&url.URL{Scheme: "file", Path: "/" + path}).String()
	}
	path := file
	if !filepath.IsAbs(path) {
		path = filepath.Join(root, path)
	}
	return (&url.URL{Scheme: "file", Path: filepath.ToSlash(filepath.Clean(path))}).String()
}

// URIToPath converts a file URI back into a local path. Windows drive paths
// retain forward slashes when decoded on a non-Windows host.
func URIToPath(uri string) (string, error) {
	parsed, err := url.Parse(uri)
	if err != nil {
		return "", fmt.Errorf("parse document URI: %w", err)
	}
	if parsed.Scheme != "file" {
		return "", fmt.Errorf("document URI scheme %q is not file", parsed.Scheme)
	}
	if parsed.Host != "" && parsed.Host != "localhost" {
		return "", fmt.Errorf("document URI host %q is not local", parsed.Host)
	}
	path := parsed.Path
	if len(path) >= 3 && path[0] == '/' && windowsAbsolutePath.MatchString(path[1:]) {
		return path[1:], nil
	}
	return filepath.FromSlash(path), nil
}
