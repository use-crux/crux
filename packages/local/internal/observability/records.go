package observability

import (
	"encoding/json"
	"fmt"
	"strings"
)

const SchemaVersion = 1

type RecordType string

const (
	RecordRunStart  RecordType = "run:start"
	RecordRunEnd    RecordType = "run:end"
	RecordSpanStart RecordType = "span:start"
	RecordSpanEnd   RecordType = "span:end"
	RecordSpan      RecordType = "span"
	RecordSpanEvent RecordType = "span:event"
	RecordEdge      RecordType = "edge"
	RecordArtifact  RecordType = "artifact"
)

type Batch struct {
	Records []Record `json:"records"`
}

type Record struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	Seq           int             `json:"seq,omitempty"`
	TraceID       string          `json:"traceId,omitempty"`
	Payload       json.RawMessage `json:"-"`
}

func (r *Record) UnmarshalJSON(data []byte) error {
	type wire Record
	var decoded wire
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}
	*r = Record(decoded)
	r.Payload = append(r.Payload[:0], data...)
	return nil
}

type RunStartRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	Seq           int             `json:"seq,omitempty"`
	TraceID       string          `json:"traceId,omitempty"`
	SessionID     string          `json:"sessionId,omitempty"`
	UserID        string          `json:"userId,omitempty"`
	Name          string          `json:"name"`
	RootPrimitive string          `json:"rootPrimitive"`
	StartedAt     string          `json:"startedAt"`
	Status        string          `json:"status"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

type SpanStartRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	Seq           int             `json:"seq,omitempty"`
	TraceID       string          `json:"traceId,omitempty"`
	SpanID        string          `json:"spanId"`
	ParentSpanID  *string         `json:"parentSpanId,omitempty"`
	Family        string          `json:"family"`
	Primitive     string          `json:"primitive"`
	Name          string          `json:"name"`
	StartedAt     string          `json:"startedAt"`
	Status        string          `json:"status"`
	Model         string          `json:"model,omitempty"`
	Provider      string          `json:"provider,omitempty"`
	PromptID      string          `json:"promptId,omitempty"`
	ContextID     string          `json:"contextId,omitempty"`
	AgentID       string          `json:"agentId,omitempty"`
	ToolName      string          `json:"toolName,omitempty"`
	FlowID        string          `json:"flowId,omitempty"`
	StepID        string          `json:"stepId,omitempty"`
	MemoryID      string          `json:"memoryId,omitempty"`
	RetrieverID   string          `json:"retrieverId,omitempty"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

type SpanRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	Seq           int             `json:"seq,omitempty"`
	TraceID       string          `json:"traceId,omitempty"`
	SpanID        string          `json:"spanId"`
	ParentSpanID  *string         `json:"parentSpanId,omitempty"`
	Family        string          `json:"family"`
	Primitive     string          `json:"primitive"`
	Name          string          `json:"name"`
	StartedAt     string          `json:"startedAt"`
	EndedAt       string          `json:"endedAt,omitempty"`
	DurationMs    float64         `json:"durationMs,omitempty"`
	Status        string          `json:"status"`
	Model         string          `json:"model,omitempty"`
	Provider      string          `json:"provider,omitempty"`
	PromptID      string          `json:"promptId,omitempty"`
	ContextID     string          `json:"contextId,omitempty"`
	AgentID       string          `json:"agentId,omitempty"`
	ToolName      string          `json:"toolName,omitempty"`
	FlowID        string          `json:"flowId,omitempty"`
	StepID        string          `json:"stepId,omitempty"`
	MemoryID      string          `json:"memoryId,omitempty"`
	RetrieverID   string          `json:"retrieverId,omitempty"`
	Metrics       json.RawMessage `json:"metrics,omitempty"`
	Error         json.RawMessage `json:"error,omitempty"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

type ArtifactRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	Seq           int             `json:"seq,omitempty"`
	TraceID       string          `json:"traceId,omitempty"`
	ArtifactID    string          `json:"artifactId"`
	SpanID        string          `json:"spanId,omitempty"`
	Kind          string          `json:"kind"`
	CreatedAt     string          `json:"createdAt"`
	ContentType   string          `json:"contentType"`
	Encoding      string          `json:"encoding"`
	SizeBytes     int64           `json:"sizeBytes,omitempty"`
	Hash          string          `json:"hash,omitempty"`
	Preview       json.RawMessage `json:"preview,omitempty"`
	URI           string          `json:"uri,omitempty"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

type EdgeRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	Seq           int             `json:"seq,omitempty"`
	TraceID       string          `json:"traceId,omitempty"`
	EdgeID        string          `json:"edgeId"`
	EdgeType      string          `json:"edgeType"`
	From          NodeRef         `json:"from"`
	To            NodeRef         `json:"to"`
	CreatedAt     string          `json:"createdAt"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

type NodeRef struct {
	Kind string `json:"kind"`
	ID   string `json:"id"`
}

var primitiveFamilyByName = map[string]string{
	"run":                     "run",
	"generation.call":         "generation",
	"generation.stream":       "generation",
	"prompt.resolve":          "prompt",
	"prompt.budget":           "prompt",
	"context.resolve":         "context",
	"context.predicate":       "context",
	"context.cache":           "context",
	"agent.run":               "agent",
	"flow.run":                "flow",
	"flow.step":               "flow",
	"flow.suspension":         "flow",
	"composition.parallel":    "composition",
	"composition.pipeline":    "composition",
	"composition.consensus":   "composition",
	"composition.swarm":       "composition",
	"composition.branch":      "composition",
	"composition.join":        "composition",
	"composition.vote":        "composition",
	"tool.call":               "tool",
	"tool.approval":           "tool",
	"retrieval.pipeline":      "retrieval",
	"retrieval.query":         "retrieval",
	"retrieval.recipe":        "retrieval",
	"retrieval.retrieve":      "retrieval",
	"retrieval.stage":         "retrieval",
	"retrieval.step":          "retrieval",
	"embedding.call":          "embedding",
	"memory.read":             "memory",
	"memory.write":            "memory",
	"constraint.check":        "constraint",
	"constraint.retry":        "constraint",
	"guardrail.run":           "guardrail",
	"routing.router":          "routing",
	"routing.cascade":         "routing",
	"fallback.attempt":        "routing",
	"runtime.convex.action":   "runtime",
	"runtime.convex.query":    "runtime",
	"runtime.convex.mutation": "runtime",
	"runtime.convex.schedule": "runtime",
	"runtime.convex.resume":   "runtime",
	"runtime.convex.flush":    "runtime",
	"cache.lookup":            "cache",
	"compaction.run":          "compaction",
	"eval.run":                "eval",
	"eval.case":               "eval",
	"scoring.judge":           "scoring",
	"citation.check":          "citation",
	"handoff.prepare":         "handoff",
	"delegate.invoke":         "delegate",
	"workspace.operation":     "workspace",
	"plan.operation":          "plan",
	"task.operation":          "task",
	"indexing.pipeline":       "indexing",
	"ingest.parse":            "ingest",
	"corpus.sync":             "corpus",
	"skill.load":              "skill",
	"security.warning":        "security",
	"cost.record":             "cost",
	"feedback.record":         "feedback",
	"custom.operation":        "custom",
}

var canonicalEdgeTypes = map[string]struct{}{
	"caused":               {},
	"triggered":            {},
	"called":               {},
	"explains":             {},
	"produced":             {},
	"consumed":             {},
	"handoff.payload":      {},
	"delegate.invoked":     {},
	"memory.read":          {},
	"memory.write":         {},
	"retrieval.returned":   {},
	"citation.used":        {},
	"constraint.retry":     {},
	"guardrail.blocked":    {},
	"fallback.attempt":     {},
	"replay.of":            {},
	"feedback.for":         {},
	"eval.case_of":         {},
	"comparison.baseline":  {},
	"comparison.candidate": {},
}

var canonicalArtifactKinds = map[string]struct{}{
	"input":                {},
	"output":               {},
	"messages":             {},
	"system":               {},
	"context":              {},
	"context.contribution": {},
	"prompt":               {},
	"prompt.budget":        {},
	"tool.args":            {},
	"tool.request":         {},
	"tool.result":          {},
	"retrieval.hits":       {},
	"memory.snapshot":      {},
	"memory.recall":        {},
	"memory.diff":          {},
	"handoff.payload":      {},
	"delegate.report":      {},
	"constraint.report":    {},
	"guardrail.report":     {},
	"error.stack":          {},
	"error.raw":            {},
	"stream.timeline":      {},
	"score.report":         {},
	"citation.report":      {},
	"comparison.report":    {},
	"composition.report":   {},
	"routing.report":       {},
	"cache.report":         {},
	"compaction.report":    {},
	"embedding.report":     {},
	"indexing.report":      {},
	"ingest.report":        {},
	"corpus.report":        {},
	"security.report":      {},
}

func ValidateRecord(record Record) error {
	if record.SchemaVersion != SchemaVersion {
		return fmt.Errorf("record %s schemaVersion %d is not supported", record.RecordID, record.SchemaVersion)
	}
	if record.RecordID == "" || record.RunID == "" {
		return fmt.Errorf("record is missing required identity")
	}

	switch record.Type {
	case RecordRunStart:
		var run RunStartRecord
		if err := json.Unmarshal(record.Payload, &run); err != nil {
			return err
		}
		if _, ok := primitiveFamilyByName[run.RootPrimitive]; !ok {
			return fmt.Errorf("run %s has unknown rootPrimitive %q", run.RunID, run.RootPrimitive)
		}
	case RecordSpanStart:
		var span SpanStartRecord
		if err := json.Unmarshal(record.Payload, &span); err != nil {
			return err
		}
		if want, ok := primitiveFamilyByName[span.Primitive]; !ok {
			return fmt.Errorf("span %s has unknown primitive %q", span.SpanID, span.Primitive)
		} else if span.Family != want {
			return fmt.Errorf("span %s family %q does not match primitive %q", span.SpanID, span.Family, span.Primitive)
		}
	case RecordEdge:
		var edge EdgeRecord
		if err := json.Unmarshal(record.Payload, &edge); err != nil {
			return err
		}
		if !isCanonicalOrCustom(edge.EdgeType, canonicalEdgeTypes) {
			return fmt.Errorf("edge %s has invalid edgeType %q", edge.EdgeID, edge.EdgeType)
		}
	case RecordArtifact:
		var artifact ArtifactRecord
		if err := json.Unmarshal(record.Payload, &artifact); err != nil {
			return err
		}
		if !isCanonicalOrCustom(artifact.Kind, canonicalArtifactKinds) {
			return fmt.Errorf("artifact %s has invalid kind %q", artifact.ArtifactID, artifact.Kind)
		}
	case RecordSpan:
		var span SpanRecord
		if err := json.Unmarshal(record.Payload, &span); err != nil {
			return err
		}
		if want, ok := primitiveFamilyByName[span.Primitive]; !ok {
			return fmt.Errorf("span %s has unknown primitive %q", span.SpanID, span.Primitive)
		} else if span.Family != want {
			return fmt.Errorf("span %s family %q does not match primitive %q", span.SpanID, span.Family, span.Primitive)
		}
	case RecordRunEnd, RecordSpanEnd, RecordSpanEvent:
		return nil
	default:
		return nil
	}
	return nil
}

func isKnownRecordType(recordType RecordType) bool {
	switch recordType {
	case RecordRunStart, RecordRunEnd, RecordSpanStart, RecordSpanEnd, RecordSpan, RecordSpanEvent, RecordEdge, RecordArtifact:
		return true
	default:
		return false
	}
}

func isCanonicalOrCustom(value string, canonical map[string]struct{}) bool {
	if _, ok := canonical[value]; ok {
		return true
	}
	return strings.HasPrefix(value, "custom.") && len(value) > len("custom.")
}
