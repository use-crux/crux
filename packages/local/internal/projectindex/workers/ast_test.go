package workers

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	staticclient "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/client"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/syntax"
)

func TestSyntaxCompilerCallsCommandWorker(t *testing.T) {
	worker := staticclient.New(shellPath(t), fakeStaticIndexCompilerWorker(t))
	defer worker.Close()

	identity := protocol.SkeletonIdentity()
	prepare, err := worker.StaticIndexPrepare(context.Background(), protocol.PrepareRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Root:            "/repo",
		ProjectName:     "static-index",
		Identity:        identity,
		Files: []protocol.SourceFile{
			{File: "/repo/src/cached.ts", SourceHash: "sha256:cached", CacheKey: "static:cached"},
			{File: "/repo/src/miss.ts", SourceHash: "sha256:miss"},
		},
	})
	if err != nil {
		t.Fatalf("StaticIndexPrepare error = %v", err)
	}
	if len(prepare.Plan.CacheHits) != 1 || len(prepare.Plan.CacheMisses) != 1 {
		t.Fatalf("prepare plan = %+v, want one hit and one miss", prepare.Plan)
	}

	analyze, err := worker.StaticIndexAnalyzeStream(context.Background(), protocol.AnalyzeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.AnalyzeMethod,
		Identity:        identity,
		Plan:            prepare.Plan,
		Files:           sourceprofile.AnalyzeFiles(prepare.Plan.CacheMisses),
	}, nil)
	if err != nil {
		t.Fatalf("StaticIndexAnalyzeStream error = %v", err)
	}
	if len(analyze.Facts) != 0 || analyze.Telemetry.Files.Analyzed != 1 {
		t.Fatalf("analyze response = %+v, want empty skeleton facts for one analyzed file", analyze)
	}

	finalize, err := worker.StaticIndexFinalize(context.Background(), protocol.FinalizeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Identity:        identity,
		NativeFacts:     analyze.Facts,
		ExtensionFacts:  []json.RawMessage{},
	})
	if err != nil {
		t.Fatalf("StaticIndexFinalize error = %v", err)
	}
	if len(finalize.Events) != 0 {
		t.Fatalf("finalize events = %s, want empty skeleton event stream", finalize.Events)
	}
}

func TestWorkerRunStaticIndexCompilerSkeletonDoesNotUseSyntaxRecords(t *testing.T) {
	compiler := &recordingStaticIndexCompiler{}
	worker := &Bundle{syntaxParser: compiler}
	files := []protocol.SourceFile{
		{File: "/repo/src/cached.ts", SourceHash: "sha256:cached", CacheKey: "static:cached"},
		{File: "/repo/src/miss.ts", SourceHash: "sha256:miss"},
	}

	result, err := worker.runStaticIndexCompilerSkeleton(context.Background(), "/repo", "", "static-index-skeleton", files)
	if err != nil {
		t.Fatalf("runStaticIndexCompilerSkeleton error = %v", err)
	}

	if compiler.parseCalls != 0 || compiler.batchParseCalls != 0 {
		t.Fatalf("syntax-record parsing was called: parse=%d batch=%d", compiler.parseCalls, compiler.batchParseCalls)
	}
	if compiler.prepareCalls != 1 || compiler.analyzeCalls != 1 || compiler.finalizeCalls != 1 {
		t.Fatalf("native calls = prepare %d analyze %d finalize %d, want 1 each", compiler.prepareCalls, compiler.analyzeCalls, compiler.finalizeCalls)
	}
	if len(compiler.analyzeFiles) != 1 || compiler.analyzeFiles[0].File != "/repo/src/miss.ts" {
		t.Fatalf("analyze files = %+v, want only cache miss", compiler.analyzeFiles)
	}
	if len(result.Finalize.Events) != 2 {
		t.Fatalf("finalize events = %d, want placeholder phase start/done events", len(result.Finalize.Events))
	}
	if result.Prepare.Telemetry.Node.Started || result.Prepare.Telemetry.NativeOnly.Eligible {
		t.Fatalf("prepare telemetry = %+v, want node-free but native-only-ineligible skeleton", result.Prepare.Telemetry)
	}
}

type recordingStaticIndexCompiler struct {
	prepareCalls    int
	analyzeCalls    int
	finalizeCalls   int
	parseCalls      int
	batchParseCalls int
	analyzeFiles    []protocol.AnalyzeFile
}

func (c *recordingStaticIndexCompiler) StaticIndexPrepare(_ context.Context, request protocol.PrepareRequest) (protocol.PrepareResponse, error) {
	c.prepareCalls++
	var hits []protocol.SourceFile
	var misses []protocol.SourceFile
	for _, file := range request.Files {
		if file.CacheKey == "" {
			misses = append(misses, file)
		} else {
			hits = append(hits, file)
		}
	}
	return protocol.PrepareResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Plan: protocol.Plan{
			Root:        request.Root,
			ProjectName: request.ProjectName,
			Files:       append([]protocol.SourceFile(nil), request.Files...),
			CacheHits:   hits,
			CacheMisses: misses,
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   staticIndexTestTelemetry(len(request.Files), len(hits), len(misses), 0),
	}, nil
}

func (c *recordingStaticIndexCompiler) StaticIndexAnalyzeStream(_ context.Context, request protocol.AnalyzeRequest, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	c.analyzeCalls++
	c.analyzeFiles = append([]protocol.AnalyzeFile(nil), request.Files...)
	return staticIndexTestAnalyzeStream(protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             staticIndexTestTelemetry(len(request.Plan.Files), len(request.Plan.CacheHits), len(request.Plan.CacheMisses), len(request.Files)),
	}, handle)
}

func (c *recordingStaticIndexCompiler) StaticIndexFinalize(_ context.Context, request protocol.FinalizeRequest) (protocol.FinalizeResponse, error) {
	c.finalizeCalls++
	return protocol.FinalizeResponse{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Events: []json.RawMessage{
			json.RawMessage(`{"protocolVersion":2,"type":"phase:start","transactionId":"static-index-skeleton","phase":"ast","root":"/repo","startedAt":"1970-01-01T00:00:00.000Z"}`),
			json.RawMessage(`{"protocolVersion":2,"type":"phase:done","transactionId":"static-index-skeleton","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":"/repo"},"startedAt":"1970-01-01T00:00:00.000Z","finishedAt":"1970-01-01T00:00:00.000Z","status":"ok"},"summary":{"factCount":0}}`),
		},
		Telemetry: staticIndexTestTelemetry(0, 0, 0, 0),
	}, nil
}

func (c *recordingStaticIndexCompiler) StaticIndexFinalizeStream(ctx context.Context, request protocol.FinalizeRequest, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if !request.Stream {
		return protocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.StaticIndexFinalize(ctx, request)
	if err != nil {
		return protocol.FinalizeResponse{}, err
	}
	return staticIndexTestFinalizeStream(response, handle)
}

func (c *recordingStaticIndexCompiler) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	c.parseCalls++
	return nil, fmt.Errorf("ParseFile should not be called by Static Index skeleton")
}

func (c *recordingStaticIndexCompiler) ParseFiles(context.Context, []syntax.Request) ([]json.RawMessage, error) {
	c.batchParseCalls++
	return nil, fmt.Errorf("ParseFiles should not be called by Static Index skeleton")
}

func (c *recordingStaticIndexCompiler) Concurrency() int {
	return 1
}

func (c *recordingStaticIndexCompiler) Close() error {
	return nil
}

func staticIndexTestTelemetry(selected, hits, misses, analyzed int) protocol.Telemetry {
	return protocol.Telemetry{
		Node:       protocol.NodeTelemetry{Started: false, Reasons: []string{}},
		NativeOnly: protocol.NativeOnlyTelemetry{Eligible: false, Reasons: []string{"phase-3-skeleton"}},
		Timings:    []protocol.Timing{},
		Files: protocol.FileTelemetry{
			Selected:    selected,
			CacheHits:   hits,
			CacheMisses: misses,
			Analyzed:    analyzed,
			Skipped:     0,
		},
		Cache: protocol.CacheTelemetry{
			ReadHits:    hits,
			ReadMisses:  misses,
			Writes:      0,
			WriteErrors: 0,
		},
		Facts: protocol.FactTelemetry{},
	}
}

var _ syntax.Parser = (*recordingStaticIndexCompiler)(nil)
var _ syntax.BatchParser = (*recordingStaticIndexCompiler)(nil)
var _ StaticCompiler = (*recordingStaticIndexCompiler)(nil)

func staticIndexTestAnalyzeStream(response protocol.AnalyzeResponse, handle protocol.AnalyzeStreamHandler) (protocol.AnalyzeResponse, error) {
	if handle == nil {
		return response, nil
	}
	if len(response.ExtensionEvidenceJobs) > 0 {
		if err := handle(protocol.AnalyzeStreamEvent{
			OK:                    true,
			Type:                  "extensionEvidenceJobs",
			ExtensionEvidenceJobs: protocol.AppendRawMessages(nil, response.ExtensionEvidenceJobs),
		}); err != nil {
			return protocol.AnalyzeResponse{}, err
		}
	}
	return response, nil
}

func staticIndexTestFinalizeStream(response protocol.FinalizeResponse, handle protocol.FinalizeStreamHandler) (protocol.FinalizeResponse, error) {
	if handle != nil {
		for _, event := range response.Events {
			if err := handle(protocol.FinalizeStreamEvent{
				OK:    true,
				Type:  "event",
				Event: append(json.RawMessage(nil), event...),
			}); err != nil {
				return protocol.FinalizeResponse{}, err
			}
		}
	}
	response.Events = nil
	return response, nil
}

func fakeStaticIndexCompilerWorker(t *testing.T) string {
	t.Helper()
	telemetry := `"telemetry":{"node":{"started":false,"reasons":[]},"nativeOnly":{"eligible":false,"reasons":["phase-3-skeleton"]},"timings":[],"files":{"selected":2,"cacheHits":1,"cacheMisses":1,"analyzed":1,"skipped":0},"cache":{"readHits":1,"readMisses":1,"writes":0,"writeErrors":0},"facts":{"definitions":0,"relations":0,"sourceRefs":0,"diagnostics":0,"lintFindings":0,"ruleDescriptors":0,"sources":0,"sourceGraph":0}}`
	script := strings.ReplaceAll(`while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *staticIndexPrepare*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":2,"method":"staticIndexPrepare","plan":{"root":"/repo","projectName":"static-index","files":[{"file":"/repo/src/cached.ts","sourceHash":"sha256:cached","cacheKey":"static:cached"},{"file":"/repo/src/miss.ts","sourceHash":"sha256:miss"}],"cacheHits":[{"file":"/repo/src/cached.ts","sourceHash":"sha256:cached","cacheKey":"static:cached"}],"cacheMisses":[{"file":"/repo/src/miss.ts","sourceHash":"sha256:miss"}]},"diagnostics":[],$TELEMETRY}}\n' "$id" ;;
  *staticIndexAnalyze*) printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":2,"method":"staticIndexAnalyze","facts":[],"diagnostics":[],"extensionEvidenceJobs":[],$TELEMETRY}}\n' "$id" ;;
  *staticIndexFinalize*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":2,"method":"staticIndexFinalize","events":[],$TELEMETRY}}\n' "$id" ;;
  *) printf '{"error":"unexpected Static Index request"}\n' ;;
esac
done
`, "$TELEMETRY", telemetry)
	return writeShellScript(t, "static-index-worker.sh", script)
}
