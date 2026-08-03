package tui

import (
	"sync"
	"time"

	tea "charm.land/bubbletea/v2"
)

const movementBurstDelay = 12 * time.Millisecond
const maxMovementBurstKeys = 64

type movementBurstMsg struct {
	keys []tea.KeyPressMsg
	next tea.Msg
}

// InputCoalescer collapses contiguous Index cursor input before Bubble Tea's
// render boundary. The App still replays every movement in order, but renders
// and starts detail work only after the burst reaches its final position.
type InputCoalescer struct {
	mu    sync.Mutex
	keys  []tea.KeyPressMsg
	timer *time.Timer
	send  func(tea.Msg)
}

func NewInputCoalescer(send func(tea.Msg)) *InputCoalescer {
	return &InputCoalescer{send: send}
}

func (c *InputCoalescer) Filter(model tea.Model, msg tea.Msg) tea.Msg {
	app, ok := model.(*App)
	key, isKey := msg.(tea.KeyPressMsg)
	if ok && isKey && app.bootComplete && app.workbench.coalescesIndexMovement() && isIndexMovementKey(key) {
		c.mu.Lock()
		c.keys = append(c.keys, key)
		if len(c.keys) >= maxMovementBurstKeys {
			if c.timer != nil {
				c.timer.Stop()
				c.timer = nil
			}
			keys := append([]tea.KeyPressMsg(nil), c.keys...)
			c.keys = c.keys[:0]
			c.mu.Unlock()
			return movementBurstMsg{keys: keys}
		}
		if c.timer == nil {
			// Flush at a fixed cadence under continuous input. Resetting this
			// deadline turns paste/key-repeat into an unbounded debounce queue.
			c.timer = time.AfterFunc(movementBurstDelay, c.flush)
		}
		c.mu.Unlock()
		return nil
	}
	if _, olderBurst := msg.(movementBurstMsg); olderBurst {
		// A timer-emitted burst predates any keys buffered since that timer
		// fired. Let it through without nesting newer movement ahead of it.
		return msg
	}

	c.mu.Lock()
	if len(c.keys) == 0 {
		c.mu.Unlock()
		return msg
	}
	if c.timer != nil {
		c.timer.Stop()
		c.timer = nil
	}
	keys := append([]tea.KeyPressMsg(nil), c.keys...)
	c.keys = c.keys[:0]
	c.mu.Unlock()

	_, shutdown := msg.(shutdownRequestMsg)
	if shutdown || isKey && (key.String() == "q" || key.String() == "ctrl+c") {
		return msg
	}
	return movementBurstMsg{keys: keys, next: msg}
}

func (c *InputCoalescer) flush() {
	c.mu.Lock()
	if len(c.keys) == 0 {
		c.timer = nil
		c.mu.Unlock()
		return
	}
	keys := append([]tea.KeyPressMsg(nil), c.keys...)
	c.keys = c.keys[:0]
	c.timer = nil
	send := c.send
	c.mu.Unlock()
	if send != nil {
		send(movementBurstMsg{keys: keys})
	}
}

func isIndexMovementKey(key tea.KeyPressMsg) bool {
	switch key.String() {
	case "j", "k", "down", "up":
		return true
	default:
		return false
	}
}
