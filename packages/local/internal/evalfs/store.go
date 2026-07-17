// Package evalfs reads private Eval V3 artifacts without reinterpreting
// legacy Quality experiment records.
package evalfs

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

var safeID = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// Run contains the validated fields used by Local and the exact stored bytes
// served to future-additive clients.
type Run struct {
	SchemaVersion int             `json:"schemaVersion"`
	RunID         string          `json:"runId"`
	EvalID        string          `json:"evalId"`
	Status        string          `json:"status"`
	Passed        bool            `json:"passed"`
	Raw           json.RawMessage `json:"-"`
}

// Store reads Eval records rooted at a project's `.crux/quality` directory.
type Store struct {
	projectRoot string
	runsDir     string
}

// OpenProject creates a reader for a project root.
func OpenProject(projectRoot string) *Store {
	return &Store{
		projectRoot: projectRoot,
		runsDir:     filepath.Join(projectRoot, ".crux", "quality", "runs"),
	}
}

// ReadRun validates the known V3 envelope while preserving the exact bytes.
func (s *Store) ReadRun(runID string) (Run, bool, error) {
	if !safeID.MatchString(runID) {
		return Run{}, false, fmt.Errorf("invalid Eval run ID %q", runID)
	}
	raw, err := os.ReadFile(filepath.Join(s.runsDir, runID+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return Run{}, false, nil
	}
	if err != nil {
		return Run{}, false, err
	}
	run, err := parseRun(raw)
	if err != nil {
		return Run{}, false, fmt.Errorf("Eval run %s is corrupt: %w", runID, err)
	}
	if run.RunID != runID {
		return Run{}, false, fmt.Errorf("Eval run %s is corrupt: embedded runId is %q", runID, run.RunID)
	}
	return run, true, nil
}

// ListRuns returns valid V3 records newest-first by file name. A corrupt
// terminal record is reported instead of being silently treated as truth.
func (s *Store) ListRuns() ([]json.RawMessage, error) {
	entries, err := os.ReadDir(s.runsDir)
	if errors.Is(err, os.ErrNotExist) {
		return []json.RawMessage{}, nil
	}
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			names = append(names, strings.TrimSuffix(entry.Name(), ".json"))
		}
	}
	sort.Sort(sort.Reverse(sort.StringSlice(names)))
	records := make([]json.RawMessage, 0, len(names))
	for _, name := range names {
		run, found, err := s.ReadRun(name)
		if err != nil {
			return nil, err
		}
		if found {
			records = append(records, bytes.Clone(run.Raw))
		}
	}
	return records, nil
}

func parseRun(raw []byte) (Run, error) {
	var run Run
	if err := json.Unmarshal(raw, &run); err != nil {
		return Run{}, err
	}
	var envelope struct {
		Passed                *bool           `json:"passed"`
		SourceKey             json.RawMessage `json:"sourceKey"`
		StartedAt             json.RawMessage `json:"startedAt"`
		EndedAt               json.RawMessage `json:"endedAt"`
		DefinitionFingerprint json.RawMessage `json:"definitionFingerprint"`
		Selection             json.RawMessage `json:"selection"`
		CostControl           json.RawMessage `json:"costControl"`
		BlockingVariants      json.RawMessage `json:"blockingVariants"`
		Cells                 json.RawMessage `json:"cells"`
		Variants              json.RawMessage `json:"variants"`
		Aggregates            json.RawMessage `json:"aggregates"`
		Gates                 json.RawMessage `json:"gates"`
		Cost                  json.RawMessage `json:"cost"`
		Provenance            json.RawMessage `json:"provenance"`
		Reasons               json.RawMessage `json:"reasons"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return Run{}, err
	}
	if run.SchemaVersion != 3 || run.RunID == "" || run.EvalID == "" {
		return Run{}, fmt.Errorf("expected schemaVersion 3 with runId and evalId")
	}
	for name, value := range map[string]json.RawMessage{
		"sourceKey": envelope.SourceKey, "startedAt": envelope.StartedAt,
		"endedAt": envelope.EndedAt, "definitionFingerprint": envelope.DefinitionFingerprint,
		"selection": envelope.Selection, "costControl": envelope.CostControl,
		"blockingVariants": envelope.BlockingVariants, "cells": envelope.Cells,
		"variants": envelope.Variants, "aggregates": envelope.Aggregates,
		"gates": envelope.Gates, "cost": envelope.Cost, "provenance": envelope.Provenance,
	} {
		if len(value) == 0 || bytes.Equal(bytes.TrimSpace(value), []byte("null")) {
			return Run{}, fmt.Errorf("required field %s is missing", name)
		}
	}
	if envelope.Passed == nil {
		return Run{}, fmt.Errorf("required field passed is missing")
	}
	run.Passed = *envelope.Passed
	if run.Status != "complete" && run.Status != "incomplete" {
		return Run{}, fmt.Errorf("unknown status %q", run.Status)
	}
	if run.Status == "incomplete" && run.Passed {
		return Run{}, fmt.Errorf("incomplete run cannot pass")
	}
	if run.Status == "incomplete" && len(envelope.Reasons) == 0 {
		return Run{}, fmt.Errorf("incomplete run requires reasons")
	}
	run.Raw = bytes.Clone(raw)
	return run, nil
}
