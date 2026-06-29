package devtools

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"sort"
	"strings"

	"github.com/use-crux/crux/packages/local/internal/observability"
	"github.com/use-crux/crux/packages/local/internal/resourceinspection"
	"github.com/use-crux/crux/packages/local/internal/store"
)

type lifetimeWindow struct {
	StartedAt     int64 `json:"startedAt"`
	LastTouchedAt int64 `json:"lastTouchedAt"`
	DurationMs    int64 `json:"durationMs"`
}

type memoryStoreSummary struct {
	ID          string         `json:"id"`
	Type        string         `json:"type"`
	Label       string         `json:"label,omitempty"`
	Scope       map[string]any `json:"scope"`
	Stats       memoryStats    `json:"stats"`
	LastRunID   string         `json:"lastRunId,omitempty"`
	LastTraceID string         `json:"lastTraceId,omitempty"`
	Health      string         `json:"health"`
}

type memoryStats struct {
	Reads     int            `json:"reads"`
	Writes    int            `json:"writes"`
	Entries   *int           `json:"entries"`
	Conflicts int            `json:"conflicts"`
	Lifetime  lifetimeWindow `json:"lifetime"`
	Trend     *memoryTrend   `json:"trend,omitempty"`
}

type memoryStoreDetail struct {
	memoryStoreSummary
	Schema         any               `json:"schema,omitempty"`
	Owner          string            `json:"owner,omitempty"`
	Source         *store.SourceLoc  `json:"source,omitempty"`
	Backend        string            `json:"backend,omitempty"`
	ConflictPolicy string            `json:"conflictPolicy,omitempty"`
	EvictionPolicy string            `json:"evictionPolicy,omitempty"`
	State          any               `json:"state"`
	Inspection     *memoryInspection `json:"inspection,omitempty"`
}

type memoryInspection struct {
	Status     resourceinspection.Status          `json:"status"`
	Source     resourceinspection.Source          `json:"source,omitempty"`
	ResourceID string                             `json:"resourceId"`
	Kind       string                             `json:"kind,omitempty"`
	Value      json.RawMessage                    `json:"value,omitempty"`
	Entries    []resourceinspection.ResourceEntry `json:"entries,omitempty"`
	Message    string                             `json:"message,omitempty"`
	Reason     string                             `json:"reason,omitempty"`
	DocsURL    string                             `json:"docsUrl,omitempty"`
}

type memoryTrend struct {
	Reads  []int `json:"reads"`
	Writes []int `json:"writes"`
}

type memoryOperationRecord struct {
	EventID   string `json:"eventId"`
	Timestamp int64  `json:"timestamp"`
	StoreID   string `json:"storeId"`
	StoreType string `json:"storeType"`
	Op        string `json:"op"`
	Key       string `json:"key"`
	Value     string `json:"value,omitempty"`
	TraceID   string `json:"traceId,omitempty"`
	SpanID    string `json:"spanId,omitempty"`
}

type workspaceSummary struct {
	ID            string           `json:"id"`
	Namespace     string           `json:"namespace"`
	Mounts        []workspaceMount `json:"mounts"`
	Stats         workspaceStats   `json:"stats"`
	LastTouchedAt int64            `json:"lastTouchedAt"`
}

type workspaceMount struct {
	Path      string `json:"path"`
	Mode      string `json:"mode"`
	FileCount int    `json:"fileCount"`
}

type workspaceStats struct {
	Runs         int     `json:"runs"`
	Operations   int     `json:"operations"`
	Errors       int     `json:"errors"`
	P50LatencyMs float64 `json:"p50LatencyMs"`
	P99LatencyMs float64 `json:"p99LatencyMs"`
}

type workspaceDetail struct {
	workspaceSummary
	Files     []workspaceFileSummary `json:"files"`
	RecentOps []workspaceOpDetail    `json:"recentOps"`
}

type workspaceFileSummary struct {
	Path             string  `json:"path"`
	Mount            string  `json:"mount"`
	Op               string  `json:"op"`
	Status           string  `json:"status"`
	Size             *int    `json:"size,omitempty"`
	Mime             string  `json:"mime,omitempty"`
	LastOpAt         int64   `json:"lastOpAt"`
	LastOpDurationMs float64 `json:"lastOpDurationMs"`
	LastError        string  `json:"lastError,omitempty"`
	OperationCount   int     `json:"operationCount"`
}

type workspaceOpDetail struct {
	EventID    string  `json:"eventId"`
	Op         string  `json:"op"`
	Path       string  `json:"path"`
	DurationMs float64 `json:"durationMs"`
	Status     string  `json:"status"`
	Bytes      *int    `json:"bytes,omitempty"`
	TraceID    string  `json:"traceId,omitempty"`
	SpanID     string  `json:"spanId,omitempty"`
	Actor      string  `json:"actor,omitempty"`
	Error      string  `json:"error,omitempty"`
	Timestamp  int64   `json:"timestamp"`
}

type workspaceFileDetail struct {
	Path       string                `json:"path"`
	Mime       string                `json:"mime,omitempty"`
	Size       *int                  `json:"size,omitempty"`
	Status     string                `json:"status"`
	Preview    *workspaceFilePreview `json:"preview,omitempty"`
	Operations []workspaceFileOp     `json:"operations"`
	Versions   []workspaceVersion    `json:"versions,omitempty"`
}

type workspaceFilePreview struct {
	ContentType string `json:"contentType"`
	Body        string `json:"body"`
	Truncated   bool   `json:"truncated"`
}

type workspaceFileOp struct {
	EventID    string               `json:"eventId"`
	Op         string               `json:"op"`
	Actor      string               `json:"actor,omitempty"`
	SpanID     string               `json:"spanId,omitempty"`
	TraceID    string               `json:"traceId,omitempty"`
	DurationMs float64              `json:"durationMs"`
	Diff       *workspaceDiffCounts `json:"diff,omitempty"`
	Timestamp  int64                `json:"timestamp"`
}

type workspaceVersion struct {
	VersionID string              `json:"versionId"`
	Timestamp int64               `json:"timestamp"`
	Actor     string              `json:"actor,omitempty"`
	Diff      workspaceDiffCounts `json:"diff"`
	TraceID   string              `json:"traceId,omitempty"`
}

type workspaceDiffCounts struct {
	Added   int `json:"added"`
	Removed int `json:"removed"`
}

type planSummary struct {
	ID             string     `json:"id"`
	Title          string     `json:"title"`
	Status         string     `json:"status"`
	Version        int        `json:"version"`
	VersionCount   int        `json:"versionCount"`
	StartedAt      int64      `json:"startedAt"`
	LastUpdatedAt  int64      `json:"lastUpdatedAt"`
	Author         string     `json:"author,omitempty"`
	TaskCounts     taskCounts `json:"taskCounts"`
	ContentPreview string     `json:"contentPreview"`
}

type taskCounts struct {
	Done       int `json:"done"`
	InProgress int `json:"inProgress"`
	Pending    int `json:"pending"`
	Removed    int `json:"removed"`
}

type planDetail struct {
	planSummary
	Content  string        `json:"content"`
	Versions []planVersion `json:"versions"`
	Tasks    []planTask    `json:"tasks"`
	Events   []planEvent   `json:"events"`
}

type planVersion struct {
	Version         int                  `json:"version"`
	Timestamp       int64                `json:"timestamp"`
	Author          string               `json:"author,omitempty"`
	Summary         string               `json:"summary"`
	Diff            *workspaceDiffCounts `json:"diff,omitempty"`
	ContentSnapshot string               `json:"contentSnapshot,omitempty"`
}

type planTask struct {
	ID               string   `json:"id"`
	ParentID         *string  `json:"parentId"`
	Label            string   `json:"label"`
	Status           string   `json:"status"`
	Progress         float64  `json:"progress"`
	ProgressMessage  string   `json:"progressMessage,omitempty"`
	Assignee         string   `json:"assignee,omitempty"`
	Model            string   `json:"model,omitempty"`
	DurationMs       *float64 `json:"durationMs"`
	SpanID           string   `json:"spanId,omitempty"`
	TraceID          string   `json:"traceId,omitempty"`
	AddedInVersion   int      `json:"addedInVersion"`
	RemovedInVersion *int     `json:"removedInVersion,omitempty"`
}

type planEvent struct {
	EventID   string `json:"eventId"`
	Kind      string `json:"kind"`
	Agent     string `json:"agent,omitempty"`
	Label     string `json:"label"`
	Timestamp int64  `json:"timestamp"`
	Payload   any    `json:"payload,omitempty"`
}

func (s *Service) memoryStores(ctx context.Context) ([]memoryStoreSummary, error) {
	instances := s.store.GetMemoryInstances()
	events := s.memoryEvents(ctx)
	byID := map[string][]store.MemoryEventData{}
	for _, event := range events {
		byID[event.MemoryID] = append(byID[event.MemoryID], event)
	}

	seen := map[string]bool{}
	out := make([]memoryStoreSummary, 0, len(instances))
	for _, inst := range instances {
		eventsForStore := byID[inst.MemoryID]
		out = append(out, memorySummaryFromInstance(inst, eventsForStore))
		seen[inst.MemoryID] = true
	}
	for id, eventsForStore := range byID {
		if seen[id] || id == "" {
			continue
		}
		out = append(out, memorySummaryFromEvents(id, eventsForStore))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Stats.Lifetime.LastTouchedAt > out[j].Stats.Lifetime.LastTouchedAt
	})
	return out, nil
}

func (s *Service) memoryStoreDetail(ctx context.Context, id string) (memoryStoreDetail, bool, error) {
	stores, err := s.memoryStores(ctx)
	if err != nil {
		return memoryStoreDetail{}, false, err
	}
	var summary *memoryStoreSummary
	for i := range stores {
		if stores[i].ID == id {
			summary = &stores[i]
			break
		}
	}
	if summary == nil {
		return memoryStoreDetail{}, false, nil
	}
	events := filterMemoryEvents(s.memoryEvents(ctx), id)
	inst := s.store.GetMemoryInstance(id)
	state := memoryStateFor(*summary, inst, events)
	detail := memoryStoreDetail{memoryStoreSummary: *summary, State: state}
	enrichMemoryStoreDetail(&detail, inst, events, s.store.GetIndex())
	detail.Inspection = s.memoryStoreInspection(ctx, detail)
	return detail, true, nil
}

func (s *Service) memoryStoreInspection(ctx context.Context, detail memoryStoreDetail) *memoryInspection {
	resourceID, kind := memoryResourceID(detail)
	if s.resources == nil {
		return nil
	}

	result, err := s.resources.List(ctx, resourceinspection.ListRequest{
		ResourceID: resourceID,
		Limit:      100,
	})
	if err != nil {
		return &memoryInspection{
			Status:     resourceinspection.StatusPartial,
			Source:     resourceinspection.SourceProjection,
			ResourceID: resourceID,
			Kind:       kind,
			Reason:     resourceinspection.ReasonCommandFailed,
			Message:    fmt.Sprintf("Showing projected memory activity because live runtime inspection failed: %v", err),
			DocsURL:    resourceinspection.RuntimeBridgeDocsURL,
		}
	}
	if result.Status == resourceinspection.StatusOK {
		return memoryInspectionFromResource(result, resourceinspection.SourceMixed)
	}

	message := result.Message
	if message == "" {
		message = "Showing projected memory activity. Live runtime inspection is not available."
	}
	if result.Status == resourceinspection.StatusError && result.Reason == resourceinspection.ReasonCommandFailed {
		message = "Showing projected memory activity because live runtime inspection failed: " + message
	}
	docsURL := result.DocsURL
	if docsURL == "" {
		docsURL = resourceinspection.RuntimeBridgeDocsURL
	}
	return &memoryInspection{
		Status:     resourceinspection.StatusPartial,
		Source:     resourceinspection.SourceProjection,
		ResourceID: resourceID,
		Kind:       kind,
		Reason:     result.Reason,
		Message:    message,
		DocsURL:    docsURL,
	}
}

func memoryInspectionFromResource(result resourceinspection.ResourceResult, source resourceinspection.Source) *memoryInspection {
	if result.Source != "" {
		source = result.Source
	}
	if source == resourceinspection.SourceRuntimeBridge {
		source = resourceinspection.SourceMixed
	}
	return &memoryInspection{
		Status:     result.Status,
		Source:     source,
		ResourceID: result.ResourceID,
		Kind:       result.Kind,
		Value:      result.Value,
		Entries:    result.Entries,
		Message:    result.Message,
		Reason:     result.Reason,
		DocsURL:    result.DocsURL,
	}
}

func memoryResourceID(detail memoryStoreDetail) (string, string) {
	if strings.HasPrefix(detail.ID, "memory:") {
		return detail.ID, "memory"
	}
	if strings.HasPrefix(detail.ID, "blackboard:") {
		return detail.ID, "blackboard"
	}
	if detail.Type == "blackboard" {
		return "blackboard:" + detail.ID, "blackboard"
	}
	return "memory:" + detail.ID, "memory"
}

func (s *Service) memoryOperations(ctx context.Context, since, until int64, limit int) ([]memoryOperationRecord, error) {
	events := s.memoryEvents(ctx)
	if limit <= 0 {
		limit = 50
	}
	if limit > 500 {
		limit = 500
	}
	out := make([]memoryOperationRecord, 0, len(events))
	for _, event := range events {
		if event.MemoryID == "" {
			continue
		}
		if since > 0 && event.Timestamp < since {
			continue
		}
		if until > 0 && event.Timestamp > until {
			continue
		}
		storeType := normalizedMemoryType(event.MemoryType, event.BlockKind)
		key := nonEmpty(event.Key, event.Query, event.Operation)
		record := memoryOperationRecord{
			EventID:   eventID("memory-op", event.TraceID, event.Timestamp, key),
			Timestamp: event.Timestamp,
			StoreID:   event.MemoryID,
			StoreType: storeType,
			Op:        memoryOperationName(event),
			Key:       key,
			Value:     memoryOperationValue(event),
			TraceID:   event.TraceID,
			SpanID:    event.SpanID,
		}
		out = append(out, record)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp > out[j].Timestamp })
	if len(out) > limit {
		out = out[:limit]
	}
	return out, nil
}

func (s *Service) workspaceSummaries(ctx context.Context) ([]workspaceSummary, error) {
	events := s.workspaceEvents(ctx)
	byID := map[string][]store.WorkspaceEventData{}
	for _, event := range events {
		id := nonEmpty(event.WorkspaceID, "workspace")
		byID[id] = append(byID[id], event)
	}
	out := make([]workspaceSummary, 0, len(byID))
	for id, group := range byID {
		out = append(out, workspaceSummaryFromEvents(id, group))
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastTouchedAt > out[j].LastTouchedAt })
	return out, nil
}

func (s *Service) workspaceDetail(ctx context.Context, id string) (workspaceDetail, bool, error) {
	events := filterWorkspaceEvents(s.workspaceEvents(ctx), id)
	if len(events) == 0 {
		return workspaceDetail{}, false, nil
	}
	summary := workspaceSummaryFromEvents(id, events)
	files := workspaceFilesFromEvents(events)
	ops := workspaceOpsFromEvents(events)
	return workspaceDetail{workspaceSummary: summary, Files: files, RecentOps: ops}, true, nil
}

func (s *Service) workspaceFileDetail(ctx context.Context, workspaceID, filePath string) (workspaceFileDetail, bool, error) {
	events := filterWorkspaceFileEvents(s.workspaceEvents(ctx), workspaceID, filePath)
	if len(events) == 0 {
		return workspaceFileDetail{}, false, nil
	}
	files := workspaceFilesFromEvents(events)
	file := files[0]
	return workspaceFileDetail{
		Path:       file.Path,
		Mime:       file.Mime,
		Size:       file.Size,
		Status:     file.Status,
		Operations: workspaceFileOpsFromEvents(events),
	}, true, nil
}

func (s *Service) plans(ctx context.Context) ([]planSummary, error) {
	details := s.planDetails(ctx)
	out := make([]planSummary, 0, len(details))
	for _, detail := range details {
		out = append(out, detail.planSummary)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LastUpdatedAt > out[j].LastUpdatedAt })
	return out, nil
}

func (s *Service) planDetail(ctx context.Context, id string) (planDetail, bool) {
	for _, detail := range s.planDetails(ctx) {
		if detail.ID == id {
			return detail, true
		}
	}
	return planDetail{}, false
}

func (s *Service) memoryEvents(ctx context.Context) []store.MemoryEventData {
	if s.observability != nil {
		if activity, err := s.observability.ResourceActivity(ctx, "memory"); err == nil && len(activity) > 0 {
			return memoryEventsFromActivity(activity)
		}
	}
	return s.store.GetMemoryEvents()
}

func (s *Service) workspaceEvents(ctx context.Context) []store.WorkspaceEventData {
	if s.observability != nil {
		if activity, err := s.observability.ResourceActivity(ctx, "workspace"); err == nil && len(activity) > 0 {
			return workspaceEventsFromActivity(activity)
		}
	}
	return s.store.GetWorkspaceEvents()
}

func memoryEventsFromActivity(activity []observability.ResourceActivity) []store.MemoryEventData {
	out := make([]store.MemoryEventData, 0, len(activity))
	for _, item := range activity {
		attrs := rawMap(item.Attributes)
		kind := "write"
		if item.Primitive == "memory.read" {
			kind = "read"
		}
		event := store.MemoryEventData{
			Kind:          kind,
			SpanID:        item.SpanID,
			RunID:         item.RunID,
			MemoryID:      stringValue(attrs, "memoryId", item.ResourceID),
			MemoryType:    stringValue(attrs, "memoryType", "block"),
			Operation:     stringValue(attrs, "operation", operationFromActivity(item)),
			BlockID:       stringValue(attrs, "blockId", ""),
			BlockKind:     stringValue(attrs, "blockKind", ""),
			NamespaceHash: stringValue(attrs, "namespaceHash", ""),
			TraceID:       item.TraceID,
			Timestamp:     parseUnixMillis(item.StartedAt),
			Snapshot:      firstArtifactPreview(item.Artifacts),
			Metadata:      attrs,
		}
		if kind == "read" {
			count := intValue(attrs, "resultCount", intValue(attrs, "count", 0))
			event.Count = &count
			event.Query = stringValue(attrs, "query", "")
			if score, ok := numberAny(attrs["topScore"]); ok {
				event.Score = &score
			} else if score, ok := numberAny(attrs["score"]); ok {
				event.Score = &score
			}
			if item.DurationMs > 0 {
				durationMs := item.DurationMs
				event.DurationMs = &durationMs
			}
		} else {
			event.Key = stringValue(attrs, "entryKey", stringValue(attrs, "key", ""))
			event.Content = stringValue(attrs, "contentPreview", stringValue(attrs, "content", ""))
			event.WriteMode = stringValue(attrs, "writeMode", "")
			event.ProposalStatus = stringValue(attrs, "proposalStatus", "")
		}
		out = append(out, event)
	}
	return out
}

func workspaceEventsFromActivity(activity []observability.ResourceActivity) []store.WorkspaceEventData {
	out := make([]store.WorkspaceEventData, 0, len(activity))
	for _, item := range activity {
		attrs := rawMap(item.Attributes)
		status := "success"
		if item.Status == "error" || len(item.Error) > 0 && string(item.Error) != "null" {
			status = "error"
		}
		event := store.WorkspaceEventData{
			TraceID:     item.TraceID,
			Timestamp:   parseUnixMillis(item.StartedAt),
			WorkspaceID: stringValue(attrs, "workspaceId", item.ResourceID),
			Namespace:   stringValue(attrs, "namespaceHash", stringValue(attrs, "namespace", "")),
			Operation:   stringValue(attrs, "operation", operationFromActivity(item)),
			Path:        stringValue(attrs, "path", "/"),
			Status:      status,
			DurationMs:  item.DurationMs,
			Mount:       stringValue(attrs, "mount", ""),
			MimeType:    stringValue(attrs, "mimeType", ""),
		}
		if size, ok := optionalIntValue(attrs, "size"); ok {
			event.Size = &size
		} else if size, ok := optionalIntValue(attrs, "sizeBytes"); ok {
			event.Size = &size
		}
		if msg := errorMessage(item.Error); msg != "" {
			event.Error = &msg
		}
		out = append(out, event)
	}
	return out
}

func memorySummaryFromInstance(inst store.MemoryInstanceData, events []store.MemoryEventData) memoryStoreSummary {
	entries := len(inst.Entries)
	stats := memoryStats{
		Reads:     inst.ReadCount,
		Writes:    inst.WriteCount,
		Entries:   &entries,
		Conflicts: countMemoryConflicts(events),
		Lifetime:  eventLifetime(memoryEventTimes(events), inst.LastActivity),
		Trend:     memoryTrendFromEvents(events),
	}
	if inst.MemoryType == "working" {
		stats.Entries = nil
	}
	lastRun, lastTrace := lastRunTraceFromMemory(events)
	return memoryStoreSummary{
		ID:          inst.MemoryID,
		Type:        normalizedMemoryType(inst.MemoryType, inst.BlockKind),
		Label:       memoryLabel(inst),
		Scope:       memoryScope(inst),
		Stats:       stats,
		LastRunID:   lastRun,
		LastTraceID: lastTrace,
		Health:      memoryHealth(events),
	}
}

func memorySummaryFromEvents(id string, events []store.MemoryEventData) memoryStoreSummary {
	reads, writes := 0, 0
	memoryType := "working"
	for _, event := range events {
		if event.MemoryType != "" {
			memoryType = normalizedMemoryType(event.MemoryType, event.BlockKind)
		}
		if event.Kind == "read" {
			reads++
		} else {
			writes++
		}
	}
	lastRun, lastTrace := lastRunTraceFromMemory(events)
	return memoryStoreSummary{
		ID:          id,
		Type:        memoryType,
		Scope:       map[string]any{"kind": "project", "id": "default"},
		Stats:       memoryStats{Reads: reads, Writes: writes, Entries: nil, Conflicts: countMemoryConflicts(events), Lifetime: eventLifetime(memoryEventTimes(events), 0), Trend: memoryTrendFromEvents(events)},
		LastRunID:   lastRun,
		LastTraceID: lastTrace,
		Health:      memoryHealth(events),
	}
}

func memoryStateFor(summary memoryStoreSummary, inst *store.MemoryInstanceData, events []store.MemoryEventData) any {
	switch summary.Type {
	case "episodic":
		return episodicMemoryState(inst, events)
	case "semantic":
		return semanticMemoryState(inst, events)
	case "blackboard":
		return blackboardMemoryState(inst, events)
	default:
		return workingMemoryState(inst, events)
	}
}

func workingMemoryState(inst *store.MemoryInstanceData, events []store.MemoryEventData) map[string]any {
	fields := []map[string]any{}
	if inst != nil {
		for key, value := range objectFields(inst.CurrentState) {
			fields = append(fields, map[string]any{
				"name":      key,
				"ty":        typeName(value),
				"value":     value,
				"updatedAt": inst.LastActivity,
			})
		}
	}
	if len(fields) == 0 {
		fields = memoryFieldsFromSnapshots(events, "updatedAt", true)
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i]["name"].(string) < fields[j]["name"].(string) })
	mutations := []map[string]any{}
	for _, event := range events {
		if event.Kind != "write" {
			continue
		}
		key := nonEmpty(event.Key, event.Operation)
		mutation := map[string]any{
			"eventId":   eventID("memory", event.TraceID, event.Timestamp, key),
			"op":        memoryMutationOp(event.Operation),
			"key":       key,
			"timestamp": event.Timestamp,
		}
		if len(event.Snapshot) > 0 && string(event.Snapshot) != "null" {
			mutation["after"] = rawJSONValue(event.Snapshot)
		}
		if event.TraceID != "" {
			mutation["traceId"] = event.TraceID
		}
		if event.SpanID != "" {
			mutation["spanId"] = event.SpanID
		}
		mutations = append(mutations, mutation)
	}
	return map[string]any{"type": "working", "fields": fields, "mutations": mutations}
}

func episodicMemoryState(inst *store.MemoryInstanceData, events []store.MemoryEventData) map[string]any {
	entries := memoryEntries(inst, "episode")
	if len(entries) == 0 {
		entries = memoryEntriesFromSnapshots(events, "episode")
	}
	return map[string]any{"type": "episodic", "entries": entries, "queries": memoryQueries(events), "writes": memoryWrites(events)}
}

func semanticMemoryState(inst *store.MemoryInstanceData, events []store.MemoryEventData) map[string]any {
	entries := memoryEntries(inst, "chunk")
	if len(entries) == 0 {
		entries = memoryEntriesFromSnapshots(events, "chunk")
	}
	chunks := []map[string]any{}
	for _, entry := range entries {
		chunks = append(chunks, map[string]any{
			"id":        entry["id"],
			"sourceDoc": stringValue(entry, "sourceDoc", stringValue(entry, "id", "")),
			"text":      stringValue(entry, "content", ""),
			"tags":      entry["tags"],
		})
	}
	return map[string]any{
		"type": "semantic",
		"index": map[string]any{
			"chunkCount":  len(chunks),
			"sourceCount": len(chunks),
		},
		"chunks":  chunks,
		"queries": memoryQueries(events),
	}
}

func blackboardMemoryState(inst *store.MemoryInstanceData, events []store.MemoryEventData) map[string]any {
	fields := []map[string]any{}
	if inst != nil {
		for key, value := range objectFields(inst.CurrentState) {
			fields = append(fields, map[string]any{
				"name":      key,
				"ty":        typeName(value),
				"value":     value,
				"writtenAt": inst.LastActivity,
			})
		}
	}
	if len(fields) == 0 {
		fields = memoryFieldsFromSnapshots(events, "writtenAt", true)
	}
	changeLog := []map[string]any{}
	collaborators := map[string]bool{}
	for _, event := range events {
		if event.Kind != "write" {
			continue
		}
		agent := nonEmpty(event.Operation, "memory")
		collaborators[agent] = true
		change := map[string]any{
			"eventId":   eventID("blackboard", event.TraceID, event.Timestamp, event.Key),
			"agent":     agent,
			"field":     nonEmpty(event.Key, event.Operation),
			"timestamp": event.Timestamp,
		}
		if len(event.Snapshot) > 0 && string(event.Snapshot) != "null" {
			change["after"] = rawJSONValue(event.Snapshot)
		}
		if event.TraceID != "" {
			change["traceId"] = event.TraceID
		}
		if event.SpanID != "" {
			change["spanId"] = event.SpanID
		}
		changeLog = append(changeLog, change)
	}
	return map[string]any{"type": "blackboard", "fields": fields, "changeLog": changeLog, "collaborators": sortedKeys(collaborators)}
}

func memoryFieldsFromSnapshots(events []store.MemoryEventData, timeKey string, includeReads bool) []map[string]any {
	current := map[string]map[string]any{}
	for _, event := range events {
		if event.Kind != "write" && !(includeReads && event.Kind == "read") {
			continue
		}
		for key, value := range memorySnapshotFields(event) {
			if key == "" {
				continue
			}
			if existing, ok := current[key]; ok {
				if int64Value(existing[timeKey], 0) > event.Timestamp {
					continue
				}
			}
			current[key] = map[string]any{
				"name":  key,
				"ty":    typeName(value),
				"value": value,
				timeKey: event.Timestamp,
			}
		}
	}
	fields := make([]map[string]any, 0, len(current))
	for _, field := range current {
		fields = append(fields, field)
	}
	sort.Slice(fields, func(i, j int) bool { return fields[i]["name"].(string) < fields[j]["name"].(string) })
	return fields
}

func memorySnapshotFields(event store.MemoryEventData) map[string]any {
	out := map[string]any{}
	value := rawJSONValue(event.Snapshot)
	if value == nil {
		if event.Key != "" && event.Content != "" {
			out[event.Key] = event.Content
		}
		return out
	}
	if object := anyMap(value); len(object) > 0 {
		if field := stringValue(object, "field", ""); field != "" {
			if nested, ok := object["value"]; ok {
				out[field] = nested
				return out
			}
		}
	}
	if event.Key != "" {
		if object := anyMap(value); len(object) > 0 {
			if nested, ok := object[event.Key]; ok {
				out[event.Key] = nested
				return out
			}
			if field := stringValue(object, "field", ""); field != "" {
				if nested, ok := object["value"]; ok {
					out[field] = nested
					return out
				}
			}
		}
		out[event.Key] = value
		return out
	}
	for key, fieldValue := range objectFields(value) {
		out[key] = fieldValue
	}
	return out
}

func enrichMemoryStoreDetail(detail *memoryStoreDetail, inst *store.MemoryInstanceData, events []store.MemoryEventData, index store.IndexData) {
	def := memoryIndexDefinition(detail.ID, detail.Type, inst, index)
	if def != nil {
		detail.Source = def.Source
		if schema := memorySchemaFromDefinition(*def); schema != nil {
			detail.Schema = schema
		}
		meta := rawMap(def.Metadata)
		detail.Owner = stringValue(meta, "owner", detail.Owner)
		detail.Backend = stringValue(meta, "backend", detail.Backend)
		detail.ConflictPolicy = stringValue(meta, "conflictPolicy", detail.ConflictPolicy)
		detail.EvictionPolicy = stringValue(meta, "evictionPolicy", detail.EvictionPolicy)
	}

	meta := latestMemoryMetadata(events)
	detail.Owner = stringValue(meta, "owner", stringValue(meta, "agentId", detail.Owner))
	detail.Backend = stringValue(meta, "backend", stringValue(meta, "store", detail.Backend))
	detail.ConflictPolicy = stringValue(meta, "conflictPolicy", detail.ConflictPolicy)
	detail.EvictionPolicy = stringValue(meta, "evictionPolicy", detail.EvictionPolicy)
	if detail.Schema == nil {
		if schema, ok := schemaFromMetadata(meta); ok {
			detail.Schema = schema
		}
	}
	if detail.Source == nil {
		detail.Source = sourceFromMetadata(meta)
	}
	if detail.Type == "blackboard" && detail.ConflictPolicy != "" {
		if state, ok := detail.State.(map[string]any); ok {
			state["conflictPolicy"] = detail.ConflictPolicy
		}
	}
	if detail.Type == "episodic" {
		hasEmbed := episodicHasEmbed(def)
		indexedRetentionPolicy := episodicRetentionPolicyFromDefinition(def)
		if detail.Schema == nil {
			detail.Schema = canonicalEpisodicSchema(hasEmbed)
		}
		if state, ok := detail.State.(map[string]any); ok {
			if index := episodicIndexFromMetadata(meta); index != nil {
				state["index"] = index
			} else if def != nil {
				if index := memoryIndexFromDefinition(*def, state); index != nil {
					state["index"] = index
				}
			}
			if retention := episodicRetention(meta, events, indexedRetentionPolicy); retention != nil {
				state["retention"] = retention
			}
		}
	}
}

// episodicHasEmbed reports whether any episodes block in the definition has a
// real embedder (and therefore a vector index). Recency/list-backed episodic
// stores return false.
func episodicHasEmbed(def *store.ProjectDefinition) bool {
	if def == nil {
		return false
	}
	blocks, ok := rawMap(def.Metadata)["blocks"].([]any)
	if !ok {
		return false
	}
	for _, blockValue := range blocks {
		block := anyMap(blockValue)
		if stringValue(block, "kind", "") == "episodes" && boolValue(block, "hasEmbed", false) {
			return true
		}
	}
	return false
}

func episodicRetentionPolicyFromDefinition(def *store.ProjectDefinition) string {
	if def == nil {
		return ""
	}
	blocks, ok := rawMap(def.Metadata)["blocks"].([]any)
	if !ok {
		return ""
	}
	for _, blockValue := range blocks {
		block := anyMap(blockValue)
		if stringValue(block, "kind", "") == "episodes" {
			return stringValue(block, "retentionPolicy", "")
		}
	}
	return ""
}

// canonicalEpisodicSchema returns the fixed EpisodicEntry shape as an authored
// schema. EpisodicEntry is a Crux type, not a per-project schema, so the shape
// is synthesized rather than read from event metadata. Fields that only exist
// when the store is vector-indexed (embedding) are included only when the block
// actually has an embedder — the card stays truthful to what the store persists.
func canonicalEpisodicSchema(hasEmbed bool) map[string]any {
	properties := map[string]any{
		"id":        map[string]any{"type": "string", "description": "Stable entry key"},
		"content":   map[string]any{"type": "string", "description": "Recorded episode text"},
		"tags":      map[string]any{"type": "array", "items": map[string]any{"type": "string"}, "description": "Classification tags (from entry metadata)"},
		"writtenBy": map[string]any{"type": "string", "description": "Originating agent / subsystem (when known)"},
		"sourceRun": map[string]any{"type": "string", "description": "Originating run / trace id (when known)"},
		"createdAt": map[string]any{"type": "number", "description": "Record timestamp (ms)"},
	}
	required := []any{"id", "content", "createdAt"}
	if hasEmbed {
		properties["confidence"] = map[string]any{"type": "number", "minimum": 0, "maximum": 1, "description": "Relevance confidence"}
		properties["embedding"] = map[string]any{"type": "array", "items": map[string]any{"type": "number"}, "description": "Dense vector (index only)"}
	}
	return map[string]any{
		"$schema":     "https://json-schema.org/draft/2020-12/schema",
		"title":       "EpisodicEntry",
		"type":        "object",
		"description": "Episodic memory entry. Recency-backed; retention sweep evicts entries past the policy window.",
		"properties":  properties,
		"required":    required,
		"x-authored":  true,
	}
}

// episodicRetention resolves the retention policy plus the latest GC sweep stats.
// The policy comes from event metadata (every episodic event carries it when a
// retention is configured); lastGcAt/lastGcEvicted come from the most recent
// `evict` sweep so the card reports real eviction activity, not a guess.
func episodicRetention(meta map[string]any, events []store.MemoryEventData, indexedPolicy string) map[string]any {
	policy := stringValue(meta, "retentionPolicy", "")
	if policy == "" {
		policy = indexedPolicy
	}
	var lastGcAt, lastGcEvicted float64
	hasGc := false
	for _, event := range events {
		if policy == "" {
			policy = stringValue(event.Metadata, "retentionPolicy", "")
		}
		gcAt, ok := numberAny(event.Metadata["lastGcAt"])
		if !ok {
			continue
		}
		if !hasGc || gcAt >= lastGcAt {
			lastGcAt = gcAt
			hasGc = true
			lastGcEvicted = 0
			if evicted, ok := numberAny(event.Metadata["lastGcEvicted"]); ok {
				lastGcEvicted = evicted
			}
		}
	}
	if policy == "" && !hasGc {
		return nil
	}
	retention := map[string]any{}
	if policy != "" {
		retention["policy"] = policy
	}
	if hasGc {
		retention["lastGcAt"] = lastGcAt
		retention["lastGcEvicted"] = lastGcEvicted
	}
	return retention
}

func memoryIndexDefinition(id, typ string, inst *store.MemoryInstanceData, index store.IndexData) *store.ProjectDefinition {
	candidates := []string{"memory:" + safeDefinitionID(id)}
	if typ == "blackboard" {
		candidates = append([]string{"blackboard:" + safeDefinitionID(id)}, candidates...)
	}
	if inst != nil {
		if inst.BlockID != "" {
			candidates = append(candidates, "memory:"+safeDefinitionID(inst.BlockID), "blackboard:"+safeDefinitionID(inst.BlockID))
		}
	}
	for _, candidate := range candidates {
		for i := range index.Definitions {
			if index.Definitions[i].ID == candidate {
				return &index.Definitions[i]
			}
		}
	}
	for i := range index.Definitions {
		def := &index.Definitions[i]
		if def.Kind != "memory" && def.Kind != "blackboard" {
			continue
		}
		if typ == "blackboard" && def.Kind != "blackboard" {
			continue
		}
		if typ != "blackboard" && def.Kind != "memory" {
			continue
		}
		prefix := stringValue(rawMap(def.Metadata), "runtimeIdPrefix", "")
		if prefix != "" && strings.HasPrefix(id, prefix) {
			return def
		}
	}
	return nil
}

func memorySchemaFromDefinition(def store.ProjectDefinition) any {
	meta := rawMap(def.Metadata)
	if schema, ok := schemaFromMetadata(meta); ok {
		return schema
	}
	if schema := memorySchemaFromBlocks(meta); schema != nil {
		return schema
	}
	return nil
}

func memorySchemaFromBlocks(meta map[string]any) any {
	blocks, ok := meta["blocks"].([]any)
	if !ok || len(blocks) != 1 {
		return nil
	}
	block := anyMap(blocks[0])
	if schema, ok := schemaFromMetadata(block); ok {
		return schema
	}
	return nil
}

func schemaFromMetadata(meta map[string]any) (any, bool) {
	for _, key := range []string{"schema", "inputSchema", "outputSchema"} {
		if schema, ok := meta[key]; ok && schema != nil {
			return schema, true
		}
	}
	return nil, false
}

func latestMemoryMetadata(events []store.MemoryEventData) map[string]any {
	var latest store.MemoryEventData
	for _, event := range events {
		if len(event.Metadata) == 0 {
			continue
		}
		if latest.Timestamp == 0 || event.Timestamp >= latest.Timestamp {
			latest = event
		}
	}
	if latest.Metadata == nil {
		return map[string]any{}
	}
	return latest.Metadata
}

func sourceFromMetadata(meta map[string]any) *store.SourceLoc {
	file := stringValue(meta, "sourceFile", stringValue(meta, "file", ""))
	if file == "" {
		return nil
	}
	line := intValue(meta, "sourceLine", intValue(meta, "line", 1))
	column := intValue(meta, "sourceColumn", intValue(meta, "column", 0))
	source := &store.SourceLoc{File: file, Line: line}
	if column > 0 {
		source.Column = &column
	}
	return source
}

func episodicIndexFromMetadata(meta map[string]any) map[string]any {
	index := map[string]any{}
	copyStringField(index, meta, "embeddingModel")
	copyNumberField(index, meta, "dimensions")
	if distance := stringValue(meta, "distance", stringValue(meta, "similarity", "")); distance != "" {
		index["distance"] = distance
	}
	copyNumberField(index, meta, "indexedCount")
	copyNumberField(index, meta, "targetCount")
	if status := stringValue(meta, "indexStatus", ""); status != "" {
		index["status"] = status
	}
	if len(index) == 0 {
		return nil
	}
	return index
}

func memoryIndexFromDefinition(def store.ProjectDefinition, state map[string]any) map[string]any {
	meta := rawMap(def.Metadata)
	// Only an episodes block with a real embedder backs a vector index. Inferring
	// an index from kind alone — or from a sibling block of another kind (facts,
	// ...) — fabricates "index health" for recency/list-backed stores that have no
	// embeddings.
	if !episodicHasEmbed(&def) {
		return nil
	}
	index := map[string]any{}
	entries := memoryStateEntryCount(state)
	index["indexedCount"] = entries
	index["targetCount"] = entries
	index["status"] = "observed"
	if similarity := stringValue(meta, "similarity", ""); similarity != "" {
		index["distance"] = similarity
	} else if distance := stringValue(meta, "distance", ""); distance != "" {
		index["distance"] = distance
	}
	copyStringField(index, meta, "embeddingModel")
	copyNumberField(index, meta, "dimensions")
	return index
}

func memoryStateEntryCount(state map[string]any) int {
	for _, key := range []string{"entries", "chunks"} {
		if values, ok := state[key].([]map[string]any); ok {
			return len(values)
		}
		if values, ok := state[key].([]any); ok {
			return len(values)
		}
	}
	return 0
}

func memoryTrendFromEvents(events []store.MemoryEventData) *memoryTrend {
	if len(events) == 0 {
		return nil
	}
	times := memoryEventTimes(events)
	lifetime := eventLifetime(times, 0)
	if lifetime.LastTouchedAt == 0 {
		return nil
	}
	const buckets = 8
	windowStart := lifetime.LastTouchedAt - 24*60*60*1000
	if lifetime.StartedAt > 0 && lifetime.StartedAt > windowStart {
		windowStart = lifetime.StartedAt
	}
	width := maxInt64(1, (lifetime.LastTouchedAt-windowStart)/buckets)
	trend := memoryTrend{Reads: make([]int, buckets), Writes: make([]int, buckets)}
	for _, event := range events {
		if event.Timestamp < windowStart {
			continue
		}
		idx := int((event.Timestamp - windowStart) / width)
		if idx >= buckets {
			idx = buckets - 1
		}
		if event.Kind == "read" {
			trend.Reads[idx]++
		} else {
			trend.Writes[idx]++
		}
	}
	return &trend
}

func memoryOperationName(event store.MemoryEventData) string {
	if event.Operation != "" {
		return event.Operation
	}
	if event.Kind == "read" {
		if event.Query != "" {
			return "query"
		}
		return "read"
	}
	return "write"
}

func memoryOperationValue(event store.MemoryEventData) string {
	if event.Content != "" {
		return event.Content
	}
	if len(event.Snapshot) > 0 && string(event.Snapshot) != "null" {
		value := rawJSONValue(event.Snapshot)
		if s, ok := value.(string); ok {
			return s
		}
		raw, err := json.Marshal(value)
		if err == nil {
			return string(raw)
		}
	}
	return ""
}

func copyStringField(out, in map[string]any, key string) {
	if value := stringValue(in, key, ""); value != "" {
		out[key] = value
	}
}

func copyNumberField(out, in map[string]any, key string) {
	if value, ok := numberAny(in[key]); ok {
		out[key] = value
	}
}

func safeDefinitionID(value string) string {
	value = strings.TrimSpace(value)
	var b strings.Builder
	lastDash := false
	for _, r := range value {
		allowed := (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '_' || r == '.' || r == ':' || r == '-'
		if allowed {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	return strings.Trim(b.String(), "-")
}

func workspaceSummaryFromEvents(id string, events []store.WorkspaceEventData) workspaceSummary {
	runs := map[string]bool{}
	mounts := map[string]map[string]bool{}
	var durations []float64
	errors := 0
	last := int64(0)
	namespace := ""
	for _, event := range events {
		if event.TraceID != "" {
			runs[event.TraceID] = true
		}
		if namespace == "" {
			namespace = event.Namespace
		}
		if event.Status == "error" || event.Status == "err" {
			errors++
		}
		durations = append(durations, event.DurationMs)
		last = maxInt64(last, event.Timestamp)
		mount := nonEmpty(event.Mount, firstPathSegment(event.Path))
		if mounts[mount] == nil {
			mounts[mount] = map[string]bool{}
		}
		if event.Path != "" && event.Path != "/" {
			mounts[mount][event.Path] = true
		}
	}
	return workspaceSummary{
		ID:            id,
		Namespace:     namespace,
		Mounts:        workspaceMounts(mounts),
		Stats:         workspaceStats{Runs: len(runs), Operations: len(events), Errors: errors, P50LatencyMs: percentile(durations, 50), P99LatencyMs: percentile(durations, 99)},
		LastTouchedAt: last,
	}
}

func workspaceFilesFromEvents(events []store.WorkspaceEventData) []workspaceFileSummary {
	files := map[string]*workspaceFileSummary{}
	counts := map[string]int{}
	for _, event := range events {
		if event.Path == "" || event.Path == "/" || event.Operation == "list" {
			continue
		}
		counts[event.Path]++
		current := files[event.Path]
		if current == nil || event.Timestamp >= current.LastOpAt {
			status := workspaceStatus(event.Status)
			lastError := ""
			if event.Error != nil {
				lastError = *event.Error
			}
			files[event.Path] = &workspaceFileSummary{
				Path:             event.Path,
				Mount:            nonEmpty(event.Mount, firstPathSegment(event.Path)),
				Op:               event.Operation,
				Status:           status,
				Size:             event.Size,
				Mime:             event.MimeType,
				LastOpAt:         event.Timestamp,
				LastOpDurationMs: event.DurationMs,
				LastError:        lastError,
			}
		}
	}
	out := make([]workspaceFileSummary, 0, len(files))
	for path, file := range files {
		file.OperationCount = counts[path]
		out = append(out, *file)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func workspaceOpsFromEvents(events []store.WorkspaceEventData) []workspaceOpDetail {
	out := make([]workspaceOpDetail, 0, len(events))
	for _, event := range events {
		out = append(out, workspaceOpDetail{
			EventID:    eventID("workspace", event.TraceID, event.Timestamp, event.Path),
			Op:         event.Operation,
			Path:       event.Path,
			DurationMs: event.DurationMs,
			Status:     workspaceStatus(event.Status),
			Bytes:      event.Size,
			TraceID:    event.TraceID,
			Error:      derefString(event.Error),
			Timestamp:  event.Timestamp,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp > out[j].Timestamp })
	return out
}

func workspaceFileOpsFromEvents(events []store.WorkspaceEventData) []workspaceFileOp {
	out := make([]workspaceFileOp, 0, len(events))
	for _, event := range events {
		out = append(out, workspaceFileOp{
			EventID:    eventID("workspace-file", event.TraceID, event.Timestamp, event.Path),
			Op:         event.Operation,
			TraceID:    event.TraceID,
			DurationMs: event.DurationMs,
			Timestamp:  event.Timestamp,
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Timestamp > out[j].Timestamp })
	return out
}

func (s *Service) planDetails(ctx context.Context) []planDetail {
	planEvents := s.store.GetPlanEvents()
	taskListEvents := s.store.GetTaskListEvents()
	taskEvents := s.store.GetTaskEvents()
	plans := map[string]*planDetail{}
	taskListToPlan := map[string]string{}
	taskByPlan := map[string]map[string]*planTask{}

	for _, event := range taskListEvents {
		planID := stringValue(event.Data, "planId", "")
		if planID == "" {
			planID = "unassigned"
		}
		taskListToPlan[event.TaskListID] = planID
	}

	if s.observability != nil {
		if activity, err := s.observability.ResourceActivity(ctx, "plan"); err == nil {
			applyObservedPlanActivity(plans, activity)
		}
		if activity, err := s.observability.ResourceActivity(ctx, "task"); err == nil {
			applyObservedTaskActivity(plans, taskListToPlan, taskByPlan, activity)
		}
	}

	for _, event := range planEvents {
		planID := event.PlanID
		if planID == "" {
			continue
		}
		detail := ensurePlan(plans, planID)
		detail.LastUpdatedAt = maxInt64(detail.LastUpdatedAt, event.Timestamp)
		if detail.StartedAt == 0 || event.Timestamp < detail.StartedAt {
			detail.StartedAt = event.Timestamp
		}
		if event.Kind == "created" {
			detail.Title = stringValue(event.Data, "title", nonEmpty(detail.Title, planID))
			detail.Status = normalizePlanStatus(stringValue(event.Data, "status", nonEmpty(detail.Status, "active")))
			detail.ContentPreview = stringValue(event.Data, "contentPreview", stringValue(event.Data, "content", detail.ContentPreview))
			detail.Content = stringValue(event.Data, "content", detail.Content)
			detail.Version = maxInt(detail.Version, 1)
			detail.VersionCount = maxInt(detail.VersionCount, 1)
			author := stringValue(event.Data, "author", stringValue(event.Data, "agent", ""))
			if detail.Author == "" {
				detail.Author = author
			}
			detail.Versions = append(detail.Versions, planVersion{Version: 1, Timestamp: event.Timestamp, Author: author, Summary: "created plan"})
			detail.Events = append(detail.Events, planEvent{EventID: eventID("plan", event.TraceID, event.Timestamp, planID), Kind: "plan.created", Agent: author, Label: "created plan", Timestamp: event.Timestamp, Payload: event.Data})
		} else {
			version := intValue(event.Data, "version", detail.Version+1)
			detail.Version = maxInt(detail.Version, version)
			detail.VersionCount = maxInt(detail.VersionCount, version)
			detail.Status = normalizePlanStatus(stringValue(event.Data, "status", detail.Status))
			summary := strings.Join(stringSlice(event.Data["changes"]), ", ")
			if summary == "" {
				summary = "updated plan"
			}
			author := stringValue(event.Data, "author", stringValue(event.Data, "agent", ""))
			if detail.Author == "" {
				detail.Author = author
			}
			detail.Versions = append(detail.Versions, planVersion{Version: version, Timestamp: event.Timestamp, Author: author, Summary: summary})
			detail.Events = append(detail.Events, planEvent{EventID: eventID("plan", event.TraceID, event.Timestamp, planID), Kind: "plan.updated", Agent: author, Label: summary, Timestamp: event.Timestamp, Payload: event.Data})
		}
	}

	for _, event := range taskListEvents {
		planID := nonEmpty(taskListToPlan[event.TaskListID], "unassigned")
		taskListToPlan[event.TaskListID] = planID
		detail := ensurePlan(plans, planID)
		detail.LastUpdatedAt = maxInt64(detail.LastUpdatedAt, event.Timestamp)
		if detail.StartedAt == 0 || event.Timestamp < detail.StartedAt {
			detail.StartedAt = event.Timestamp
		}
		kind := "tasklist." + event.Kind
		agent := stringValue(event.Data, "agent", stringValue(event.Data, "author", ""))
		detail.Events = append(detail.Events, planEvent{EventID: eventID("tasklist", event.TraceID, event.Timestamp, event.TaskListID), Kind: kind, Agent: agent, Label: kind, Timestamp: event.Timestamp, Payload: event.Data})
		if event.Kind == "completed" {
			detail.Status = "completed"
		}
	}

	for _, event := range taskEvents {
		planID := nonEmpty(taskListToPlan[event.TaskListID], "unassigned")
		detail := ensurePlan(plans, planID)
		detail.LastUpdatedAt = maxInt64(detail.LastUpdatedAt, event.Timestamp)
		if detail.StartedAt == 0 || event.Timestamp < detail.StartedAt {
			detail.StartedAt = event.Timestamp
		}
		if taskByPlan[planID] == nil {
			taskByPlan[planID] = map[string]*planTask{}
		}
		task := taskByPlan[planID][event.TaskID]
		if task == nil {
			task = &planTask{ID: event.TaskID, Status: "pending", AddedInVersion: maxInt(detail.Version, 1)}
			taskByPlan[planID][event.TaskID] = task
		}
		switch event.Kind {
		case "added":
			task.Label = stringValue(event.Data, "label", event.TaskID)
			task.Assignee = assigneeLabel(event.Data["assignee"])
			task.TraceID = event.TraceID
		case "updated":
			task.Status = normalizeTaskStatus(stringValue(event.Data, "status", task.Status))
			task.ProgressMessage = stringValue(event.Data, "progress", task.ProgressMessage)
			task.Progress = progressValue(event.Data["progress"], task.Status)
			task.DurationMs = floatPointer(event.Data["durationMs"])
			task.TraceID = event.TraceID
		case "removed":
			task.Status = "removed"
			removedVersion := maxInt(detail.Version, 1)
			task.RemovedInVersion = &removedVersion
		}
		kind := "task." + event.Kind
		agent := stringValue(event.Data, "agent", stringValue(event.Data, "author", ""))
		detail.Events = append(detail.Events, planEvent{EventID: eventID("task", event.TraceID, event.Timestamp, event.TaskID), Kind: kind, Agent: agent, Label: nonEmpty(task.Label, event.TaskID), Timestamp: event.Timestamp, Payload: event.Data})
	}

	out := make([]planDetail, 0, len(plans))
	for planID, detail := range plans {
		if detail.Title == "" {
			detail.Title = planID
		}
		if detail.Status == "" {
			detail.Status = "active"
		}
		if detail.Version == 0 {
			detail.Version = 1
		}
		if detail.VersionCount == 0 {
			detail.VersionCount = detail.Version
		}
		for _, task := range taskByPlan[planID] {
			detail.Tasks = append(detail.Tasks, *task)
			switch task.Status {
			case "completed":
				detail.TaskCounts.Done++
			case "in_progress":
				detail.TaskCounts.InProgress++
			case "removed":
				detail.TaskCounts.Removed++
			default:
				detail.TaskCounts.Pending++
			}
		}
		sort.Slice(detail.Tasks, func(i, j int) bool { return detail.Tasks[i].ID < detail.Tasks[j].ID })
		sort.Slice(detail.Events, func(i, j int) bool { return detail.Events[i].Timestamp > detail.Events[j].Timestamp })
		sort.Slice(detail.Versions, func(i, j int) bool { return detail.Versions[i].Version > detail.Versions[j].Version })
		out = append(out, *detail)
	}
	return out
}

func applyObservedPlanActivity(plans map[string]*planDetail, activity []observability.ResourceActivity) {
	// Resource activity is newest-first; replay oldest-first so the final
	// snapshot wins when a plan has multiple create/update operations.
	sort.Slice(activity, func(i, j int) bool {
		return activity[i].StartedAt < activity[j].StartedAt
	})
	for _, item := range activity {
		attrs := rawMap(item.Attributes)
		preview := rawMap(firstArtifactPreview(item.Artifacts))
		planID := nonEmpty(stringValue(preview, "planId", ""), stringValue(attrs, "planId", item.ResourceID))
		if planID == "" {
			continue
		}
		detail := ensurePlan(plans, planID)
		timestamp := parseUnixMillis(nonEmpty(item.EndedAt, item.StartedAt))
		if timestamp == 0 {
			timestamp = parseUnixMillis(item.StartedAt)
		}
		if timestamp > 0 {
			detail.LastUpdatedAt = maxInt64(detail.LastUpdatedAt, timestamp)
			if detail.StartedAt == 0 || timestamp < detail.StartedAt {
				detail.StartedAt = timestamp
			}
		}
		operation := nonEmpty(stringValue(preview, "operation", ""), stringValue(attrs, "operation", operationFromActivity(item)))
		title := nonEmpty(stringValue(preview, "title", ""), stringValue(attrs, "title", ""))
		if title != "" {
			detail.Title = title
		}
		version := intValue(preview, "version", intValue(attrs, "version", detail.Version))
		if version <= 0 {
			version = 1
		}
		detail.Version = maxInt(detail.Version, version)
		detail.VersionCount = maxInt(detail.VersionCount, version)
		metadata := anyMap(preview["metadata"])
		detail.Status = normalizePlanStatus(nonEmpty(stringValue(preview, "status", ""), stringValue(metadata, "status", detail.Status)))
		detail.Author = nonEmpty(detail.Author, stringValue(preview, "author", stringValue(attrs, "author", stringValue(metadata, "author", ""))))
		content := stringValue(preview, "content", "")
		if content != "" {
			detail.Content = content
			detail.ContentPreview = truncateString(content, 280)
		} else if contentPreview := stringValue(preview, "contentPreview", ""); contentPreview != "" {
			detail.ContentPreview = contentPreview
			if detail.Content == "" {
				detail.Content = contentPreview
			}
		}
		kind := "plan.updated"
		summary := "updated plan"
		if operation == "create" {
			kind = "plan.created"
			summary = "created plan"
		} else if changes := strings.Join(stringSlice(preview["changes"]), ", "); changes != "" {
			summary = changes
		} else if changes := strings.Join(stringSlice(attrs["changes"]), ", "); changes != "" {
			summary = changes
		}
		payload := map[string]any{}
		for key, value := range preview {
			payload[key] = value
		}
		if len(payload) == 0 {
			payload = attrs
		}
		detail.Versions = append(detail.Versions, planVersion{
			Version:         version,
			Timestamp:       timestamp,
			Author:          detail.Author,
			Summary:         summary,
			ContentSnapshot: content,
		})
		detail.Events = append(detail.Events, planEvent{
			EventID:   eventID("plan", item.TraceID, timestamp, nonEmpty(item.SpanID, planID)),
			Kind:      kind,
			Agent:     detail.Author,
			Label:     summary,
			Timestamp: timestamp,
			Payload:   payload,
		})
	}
}

func ensurePlan(plans map[string]*planDetail, id string) *planDetail {
	if plans[id] == nil {
		plans[id] = &planDetail{planSummary: planSummary{ID: id, Title: id, Status: "active", Version: 1, VersionCount: 1}}
	}
	return plans[id]
}

func filterMemoryEvents(events []store.MemoryEventData, id string) []store.MemoryEventData {
	out := []store.MemoryEventData{}
	for _, event := range events {
		if event.MemoryID == id {
			out = append(out, event)
		}
	}
	return out
}

func filterWorkspaceEvents(events []store.WorkspaceEventData, id string) []store.WorkspaceEventData {
	out := []store.WorkspaceEventData{}
	for _, event := range events {
		if nonEmpty(event.WorkspaceID, "workspace") == id {
			out = append(out, event)
		}
	}
	return out
}

func filterWorkspaceFileEvents(events []store.WorkspaceEventData, workspaceID, filePath string) []store.WorkspaceEventData {
	out := []store.WorkspaceEventData{}
	for _, event := range events {
		if nonEmpty(event.WorkspaceID, "workspace") == workspaceID && event.Path == filePath {
			out = append(out, event)
		}
	}
	return out
}

func memoryEntries(inst *store.MemoryInstanceData, fallbackPrefix string) []map[string]any {
	if inst == nil {
		return []map[string]any{}
	}
	out := make([]map[string]any, 0, len(inst.Entries))
	for _, entry := range inst.Entries {
		id := nonEmpty(entry.Key, fallbackPrefix)
		tags := []string{}
		writtenBy := ""
		if entry.Metadata != nil {
			tags = stringSlice(entry.Metadata["tags"])
			writtenBy = stringValue(entry.Metadata, "writtenBy", "")
		}
		item := map[string]any{
			"id":        id,
			"content":   entry.Content,
			"tags":      tags,
			"timestamp": derefInt64(entry.UpdatedAt, derefInt64(entry.CreatedAt, inst.LastActivity)),
		}
		if entry.Confidence != nil {
			item["confidence"] = *entry.Confidence
		}
		if writtenBy != "" {
			item["writtenBy"] = writtenBy
		}
		out = append(out, item)
	}
	return out
}

// memoryEntriesFromSnapshots reconstructs stored entries by replaying write-event
// snapshots, for stores whose live instance index is empty. The in-memory
// instance map is only populated by the in-process event path; observability-
// driven ingestion (the live devtools path) leaves it empty, so episodic and
// semantic stores rebuild their entries here — mirroring how blackboard/working
// memory recover their fields via memoryFieldsFromSnapshots. The output shape
// matches memoryEntries so callers and the UI stay source-agnostic.
func memoryEntriesFromSnapshots(events []store.MemoryEventData, fallbackPrefix string) []map[string]any {
	entries := map[string]map[string]any{}
	timestamps := map[string]int64{}
	for _, event := range events {
		if event.Kind != "write" {
			continue
		}
		switch event.Operation {
		case "clear", "prune":
			entries = map[string]map[string]any{}
			timestamps = map[string]int64{}
			continue
		case "delete":
			if event.Key != "" {
				delete(entries, event.Key)
				delete(timestamps, event.Key)
			}
			continue
		}
		entry, ok := memoryEntryFromSnapshot(event, fallbackPrefix)
		if !ok {
			continue
		}
		key := entry["id"].(string)
		if prev, seen := timestamps[key]; seen && event.Timestamp < prev {
			continue
		}
		entries[key] = entry
		timestamps[key] = event.Timestamp
	}
	out := make([]map[string]any, 0, len(entries))
	for _, entry := range entries {
		out = append(out, entry)
	}
	sort.Slice(out, func(i, j int) bool {
		return int64Value(out[i]["timestamp"], 0) > int64Value(out[j]["timestamp"], 0)
	})
	return out
}

// memoryEntryFromSnapshot decodes a single write event's snapshot into the same
// entry shape memoryEntries produces (id, content, tags, timestamp, confidence).
func memoryEntryFromSnapshot(event store.MemoryEventData, fallbackPrefix string) (map[string]any, bool) {
	object := anyMap(rawJSONValue(event.Snapshot))
	key := stringValue(object, "key", event.Key)
	if key == "" {
		key = nonEmpty(event.Key, fallbackPrefix)
	}
	content := stringValue(object, "content", event.Content)
	if content == "" && len(object) == 0 {
		return nil, false
	}
	tags := []string{}
	writtenBy := ""
	if meta := anyMap(object["metadata"]); len(meta) > 0 {
		tags = stringSlice(meta["tags"])
		writtenBy = stringValue(meta, "writtenBy", "")
	}
	item := map[string]any{
		"id":        key,
		"content":   content,
		"tags":      tags,
		"timestamp": int64Value(object["updatedAt"], int64Value(object["createdAt"], event.Timestamp)),
	}
	if conf, ok := numberAny(object["confidence"]); ok {
		item["confidence"] = conf
	}
	if writtenBy != "" {
		item["writtenBy"] = writtenBy
	}
	if event.TraceID != "" {
		item["sourceTraceId"] = event.TraceID
	}
	if event.RunID != "" {
		item["sourceRun"] = event.RunID
	}
	return item, true
}

func memoryQueries(events []store.MemoryEventData) []map[string]any {
	out := []map[string]any{}
	for _, event := range events {
		if event.Kind != "read" {
			continue
		}
		if event.Query == "" && event.Operation == "" {
			continue
		}
		query := nonEmpty(event.Query, event.Operation)
		queryEvent := map[string]any{
			"eventId":   eventID("memory-query", event.TraceID, event.Timestamp, event.Operation),
			"query":     query,
			"timestamp": event.Timestamp,
		}
		if event.Count != nil {
			queryEvent["k"] = *event.Count
		}
		if event.Score != nil {
			queryEvent["topScore"] = *event.Score
		}
		if event.DurationMs != nil {
			queryEvent["latencyMs"] = *event.DurationMs
		}
		if event.TraceID != "" {
			queryEvent["traceId"] = event.TraceID
		}
		if event.SpanID != "" {
			queryEvent["spanId"] = event.SpanID
		}
		out = append(out, queryEvent)
	}
	return out
}

func memoryWrites(events []store.MemoryEventData) []map[string]any {
	out := []map[string]any{}
	for _, event := range events {
		if event.Kind != "write" {
			continue
		}
		write := map[string]any{
			"eventId":        eventID("memory-write", event.TraceID, event.Timestamp, event.Key),
			"op":             nonEmpty(event.Operation, "append"),
			"entryId":        nonEmpty(event.Key, eventID("entry", event.TraceID, event.Timestamp, "")),
			"contentPreview": event.Content,
			"timestamp":      event.Timestamp,
		}
		if event.Confidence != nil {
			write["confidence"] = *event.Confidence
		}
		if snap := anyMap(rawJSONValue(event.Snapshot)); len(snap) > 0 {
			if meta := anyMap(snap["metadata"]); len(meta) > 0 {
				if writtenBy := stringValue(meta, "writtenBy", ""); writtenBy != "" {
					write["writtenBy"] = writtenBy
				}
			}
		}
		if event.TraceID != "" {
			write["traceId"] = event.TraceID
		}
		if event.SpanID != "" {
			write["spanId"] = event.SpanID
		}
		out = append(out, write)
	}
	return out
}

func memoryEventTimes(events []store.MemoryEventData) []int64 {
	out := make([]int64, 0, len(events))
	for _, event := range events {
		out = append(out, event.Timestamp)
	}
	return out
}

func eventLifetime(times []int64, fallbackLast int64) lifetimeWindow {
	var start, last int64
	for _, t := range times {
		if t == 0 {
			continue
		}
		if start == 0 || t < start {
			start = t
		}
		if t > last {
			last = t
		}
	}
	if last == 0 {
		last = fallbackLast
	}
	if start == 0 {
		start = last
	}
	return lifetimeWindow{StartedAt: start, LastTouchedAt: last, DurationMs: maxInt64(0, last-start)}
}

func workspaceMounts(mountFiles map[string]map[string]bool) []workspaceMount {
	out := make([]workspaceMount, 0, len(mountFiles))
	for mount, files := range mountFiles {
		out = append(out, workspaceMount{Path: nonEmpty(mount, "/"), Mode: "read-write", FileCount: len(files)})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out
}

func percentile(values []float64, p float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	idx := int(math.Ceil((p/100)*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

func normalizePlanStatus(status string) string {
	switch strings.ToLower(status) {
	case "completed", "complete", "done":
		return "completed"
	case "discarded", "cancelled", "canceled":
		return "discarded"
	case "suspended", "waiting":
		return "suspended"
	case "in_progress", "running":
		return "in_progress"
	default:
		return nonEmpty(status, "active")
	}
}

func normalizeTaskStatus(status string) string {
	switch strings.ToLower(status) {
	case "completed", "complete", "done", "ok":
		return "completed"
	case "running", "active", "in-progress":
		return "in_progress"
	case "failed", "skipped", "cancelled", "removed":
		return strings.ToLower(status)
	case "canceled":
		return "cancelled"
	default:
		return "pending"
	}
}

func progressValue(value any, status string) float64 {
	if f, ok := numberAny(value); ok {
		if f > 1 {
			return f / 100
		}
		return f
	}
	if status == "completed" {
		return 1
	}
	if status == "in_progress" {
		return 0.5
	}
	return 0
}

func assigneeLabel(value any) string {
	if m, ok := value.(map[string]any); ok {
		return nonEmpty(stringValue(m, "agent", ""), stringValue(m, "model", "agent"))
	}
	return "agent"
}

func objectFields(value any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	if m, ok := value.(map[string]any); ok {
		return m
	}
	return map[string]any{"value": value}
}

func rawJSONValue(raw json.RawMessage) any {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return string(raw)
	}
	return value
}

func firstArtifactPreview(artifacts []observability.ResourceArtifact) json.RawMessage {
	for _, artifact := range artifacts {
		if len(artifact.Preview) > 0 && string(artifact.Preview) != "null" {
			return artifact.Preview
		}
	}
	return nil
}

func operationFromActivity(item observability.ResourceActivity) string {
	parts := strings.SplitN(item.Name, ".", 2)
	if len(parts) == 2 && parts[1] != "" {
		return parts[1]
	}
	parts = strings.SplitN(item.Primitive, ".", 2)
	if len(parts) == 2 {
		return parts[1]
	}
	return item.Name
}

func stringValue(m map[string]any, key, fallback string) string {
	if value, ok := m[key].(string); ok && value != "" {
		return value
	}
	return fallback
}

func boolValue(m map[string]any, key string, fallback bool) bool {
	if value, ok := m[key].(bool); ok {
		return value
	}
	return fallback
}

func anyMap(value any) map[string]any {
	if out, ok := value.(map[string]any); ok {
		return out
	}
	return map[string]any{}
}

func intValue(m map[string]any, key string, fallback int) int {
	if value, ok := numberAny(m[key]); ok {
		return int(value)
	}
	return fallback
}

func int64Value(value any, fallback int64) int64 {
	if number, ok := numberAny(value); ok {
		return int64(number)
	}
	return fallback
}

func truncateString(value string, max int) string {
	if max <= 0 || len(value) <= max {
		return value
	}
	return value[:max]
}

func optionalIntValue(m map[string]any, key string) (int, bool) {
	value, ok := numberAny(m[key])
	if !ok {
		return 0, false
	}
	return int(value), true
}

func numberAny(value any) (float64, bool) {
	switch v := value.(type) {
	case float64:
		return v, true
	case float32:
		return float64(v), true
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case json.Number:
		f, err := v.Float64()
		return f, err == nil
	default:
		return 0, false
	}
}

func floatPointer(value any) *float64 {
	if f, ok := numberAny(value); ok {
		return &f
	}
	return nil
}

func stringSlice(value any) []string {
	raw, ok := value.([]any)
	if !ok {
		if stringsValue, ok := value.([]string); ok {
			return stringsValue
		}
		return []string{}
	}
	out := []string{}
	for _, item := range raw {
		if s, ok := item.(string); ok && s != "" {
			out = append(out, s)
		}
	}
	return out
}

func nonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func maxInt64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func typeName(value any) string {
	switch value.(type) {
	case nil:
		return "null"
	case string:
		return "string"
	case bool:
		return "boolean"
	case float64, float32, int, int64:
		return "number"
	case []any:
		return "array"
	case map[string]any:
		return "object"
	default:
		return fmt.Sprintf("%T", value)
	}
}

func memoryMutationOp(operation string) string {
	switch operation {
	case "append", "delete", "update":
		return operation
	default:
		return "write"
	}
}

func normalizedMemoryType(memoryType, blockKind string) string {
	if memoryType == "blackboard" {
		return "blackboard"
	}
	if memoryType == "block" {
		switch blockKind {
		case "working":
			return "working"
		case "episodes":
			return "episodic"
		case "facts", "procedures", "semantic":
			return "semantic"
		}
	}
	if memoryType == "" {
		return "working"
	}
	return memoryType
}

func memoryLabel(inst store.MemoryInstanceData) string {
	typ := normalizedMemoryType(inst.MemoryType, inst.BlockKind)
	if inst.BlockKind != "" {
		return typ + " · " + inst.BlockKind
	}
	return typ
}

func memoryScope(inst store.MemoryInstanceData) map[string]any {
	if inst.NamespaceHash != "" {
		return map[string]any{"kind": "session", "id": inst.NamespaceHash}
	}
	return map[string]any{"kind": "project", "id": "default"}
}

func countMemoryConflicts(events []store.MemoryEventData) int {
	count := 0
	for _, event := range events {
		if strings.Contains(strings.ToLower(event.Operation), "conflict") {
			count++
		}
	}
	return count
}

func memoryHealth(events []store.MemoryEventData) string {
	for _, event := range events {
		if strings.Contains(strings.ToLower(event.Operation), "error") {
			return "errored"
		}
	}
	if len(events) == 0 {
		return "stale"
	}
	return "healthy"
}

func lastRunTraceFromMemory(events []store.MemoryEventData) (string, string) {
	var last store.MemoryEventData
	for _, event := range events {
		if event.Timestamp >= last.Timestamp {
			last = event
		}
	}
	return "", last.TraceID
}

func eventID(prefix, traceID string, timestamp int64, id string) string {
	parts := []string{prefix}
	if traceID != "" {
		parts = append(parts, traceID)
	}
	if id != "" {
		parts = append(parts, id)
	}
	return strings.Join(parts, ":") + fmt.Sprintf(":%d", timestamp)
}

func workspaceStatus(status string) string {
	switch strings.ToLower(status) {
	case "error", "err":
		return "err"
	case "denied":
		return "denied"
	default:
		return "ok"
	}
}

func firstPathSegment(path string) string {
	trimmed := strings.Trim(path, "/")
	if trimmed == "" {
		return "/"
	}
	segment := strings.Split(trimmed, "/")[0]
	return "/" + segment
}

func errorMessage(raw json.RawMessage) string {
	value := rawMap(raw)
	return stringValue(value, "message", "")
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func derefFloat(value *float64, fallback float64) float64 {
	if value == nil {
		return fallback
	}
	return *value
}

func derefInt(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func derefInt64(value *int64, fallback int64) int64 {
	if value == nil {
		return fallback
	}
	return *value
}

func sortedKeys(values map[string]bool) []string {
	out := make([]string, 0, len(values))
	for key := range values {
		out = append(out, key)
	}
	sort.Strings(out)
	return out
}

func decodePathSegment(value string) string {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return value
	}
	return decoded
}
