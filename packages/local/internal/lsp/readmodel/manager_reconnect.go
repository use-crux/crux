package readmodel

import (
	"context"
	"fmt"
	"time"
)

func (m *Manager) reconnect(ctx context.Context, cause error) bool {
	m.setTransientSource(nil)
	m.setMode(ModeReconnect)
	fmt.Fprintf(m.options.Logs, "crux lsp: scope %s reconnecting after %v\n", m.options.ScopeID, cause)
	deadline := time.Now().Add(m.options.Grace)
	for attempt := 0; time.Now().Before(deadline); attempt++ {
		if !waitContext(ctx, m.backoff(attempt), deadline) {
			return false
		}
		attemptContext, cancelAttempt := context.WithDeadline(ctx, deadline)
		stream, err := m.connect(attemptContext)
		if err != nil {
			cancelAttempt()
			continue
		}
		err = m.consume(ctx, attemptContext, stream, true)
		cancelAttempt()
		if ctx.Err() != nil {
			return false
		}
		if m.Mode() == ModeAttached && !time.Now().Before(deadline) {
			// A successful reconnect gets a fresh grace window after its next drop.
			return true
		}
		m.setTransientSource(nil)
		m.setMode(ModeReconnect)
	}
	return false
}

func (m *Manager) backoff(attempt int) time.Duration {
	if attempt < len(m.options.Backoffs) {
		return m.options.Backoffs[attempt]
	}
	return m.options.Backoffs[len(m.options.Backoffs)-1]
}

func waitContext(ctx context.Context, delay time.Duration, deadline time.Time) bool {
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return false
	}
	if delay > remaining {
		delay = remaining
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return time.Now().Before(deadline)
	}
}
