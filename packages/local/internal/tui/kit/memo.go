package kit

// MemoKey identifies a cached pane render.
type MemoKey struct {
	Revision uint64
	Rect     Rect
	Focus    string
}

// Memo caches expensive pane renders behind a small immutable key.
type Memo struct {
	entries map[MemoKey][]string
}

// Get returns a cached render or stores the result of render.
func (m *Memo) Get(key MemoKey, render func() []string) []string {
	if m.entries == nil {
		m.entries = map[MemoKey][]string{}
	}
	if lines, ok := m.entries[key]; ok {
		return cloneLines(lines)
	}
	lines := cloneLines(render())
	m.entries[key] = lines
	return cloneLines(lines)
}

func cloneLines(lines []string) []string {
	if lines == nil {
		return nil
	}
	out := make([]string, len(lines))
	copy(out, lines)
	return out
}
