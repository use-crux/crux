package readmodel

import (
	"context"
	"fmt"
)

func (m *Manager) applyDelta(ctx context.Context, delta Delta) error {
	before := m.options.Store.PublicationSnapshot(m.options.ScopeID)
	result := m.options.Store.ApplyDelta(m.options.ScopeID, delta)
	if result.Status == DeltaNeedsResync {
		snapshot, err := m.options.Transport.Snapshot(ctx)
		if err != nil {
			return fmt.Errorf("generation-gap resync: %w", err)
		}
		if err := m.validateRemoteSnapshot(snapshot); err != nil {
			return fmt.Errorf("generation-gap resync identity: %w", err)
		}
		m.applySnapshot(snapshot)
		m.setAttachedCompletionSource(snapshot)
		return nil
	}
	after := m.options.Store.PublicationSnapshot(m.options.ScopeID)
	if result.Status == DeltaApplied &&
		(!before.GenerationKnown ||
			!after.GenerationKnown ||
			before.Generation != after.Generation) {
		m.indexChanged()
	}
	m.changed(result.ChangedFiles, false)
	return nil
}

func (m *Manager) applySnapshot(snapshot Snapshot) {
	files := m.options.Store.ApplySnapshot(m.options.ScopeID, snapshot)
	m.indexChanged()
	m.changed(files, true)
	findings := m.options.Store.AllFindings(m.options.ScopeID)
	for _, entries := range findings {
		for _, finding := range entries {
			fmt.Fprintf(m.options.Logs, "crux lsp: scope %s finding %s\n", m.options.ScopeID, finding.ID)
		}
	}
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
