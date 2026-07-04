package observability

import (
	"encoding/json"
	"fmt"
	"time"
)

const tokenChunkFlushInterval = 80 * time.Millisecond

type tokenChunkKey struct {
	runID  string
	spanID string
}

type pendingTokenChunk struct {
	runID      string
	traceID    string
	spanID     string
	eventID    string
	timestamp  string
	attributes map[string]any
}

func (s *Service) enqueueTokenChunkEvents(tokens []SpanEventRecord) {
	if len(tokens) == 0 {
		return
	}
	s.tokenMu.Lock()
	defer s.tokenMu.Unlock()

	if s.tokenPending == nil {
		s.tokenPending = make(map[tokenChunkKey]pendingTokenChunk)
	}
	for _, token := range tokens {
		key := tokenChunkKey{runID: token.RunID, spanID: token.SpanID}
		next := pendingTokenChunkFromRecord(token)
		if current, ok := s.tokenPending[key]; ok {
			next = mergePendingTokenChunk(current, next)
		}
		s.tokenPending[key] = next
	}
	if s.tokenTimer == nil {
		s.tokenTimer = time.AfterFunc(tokenChunkFlushInterval, s.flushTokenChunkEvents)
	}
}

func (s *Service) flushTokenChunkEvents() {
	s.tokenMu.Lock()
	pending := s.tokenPending
	s.tokenPending = nil
	s.tokenTimer = nil
	s.tokenMu.Unlock()

	for _, token := range pending {
		payload, _ := json.Marshal(map[string]any{
			"runId":      token.runID,
			"traceId":    token.traceID,
			"spanId":     token.spanID,
			"eventId":    token.eventID,
			"timestamp":  token.timestamp,
			"attributes": token.attributes,
		})
		now := time.Now().UnixMilli()
		s.events.Publish(Event{
			Tag:       "ObservabilityEvent",
			ID:        fmt.Sprintf("token:%s:%s:%s", token.runID, token.spanID, token.eventID),
			Timestamp: now,
			Kind:      tokenChunkEventName,
			Action:    "appended",
			Severity:  "info",
			RefID:     token.runID,
			Payload:   payload,
		})
	}
}

func pendingTokenChunkFromRecord(token SpanEventRecord) pendingTokenChunk {
	attributes := map[string]any{}
	if len(token.Attributes) > 0 {
		_ = json.Unmarshal(token.Attributes, &attributes)
	}
	return pendingTokenChunk{
		runID:      token.RunID,
		traceID:    token.TraceID,
		spanID:     token.SpanID,
		eventID:    token.EventID,
		timestamp:  token.Timestamp,
		attributes: attributes,
	}
}

func mergePendingTokenChunk(current pendingTokenChunk, next pendingTokenChunk) pendingTokenChunk {
	merged := current
	merged.eventID = next.eventID
	merged.timestamp = next.timestamp
	merged.attributes = cloneAttributes(current.attributes)
	currentText := stringAttributeValue(current.attributes, "text")
	nextText := stringAttributeValue(next.attributes, "text")
	if currentText != "" || nextText != "" {
		merged.attributes["text"] = currentText + nextText
		merged.attributes["charCount"] = len([]rune(currentText + nextText))
	}
	if _, ok := merged.attributes["firstDeltaAt"]; !ok {
		if first := stringAttributeValue(next.attributes, "firstDeltaAt"); first != "" {
			merged.attributes["firstDeltaAt"] = first
		}
	}
	if last := stringAttributeValue(next.attributes, "lastDeltaAt"); last != "" {
		merged.attributes["lastDeltaAt"] = last
	}
	return merged
}

func cloneAttributes(attributes map[string]any) map[string]any {
	next := make(map[string]any, len(attributes))
	for key, value := range attributes {
		next[key] = value
	}
	return next
}

func stringAttributeValue(attributes map[string]any, key string) string {
	if value, ok := attributes[key].(string); ok {
		return value
	}
	return ""
}
