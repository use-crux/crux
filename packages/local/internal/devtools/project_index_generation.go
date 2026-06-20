package devtools

import "sync"

// projectIndexGeneration tracks AST/source commits that semantic work depends on.
//
// Background semantic indexing is allowed to finish after a newer AST patch has
// already committed. The generation check keeps those late semantic results from
// mutating the current read model.
type projectIndexGeneration struct {
	mu      sync.Mutex
	current uint64
}

func (g *projectIndexGeneration) BumpAST() uint64 {
	if g == nil {
		return 0
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.current++
	return g.current
}

func (g *projectIndexGeneration) Current() uint64 {
	if g == nil {
		return 0
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return g.current
}

func (g *projectIndexGeneration) IsCurrent(generation uint64) bool {
	if generation == 0 || g == nil {
		return true
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	return generation == g.current
}
