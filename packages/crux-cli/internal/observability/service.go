package observability

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

var ErrNotFound = errors.New("observability record not found")

const (
	defaultQueryTimeout       = 5 * time.Second
	defaultMutationTimeout    = 10 * time.Second
	defaultMaintenanceTimeout = 15 * time.Second
)

type Service struct {
	db            *sql.DB
	events        *EventBus
	queryTO       time.Duration
	mutationTO    time.Duration
	maintenanceTO time.Duration

	lifecycleMu         sync.Mutex
	lifecycleSignatures map[string]string
}

type Event struct {
	Tag       string          `json:"_tag"`
	ID        string          `json:"id"`
	Timestamp int64           `json:"timestamp"`
	Kind      string          `json:"kind"`
	Action    string          `json:"action"`
	Severity  string          `json:"severity"`
	RefID     string          `json:"refId"`
	Payload   json.RawMessage `json:"payload,omitempty"`
}

type lifecycleReconciliation struct {
	RunID     string
	Status    string
	Reason    string
	Severity  string
	Signature string
}

type EventBus struct {
	mu   sync.Mutex
	subs map[chan Event]struct{}
}

func NewEventBus() *EventBus {
	return &EventBus{subs: make(map[chan Event]struct{})}
}

func (b *EventBus) Subscribe(ctx context.Context) <-chan Event {
	ch := make(chan Event, 128)
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

func (b *EventBus) Publish(event Event) {
	b.mu.Lock()
	defer b.mu.Unlock()
	for ch := range b.subs {
		select {
		case ch <- event:
		default:
		}
	}
}

type RunSummary struct {
	RunID         string          `json:"runId"`
	TraceID       string          `json:"traceId"`
	Name          string          `json:"name"`
	RootPrimitive string          `json:"rootPrimitive"`
	Status        string          `json:"status"`
	StartedAt     string          `json:"startedAt"`
	EndedAt       string          `json:"endedAt"`
	DurationMs    float64         `json:"durationMs"`
	Model         string          `json:"model"`
	Provider      string          `json:"provider"`
	PromptID      string          `json:"promptId"`
	RecordCount   int             `json:"recordCount"`
	SpanCount     int             `json:"spanCount"`
	EventCount    int             `json:"eventCount"`
	ArtifactCount int             `json:"artifactCount"`
	EdgeCount     int             `json:"edgeCount"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
	Metrics       json.RawMessage `json:"metrics,omitempty"`
	Error         json.RawMessage `json:"error,omitempty"`
}

type Graph struct {
	Run       RunSummary         `json:"run"`
	Spans     []SpanSummary      `json:"spans"`
	Events    []SpanEventSummary `json:"events"`
	Artifacts []ArtifactSummary  `json:"artifacts"`
	Edges     []EdgeSummary      `json:"edges"`
	Records   []StoredRecord     `json:"records"`
}

type ResourceActivity struct {
	SpanID     string             `json:"spanId"`
	RunID      string             `json:"runId"`
	TraceID    string             `json:"traceId"`
	Family     string             `json:"family"`
	Primitive  string             `json:"primitive"`
	Name       string             `json:"name"`
	Status     string             `json:"status"`
	StartedAt  string             `json:"startedAt"`
	EndedAt    string             `json:"endedAt"`
	DurationMs float64            `json:"durationMs"`
	ResourceID string             `json:"resourceId"`
	Attributes json.RawMessage    `json:"attributes,omitempty"`
	Metrics    json.RawMessage    `json:"metrics,omitempty"`
	Error      json.RawMessage    `json:"error,omitempty"`
	Artifacts  []ResourceArtifact `json:"artifacts,omitempty"`
	Edges      []EdgeSummary      `json:"edges,omitempty"`
}

type ResourceArtifact struct {
	ArtifactID  string          `json:"artifactId"`
	RunID       string          `json:"runId"`
	TraceID     string          `json:"traceId"`
	SpanID      string          `json:"spanId"`
	Kind        string          `json:"kind"`
	CreatedAt   string          `json:"createdAt"`
	ContentType string          `json:"contentType"`
	Encoding    string          `json:"encoding"`
	SizeBytes   int64           `json:"sizeBytes"`
	Hash        string          `json:"hash"`
	Preview     json.RawMessage `json:"preview,omitempty"`
	URI         string          `json:"uri"`
	Attributes  json.RawMessage `json:"attributes,omitempty"`
}

type presentation struct {
	Run             RunSummary             `json:"run"`
	DisplayMode     string                 `json:"displayMode"`
	Spans           []presentationNode     `json:"spans"`
	RunDetails      []presentationDetail   `json:"runDetails,omitempty"`
	HiddenSpanCount int                    `json:"hiddenSpanCount"`
	Counts          presentationViewCounts `json:"counts"`
}

type presentationViewCounts struct {
	Primary  int `json:"primary"`
	Detail   int `json:"detail"`
	Metadata int `json:"metadata"`
}

type presentationNode struct {
	SpanSummary
	Display               string               `json:"display"`
	CanonicalParentSpanID string               `json:"-"`
	OrderAfterSpanID      string               `json:"-"`
	Details               []presentationDetail `json:"details,omitempty"`
	Children              []presentationNode   `json:"children"`
}

type presentationDetail struct {
	SpanSummary
	Display string `json:"display"`
}

type RunDetail struct {
	SchemaVersion int                           `json:"schemaVersion"`
	Run           RunSummary                    `json:"run"`
	Root          RunDetailNode                 `json:"root"`
	Rows          []RunDetailRow                `json:"rows"`
	SpanIndex     map[string]RunDetailPlacement `json:"spanIndex"`
	Facets        map[string]map[string]int     `json:"facets"`
	Diagnostics   []RunDetailDiagnostic         `json:"diagnostics"`
	Counts        RunDetailCounts               `json:"counts"`
	Debug         *Graph                        `json:"debug,omitempty"`
}

type RunDetailCounts struct {
	Primary         int `json:"primary"`
	Detail          int `json:"detail"`
	Metadata        int `json:"metadata"`
	AttachedDetails int `json:"attachedDetails"`
}

type RunDetailNode struct {
	SpanSummary
	ID            string                 `json:"id"`
	Virtual       bool                   `json:"virtual"`
	ParentID      string                 `json:"parentId"`
	Path          []string               `json:"path"`
	Kind          string                 `json:"kind"`
	Display       RunDetailDisplay       `json:"display"`
	Timing        RunDetailTiming        `json:"timing"`
	MetricBuckets RunDetailMetricBuckets `json:"metricBuckets"`
	Source        RunDetailSource        `json:"source"`
	Details       []RunDetailDetail      `json:"details"`
	Artifacts     []ArtifactSummary      `json:"artifacts"`
	Events        []SpanEventSummary     `json:"events"`
	Relations     []EdgeSummary          `json:"relations"`
	Diagnostics   []RunDetailDiagnostic  `json:"diagnostics"`
	Flow          map[string]any         `json:"flow,omitempty"`
	Step          map[string]any         `json:"step,omitempty"`
	Composition   map[string]any         `json:"composition,omitempty"`
	Transition    map[string]any         `json:"transition,omitempty"`
	Inspection    RunDetailInspection    `json:"inspection,omitempty"`
	Children      []RunDetailNode        `json:"children"`
}

type RunDetailDetail struct {
	SpanSummary
	ID          string                `json:"id"`
	Kind        string                `json:"kind"`
	Role        string                `json:"role,omitempty"`
	Label       string                `json:"label"`
	Display     string                `json:"display"`
	Timing      RunDetailTiming       `json:"timing"`
	Summary     string                `json:"summary,omitempty"`
	Events      []SpanEventSummary    `json:"events"`
	Artifacts   []ArtifactSummary     `json:"artifacts"`
	Relations   []EdgeSummary         `json:"relations"`
	Diagnostics []RunDetailDiagnostic `json:"diagnostics"`
	Source      RunDetailSource       `json:"source"`
	Inspection  RunDetailInspection   `json:"inspection,omitempty"`
}

type RunDetailInspection map[string][]RunDetailInspectionItem

type RunDetailInspectionItem struct {
	Type         string          `json:"type"`
	ID           string          `json:"id"`
	Label        string          `json:"label,omitempty"`
	Kind         string          `json:"kind,omitempty"`
	Role         string          `json:"role,omitempty"`
	SourceSpanID string          `json:"sourceSpanId,omitempty"`
	Data         json.RawMessage `json:"data,omitempty"`
}

type RunDetailDisplay struct {
	Kind        string `json:"kind"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
	Icon        string `json:"icon,omitempty"`
	Accent      string `json:"accent,omitempty"`
	Severity    string `json:"severity,omitempty"`
}

type RunDetailTiming struct {
	StartedAt  string  `json:"startedAt"`
	EndedAt    string  `json:"endedAt,omitempty"`
	DurationMs float64 `json:"durationMs"`
	SelfMs     float64 `json:"selfMs,omitempty"`
	ChildrenMs float64 `json:"childrenMs,omitempty"`
	DetailsMs  float64 `json:"detailsMs,omitempty"`
}

type RunDetailMetricBuckets struct {
	Own      json.RawMessage `json:"own,omitempty"`
	Children json.RawMessage `json:"children,omitempty"`
	Details  json.RawMessage `json:"details,omitempty"`
	Total    json.RawMessage `json:"total,omitempty"`
}

type RunDetailSource struct {
	PlacementReason       string `json:"placementReason"`
	OwnerSpanID           string `json:"ownerSpanId,omitempty"`
	CanonicalParentSpanID string `json:"canonicalParentSpanId,omitempty"`
}

type RunDetailDiagnostic struct {
	Code         string   `json:"code"`
	Severity     string   `json:"severity"`
	Message      string   `json:"message"`
	RecordIDs    []string `json:"recordIds,omitempty"`
	SpanIDs      []string `json:"spanIds,omitempty"`
	SuggestedFix string   `json:"suggestedFix,omitempty"`
}

type RunDetailRow struct {
	NodeID          string           `json:"nodeId"`
	SpanID          string           `json:"spanId,omitempty"`
	ParentID        string           `json:"parentId"`
	Depth           int              `json:"depth"`
	Path            []string         `json:"path"`
	HasChildren     bool             `json:"hasChildren"`
	ExpandedDefault bool             `json:"expandedDefault"`
	Display         RunDetailDisplay `json:"display"`
	Status          string           `json:"status"`
	Timing          RunDetailTiming  `json:"timing"`
	Match           bool             `json:"match,omitempty"`
}

type RunDetailPlacement struct {
	Placement   string   `json:"placement"`
	NodeID      string   `json:"nodeId,omitempty"`
	OwnerNodeID string   `json:"ownerNodeId,omitempty"`
	Path        []string `json:"path"`
	Reason      string   `json:"reason,omitempty"`
}

type StoredRecord struct {
	RecordID    string     `json:"recordId"`
	RunID       string     `json:"runId"`
	TraceID     string     `json:"traceId"`
	Type        RecordType `json:"type"`
	PayloadJSON string     `json:"payloadJson"`
	ReceivedAt  string     `json:"receivedAt"`
}

type SpanSummary struct {
	SpanID       string          `json:"spanId"`
	RunID        string          `json:"runId"`
	TraceID      string          `json:"traceId"`
	ParentSpanID string          `json:"parentSpanId"`
	Family       string          `json:"family"`
	Primitive    string          `json:"primitive"`
	Name         string          `json:"name"`
	Status       string          `json:"status"`
	StartedAt    string          `json:"startedAt"`
	EndedAt      string          `json:"endedAt"`
	DurationMs   float64         `json:"durationMs"`
	Model        string          `json:"model"`
	Provider     string          `json:"provider"`
	PromptID     string          `json:"promptId"`
	ContextID    string          `json:"contextId"`
	AgentID      string          `json:"agentId"`
	ToolName     string          `json:"toolName"`
	FlowID       string          `json:"flowId"`
	StepID       string          `json:"stepId"`
	MemoryID     string          `json:"memoryId"`
	RetrieverID  string          `json:"retrieverId"`
	Attributes   json.RawMessage `json:"attributes,omitempty"`
	Metrics      json.RawMessage `json:"metrics,omitempty"`
	Error        json.RawMessage `json:"error,omitempty"`
}

type SpanEventSummary struct {
	EventID    string          `json:"eventId"`
	RunID      string          `json:"runId"`
	TraceID    string          `json:"traceId"`
	SpanID     string          `json:"spanId"`
	Name       string          `json:"name"`
	Timestamp  string          `json:"timestamp"`
	Attributes json.RawMessage `json:"attributes,omitempty"`
}

type ArtifactSummary struct {
	ArtifactID  string          `json:"artifactId"`
	RunID       string          `json:"runId"`
	TraceID     string          `json:"traceId"`
	SpanID      string          `json:"spanId"`
	Kind        string          `json:"kind"`
	CreatedAt   string          `json:"createdAt"`
	ContentType string          `json:"contentType"`
	Encoding    string          `json:"encoding"`
	SizeBytes   int64           `json:"sizeBytes"`
	Hash        string          `json:"hash"`
	URI         string          `json:"uri"`
	Preview     json.RawMessage `json:"preview,omitempty"`
	Attributes  json.RawMessage `json:"attributes,omitempty"`
}

type EdgeSummary struct {
	EdgeID     string          `json:"edgeId"`
	RunID      string          `json:"runId"`
	TraceID    string          `json:"traceId"`
	EdgeType   string          `json:"edgeType"`
	From       NodeRef         `json:"from"`
	To         NodeRef         `json:"to"`
	CreatedAt  string          `json:"createdAt"`
	Attributes json.RawMessage `json:"attributes,omitempty"`
}

type RunEndRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	TraceID       string          `json:"traceId,omitempty"`
	EndedAt       string          `json:"endedAt"`
	DurationMs    float64         `json:"durationMs,omitempty"`
	Status        string          `json:"status"`
	Metrics       json.RawMessage `json:"metrics,omitempty"`
	Error         json.RawMessage `json:"error,omitempty"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

type SpanEndRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	TraceID       string          `json:"traceId,omitempty"`
	SpanID        string          `json:"spanId"`
	EndedAt       string          `json:"endedAt"`
	DurationMs    float64         `json:"durationMs,omitempty"`
	Status        string          `json:"status"`
	Metrics       json.RawMessage `json:"metrics,omitempty"`
	Error         json.RawMessage `json:"error,omitempty"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

type SpanEventRecord struct {
	SchemaVersion int             `json:"schemaVersion"`
	RecordID      string          `json:"recordId"`
	Type          RecordType      `json:"type"`
	RunID         string          `json:"runId"`
	TraceID       string          `json:"traceId,omitempty"`
	SpanID        string          `json:"spanId"`
	EventID       string          `json:"eventId"`
	Name          string          `json:"name"`
	Timestamp     string          `json:"timestamp"`
	Attributes    json.RawMessage `json:"attributes,omitempty"`
}

func NewService(db *sql.DB) (*Service, error) {
	return newService(context.Background(), db)
}

func newService(ctx context.Context, db *sql.DB) (*Service, error) {
	db.SetMaxOpenConns(1)
	service := &Service{
		db:                  db,
		events:              NewEventBus(),
		queryTO:             defaultQueryTimeout,
		mutationTO:          defaultMutationTimeout,
		maintenanceTO:       defaultMaintenanceTimeout,
		lifecycleSignatures: make(map[string]string),
	}
	ctx, cancel := service.maintenanceContext(ctx)
	defer cancel()

	if err := service.configureSQLite(ctx); err != nil {
		return nil, fmt.Errorf("configure observability sqlite: %w", err)
	}
	if err := service.migrate(ctx); err != nil {
		return nil, fmt.Errorf("migrate observability sqlite: %w", err)
	}
	return service, nil
}

func contextWithOptionalTimeout(ctx context.Context, timeout time.Duration) (context.Context, context.CancelFunc) {
	if timeout <= 0 {
		return ctx, func() {}
	}
	if _, ok := ctx.Deadline(); ok {
		return ctx, func() {}
	}
	return context.WithTimeout(ctx, timeout)
}

func (s *Service) queryContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return contextWithOptionalTimeout(ctx, s.queryTO)
}

func (s *Service) mutationContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return contextWithOptionalTimeout(ctx, s.mutationTO)
}

func (s *Service) maintenanceContext(ctx context.Context) (context.Context, context.CancelFunc) {
	return contextWithOptionalTimeout(ctx, s.maintenanceTO)
}

func OpenService(ctx context.Context, path string) (*Service, error) {
	if path != ":memory:" {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return nil, fmt.Errorf("create observability sqlite directory for %q: %w", path, err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("open observability sqlite %q: %w", path, err)
	}
	service, err := newService(ctx, db)
	if err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize observability service: %w", err)
	}
	service.StartLifecycleReconciler(ctx, time.Second)
	return service, nil
}

func (s *Service) Close() error {
	return s.db.Close()
}

func (s *Service) Events() *EventBus {
	return s.events
}

func (s *Service) StartLifecycleReconciler(ctx context.Context, interval time.Duration) {
	if interval <= 0 {
		interval = time.Second
	}
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := s.PublishLifecycleReconciliations(ctx); err != nil {
					// Reconciliation drives presentation freshness only; ingestion and reads
					// remain the source of canonical data and should never be blocked by it.
				}
			}
		}
	}()
}

func (s *Service) PublishLifecycleReconciliations(ctx context.Context) error {
	ctx, cancel := s.maintenanceContext(ctx)
	defer cancel()

	reconciliations, err := s.lifecycleReconciliations(ctx)
	if err != nil {
		return err
	}
	if len(reconciliations) == 0 {
		return nil
	}

	s.lifecycleMu.Lock()
	defer s.lifecycleMu.Unlock()

	now := time.Now().UnixMilli()
	for _, reconciliation := range reconciliations {
		if s.lifecycleSignatures[reconciliation.RunID] == reconciliation.Signature {
			continue
		}
		s.lifecycleSignatures[reconciliation.RunID] = reconciliation.Signature
		payload, _ := json.Marshal(map[string]any{
			"runId":  reconciliation.RunID,
			"status": reconciliation.Status,
			"reason": reconciliation.Reason,
		})
		s.events.Publish(Event{
			Tag:       "ObservabilityEvent",
			ID:        fmt.Sprintf("observability:lifecycle:%s:%d", reconciliation.RunID, now),
			Timestamp: now,
			Kind:      "observability.lifecycle",
			Action:    "reconciled",
			Severity:  reconciliation.Severity,
			RefID:     reconciliation.RunID,
			Payload:   payload,
		})
	}
	return nil
}

func (s *Service) lifecycleReconciliations(ctx context.Context) ([]lifecycleReconciliation, error) {
	runs, err := s.Runs(ctx)
	if err != nil {
		return nil, fmt.Errorf("list runs for lifecycle reconciliation: %w", err)
	}
	reconciliations := make([]lifecycleReconciliation, 0)
	for _, run := range runs {
		if run.Status != "running" || run.EndedAt != "" {
			continue
		}
		detail, err := s.RunDetail(ctx, run.RunID)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				continue
			}
			return nil, fmt.Errorf("read run detail for lifecycle reconciliation %q: %w", run.RunID, err)
		}
		if detail.Run.Status == "" || detail.Run.Status == run.Status {
			continue
		}
		reason := lifecycleReconciliationReason(detail)
		severity := "warn"
		if detail.Run.Status == "error" || detail.Run.Status == "cancelled" {
			severity = "error"
		}
		reconciliations = append(reconciliations, lifecycleReconciliation{
			RunID:     run.RunID,
			Status:    detail.Run.Status,
			Reason:    reason,
			Severity:  severity,
			Signature: strings.Join([]string{detail.Run.Status, detail.Run.EndedAt, reason}, "|"),
		})
	}
	return reconciliations, nil
}

func lifecycleReconciliationReason(detail RunDetail) string {
	for _, diagnostic := range detail.Diagnostics {
		if diagnostic.Code != "" {
			return diagnostic.Code
		}
	}
	return "presentation-reconciled"
}
