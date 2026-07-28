package view

import (
	"sort"
	"sync"

	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	indexview "github.com/use-crux/crux/packages/local/internal/lsp/view"
)

type trackedRange struct {
	signature string
	ranges    []protocol.Range
	valid     bool
}

type documentTransform struct {
	revision       indexview.DocumentRevision
	baseSourceHash string
	records        map[string]trackedRange
	unavailable    bool
}

type transformStore struct {
	mu        sync.Mutex
	revision  uint64
	documents map[string]documentTransform
}

type transformSnapshot struct {
	revision  uint64
	documents map[string]documentTransform
}

func newTransformStore() *transformStore {
	return &transformStore{documents: make(map[string]documentTransform)}
}

func (s *transformStore) reserve(
	file string,
	revision indexview.DocumentRevision,
) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, exists := s.documents[file]
	if exists {
		if current.revision.OpenEpoch > revision.OpenEpoch ||
			current.revision.OpenEpoch == revision.OpenEpoch &&
				current.revision.Version > revision.Version {
			return false
		}
		if current.revision == revision {
			return true
		}
	}
	s.revision++
	s.documents[file] = documentTransform{
		revision: revision,
		records:  make(map[string]trackedRange),
	}
	return true
}

func (s *transformStore) establishCurrent(
	file string,
	revision indexview.DocumentRevision,
	baseSourceHash string,
	view normalizedView,
) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, exists := s.documents[file]
	if !exists || current.revision != revision {
		return false
	}
	s.revision++
	s.documents[file] = documentTransform{
		revision: revision, baseSourceHash: baseSourceHash,
		records: recordsInFile(view, file),
	}
	return true
}

func (s *transformStore) unavailable(
	file string,
	revision indexview.DocumentRevision,
) {
	s.mu.Lock()
	defer s.mu.Unlock()
	current, exists := s.documents[file]
	if exists &&
		(current.revision.OpenEpoch > revision.OpenEpoch ||
			current.revision.OpenEpoch == revision.OpenEpoch &&
				current.revision.Version > revision.Version) {
		return
	}
	if exists && current.revision == revision && current.unavailable {
		return
	}
	s.revision++
	s.documents[file] = documentTransform{
		revision: revision, records: make(map[string]trackedRange),
		unavailable: true,
	}
}

func (s *transformStore) change(
	file string,
	revision indexview.DocumentRevision,
	changes []protocol.TextDocumentContentChangeEvent,
) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, ok := s.documents[file]
	if !ok || document.revision.OpenEpoch != revision.OpenEpoch ||
		revision.Version <= document.revision.Version {
		return
	}
	s.revision++
	document.revision = revision
	document.unavailable = false
	for key, record := range document.records {
		if !record.valid {
			continue
		}
		for _, change := range changes {
			if change.Range == nil {
				record.valid = false
				break
			}
			for index, current := range record.ranges {
				next, valid := transformRange(current, *change.Range, change.Text)
				if !valid {
					record.valid = false
					break
				}
				record.ranges[index] = next
			}
			if !record.valid {
				break
			}
		}
		document.records[key] = record
	}
	s.documents[file] = document
}

func (s *transformStore) retire(file string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.documents[file]; !exists {
		return
	}
	s.revision++
	delete(s.documents, file)
}

func (s *transformStore) retireAll() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.documents) == 0 {
		return
	}
	s.revision++
	s.documents = make(map[string]documentTransform)
}

func (s *transformStore) snapshot() transformSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := transformSnapshot{
		revision:  s.revision,
		documents: make(map[string]documentTransform, len(s.documents)),
	}
	for file, document := range s.documents {
		cloned := document
		cloned.records = make(map[string]trackedRange, len(document.records))
		for key, record := range document.records {
			record.ranges = append([]protocol.Range(nil), record.ranges...)
			cloned.records[key] = record
		}
		result.documents[file] = cloned
	}
	return result
}

func (s *transformStore) current(stamp Stamp) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.revision != stamp.TransformRevision {
		return false
	}
	if stamp.RequestDocument == nil {
		return true
	}
	document, exists := s.documents[stamp.requestFile]
	return exists && document.revision == *stamp.RequestDocument
}

func (snapshot transformSnapshot) documentStamps() []DocumentStamp {
	result := make([]DocumentStamp, 0, len(snapshot.documents))
	for file, document := range snapshot.documents {
		result = append(result, DocumentStamp{
			File: file, Revision: document.revision,
			BaseSourceHash:    document.baseSourceHash,
			TransformRevision: snapshot.revision,
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].File < result[j].File })
	return result
}
