package inspect

import (
	"bufio"
	"context"
	"crypto/sha1"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

const inspectActivityLimit = 500

// EventBus is the in-process live event stream for local inspect data.
// HTTP and WebSocket handlers are adapters on top of this bus; native callers can
// subscribe directly without round-tripping through the API server.
type EventBus struct {
	mu         sync.Mutex
	nextID     int64
	subs       map[chan api.InspectEvent]struct{}
	activity   []api.InspectActivityEvent
	activityFP string
}

func NewEventBus(activityDir string) *EventBus {
	b := &EventBus{
		subs:       make(map[chan api.InspectEvent]struct{}),
		activityFP: filepath.Join(activityDir, "activity.jsonl"),
	}
	if err := b.loadActivity(); err != nil {
		slog.Warn("inspect activity hydration failed", "error", err)
	}
	return b
}

func (b *EventBus) Subscribe(ctx context.Context) <-chan api.InspectEvent {
	ch := make(chan api.InspectEvent, 128)
	b.mu.Lock()
	b.subs[ch] = struct{}{}
	b.mu.Unlock()

	go func() {
		<-ctx.Done()
		b.mu.Lock()
		delete(b.subs, ch)
		close(ch)
		b.mu.Unlock()
	}()

	return ch
}

func (b *EventBus) Publish(event api.InspectEvent) {
	if event.Tag == "" {
		event.Tag = "InspectEvent"
	}
	if event.Timestamp == 0 {
		event.Timestamp = time.Now().UnixMilli()
	}
	if event.ID == "" {
		event.ID = b.nextEventID(event)
	}
	if event.Severity == "" {
		event.Severity = "info"
	}

	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- event:
		default:
			slog.Debug("dropping inspect event for slow subscriber", "event", event.ID)
		}
	}
}

func (b *EventBus) PublishActivity(activity api.InspectActivityEvent) {
	if activity.Tag == "" {
		activity.Tag = "InspectActivityEvent"
	}
	if activity.Timestamp == 0 {
		activity.Timestamp = time.Now().UnixMilli()
	}
	if activity.Severity == "" {
		activity.Severity = "info"
	}
	activity.Summary = truncateSummary(activity.Summary)

	b.mu.Lock()
	b.activity = append(b.activity, activity)
	if len(b.activity) > inspectActivityLimit {
		b.activity = b.activity[len(b.activity)-inspectActivityLimit:]
	}
	b.mu.Unlock()

	if err := appendJSONL(b.activityFP, activity); err != nil {
		slog.Warn("inspect activity persist failed", "error", err)
	}

	payload, _ := json.Marshal(activity)
	b.Publish(api.InspectEvent{
		Kind:     activity.Kind,
		Action:   "activity",
		Severity: activity.Severity,
		RefID:    activity.RefID,
		Payload:  payload,
	})
}

func (b *EventBus) RecentActivity(limit int) []api.InspectActivityEvent {
	b.mu.Lock()
	defer b.mu.Unlock()
	if limit <= 0 || limit > len(b.activity) {
		limit = len(b.activity)
	}
	start := len(b.activity) - limit
	out := make([]api.InspectActivityEvent, limit)
	copy(out, b.activity[start:])
	return out
}

func (b *EventBus) loadActivity() error {
	file, err := os.Open(b.activityFP)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer file.Close()

	var loaded []api.InspectActivityEvent
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var event api.InspectActivityEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}
		loaded = append(loaded, event)
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if len(loaded) > inspectActivityLimit {
		loaded = loaded[len(loaded)-inspectActivityLimit:]
	}

	b.mu.Lock()
	b.activity = loaded
	b.mu.Unlock()
	return nil
}

func (b *EventBus) nextEventID(event api.InspectEvent) string {
	b.mu.Lock()
	b.nextID++
	n := b.nextID
	b.mu.Unlock()

	sum := sha1.Sum([]byte(fmt.Sprintf("%d:%s:%s:%s", event.Timestamp, event.Kind, event.RefID, event.Action)))
	return fmt.Sprintf("inspect_evt_%d_%s", n, hex.EncodeToString(sum[:4]))
}

func appendJSONL(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(value)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(data, '\n'))
	return err
}

func truncateSummary(summary string) string {
	const max = 80
	if len(summary) <= max {
		return summary
	}
	return strings.TrimSpace(summary[:max-1]) + "..."
}
