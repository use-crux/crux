package workers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"github.com/use-crux/crux/packages/local/internal/projectindex"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	staticclient "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/client"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestSyntaxCompilerAnalyzeStreamAcceptsChunkedEvents(t *testing.T) {
	worker := staticclient.New(shellPath(t), fakeStaticIndexAnalyzeStreamWorker(t))
	defer worker.Close()

	identity := protocol.SkeletonIdentity()
	events := []string{}
	response, err := worker.StaticIndexAnalyzeStream(context.Background(), protocol.AnalyzeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.AnalyzeMethod,
		Identity:        identity,
		Plan: protocol.Plan{
			Root:        "/repo",
			ProjectName: "stream",
			Files:       []protocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
			CacheMisses: []protocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
		},
		Files: []protocol.AnalyzeFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer", SourceText: "export const writer = prompt({ id: 'writer' })"}},
	}, func(event protocol.AnalyzeStreamEvent) error {
		events = append(events, event.Type)
		return nil
	})
	if err != nil {
		t.Fatalf("StaticIndexAnalyzeStream error = %v", err)
	}

	if !reflect.DeepEqual(events, []string{"extensionEvidenceJobs", "fact", "done"}) {
		t.Fatalf("stream events = %v, want extension jobs, fact, done", events)
	}
	if len(response.ExtensionEvidenceJobs) != 1 {
		t.Fatalf("extension jobs = %s, want one streamed job", response.ExtensionEvidenceJobs)
	}
	if len(response.Facts) != 1 {
		t.Fatalf("facts = %s, want one streamed fact", response.Facts)
	}
	if response.Telemetry.Files.Analyzed != 1 {
		t.Fatalf("telemetry = %+v, want one analyzed file", response.Telemetry)
	}
}

func TestSyntaxCompilerAnalyzeStreamRejectsUnlabeledEvents(t *testing.T) {
	worker := staticclient.New(shellPath(t), fakeStaticIndexAnalyzeUnlabeledEventWorker(t))
	defer worker.Close()

	_, err := worker.StaticIndexAnalyzeStream(context.Background(), protocol.AnalyzeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.AnalyzeMethod,
		Identity:        protocol.SkeletonIdentity(),
		Plan: protocol.Plan{
			Root:        "/repo",
			ProjectName: "stream",
			Files:       []protocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
			CacheMisses: []protocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
		},
		Files: []protocol.AnalyzeFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer", SourceText: "export const writer = prompt({ id: 'writer' })"}},
	}, nil)
	if err == nil || !strings.Contains(err.Error(), `unknown event type ""`) {
		t.Fatalf("StaticIndexAnalyzeStream error = %v, want unlabeled stream event rejection", err)
	}
}

func TestSyntaxCompilerAnalyzeStreamIgnoresDoneResponseFacts(t *testing.T) {
	worker := staticclient.New(shellPath(t), fakeStaticIndexAnalyzeDoneFactsWorker(t))
	defer worker.Close()

	response, err := worker.StaticIndexAnalyzeStream(context.Background(), protocol.AnalyzeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.AnalyzeMethod,
		Identity:        protocol.SkeletonIdentity(),
		Plan: protocol.Plan{
			Root:        "/repo",
			ProjectName: "stream",
			Files:       []protocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
			CacheMisses: []protocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
		},
		Files: []protocol.AnalyzeFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer", SourceText: "export const writer = prompt({ id: 'writer' })"}},
	}, nil)
	if err != nil {
		t.Fatalf("StaticIndexAnalyzeStream error = %v", err)
	}
	if len(response.Facts) != 0 || len(response.ExtensionEvidenceJobs) != 0 || len(response.Diagnostics) != 0 {
		t.Fatalf("done response data was accepted: facts=%s jobs=%s diagnostics=%s", response.Facts, response.ExtensionEvidenceJobs, response.Diagnostics)
	}
}

func TestSyntaxCompilerFinalizeStreamAcceptsPatchEvents(t *testing.T) {
	worker := staticclient.New(shellPath(t), fakeStaticIndexFinalizeStreamWorker(t))
	defer worker.Close()

	events := []json.RawMessage{}
	response, err := worker.StaticIndexFinalizeStream(context.Background(), protocol.FinalizeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
		Identity:        protocol.SkeletonIdentity(),
		NativeFacts:     []json.RawMessage{json.RawMessage(`{"root":"/repo","projectName":"stream"}`)},
		ExtensionFacts:  []json.RawMessage{},
	}, func(event protocol.FinalizeStreamEvent) error {
		events = append(events, append(json.RawMessage(nil), event.Event...))
		return nil
	})
	if err != nil {
		t.Fatalf("StaticIndexFinalizeStream error = %v", err)
	}

	if len(events) != 3 {
		t.Fatalf("streamed events = %d, want 3", len(events))
	}
	if !bytes.Contains(events[0], []byte(`"phase:start"`)) || !bytes.Contains(events[2], []byte(`"phase:done"`)) {
		t.Fatalf("events = %s, want patch event stream", events)
	}
	if len(response.Events) != 0 {
		t.Fatalf("done response events = %s, want streamed events omitted", response.Events)
	}
	if response.Telemetry.Files.Analyzed != 1 {
		t.Fatalf("telemetry = %+v, want one finalized file", response.Telemetry)
	}
}

func TestWorkerStaticIndexCompilerUsesStreamingAnalyze(t *testing.T) {
	root := t.TempDir()
	srcDir := filepath.Join(root, "src")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	sourceFile := filepath.Join(srcDir, "writer.ts")
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'static-index-cutover' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}

	compiler := &streamingStaticIndexCutoverCompiler{
		staticIndexCutoverCompiler: staticIndexCutoverCompiler{root: root, sourceFile: sourceFile},
	}
	worker := &Bundle{}
	plan := projectindex.ProjectStaticSyntaxPlan{
		Root:                root,
		ProjectName:         "static-index-cutover",
		Files:               []string{sourceFile},
		PrimaryFiles:        []string{sourceFile},
		FilesToParse:        []string{sourceFile},
		CacheMisses:         []string{sourceFile},
		CallNames:           []string{"prompt"},
		ConstructorNames:    []string{"Agent"},
		StaticSyntaxEnabled: true,
		StaticHost:          json.RawMessage(`{}`),
		StaticInterests:     json.RawMessage(`{"extractors":[]}`),
		SourceGraph:         json.RawMessage(`{"schemaVersion":1,"producedBy":"@use-crux/indexer","capabilities":[],"shards":[]}`),
	}

	patch, _, usedStaticIndex, err := worker.indexProjectAstPatchFromStaticIndexCompiler(context.Background(), root, "", "static-index-cutover", plan, compiler)
	if err != nil {
		t.Fatalf("indexProjectAstPatchFromStaticIndexCompiler error = %v", err)
	}
	if !usedStaticIndex {
		t.Fatal("usedStaticIndex = false, want true")
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:static-index-cutover" {
		t.Fatalf("definitions = %+v, want Static Index finalize result", patch.Facts.Definitions)
	}
	if compiler.streamAnalyzeCalls != 1 || compiler.analyzeCalls != 0 {
		t.Fatalf("analyze calls = stream %d non-stream %d, want streaming only", compiler.streamAnalyzeCalls, compiler.analyzeCalls)
	}
}

func fakeStaticIndexFinalizeStreamWorker(t *testing.T) string {
	t.Helper()
	telemetry := `"telemetry":{"node":{"started":false,"reasons":[]},"nativeOnly":{"eligible":true,"reasons":[]},"timings":[],"files":{"selected":1,"cacheHits":0,"cacheMisses":1,"analyzed":1,"skipped":0},"cache":{"readHits":0,"readMisses":1,"writes":0,"writeErrors":0},"facts":{"definitions":1,"relations":0,"sourceRefs":0,"diagnostics":0,"lintFindings":0,"ruleDescriptors":0,"sources":0,"sourceGraph":0}}`
	script := strings.ReplaceAll(`while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *staticIndexFinalize*)
    printf '{"id":%s,"ok":true,"type":"event","event":{"protocolVersion":2,"type":"phase:start","transactionId":"tx-static-index-finalize-stream","phase":"ast","root":"/repo","startedAt":"1970-01-01T00:00:00.000Z"}}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"event","event":{"protocolVersion":2,"type":"fact:batch","transactionId":"tx-static-index-finalize-stream","sequence":0,"facts":[]}}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"event","event":{"protocolVersion":2,"type":"phase:done","transactionId":"tx-static-index-finalize-stream","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":"/repo"},"startedAt":"1970-01-01T00:00:00.000Z","finishedAt":"1970-01-01T00:00:00.000Z","status":"ok"},"summary":{"factCount":0,"decision":{"staticIndexComplete":true}}}}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":2,"method":"staticIndexFinalize","events":[{"fixture":true}],$TELEMETRY}}\n' "$id"
    ;;
  *) printf '{"error":"unexpected Static Index request"}\n' ;;
esac
done
`, "$TELEMETRY", telemetry)
	return writeShellScript(t, "static-index-finalize-stream-worker.sh", script)
}

func fakeStaticIndexAnalyzeDoneFactsWorker(t *testing.T) string {
	t.Helper()
	telemetry := `"telemetry":{"node":{"started":false,"reasons":[]},"nativeOnly":{"eligible":true,"reasons":[]},"timings":[],"files":{"selected":1,"cacheHits":0,"cacheMisses":1,"analyzed":1,"skipped":0},"cache":{"readHits":0,"readMisses":1,"writes":0,"writeErrors":0},"facts":{"definitions":1,"relations":0,"sourceRefs":0,"diagnostics":0,"lintFindings":0,"ruleDescriptors":0,"sources":0,"sourceGraph":0}}`
	script := strings.ReplaceAll(`while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *staticIndexAnalyze*) printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":2,"method":"staticIndexAnalyze","facts":[{"root":"/repo","projectName":"stream"}],"diagnostics":[{"id":"fixture"}],"extensionEvidenceJobs":[{"id":"fixture-job"}],$TELEMETRY}}\n' "$id" ;;
  *) printf '{"error":"unexpected Static Index request"}\n' ;;
esac
done
`, "$TELEMETRY", telemetry)
	return writeShellScript(t, "static-index-analyze-done-facts-worker.sh", script)
}

func fakeStaticIndexAnalyzeUnlabeledEventWorker(t *testing.T) string {
	t.Helper()
	script := `while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *staticIndexAnalyze*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":2,"method":"staticIndexAnalyze","facts":[],"diagnostics":[],"extensionEvidenceJobs":[]}}\n' "$id" ;;
  *) printf '{"error":"unexpected Static Index request"}\n' ;;
esac
done
`
	return writeShellScript(t, "static-index-analyze-unlabeled-event-worker.sh", script)
}

func fakeStaticIndexAnalyzeStreamWorker(t *testing.T) string {
	t.Helper()
	telemetry := `"telemetry":{"node":{"started":false,"reasons":[]},"nativeOnly":{"eligible":true,"reasons":[]},"timings":[],"files":{"selected":1,"cacheHits":0,"cacheMisses":1,"analyzed":1,"skipped":0},"cache":{"readHits":0,"readMisses":1,"writes":0,"writeErrors":0},"facts":{"definitions":1,"relations":0,"sourceRefs":0,"diagnostics":0,"lintFindings":0,"ruleDescriptors":0,"sources":0,"sourceGraph":0}}`
	script := strings.ReplaceAll(`while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *staticIndexAnalyze*)
    printf '{"id":%s,"ok":true,"type":"extensionEvidenceJobs","extensionEvidenceJobs":[{"id":"job:writer"}]}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"fact","fact":{"root":"/repo","projectName":"stream","definitions":[{"id":"prompt:writer","kind":"prompt","name":"writer","fidelity":"resolved","status":"active"}]}}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":2,"method":"staticIndexAnalyze","facts":[],"diagnostics":[],"extensionEvidenceJobs":[],$TELEMETRY}}\n' "$id"
    ;;
  *) printf '{"error":"unexpected Static Index request"}\n' ;;
esac
done
`, "$TELEMETRY", telemetry)
	return writeShellScript(t, "static-index-analyze-stream-worker.sh", script)
}

type streamingStaticIndexCutoverCompiler struct {
	staticIndexCutoverCompiler
	streamAnalyzeCalls int
}

func (c *streamingStaticIndexCutoverCompiler) StaticIndexAnalyzeStream(
	_ context.Context,
	request protocol.AnalyzeRequest,
	handle protocol.AnalyzeStreamHandler,
) (protocol.AnalyzeResponse, error) {
	c.streamAnalyzeCalls++
	c.analyzeFiles = append([]protocol.AnalyzeFile(nil), request.Files...)
	if !request.Stream {
		return protocol.AnalyzeResponse{}, fmt.Errorf("stream flag = false, want true")
	}
	fact := json.RawMessage(`{"kind":"definition","id":"prompt:static-index-cutover"}`)
	if err := handle(protocol.AnalyzeStreamEvent{
		ID:   request.ID,
		OK:   true,
		Type: "fact",
		Fact: fact,
	}); err != nil {
		return protocol.AnalyzeResponse{}, err
	}
	return protocol.AnalyzeResponse{
		ProtocolVersion:       protocol.Version,
		Method:                protocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{fact},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             staticIndexTestTelemetry(1, 0, 1, len(request.Files)),
	}, nil
}

var _ StaticCompiler = (*streamingStaticIndexCutoverCompiler)(nil)
