package quality

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
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
)

const qualityActivityLimit = 500
const runningExperimentTTL = 6 * time.Hour

type activeQualityExperiment struct {
	summary   api.QualityExperimentSummary
	updatedAt time.Time
}

// EventBus is the in-process live event stream for local quality data.
// HTTP and WebSocket handlers are adapters on top of this bus; native callers can
// subscribe directly without round-tripping through the API server.
type EventBus struct {
	mu         sync.Mutex
	nextID     int64
	subs       map[chan api.QualityEvent]struct{}
	activity   []api.QualityActivityEvent
	activityFP string

	activeSeq         int64
	activeExperiments map[string]activeQualityExperiment
}

func NewEventBus(activityDir string) *EventBus {
	b := &EventBus{
		subs:              make(map[chan api.QualityEvent]struct{}),
		activityFP:        filepath.Join(activityDir, "activity.jsonl"),
		activeExperiments: make(map[string]activeQualityExperiment),
	}
	if err := b.loadActivity(); err != nil {
		slog.Warn("quality activity hydration failed", "error", err)
	}
	return b
}

// TrackRunEvent projects the live quality runner stream into transient
// experiment summaries. Completed ExperimentRecords remain the durable source
// of truth; these rows only exist while an eval is in flight.
func (b *EventBus) TrackRunEvent(raw json.RawMessage) {
	if b == nil {
		return
	}
	var event struct {
		RunID        string `json:"runId"`
		Type         string `json:"type"`
		EvaluationID string `json:"evaluationId"`
		Cells        int    `json:"cells"`
		Cell         *struct {
			Status string `json:"status"`
		} `json:"cell"`
	}
	if json.Unmarshal(raw, &event) != nil {
		return
	}
	now := time.Now().UTC()
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.activeExperiments == nil {
		b.activeExperiments = make(map[string]activeQualityExperiment)
	}
	switch event.Type {
	case "eval:start":
		if event.EvaluationID == "" {
			return
		}
		key := activeExperimentKey(event.RunID, event.EvaluationID)
		b.activeSeq++
		b.activeExperiments[key] = activeQualityExperiment{
			summary: api.QualityExperimentSummary{
				ExperimentID: runningExperimentID(event.RunID, event.EvaluationID, b.activeSeq),
				EvaluationID: event.EvaluationID,
				StartedAt:    now.Format(time.RFC3339Nano),
				Status:       "running",
				ReplayMode:   "live",
				Variants:     []string{},
				Cells:        event.Cells,
			},
			updatedAt: now,
		}
	case "cell:done":
		key := activeExperimentKey(event.RunID, event.EvaluationID)
		current, ok := b.activeExperiments[key]
		if !ok {
			return
		}
		current.updatedAt = now
		if event.Cell != nil {
			switch event.Cell.Status {
			case "passed":
				current.summary.CellsPassed++
			case "failed":
				current.summary.CellsFailed++
			case "errored", "error":
				current.summary.CellsErrored++
			case "skipped":
				current.summary.CellsSkipped++
			}
			done := current.summary.CellsPassed + current.summary.CellsFailed + current.summary.CellsErrored + current.summary.CellsSkipped
			if current.summary.Cells < done {
				current.summary.Cells = done
			}
		}
		b.activeExperiments[key] = current
	case "eval:done":
		if event.EvaluationID != "" {
			delete(b.activeExperiments, activeExperimentKey(event.RunID, event.EvaluationID))
		}
	case "run:done":
		if event.RunID == "" {
			for key := range b.activeExperiments {
				delete(b.activeExperiments, key)
			}
			return
		}
		prefix := event.RunID + ":"
		for key := range b.activeExperiments {
			if strings.HasPrefix(key, prefix) {
				delete(b.activeExperiments, key)
			}
		}
	}
}

func (b *EventBus) RunningExperimentSummaries(now time.Time) []api.QualityExperimentSummary {
	if b == nil {
		return nil
	}
	now = now.UTC()
	b.mu.Lock()
	defer b.mu.Unlock()
	if len(b.activeExperiments) == 0 {
		return nil
	}
	out := make([]api.QualityExperimentSummary, 0, len(b.activeExperiments))
	for key, current := range b.activeExperiments {
		if now.Sub(current.updatedAt) > runningExperimentTTL {
			delete(b.activeExperiments, key)
			continue
		}
		out = append(out, current.summary)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].StartedAt == out[j].StartedAt {
			return out[i].EvaluationID < out[j].EvaluationID
		}
		return out[i].StartedAt > out[j].StartedAt
	})
	return out
}

func activeExperimentKey(runID string, evaluationID string) string {
	if runID == "" {
		return evaluationID
	}
	return runID + ":" + evaluationID
}

func runningExperimentID(runID string, evaluationID string, seq int64) string {
	if runID == "" {
		return "running:" + safeRunningExperimentID(evaluationID) + ":" + fmt.Sprint(seq)
	}
	return "running:" + safeRunningExperimentID(evaluationID) + ":" + safeRunningExperimentID(runID)
}

func safeRunningExperimentID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", " ", "_", ":", "_")
	return replacer.Replace(value)
}

func (b *EventBus) Subscribe(ctx context.Context) <-chan api.QualityEvent {
	ch := make(chan api.QualityEvent, 128)
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

func (b *EventBus) Publish(event api.QualityEvent) {
	if event.Tag == "" {
		event.Tag = "QualityEvent"
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
			slog.Debug("dropping quality event for slow subscriber", "event", event.ID)
		}
	}
}

func (b *EventBus) PublishActivity(activity api.QualityActivityEvent) {
	if activity.Tag == "" {
		activity.Tag = "QualityActivityEvent"
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
	if len(b.activity) > qualityActivityLimit {
		b.activity = b.activity[len(b.activity)-qualityActivityLimit:]
	}
	b.mu.Unlock()

	if err := appendJSONL(b.activityFP, activity); err != nil {
		slog.Warn("quality activity persist failed", "error", err)
	}

	payload, _ := json.Marshal(activity)
	b.Publish(api.QualityEvent{
		Kind:     activity.Kind,
		Action:   "activity",
		Severity: activity.Severity,
		RefID:    activity.RefID,
		Payload:  payload,
	})
}

func (b *EventBus) RecentActivity(limit int) []api.QualityActivityEvent {
	b.mu.Lock()
	defer b.mu.Unlock()
	if limit <= 0 || limit > len(b.activity) {
		limit = len(b.activity)
	}
	start := len(b.activity) - limit
	out := make([]api.QualityActivityEvent, limit)
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

	var loaded []api.QualityActivityEvent
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var event api.QualityActivityEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			continue
		}
		loaded = append(loaded, event)
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if len(loaded) > qualityActivityLimit {
		loaded = loaded[len(loaded)-qualityActivityLimit:]
	}

	b.mu.Lock()
	b.activity = loaded
	b.mu.Unlock()
	return nil
}

func (b *EventBus) nextEventID(event api.QualityEvent) string {
	b.mu.Lock()
	b.nextID++
	n := b.nextID
	b.mu.Unlock()

	sum := sha1.Sum([]byte(fmt.Sprintf("%d:%s:%s:%s", event.Timestamp, event.Kind, event.RefID, event.Action)))
	return fmt.Sprintf("quality_evt_%d_%s", n, hex.EncodeToString(sum[:4]))
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

func activityFromRawEvent(raw []byte) api.QualityActivityEvent {
	var obj map[string]any
	_ = json.Unmarshal(raw, &obj)

	eventType := firstString(obj, "type", "eventType", "_tag", "kind")
	refID := firstString(obj, "traceId", "traceID", "id", "runId", "experimentId", "caseId")
	if refID == "" {
		refID = "unknown"
	}

	kind := classifyActivityKind(eventType)
	severity := classifyActivitySeverity(eventType, obj)
	summary := summarizeActivity(kind, eventType, refID, obj)

	return api.QualityActivityEvent{
		Tag:       "QualityActivityEvent",
		Timestamp: eventTimestamp(obj),
		Kind:      kind,
		Severity:  severity,
		Summary:   summary,
		RefID:     refID,
	}
}

func classifyActivityKind(eventType string) string {
	lower := strings.ToLower(eventType)
	switch {
	case strings.Contains(lower, "insight"):
		return "insight"
	case strings.Contains(lower, "experiment"), strings.Contains(lower, "eval"):
		return "experiment"
	case strings.Contains(lower, "cassette"):
		return "cassette"
	case strings.Contains(lower, "feedback"):
		return "feedback"
	case strings.Contains(lower, "suite"), strings.Contains(lower, "dataset"):
		return "dataset"
	default:
		return "trace"
	}
}

func classifyActivitySeverity(eventType string, obj map[string]any) string {
	lower := strings.ToLower(eventType + " " + firstString(obj, "status", "level", "severity"))
	switch {
	case strings.Contains(lower, "error"), strings.Contains(lower, "failed"):
		return "error"
	case strings.Contains(lower, "warn"), strings.Contains(lower, "mismatch"), strings.Contains(lower, "missing"):
		return "warn"
	default:
		return "info"
	}
}

func summarizeActivity(kind, eventType, refID string, obj map[string]any) string {
	if summary := firstString(obj, "summary", "message", "name"); summary != "" {
		return summary
	}
	if eventType == "" {
		eventType = "event"
	}
	return fmt.Sprintf("%s %s for %s", kind, eventType, refID)
}

func eventTimestamp(obj map[string]any) int64 {
	for _, key := range []string{"timestamp", "startedAt", "completedAt", "createdAt"} {
		switch v := obj[key].(type) {
		case float64:
			return int64(v)
		case int64:
			return v
		case string:
			if parsed, err := time.Parse(time.RFC3339, v); err == nil {
				return parsed.UnixMilli()
			}
		}
	}
	return time.Now().UnixMilli()
}

func firstString(obj map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := obj[key].(string); ok && value != "" {
			return value
		}
	}
	return ""
}

func truncateSummary(summary string) string {
	const max = 80
	if len(summary) <= max {
		return summary
	}
	return strings.TrimSpace(summary[:max-1]) + "..."
}
