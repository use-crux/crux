package readmodel

import (
	"context"
	"errors"
	"fmt"
)

var errManagerSuperseded = errors.New("read-model manager superseded")

func (m *Manager) applyDelta(ctx context.Context, delta Delta) error {
	var before, after Publication
	var result DeltaResult
	if !m.applyCurrent(func() {
		before = m.options.Store.PublicationSnapshot(m.options.ScopeID)
		result = m.options.Store.ApplyDelta(m.options.ScopeID, delta)
		after = m.options.Store.PublicationSnapshot(m.options.ScopeID)
	}) {
		return errManagerSuperseded
	}
	if result.Status == DeltaNeedsResync {
		snapshot, err := m.options.Transport.Snapshot(ctx)
		if err != nil {
			return fmt.Errorf("generation-gap resync: %w", err)
		}
		if err := m.validateRemoteSnapshot(snapshot); err != nil {
			return fmt.Errorf("generation-gap resync identity: %w", err)
		}
		if !m.applySnapshot(snapshot) {
			return errManagerSuperseded
		}
		m.setAttachedTransientSource(snapshot)
		return nil
	}
	if result.Status == DeltaApplied &&
		(!before.GenerationKnown ||
			!after.GenerationKnown ||
			before.Generation != after.Generation) {
		m.indexChanged()
	}
	m.changed(result.ChangedFiles, false)
	return nil
}

func (m *Manager) applySnapshot(snapshot Snapshot) bool {
	var files []string
	if !m.applyCurrent(func() {
		files = m.options.Store.ApplySnapshot(m.options.ScopeID, snapshot)
	}) {
		return false
	}
	m.indexChanged()
	m.changed(files, true)
	findings := m.options.Store.AllFindings(m.options.ScopeID)
	for _, entries := range findings {
		for _, finding := range entries {
			fmt.Fprintf(m.options.Logs, "crux lsp: scope %s finding %s\n", m.options.ScopeID, finding.ID)
		}
	}
	return true
}

func (m *Manager) applyCurrent(apply func()) bool {
	if m.options.ApplyCurrent == nil {
		apply()
		return true
	}
	return m.options.ApplyCurrent(apply)
}

func (m *Manager) indexChanged() {
	if m.options.OnIndexChange != nil {
		m.options.OnIndexChange()
	}
}

func (m *Manager) changed(files []string, immediate bool) {
	if len(files) > 0 && m.options.OnChange != nil {
		m.options.OnChange(Change{Scope: m.options.ScopeID, Files: files, Immediate: immediate})
	}
}
