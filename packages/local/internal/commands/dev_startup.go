package commands

import (
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/startup"
)

type startupTracker struct {
	enabled bool
	started time.Time
	mu      sync.Mutex
	mode    string
	marks   map[string]time.Time
	journal *startup.Journal
}

func newStartupTracker(enabled bool) *startupTracker {
	return &startupTracker{
		enabled: enabled,
		started: time.Now(),
		marks:   map[string]time.Time{},
		journal: startup.NewJournal([]startup.TaskSpec{
			{ID: "runtime-preflight", Phase: "Checking runtime"},
			{ID: "project-index", Phase: "Indexing project"},
			{ID: "runtime-artifacts", Phase: "Generating runtime artifacts"},
		}),
	}
}

func (s *startupTracker) Enabled() bool {
	return s != nil && s.enabled
}

func (s *startupTracker) SetMode(mode string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.mode = mode
}

func (s *startupTracker) Mode() string {
	if s == nil {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.mode
}

func (s *startupTracker) Mark(name string) {
	if s == nil || !s.enabled {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.marks[name]; exists {
		return
	}
	s.marks[name] = time.Now()
}

func (s *startupTracker) Summary() string {
	if s == nil || !s.enabled {
		return ""
	}
	s.mu.Lock()
	defer s.mu.Unlock()

	steps := []struct {
		name  string
		label string
	}{
		{"Server child spawned", "spawn"},
		{"First server stdout", "stdout"},
		{"First server stderr", "stderr"},
		{"HTTP ready", "http"},
		{"WebSocket connected", "ws"},
		{"Initial data loaded", "data"},
		{"Dashboard visible", "ui"},
	}

	parts := make([]string, 0, len(steps)+2)
	if s.mode != "" {
		parts = append(parts, s.mode)
	}
	for _, step := range steps {
		if at, ok := s.marks[step.name]; ok {
			parts = append(parts, fmt.Sprintf("%s=%s", step.label, at.Sub(s.started).Round(10*time.Millisecond)))
		}
	}
	parts = append(parts, fmt.Sprintf("total=%s", time.Since(s.started).Round(10*time.Millisecond)))
	return strings.Join(parts, "  ")
}

func startupDebugEnabled(flag bool) bool {
	if flag {
		return true
	}
	switch strings.ToLower(strings.TrimSpace(os.Getenv("CRUX_STARTUP_DEBUG"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
