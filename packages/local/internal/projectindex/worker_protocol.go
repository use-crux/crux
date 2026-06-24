package projectindex

import (
	"encoding/json"
	"fmt"
)

const projectIndexWorkerProtocolVersion = 2

// ProjectIndexPatchStreamOptions configures host-side validation for one worker
// stream. The collector applies no patch until the corresponding phase has
// emitted a valid phase:done event.
type ProjectIndexPatchStreamOptions struct {
	Root             string
	Budget           IndexPatchBudget
	MaxFacts         int
	MaxFactsPerBatch int
	MaxBytes         int
	Producer         string
	AllowRoot        bool
}

// ProjectIndexPatchStreamCollector validates V2 Project Index worker events and
// reconstructs the existing IndexPatch read-model payload.
type ProjectIndexPatchStreamCollector struct {
	options      ProjectIndexPatchStreamOptions
	transactions map[string]*projectIndexPatchTransaction
	patches      []IndexPatch
	decision     map[string]any
	report       *ProjectIndexIncrementalReport
	timings      []ProjectIndexPhaseTiming
	bytes        int
	facts        int
}

// ProjectIndexPhaseTiming is an optional worker-emitted compiler timing bucket.
// It is diagnostic metadata for benchmarks and is not part of the durable
// Project Index read model.
type ProjectIndexPhaseTiming struct {
	Name       string  `json:"name"`
	DurationMs float64 `json:"durationMs"`
	Count      int     `json:"count"`
}

type projectIndexPatchTransaction struct {
	phase                     IndexPatchPhase
	root                      string
	nextSequence              int
	nextSourceProfileSequence int
	done                      bool
	facts                     IndexPatchFacts
	envelopes                 []IndexFactEnvelope
	factCount                 int
	sourceProfileFiles        []SemanticSourceProfileFile
}

type projectIndexWorkerEventHeader struct {
	ProtocolVersion int    `json:"protocolVersion"`
	Type            string `json:"type"`
	TransactionID   string `json:"transactionId"`
}

type projectIndexPhaseStartEvent struct {
	ProtocolVersion int             `json:"protocolVersion"`
	Type            string          `json:"type"`
	TransactionID   string          `json:"transactionId"`
	Phase           IndexPatchPhase `json:"phase"`
	Root            string          `json:"root"`
	StartedAt       string          `json:"startedAt"`
}

type projectIndexFactBatchEvent struct {
	ProtocolVersion int                 `json:"protocolVersion"`
	Type            string              `json:"type"`
	TransactionID   string              `json:"transactionId"`
	Sequence        int                 `json:"sequence"`
	Facts           []IndexFactEnvelope `json:"facts"`
}

type projectIndexPhaseDoneEvent struct {
	ProtocolVersion int                      `json:"protocolVersion"`
	Type            string                   `json:"type"`
	TransactionID   string                   `json:"transactionId"`
	Phase           IndexPatchPhase          `json:"phase"`
	Patch           IndexPatch               `json:"patch"`
	Summary         projectIndexPhaseSummary `json:"summary"`
}

type projectIndexPhaseSummary struct {
	FactCount int                            `json:"factCount"`
	Timings   []ProjectIndexPhaseTiming      `json:"timings,omitempty"`
	Decision  map[string]any                 `json:"decision,omitempty"`
	Report    *ProjectIndexIncrementalReport `json:"report,omitempty"`
}

// NewProjectIndexPatchStreamCollector creates an empty collector for one worker
// request stream.
func NewProjectIndexPatchStreamCollector(options ProjectIndexPatchStreamOptions) *ProjectIndexPatchStreamCollector {
	return &ProjectIndexPatchStreamCollector{
		options:      options,
		transactions: map[string]*projectIndexPatchTransaction{},
	}
}

// Handle validates and records one raw NDJSON worker event.
func (c *ProjectIndexPatchStreamCollector) Handle(raw json.RawMessage) error {
	if c == nil {
		return fmt.Errorf("project index stream collector is nil")
	}
	c.bytes += len(raw)
	if limit := c.streamByteLimit(); limit > 0 && c.bytes > limit {
		return fmt.Errorf("project index worker stream exceeded byte budget: %d/%d", c.bytes, limit)
	}

	var header projectIndexWorkerEventHeader
	if err := json.Unmarshal(raw, &header); err != nil {
		return fmt.Errorf("decode project index worker event header: %w", err)
	}
	if header.ProtocolVersion != projectIndexWorkerProtocolVersion {
		return fmt.Errorf("unsupported project index worker protocol version %d", header.ProtocolVersion)
	}
	if header.TransactionID == "" {
		return fmt.Errorf("project index worker event missing transactionId")
	}

	switch header.Type {
	case "phase:start":
		return c.handleStart(raw)
	case "fact:batch":
		return c.handleBatch(raw)
	case "sourceProfile:batch":
		return c.handleSourceProfileBatch(raw)
	case "phase:done":
		return c.handleDone(raw)
	case "phase:error":
		return c.handleError(raw)
	default:
		return fmt.Errorf("unknown project index worker event type %q", header.Type)
	}
}

// Patches returns the validated patches in completion order.
func (c *ProjectIndexPatchStreamCollector) Patches() ([]IndexPatch, error) {
	if c == nil {
		return nil, fmt.Errorf("project index stream collector is nil")
	}
	for id, tx := range c.transactions {
		if !tx.done {
			return nil, fmt.Errorf("project index worker transaction %s did not complete", id)
		}
	}
	return append([]IndexPatch(nil), c.patches...), nil
}

// Timings returns optional worker-emitted compiler timing buckets collected
// from completed phase summaries.
func (c *ProjectIndexPatchStreamCollector) Timings() []ProjectIndexPhaseTiming {
	if c == nil {
		return nil
	}
	return append([]ProjectIndexPhaseTiming(nil), c.timings...)
}

// IncrementalResult returns streamed patches plus incremental metadata attached
// to the final phase summary.
func (c *ProjectIndexPatchStreamCollector) IncrementalResult() (ProjectIndexIncrementalResult, error) {
	patches, err := c.Patches()
	if err != nil {
		return ProjectIndexIncrementalResult{}, err
	}
	report := ProjectIndexIncrementalReport{}
	if c.report != nil {
		report = *c.report
	}
	return ProjectIndexIncrementalResult{
		Decision: c.decision,
		Patches:  patches,
		Report:   report,
	}, nil
}

// CompletedPatchCount returns the number of fully validated patches received
// for this stream request.
func (c *ProjectIndexPatchStreamCollector) CompletedPatchCount() int {
	if c == nil {
		return 0
	}
	return len(c.patches)
}

// HasIncrementalReport reports whether the final incremental phase summary
// has arrived.
func (c *ProjectIndexPatchStreamCollector) HasIncrementalReport() bool {
	return c != nil && c.report != nil
}

func (c *ProjectIndexPatchStreamCollector) handleStart(raw json.RawMessage) error {
	var event projectIndexPhaseStartEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return fmt.Errorf("decode phase:start: %w", err)
	}
	if event.Phase == "" {
		return fmt.Errorf("phase:start missing phase")
	}
	if err := c.validateRoot(event.Root); err != nil {
		return err
	}
	if _, exists := c.transactions[event.TransactionID]; exists {
		return fmt.Errorf("duplicate project index worker transaction %s", event.TransactionID)
	}
	c.transactions[event.TransactionID] = &projectIndexPatchTransaction{phase: event.Phase, root: event.Root}
	return nil
}

func (c *ProjectIndexPatchStreamCollector) handleBatch(raw json.RawMessage) error {
	var event projectIndexFactBatchEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return fmt.Errorf("decode fact:batch: %w", err)
	}
	tx, err := c.openTransaction(event.TransactionID)
	if err != nil {
		return err
	}
	if event.Sequence != tx.nextSequence {
		return fmt.Errorf("project index worker transaction %s sequence = %d, want %d", event.TransactionID, event.Sequence, tx.nextSequence)
	}
	if c.options.MaxFactsPerBatch > 0 && len(event.Facts) > c.options.MaxFactsPerBatch {
		return fmt.Errorf("project index worker transaction %s batch facts = %d, want <= %d", event.TransactionID, len(event.Facts), c.options.MaxFactsPerBatch)
	}
	for _, envelope := range event.Facts {
		if err := c.addEnvelopeFact(tx, envelope); err != nil {
			return err
		}
		tx.factCount++
		c.facts++
		if c.options.MaxFacts > 0 && c.facts > c.options.MaxFacts {
			return fmt.Errorf("project index worker stream exceeded fact budget: %d/%d", c.facts, c.options.MaxFacts)
		}
	}
	tx.nextSequence++
	return nil
}

func (c *ProjectIndexPatchStreamCollector) handleDone(raw json.RawMessage) error {
	var event projectIndexPhaseDoneEvent
	if err := json.Unmarshal(raw, &event); err != nil {
		return fmt.Errorf("decode phase:done: %w", err)
	}
	tx, err := c.openTransaction(event.TransactionID)
	if err != nil {
		return err
	}
	if event.Phase != tx.phase {
		return fmt.Errorf("project index worker transaction %s done phase = %s, want %s", event.TransactionID, event.Phase, tx.phase)
	}
	if event.Summary.FactCount != tx.factCount {
		return fmt.Errorf("project index worker transaction %s fact count = %d, want %d", event.TransactionID, event.Summary.FactCount, tx.factCount)
	}
	if event.Patch.Phase == "" {
		event.Patch.Phase = tx.phase
	}
	if event.Patch.Project.Root == "" {
		event.Patch.Project.Root = tx.root
	}
	if err := c.validateRoot(event.Patch.Project.Root); err != nil {
		return err
	}
	event.Patch.Facts = tx.facts
	if len(tx.sourceProfileFiles) > 0 {
		event.Patch.SemanticSourceProfile = semanticSourceProfileFromStreamFiles(tx.sourceProfileFiles)
	}
	if err := ValidatePatchBudget(event.Patch, c.options.Budget); err != nil {
		return err
	}
	event.Patch.FactEnvelopes = append([]IndexFactEnvelope(nil), tx.envelopes...)
	tx.done = true
	c.patches = append(c.patches, event.Patch)
	if event.Summary.Decision != nil {
		c.decision = event.Summary.Decision
	}
	if event.Summary.Report != nil {
		c.report = event.Summary.Report
	}
	c.timings = append(c.timings, event.Summary.Timings...)
	return nil
}
