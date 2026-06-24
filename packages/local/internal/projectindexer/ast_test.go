package projectindexer

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/compiler"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticsource"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/syntax"
)

func TestSyntaxCompilerCallsCommandWorker(t *testing.T) {
	worker := compiler.New(shellPath(t), fakeNativeStaticCompilerWorker(t))
	defer worker.Close()

	identity := staticprotocol.SkeletonIdentity()
	prepare, err := worker.NativeStaticPrepare(context.Background(), staticprotocol.PrepareRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.PrepareMethod,
		Root:            "/repo",
		ProjectName:     "native-static",
		Identity:        identity,
		Files: []staticprotocol.SourceFile{
			{File: "/repo/src/cached.ts", SourceHash: "sha256:cached", CacheKey: "static:cached"},
			{File: "/repo/src/miss.ts", SourceHash: "sha256:miss"},
		},
	})
	if err != nil {
		t.Fatalf("NativeStaticPrepare error = %v", err)
	}
	if len(prepare.Plan.CacheHits) != 1 || len(prepare.Plan.CacheMisses) != 1 {
		t.Fatalf("prepare plan = %+v, want one hit and one miss", prepare.Plan)
	}

	analyze, err := worker.NativeStaticAnalyzeStream(context.Background(), staticprotocol.AnalyzeRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.AnalyzeMethod,
		Identity:        identity,
		Plan:            prepare.Plan,
		Files:           staticsource.AnalyzeFiles(prepare.Plan.CacheMisses),
	}, nil)
	if err != nil {
		t.Fatalf("NativeStaticAnalyzeStream error = %v", err)
	}
	if len(analyze.Facts) != 0 || analyze.Telemetry.Files.Analyzed != 1 {
		t.Fatalf("analyze response = %+v, want empty skeleton facts for one analyzed file", analyze)
	}

	finalize, err := worker.NativeStaticFinalize(context.Background(), staticprotocol.FinalizeRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.FinalizeMethod,
		Identity:        identity,
		NativeFacts:     analyze.Facts,
		ExtensionFacts:  []json.RawMessage{},
	})
	if err != nil {
		t.Fatalf("NativeStaticFinalize error = %v", err)
	}
	if len(finalize.Events) != 0 {
		t.Fatalf("finalize events = %s, want empty skeleton event stream", finalize.Events)
	}
}

func TestWorkerRunNativeStaticCompilerSkeletonDoesNotUseSyntaxRecords(t *testing.T) {
	compiler := &recordingNativeStaticCompiler{}
	worker := &Worker{syntaxParser: compiler}
	files := []staticprotocol.SourceFile{
		{File: "/repo/src/cached.ts", SourceHash: "sha256:cached", CacheKey: "static:cached"},
		{File: "/repo/src/miss.ts", SourceHash: "sha256:miss"},
	}

	result, err := worker.runNativeStaticCompilerSkeleton(context.Background(), "/repo", "", "native-static-skeleton", files)
	if err != nil {
		t.Fatalf("runNativeStaticCompilerSkeleton error = %v", err)
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

type recordingNativeStaticCompiler struct {
	prepareCalls    int
	analyzeCalls    int
	finalizeCalls   int
	parseCalls      int
	batchParseCalls int
	analyzeFiles    []staticprotocol.AnalyzeFile
}

func (c *recordingNativeStaticCompiler) NativeStaticPrepare(_ context.Context, request staticprotocol.PrepareRequest) (staticprotocol.PrepareResponse, error) {
	c.prepareCalls++
	var hits []staticprotocol.SourceFile
	var misses []staticprotocol.SourceFile
	for _, file := range request.Files {
		if file.CacheKey == "" {
			misses = append(misses, file)
		} else {
			hits = append(hits, file)
		}
	}
	return staticprotocol.PrepareResponse{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.PrepareMethod,
		Plan: staticprotocol.Plan{
			Root:        request.Root,
			ProjectName: request.ProjectName,
			Files:       append([]staticprotocol.SourceFile(nil), request.Files...),
			CacheHits:   hits,
			CacheMisses: misses,
		},
		Diagnostics: []json.RawMessage{},
		Telemetry:   nativeStaticTestTelemetry(len(request.Files), len(hits), len(misses), 0),
	}, nil
}

func (c *recordingNativeStaticCompiler) NativeStaticAnalyzeStream(_ context.Context, request staticprotocol.AnalyzeRequest, handle staticprotocol.AnalyzeStreamHandler) (staticprotocol.AnalyzeResponse, error) {
	c.analyzeCalls++
	c.analyzeFiles = append([]staticprotocol.AnalyzeFile(nil), request.Files...)
	return nativeStaticTestAnalyzeStream(staticprotocol.AnalyzeResponse{
		ProtocolVersion:       staticprotocol.Version,
		Method:                staticprotocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             nativeStaticTestTelemetry(len(request.Plan.Files), len(request.Plan.CacheHits), len(request.Plan.CacheMisses), len(request.Files)),
	}, handle)
}

func (c *recordingNativeStaticCompiler) NativeStaticFinalize(_ context.Context, request staticprotocol.FinalizeRequest) (staticprotocol.FinalizeResponse, error) {
	c.finalizeCalls++
	return staticprotocol.FinalizeResponse{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.FinalizeMethod,
		Events: []json.RawMessage{
			json.RawMessage(`{"protocolVersion":2,"type":"phase:start","transactionId":"native-static-skeleton","phase":"ast","root":"/repo","startedAt":"1970-01-01T00:00:00.000Z"}`),
			json.RawMessage(`{"protocolVersion":2,"type":"phase:done","transactionId":"native-static-skeleton","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":"/repo"},"startedAt":"1970-01-01T00:00:00.000Z","finishedAt":"1970-01-01T00:00:00.000Z","status":"ok"},"summary":{"factCount":0}}`),
		},
		Telemetry: nativeStaticTestTelemetry(0, 0, 0, 0),
	}, nil
}

func (c *recordingNativeStaticCompiler) NativeStaticFinalizeStream(ctx context.Context, request staticprotocol.FinalizeRequest, handle staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error) {
	if !request.Stream {
		return staticprotocol.FinalizeResponse{}, fmt.Errorf("finalize stream flag = false, want true")
	}
	response, err := c.NativeStaticFinalize(ctx, request)
	if err != nil {
		return staticprotocol.FinalizeResponse{}, err
	}
	return nativeStaticTestFinalizeStream(response, handle)
}

func (c *recordingNativeStaticCompiler) ParseFile(context.Context, syntax.Request) (json.RawMessage, error) {
	c.parseCalls++
	return nil, fmt.Errorf("ParseFile should not be called by native static skeleton")
}

func (c *recordingNativeStaticCompiler) ParseFiles(context.Context, []syntax.Request) ([]json.RawMessage, error) {
	c.batchParseCalls++
	return nil, fmt.Errorf("ParseFiles should not be called by native static skeleton")
}

func (c *recordingNativeStaticCompiler) Concurrency() int {
	return 1
}

func (c *recordingNativeStaticCompiler) Close() error {
	return nil
}

func nativeStaticTestTelemetry(selected, hits, misses, analyzed int) staticprotocol.Telemetry {
	return staticprotocol.Telemetry{
		Node:       staticprotocol.NodeTelemetry{Started: false, Reasons: []string{}},
		NativeOnly: staticprotocol.NativeOnlyTelemetry{Eligible: false, Reasons: []string{"phase-3-skeleton"}},
		Timings:    []staticprotocol.Timing{},
		Files: staticprotocol.FileTelemetry{
			Selected:    selected,
			CacheHits:   hits,
			CacheMisses: misses,
			Analyzed:    analyzed,
			Skipped:     0,
		},
		Cache: staticprotocol.CacheTelemetry{
			ReadHits:    hits,
			ReadMisses:  misses,
			Writes:      0,
			WriteErrors: 0,
		},
		Facts: staticprotocol.FactTelemetry{},
	}
}

var _ syntax.Parser = (*recordingNativeStaticCompiler)(nil)
var _ syntax.BatchParser = (*recordingNativeStaticCompiler)(nil)
var _ StaticCompiler = (*recordingNativeStaticCompiler)(nil)

func nativeStaticTestAnalyzeStream(response staticprotocol.AnalyzeResponse, handle staticprotocol.AnalyzeStreamHandler) (staticprotocol.AnalyzeResponse, error) {
	if handle == nil {
		return response, nil
	}
	if len(response.ExtensionEvidenceJobs) > 0 {
		if err := handle(staticprotocol.AnalyzeStreamEvent{
			OK:                    true,
			Type:                  "extensionEvidenceJobs",
			ExtensionEvidenceJobs: staticprotocol.AppendRawMessages(nil, response.ExtensionEvidenceJobs),
		}); err != nil {
			return staticprotocol.AnalyzeResponse{}, err
		}
	}
	return response, nil
}

func nativeStaticTestFinalizeStream(response staticprotocol.FinalizeResponse, handle staticprotocol.FinalizeStreamHandler) (staticprotocol.FinalizeResponse, error) {
	if handle != nil {
		for _, event := range response.Events {
			if err := handle(staticprotocol.FinalizeStreamEvent{
				OK:    true,
				Type:  "event",
				Event: append(json.RawMessage(nil), event...),
			}); err != nil {
				return staticprotocol.FinalizeResponse{}, err
			}
		}
	}
	response.Events = nil
	return response, nil
}

func fakeNativeStaticCompilerWorker(t *testing.T) string {
	t.Helper()
	telemetry := `"telemetry":{"node":{"started":false,"reasons":[]},"nativeOnly":{"eligible":false,"reasons":["phase-3-skeleton"]},"timings":[],"files":{"selected":2,"cacheHits":1,"cacheMisses":1,"analyzed":1,"skipped":0},"cache":{"readHits":1,"readMisses":1,"writes":0,"writeErrors":0},"facts":{"definitions":0,"relations":0,"sourceRefs":0,"diagnostics":0,"lintFindings":0,"ruleDescriptors":0,"sources":0,"sourceGraph":0}}`
	script := strings.ReplaceAll(`while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *nativeStaticPrepare*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":1,"method":"nativeStaticPrepare","plan":{"root":"/repo","projectName":"native-static","files":[{"file":"/repo/src/cached.ts","sourceHash":"sha256:cached","cacheKey":"static:cached"},{"file":"/repo/src/miss.ts","sourceHash":"sha256:miss"}],"cacheHits":[{"file":"/repo/src/cached.ts","sourceHash":"sha256:cached","cacheKey":"static:cached"}],"cacheMisses":[{"file":"/repo/src/miss.ts","sourceHash":"sha256:miss"}]},"diagnostics":[],$TELEMETRY}}\n' "$id" ;;
  *nativeStaticAnalyze*) printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":1,"method":"nativeStaticAnalyze","facts":[],"diagnostics":[],"extensionEvidenceJobs":[],$TELEMETRY}}\n' "$id" ;;
  *nativeStaticFinalize*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":1,"method":"nativeStaticFinalize","events":[],$TELEMETRY}}\n' "$id" ;;
  *) printf '{"error":"unexpected native static request"}\n' ;;
esac
done
`, "$TELEMETRY", telemetry)
	return writeShellScript(t, "native-static-worker.sh", script)
}
