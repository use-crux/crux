package inspectfs

import "path/filepath"

type FS struct {
	dir string
}

type Stream string

const (
	StreamInsightStatuses Stream = "insights/status.jsonl"
	StreamInsightSilences Stream = "insights/silences.jsonl"
)

func Open(path string) *FS {
	return &FS{dir: Dir(path)}
}

func Dir(path string) string {
	if path != "" {
		return path
	}
	return filepath.Join(".crux", "evals")
}

func (f *FS) Dir() string {
	if f == nil {
		return ""
	}
	return f.dir
}
