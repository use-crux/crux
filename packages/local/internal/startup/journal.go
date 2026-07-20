// Package startup owns replayable status for asynchronous dev-command startup.
package startup

import (
	"context"
	"sync"
)

type Disposition string

const (
	Pending   Disposition = "pending"
	Active    Disposition = "active"
	Succeeded Disposition = "succeeded"
	Degraded  Disposition = "degraded"
	Failed    Disposition = "failed"
)

func (d Disposition) terminal() bool {
	return d == Succeeded || d == Degraded || d == Failed
}

type TaskSpec struct {
	ID    string
	Phase string
}

type TaskStatus struct {
	ID          string
	Phase       string
	Disposition Disposition
	revision    uint64
}

type Diagnostic struct {
	ID          string
	Code        string
	Severity    string
	Message     string
	Remediation string
}

type Snapshot struct {
	Revision    uint64
	Phase       string
	Active      bool
	Terminal    bool
	Tasks       []TaskStatus
	Diagnostics []Diagnostic
}

type Journal struct {
	mu          sync.Mutex
	revision    uint64
	order       []string
	tasks       map[string]TaskStatus
	diagnostics map[string]Diagnostic
	diagTask    map[string]string
	diagKnown   map[string]bool
	diagOrder   []string
	subscribers map[uint64]chan Snapshot
	nextSubID   uint64
}

func NewJournal(specs []TaskSpec) *Journal {
	j := &Journal{
		tasks:       make(map[string]TaskStatus, len(specs)),
		diagnostics: map[string]Diagnostic{},
		diagTask:    map[string]string{},
		diagKnown:   map[string]bool{},
		subscribers: map[uint64]chan Snapshot{},
	}
	for _, spec := range specs {
		if spec.ID == "" {
			continue
		}
		if _, exists := j.tasks[spec.ID]; exists {
			continue
		}
		j.order = append(j.order, spec.ID)
		j.tasks[spec.ID] = TaskStatus{ID: spec.ID, Phase: spec.Phase, Disposition: Pending}
	}
	return j
}

func (j *Journal) Update(taskID, phase string, disposition Disposition, diagnostics []Diagnostic) {
	if j == nil {
		return
	}
	j.mu.Lock()
	task, exists := j.tasks[taskID]
	if !exists {
		j.mu.Unlock()
		return
	}
	j.revision++
	task.Disposition = disposition
	if phase != "" {
		task.Phase = phase
	}
	task.revision = j.revision
	j.tasks[taskID] = task
	for id, owner := range j.diagTask {
		if owner == taskID {
			delete(j.diagnostics, id)
			delete(j.diagTask, id)
		}
	}
	for _, diagnostic := range diagnostics {
		if diagnostic.ID == "" {
			continue
		}
		if !j.diagKnown[diagnostic.ID] {
			j.diagOrder = append(j.diagOrder, diagnostic.ID)
			j.diagKnown[diagnostic.ID] = true
		}
		j.diagnostics[diagnostic.ID] = diagnostic
		j.diagTask[diagnostic.ID] = taskID
	}
	snapshot := j.snapshotLocked()
	for _, subscriber := range j.subscribers {
		select {
		case subscriber <- snapshot:
		default:
			select {
			case <-subscriber:
			default:
			}
			subscriber <- snapshot
		}
	}
	j.mu.Unlock()
}

// SnapshotAndSubscribe atomically returns current state and a coalescing stream
// containing only revisions newer than that snapshot.
func (j *Journal) SnapshotAndSubscribe(ctx context.Context) (Snapshot, <-chan Snapshot) {
	if j == nil {
		closed := make(chan Snapshot)
		close(closed)
		return Snapshot{Terminal: true}, closed
	}
	j.mu.Lock()
	snapshot := j.snapshotLocked()
	j.nextSubID++
	id := j.nextSubID
	updates := make(chan Snapshot, 1)
	j.subscribers[id] = updates
	j.mu.Unlock()
	go func() {
		<-ctx.Done()
		j.mu.Lock()
		if subscriber, exists := j.subscribers[id]; exists {
			delete(j.subscribers, id)
			close(subscriber)
		}
		j.mu.Unlock()
	}()
	return snapshot, updates
}

func (j *Journal) snapshotLocked() Snapshot {
	snapshot := Snapshot{
		Revision: j.revision,
		Terminal: len(j.order) > 0,
		Tasks:    make([]TaskStatus, 0, len(j.order)),
	}
	var latestTerminal TaskStatus
	for _, id := range j.order {
		task := j.tasks[id]
		snapshot.Tasks = append(snapshot.Tasks, task)
		if task.Disposition == Active {
			snapshot.Active = true
			if snapshot.Phase == "" {
				snapshot.Phase = task.Phase
			}
		}
		if !task.Disposition.terminal() {
			snapshot.Terminal = false
		} else if task.revision >= latestTerminal.revision {
			latestTerminal = task
		}
	}
	if snapshot.Phase == "" {
		snapshot.Phase = latestTerminal.Phase
	}
	for _, taskID := range j.order {
		for _, id := range j.diagOrder {
			if j.diagTask[id] == taskID {
				snapshot.Diagnostics = append(snapshot.Diagnostics, j.diagnostics[id])
			}
		}
	}
	return snapshot
}
