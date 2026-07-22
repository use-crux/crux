package observability

import (
	"path/filepath"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/store"
)

// currentProjectHealthSource returns a slash-normalized project-relative copy.
// Unsafe or unresolvable paths are omitted rather than exposed to Runs clients.
func currentProjectHealthSource(projectRoot string, source *store.SourceLoc) *store.SourceLoc {
	if source == nil || source.File == "" {
		return nil
	}
	file := filepath.Clean(source.File)
	if filepath.IsAbs(file) {
		if projectRoot == "" {
			return nil
		}
		root, err := filepath.Abs(projectRoot)
		if err != nil {
			return nil
		}
		relative, err := filepath.Rel(root, file)
		if err != nil || unsafeProjectRelativePath(relative) {
			return nil
		}
		file = relative
	} else if unsafeProjectRelativePath(file) {
		return nil
	}
	copy := *source
	copy.File = filepath.ToSlash(file)
	return &copy
}

func currentProjectHealthSuppressedBy(
	projectRoot string,
	suppressedBy *store.IndexLintSuppressedBy,
) *store.IndexLintSuppressedBy {
	if suppressedBy == nil {
		return nil
	}
	source := currentProjectHealthSource(projectRoot, suppressedBy.Source)
	if source == nil {
		return nil
	}
	copy := *suppressedBy
	copy.Source = source
	return &copy
}

func unsafeProjectRelativePath(path string) bool {
	clean := filepath.Clean(path)
	return clean == "." || filepath.IsAbs(clean) || clean == ".." ||
		strings.HasPrefix(clean, ".."+string(filepath.Separator))
}
