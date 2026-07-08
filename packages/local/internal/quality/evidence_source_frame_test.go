package quality

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/store"
)

func TestResolveDiskSourceFrameRejectsAbsolutePathOutsideRoot(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.ts")
	if err := os.WriteFile(outside, []byte("export const secret = true\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	frame := resolveDiskSourceFrame(outside+":1:1", root)
	if frame.Kind != "unavailable" || frame.Reason != "source-outside-root" {
		t.Fatalf("frame = %+v, want source-outside-root unavailable", frame)
	}
}

func TestCellEvidenceAPIReanchorsDiskSourceFrameToAssertionSubject(t *testing.T) {
	dir := t.TempDir()
	writeSpecFixture(t, dir, "experiments", "01KTREANCHOR000000000000.json", `{
  "schemaVersion": 1,
  "experimentId": "01KTREANCHOR000000000000",
  "evaluationId": "flow.agent-delegation",
  "qualityId": "@packages/backend",
  "startedAt": "2026-06-16T00:00:00.000Z",
  "endedAt": "2026-06-16T00:00:01.000Z",
  "configFingerprint": "cf",
  "taskFingerprint": "tf",
  "filteredRun": false,
  "replay": { "mode": "live" },
  "variants": [{ "name": "default", "overrideKeys": [] }],
  "aggregates": { "perVariant": { "default": {
    "cells": 1, "passed": 0, "failed": 1, "errored": 0, "skipped": 0, "passRate": 0,
    "scores": {},
    "latency": { "meanMs": 1000, "p95Ms": 1000 }
  } } },
  "gates": { "passed": false, "informational": false, "results": [] },
  "passed": false,
  "cells": [{
    "caseId": "delegates-writer-for-content-creation",
    "variantName": "default",
    "trial": 0,
    "status": "failed",
    "input": { "mode": "assist" },
    "output": { "toolCalls": [] },
    "scores": [{ "name": "pass", "score": 0 }],
    "assertions": {
      "ran": 1,
      "notEvaluated": 0,
      "outcomes": [],
      "outcomes": [{
        "id": "expect:case:0",
        "level": "case",
        "phase": "expect",
        "index": 0,
        "status": "failed",
        "matcher": "toBe",
        "subjectExpr": "Boolean(writerCall)",
        "soft": false,
        "message": "expected false to be true",
        "actual": { "label": "actual", "value": false, "preview": "false", "redacted": false },
        "expected": { "label": "expected", "value": true, "preview": "true", "redacted": false },
        "expression": {
          "left": { "label": "actual", "value": false, "preview": "false", "redacted": false },
          "operator": "==",
          "right": { "label": "expected", "value": true, "preview": "true", "redacted": false },
          "result": false,
          "rendered": "false == true => false"
        },
        "sourceRef": "/workspace/evals/flows/agentRouting.eval.ts:128:39",
        "sourceFrame": {
          "kind": "source-frame",
          "sourceRef": "/workspace/evals/flows/agentRouting.eval.ts:128:39",
          "authoredFile": "/workspace/evals/flows/agentRouting.eval.ts",
          "authoredLine": 128,
          "authoredColumn": 39,
          "frameStartLine": 124,
          "frameEndLine": 132,
          "lines": [
            { "line": 124, "text": "      const writerCall = ctx.output.toolCalls.find((toolCall) => toolCall.name === 'writer')", "role": "context" },
            { "line": 125, "text": "      ctx.expect(Boolean(writerCall)).toBe(true)", "role": "context" },
            { "line": 126, "text": "      ctx.expect(writerCall?.args.intent).toBe('create')", "role": "context" },
            { "line": 127, "text": "      ctx.expect(typeof writerCall?.args.instruction).toBe('string')", "role": "context" },
            { "line": 128, "text": "    },", "role": "failed" },
            { "line": 129, "text": "  },", "role": "context" }
          ],
          "contentHash": "sha256:reanchor",
          "capturedAt": "2026-06-16T00:00:00.000Z",
          "resolver": "disk"
        }
      }]
    },
    "durationMs": 1000,
    "traceIds": [],
    "capturedSignals": []
  }]
}`)

	svc := NewService(store.NewStore(), dir)
	evidence, found, err := svc.CellEvidenceAPI(context.Background(), api.QualityCellEvidenceQuery{
		ExperimentID: "01KTREANCHOR000000000000",
		CaseID:       "delegates-writer-for-content-creation",
		VariantName:  "default",
		Trial:        0,
	})
	if err != nil || !found {
		t.Fatalf("found=%v err=%v", found, err)
	}

	outcome := evidence.Assertions.Outcomes[0]
	if outcome.SourceRef != "/workspace/evals/flows/agentRouting.eval.ts:125:11" {
		t.Fatalf("outcome source ref = %q", outcome.SourceRef)
	}
	if outcome.SourceFrame == nil || outcome.SourceFrame.AuthoredLine != 125 {
		t.Fatalf("outcome source frame = %+v", outcome.SourceFrame)
	}
	if evidence.Code.PrimaryFrame.AuthoredLine != 125 || evidence.Code.OpenedInEditor == nil || evidence.Code.OpenedInEditor.Line != 125 {
		t.Fatalf("code frame/editor = %+v", evidence.Code)
	}
	if evidence.Checks[0].SourceFrame == nil || evidence.Checks[0].SourceFrame.AuthoredLine != 125 {
		t.Fatalf("check source frame = %+v", evidence.Checks[0].SourceFrame)
	}
	for _, line := range outcome.SourceFrame.Lines {
		switch line.Line {
		case 125:
			if line.Role != "failed" {
				t.Fatalf("line 125 role = %q", line.Role)
			}
		case 128:
			if line.Role == "failed" {
				t.Fatalf("line 128 still marked failed: %+v", line)
			}
		}
	}
}
