package qualityfs

import (
	"path/filepath"
	"sync/atomic"
)

type FS struct {
	dir   string
	cache atomic.Pointer[cachedSnapshot]
}

type cachedSnapshot struct {
	fingerprint string
	snapshot    *Snapshot
	err         error
}

type Kind string

const (
	KindExperiments Kind = "experiments"
	KindSuites      Kind = "suites"
	KindBaselines   Kind = "baselines"
	KindComparisons Kind = "comparisons"
)

type Stream string

const (
	StreamFeedbackInbox       Stream = "feedback/inbox.jsonl"
	StreamFeedbackAnnotations Stream = "feedback/annotations.jsonl"
	StreamFeedbackMemory      Stream = "feedback/memory-proposals.jsonl"
	StreamInsightStatuses     Stream = "insights/status.jsonl"
	StreamInsightSilences     Stream = "insights/silences.jsonl"
	StreamCassetteIssues      Stream = "cassettes/issues.jsonl"
)

func Open(path string) *FS {
	return &FS{dir: Dir(path)}
}

func Dir(path string) string {
	if path != "" {
		return path
	}
	return filepath.Join(".crux", "quality")
}

func (f *FS) Dir() string {
	if f == nil {
		return ""
	}
	return f.dir
}
