package store

// ProjectIndexCapture atomically pairs a detached current Project Index with
// its process-local publication generation. Generation is never serialized or
// persisted.
type ProjectIndexCapture struct {
	Generation uint64
	Index      IndexData
}

// SetIndex replaces the index with new data.
func (s *Store) SetIndex(prompts []PromptMeta, contexts []ContextMeta, tools []ToolMeta) {
	s.SetIndexData(IndexData{Prompts: prompts, Contexts: contexts, Tools: tools})
}

// SetIndexData replaces the index with the canonical Project Index read model.
func (s *Store) SetIndexData(index IndexData) {
	s.mu.Lock()

	if index.SchemaVersion == 0 {
		index.SchemaVersion = 1
	}
	if index.Prompts == nil {
		index.Prompts = []PromptMeta{}
	}
	if index.Contexts == nil {
		index.Contexts = []ContextMeta{}
	}
	if index.Tools == nil {
		index.Tools = []ToolMeta{}
	}
	if index.Indexing == nil {
		index.Indexing = DefaultIndexIndexingStatus()
	}
	if index.Definitions == nil {
		index.Definitions = []ProjectDefinition{}
	}
	if index.Relations == nil {
		index.Relations = []ProjectRelation{}
	}
	if index.Diagnostics == nil {
		index.Diagnostics = []IndexDiagnostic{}
	}
	if index.Sources == nil {
		index.Sources = []IndexSourceFile{}
	}

	s.index = index
	if s.indexGeneration == ^uint64(0) {
		panic("project index publication generation exhausted")
	}
	s.indexGeneration++

	s.mu.Unlock()
	s.notify()
}

// CaptureProjectIndex returns the current detached Project Index and its
// process-local publication generation under one read lock.
func (s *Store) CaptureProjectIndex() ProjectIndexCapture {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return ProjectIndexCapture{
		Generation: s.indexGeneration,
		Index:      cloneIndexData(s.index),
	}
}

// GetIndex returns the raw current Project Index.
func (s *Store) GetIndex() IndexData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneIndexData(s.index)
}

// Snapshot returns one atomic raw Project Index snapshot.
func (s *Store) Snapshot() IndexData {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return cloneIndexData(s.index)
}

func cloneIndexData(index IndexData) IndexData {
	index.Prompts = cloneSlice(index.Prompts)
	index.Contexts = cloneSlice(index.Contexts)
	index.Tools = cloneSlice(index.Tools)
	index.Definitions = cloneSlice(index.Definitions)
	index.Relations = cloneSlice(index.Relations)
	index.Diagnostics = cloneSlice(index.Diagnostics)
	index.LintFindings = cloneSlice(index.LintFindings)
	index.RuleDescriptors = cloneSlice(index.RuleDescriptors)
	index.Sources = cloneSlice(index.Sources)
	return index
}

func cloneSlice[T any](values []T) []T {
	if values == nil {
		return nil
	}
	return append([]T{}, values...)
}
