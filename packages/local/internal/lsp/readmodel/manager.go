package readmodel

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

// Mode is one scope's current read-model source state.
type Mode string

const (
	ModeDiscovering Mode = "DISCOVERING"
	ModeAttached    Mode = "ATTACHED"
	ModeReconnect   Mode = "RECONNECT"
	ModeOwn         Mode = "OWN"
)

// Change identifies anchor files replaced in one scope.
type Change struct {
	Scope     string
	Files     []string
	Immediate bool
}

// MessageStream is the bounded WebSocket surface attach mode consumes.
type MessageStream interface {
	ReadMessages(chan<- json.RawMessage)
	Close()
}

// ManagerOptions configures one workspace scope's attach lifecycle.
type ManagerOptions struct {
	ScopeID       string
	Root          string
	Version       string
	Transport     *AttachTransport
	Store         *Store
	Logs          io.Writer
	ProbeBudget   time.Duration
	InitialBudget time.Duration
	Grace         time.Duration
	Backoffs      []time.Duration
	Reprobe       time.Duration
	Connect       func(context.Context, string) (MessageStream, error)
	StartOwn      func(context.Context, OwnOptions) (OwnSource, error)
	OnChange      func(Change)
	OnModeChange  func(Mode)
	OnWarning     func(string)
	OnShowWarning func(string)
}

// Manager owns discovery, attachment, and reconnect for one scope.
type Manager struct {
	options        ManagerOptions
	mu             sync.RWMutex
	mode           Mode
	mismatchWarned bool
	versionWarned  bool
}

// NewManager creates a scope manager with production discovery timings.
func NewManager(options ManagerOptions) *Manager {
	if options.Store == nil {
		options.Store = NewStore()
	}
	if options.Logs == nil {
		options.Logs = io.Discard
	}
	if options.ProbeBudget <= 0 {
		options.ProbeBudget = 750 * time.Millisecond
	}
	if options.InitialBudget <= 0 {
		options.InitialBudget = 2 * time.Second
	}
	if options.Grace <= 0 {
		options.Grace = 5 * time.Second
	}
	if len(options.Backoffs) == 0 {
		options.Backoffs = []time.Duration{500 * time.Millisecond, time.Second, 2 * time.Second}
	}
	if options.Reprobe <= 0 {
		options.Reprobe = 10 * time.Second
	}
	if options.Connect == nil {
		options.Connect = func(ctx context.Context, baseURL string) (MessageStream, error) {
			return api.ConnectWSContext(ctx, baseURL)
		}
	}
	if options.StartOwn == nil {
		options.StartOwn = StartOwnIndexer
	}
	return &Manager{options: options}
}

// Mode returns the manager's current state.
func (m *Manager) Mode() Mode {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.mode
}

// Run blocks until cancellation after driving this scope's attach lifecycle.
func (m *Manager) Run(ctx context.Context) {
	m.setMode(ModeDiscovering)
	discoveryContext, cancelDiscovery := context.WithTimeout(ctx, m.options.InitialBudget)
	probe, err := m.options.Transport.Probe(discoveryContext, m.options.Root, m.options.Version, m.options.ProbeBudget)
	if err != nil {
		m.handleProbeError(err)
	} else if probe.VersionSkew {
		m.warnVersionSkew()
	}
	if err == nil {
		stream, connectErr := m.connect(discoveryContext)
		if connectErr == nil {
			err = m.consume(ctx, discoveryContext, stream, false)
		} else {
			err = connectErr
		}
	}
	cancelDiscovery()
	if m.Mode() == ModeAttached {
		for ctx.Err() == nil && m.reconnect(ctx, err) {
			err = errors.New("dev server WebSocket disconnected")
		}
	}
	if ctx.Err() != nil {
		return
	}
	if err != nil {
		fmt.Fprintf(m.options.Logs, "crux lsp: scope %s entering own mode after %v\n", m.options.ScopeID, err)
	}
	for ctx.Err() == nil {
		m.runOwn(ctx)
	}
}

func (m *Manager) consume(ctx, readyContext context.Context, stream MessageStream, reconnect bool) error {
	defer stream.Close()
	messages := startMessages(stream)

	if reconnect {
		snapshot, err := m.options.Transport.Snapshot(readyContext)
		if err != nil {
			return fmt.Errorf("resync Project Index: %w", err)
		}
		if err := m.validateRemoteSnapshot(snapshot); err != nil {
			return fmt.Errorf("resync Project Index identity: %w", err)
		}
		m.applySnapshot(snapshot)
		m.setMode(ModeAttached)
	} else if err := m.awaitInitialSnapshot(readyContext, messages); err != nil {
		return err
	}
	return m.consumeMessages(ctx, messages, reconnect)
}

func (m *Manager) consumeMessages(ctx context.Context, messages <-chan json.RawMessage, ignoreInitialSnapshot bool) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case raw, ok := <-messages:
			if !ok {
				return errors.New("dev server WebSocket closed")
			}
			message, relevant, err := decodeWSMessage(raw)
			if err != nil {
				fmt.Fprintf(m.options.Logs, "crux lsp: ignored invalid WS message: %v\n", err)
				continue
			}
			if !relevant {
				continue
			}
			if message.Snapshot != nil {
				if err := m.validateRemoteSnapshot(*message.Snapshot); err != nil {
					return fmt.Errorf("WebSocket Project Index identity: %w", err)
				}
				if ignoreInitialSnapshot {
					ignoreInitialSnapshot = false
					continue
				}
				m.applySnapshot(*message.Snapshot)
				continue
			}
			if err := m.applyDelta(ctx, *message.Delta); err != nil {
				return err
			}
		}
	}
}

func (m *Manager) awaitInitialSnapshot(ctx context.Context, messages <-chan json.RawMessage) error {
	snapshot, delta, err := m.receiveInitialSnapshot(ctx, messages)
	if err != nil {
		return err
	}
	if err := m.validateRemoteSnapshot(snapshot); err != nil {
		return fmt.Errorf("initial Project Index identity: %w", err)
	}
	m.applySnapshot(snapshot)
	m.setMode(ModeAttached)
	if delta != nil {
		return m.applyDelta(ctx, *delta)
	}
	return nil
}

func (m *Manager) receiveInitialSnapshot(ctx context.Context, messages <-chan json.RawMessage) (Snapshot, *Delta, error) {
	for {
		select {
		case <-ctx.Done():
			return Snapshot{}, nil, ctx.Err()
		case raw, ok := <-messages:
			if !ok {
				return Snapshot{}, nil, errors.New("dev server WebSocket closed before initial snapshot")
			}
			message, relevant, err := decodeWSMessage(raw)
			if err != nil || !relevant {
				continue
			}
			if message.Snapshot != nil {
				return *message.Snapshot, nil, nil
			}
			snapshot, err := m.options.Transport.Snapshot(ctx)
			if err != nil {
				return Snapshot{}, nil, fmt.Errorf("delta before initial snapshot resync: %w", err)
			}
			return snapshot, message.Delta, nil
		}
	}
}

func startMessages(stream MessageStream) <-chan json.RawMessage {
	messages := make(chan json.RawMessage, 256)
	go stream.ReadMessages(messages)
	return messages
}

func (m *Manager) applyDelta(ctx context.Context, delta Delta) error {
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
		return nil
	}
	m.changed(result.ChangedFiles, false)
	return nil
}

func (m *Manager) applySnapshot(snapshot Snapshot) {
	m.changed(m.options.Store.ApplySnapshot(m.options.ScopeID, snapshot), true)
	findings := m.options.Store.AllFindings(m.options.ScopeID)
	for _, entries := range findings {
		for _, finding := range entries {
			fmt.Fprintf(m.options.Logs, "crux lsp: scope %s finding %s\n", m.options.ScopeID, finding.ID)
		}
	}
}

func (m *Manager) changed(files []string, immediate bool) {
	if len(files) > 0 && m.options.OnChange != nil {
		m.options.OnChange(Change{Scope: m.options.ScopeID, Files: files, Immediate: immediate})
	}
}

func (m *Manager) connect(ctx context.Context) (MessageStream, error) {
	if m.options.Transport == nil || m.options.Transport.http == nil {
		return nil, errors.New("attach transport is not configured")
	}
	return m.options.Connect(ctx, m.options.Transport.http.BaseURL)
}

func (m *Manager) setMode(mode Mode) {
	m.mu.Lock()
	if m.mode == mode {
		m.mu.Unlock()
		return
	}
	m.mode = mode
	m.mu.Unlock()
	fmt.Fprintf(m.options.Logs, "crux lsp: scope %s mode %s\n", m.options.ScopeID, mode)
	if m.options.OnModeChange != nil {
		m.options.OnModeChange(mode)
	}
}
