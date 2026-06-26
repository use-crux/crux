package quality

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	"github.com/use-crux/crux/packages/local/internal/api"
	qualitysvc "github.com/use-crux/crux/packages/local/internal/quality"
)

type Broadcaster interface {
	BroadcastJSON(v any)
}

// The quality run-event bridge: `crux quality run|watch|promote` forwards its
// worker's NDJSON stream (spec 03 §2 — collect:done, eval:start, cell:start,
// cell:done, eval:done, promote:done, run:done, error) to this endpoint
// best-effort, and every event is broadcast VERBATIM to devtools WS clients as
//
//	{type: "quality:run:event", event: <worker event>}
//
// This is the live counterpart of the persisted experiment records: devtools
// can render per-cell progress while a run executes and join
// `cell:done.event.cell.traceIds` against trace runs arriving on the
// observability stream. Same ingest pattern as POST /api/observability/records.
func RegisterRunEvents(mux *http.ServeMux, hub Broadcaster, qualityEvents *qualitysvc.EventBus) {
	mux.HandleFunc("POST /api/quality/run-events", func(w http.ResponseWriter, r *http.Request) {
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 64*1024*1024))
		if err != nil {
			http.Error(w, "request too large", http.StatusBadRequest)
			return
		}
		events, err := decodeRunEvents(body)
		if err != nil {
			http.Error(w, "invalid JSON: expected a worker event or an array of them", http.StatusBadRequest)
			return
		}
		for _, event := range events {
			if qualityEvents != nil {
				qualityEvents.TrackRunEvent(event)
			}
			if hub != nil {
				hub.BroadcastJSON(map[string]any{
					"type":  "quality:run:event",
					"event": event,
				})
			}
			publishRunEventActivity(qualityEvents, event)
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_ = json.NewEncoder(w).Encode(map[string]any{"accepted": len(events)})
	})
}

// decodeRunEvents accepts one event object or an array of them, preserving
// each event verbatim (raw bytes — the stream's shapes evolve additively).
func decodeRunEvents(body []byte) ([]json.RawMessage, error) {
	var batch []json.RawMessage
	if err := json.Unmarshal(body, &batch); err == nil {
		return batch, nil
	}
	var single map[string]json.RawMessage
	if err := json.Unmarshal(body, &single); err != nil {
		return nil, err
	}
	return []json.RawMessage{json.RawMessage(body)}, nil
}

// publishRunEventActivity records run lifecycle milestones in the quality
// activity feed (eval:done and promote:done carry durable references).
func publishRunEventActivity(qualityEvents *qualitysvc.EventBus, raw json.RawMessage) {
	if qualityEvents == nil {
		return
	}
	var event struct {
		Type         string `json:"type"`
		EvaluationID string `json:"evaluationId"`
		ExperimentID string `json:"experimentId"`
		BaselineID   string `json:"baselineId"`
		Gates        *struct {
			Passed bool `json:"passed"`
		} `json:"gates"`
	}
	if json.Unmarshal(raw, &event) != nil {
		return
	}
	switch event.Type {
	case "eval:done":
		severity := "info"
		summary := fmt.Sprintf("experiment completed: %s", event.EvaluationID)
		if event.Gates != nil && !event.Gates.Passed {
			severity = "warning"
			summary = fmt.Sprintf("experiment gates failed: %s", event.EvaluationID)
		}
		qualityEvents.PublishActivity(api.QualityActivityEvent{
			Tag:       "QualityActivityEvent",
			Timestamp: time.Now().UnixMilli(),
			Kind:      "experiment",
			Severity:  severity,
			Summary:   summary,
			RefID:     event.ExperimentID,
		})
	case "promote:done":
		qualityEvents.PublishActivity(api.QualityActivityEvent{
			Tag:       "QualityActivityEvent",
			Timestamp: time.Now().UnixMilli(),
			Kind:      "baseline",
			Severity:  "info",
			Summary:   fmt.Sprintf("baseline promoted: %s", event.EvaluationID),
			RefID:     event.BaselineID,
		})
	}
}
