package readmodel

import (
	"context"
	"errors"
	"fmt"
	"time"
)

// OwnOptions identifies the project compiled by an in-process watcher.
type OwnOptions struct {
	Root string
}

// OwnSource streams complete Project Index snapshots until it is closed.
type OwnSource interface {
	Snapshots() <-chan Snapshot
	Close()
}

func (m *Manager) runOwn(ctx context.Context) {
	m.setMode(ModeOwn)
	ownContext, cancelOwn := context.WithCancel(ctx)
	defer cancelOwn()

	var source OwnSource
	var snapshots <-chan Snapshot
	start := func() {
		if source != nil {
			return
		}
		started, err := m.options.StartOwn(ownContext, OwnOptions{Root: m.options.Root})
		if err != nil {
			fmt.Fprintf(m.options.Logs, "crux lsp: scope %s own index unavailable: %v\n", m.options.ScopeID, err)
			return
		}
		source = started
		snapshots = started.Snapshots()
		if transient, ok := started.(TransientSource); ok {
			m.setTransientSource(transient)
		} else {
			m.setTransientSource(nil)
		}
	}
	start()
	defer func() {
		m.setTransientSource(nil)
		if source != nil {
			source.Close()
		}
	}()

	ticker := time.NewTicker(m.options.Reprobe)
	defer ticker.Stop()
	for ctx.Err() == nil {
		select {
		case <-ctx.Done():
			return
		case snapshot, ok := <-snapshots:
			if !ok {
				m.setTransientSource(nil)
				source = nil
				snapshots = nil
				continue
			}
			if !m.applySnapshot(snapshot) {
				return
			}
		case <-ticker.C:
			probe, err := m.options.Transport.Probe(ctx, m.options.Root, m.options.Version, m.options.ProbeBudget)
			if err != nil {
				m.handleProbeError(err)
				start()
				continue
			}
			if probe.VersionSkew {
				m.warnVersionSkew()
			}
			if m.handoverToAttached(ctx, cancelOwn, source) {
				return
			}
		}
	}
}

func (m *Manager) handoverToAttached(ctx context.Context, stopOwn context.CancelFunc, source OwnSource) bool {
	handoverContext, cancelHandover := context.WithTimeout(ctx, m.options.InitialBudget)
	defer cancelHandover()
	stream, err := m.connect(handoverContext)
	if err != nil {
		return false
	}
	messages := startMessages(stream)
	snapshot, delta, err := m.receiveInitialSnapshot(handoverContext, messages)
	if err != nil {
		stream.Close()
		return false
	}
	if err := m.validateRemoteSnapshot(snapshot); err != nil {
		stream.Close()
		return false
	}

	if !m.applySnapshot(snapshot) {
		stream.Close()
		return true
	}
	if delta != nil {
		if err := m.applyDelta(ctx, *delta); err != nil {
			stream.Close()
			return true
		}
	}
	m.setAttachedTransientSource(snapshot)
	m.setMode(ModeAttached)
	stopOwn()
	if source != nil {
		source.Close()
	}
	err = m.consumeMessages(ctx, messages, false)
	stream.Close()
	for ctx.Err() == nil && m.reconnect(ctx, err) {
		err = errors.New("dev server WebSocket disconnected")
	}
	return true
}

func (m *Manager) setTransientSource(source TransientSource) {
	if m.options.OnTransientSource != nil {
		m.options.OnTransientSource(source)
	}
}

func (m *Manager) setAttachedTransientSource(snapshot Snapshot) {
	if m.options.Transport == nil || snapshot.Generation == nil || snapshot.ServerVersion == "" || snapshot.ServerVersion != m.options.Version {
		m.setTransientSource(nil)
		return
	}
	m.setTransientSource(m.options.Transport)
}
