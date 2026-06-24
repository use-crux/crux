package projectindexer

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

	"github.com/use-crux/crux/packages/local/internal/projectindexer/compiler"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
)

func TestSyntaxCompilerAnalyzeStreamAcceptsChunkedEvents(t *testing.T) {
	worker := compiler.New(shellPath(t), fakeNativeStaticAnalyzeStreamWorker(t))
	defer worker.Close()

	identity := staticprotocol.SkeletonIdentity()
	events := []string{}
	response, err := worker.NativeStaticAnalyzeStream(context.Background(), staticprotocol.AnalyzeRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.AnalyzeMethod,
		Identity:        identity,
		Plan: staticprotocol.Plan{
			Root:        "/repo",
			ProjectName: "stream",
			Files:       []staticprotocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
			CacheMisses: []staticprotocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
		},
		Files: []staticprotocol.AnalyzeFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer", SourceText: "export const writer = prompt({ id: 'writer' })"}},
	}, func(event staticprotocol.AnalyzeStreamEvent) error {
		events = append(events, event.Type)
		return nil
	})
	if err != nil {
		t.Fatalf("NativeStaticAnalyzeStream error = %v", err)
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
	worker := compiler.New(shellPath(t), fakeNativeStaticAnalyzeUnlabeledEventWorker(t))
	defer worker.Close()

	_, err := worker.NativeStaticAnalyzeStream(context.Background(), staticprotocol.AnalyzeRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.AnalyzeMethod,
		Identity:        staticprotocol.SkeletonIdentity(),
		Plan: staticprotocol.Plan{
			Root:        "/repo",
			ProjectName: "stream",
			Files:       []staticprotocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
			CacheMisses: []staticprotocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
		},
		Files: []staticprotocol.AnalyzeFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer", SourceText: "export const writer = prompt({ id: 'writer' })"}},
	}, nil)
	if err == nil || !strings.Contains(err.Error(), `unknown event type ""`) {
		t.Fatalf("NativeStaticAnalyzeStream error = %v, want unlabeled stream event rejection", err)
	}
}

func TestSyntaxCompilerAnalyzeStreamIgnoresDoneResponseFacts(t *testing.T) {
	worker := compiler.New(shellPath(t), fakeNativeStaticAnalyzeDoneFactsWorker(t))
	defer worker.Close()

	response, err := worker.NativeStaticAnalyzeStream(context.Background(), staticprotocol.AnalyzeRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.AnalyzeMethod,
		Identity:        staticprotocol.SkeletonIdentity(),
		Plan: staticprotocol.Plan{
			Root:        "/repo",
			ProjectName: "stream",
			Files:       []staticprotocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
			CacheMisses: []staticprotocol.SourceFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer"}},
		},
		Files: []staticprotocol.AnalyzeFile{{File: "/repo/src/writer.ts", SourceHash: "sha256:writer", SourceText: "export const writer = prompt({ id: 'writer' })"}},
	}, nil)
	if err != nil {
		t.Fatalf("NativeStaticAnalyzeStream error = %v", err)
	}
	if len(response.Facts) != 0 || len(response.ExtensionEvidenceJobs) != 0 || len(response.Diagnostics) != 0 {
		t.Fatalf("done response data was accepted: facts=%s jobs=%s diagnostics=%s", response.Facts, response.ExtensionEvidenceJobs, response.Diagnostics)
	}
}

func TestSyntaxCompilerFinalizeStreamAcceptsPatchEvents(t *testing.T) {
	worker := compiler.New(shellPath(t), fakeNativeStaticFinalizeStreamWorker(t))
	defer worker.Close()

	events := []json.RawMessage{}
	response, err := worker.NativeStaticFinalizeStream(context.Background(), staticprotocol.FinalizeRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.FinalizeMethod,
		Identity:        staticprotocol.SkeletonIdentity(),
		NativeFacts:     []json.RawMessage{json.RawMessage(`{"root":"/repo","projectName":"stream"}`)},
		ExtensionFacts:  []json.RawMessage{},
	}, func(event staticprotocol.FinalizeStreamEvent) error {
		events = append(events, append(json.RawMessage(nil), event.Event...))
		return nil
	})
	if err != nil {
		t.Fatalf("NativeStaticFinalizeStream error = %v", err)
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

func TestWorkerNativeStaticCompilerUsesStreamingAnalyze(t *testing.T) {
	root := t.TempDir()
	srcDir := filepath.Join(root, "src")
	if err := os.MkdirAll(srcDir, 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	sourceFile := filepath.Join(srcDir, "writer.ts")
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'native-static-cutover' })"), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}

	compiler := &streamingNativeStaticCutoverCompiler{
		nativeStaticCutoverCompiler: nativeStaticCutoverCompiler{root: root, sourceFile: sourceFile},
	}
	worker := &Worker{}
	plan := projectindex.ProjectStaticSyntaxPlan{
		Root:             root,
		ProjectName:      "native-static-cutover",
		Files:            []string{sourceFile},
		PrimaryFiles:     []string{sourceFile},
		FilesToParse:     []string{sourceFile},
		CacheMisses:      []string{sourceFile},
		CallNames:        []string{"prompt"},
		ConstructorNames: []string{"Agent"},
		NativeAstEnabled: true,
		StaticHost:       json.RawMessage(`{}`),
		StaticInterests:  json.RawMessage(`{"extractors":[]}`),
		SourceGraph:      json.RawMessage(`{"schemaVersion":1,"producedBy":"@crux/indexer","capabilities":[],"shards":[]}`),
	}

	patch, _, usedNativeStatic, err := worker.indexProjectAstPatchFromNativeStaticCompiler(context.Background(), root, "", "native-static-cutover", plan, compiler)
	if err != nil {
		t.Fatalf("indexProjectAstPatchFromNativeStaticCompiler error = %v", err)
	}
	if !usedNativeStatic {
		t.Fatal("usedNativeStatic = false, want true")
	}
	if len(patch.Facts.Definitions) != 1 || patch.Facts.Definitions[0].ID != "prompt:native-static-cutover" {
		t.Fatalf("definitions = %+v, want native static finalize result", patch.Facts.Definitions)
	}
	if compiler.streamAnalyzeCalls != 1 || compiler.analyzeCalls != 0 {
		t.Fatalf("analyze calls = stream %d non-stream %d, want streaming only", compiler.streamAnalyzeCalls, compiler.analyzeCalls)
	}
}

func fakeNativeStaticFinalizeStreamWorker(t *testing.T) string {
	t.Helper()
	telemetry := `"telemetry":{"node":{"started":false,"reasons":[]},"nativeOnly":{"eligible":true,"reasons":[]},"timings":[],"files":{"selected":1,"cacheHits":0,"cacheMisses":1,"analyzed":1,"skipped":0},"cache":{"readHits":0,"readMisses":1,"writes":0,"writeErrors":0},"facts":{"definitions":1,"relations":0,"sourceRefs":0,"diagnostics":0,"lintFindings":0,"ruleDescriptors":0,"sources":0,"sourceGraph":0}}`
	script := strings.ReplaceAll(`while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *nativeStaticFinalize*)
    printf '{"id":%s,"ok":true,"type":"event","event":{"protocolVersion":2,"type":"phase:start","transactionId":"tx-native-static-finalize-stream","phase":"ast","root":"/repo","startedAt":"1970-01-01T00:00:00.000Z"}}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"event","event":{"protocolVersion":2,"type":"fact:batch","transactionId":"tx-native-static-finalize-stream","sequence":0,"facts":[]}}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"event","event":{"protocolVersion":2,"type":"phase:done","transactionId":"tx-native-static-finalize-stream","phase":"ast","patch":{"schemaVersion":1,"phase":"ast","project":{"root":"/repo"},"startedAt":"1970-01-01T00:00:00.000Z","finishedAt":"1970-01-01T00:00:00.000Z","status":"ok"},"summary":{"factCount":0,"decision":{"nativeStaticComplete":true}}}}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":1,"method":"nativeStaticFinalize","events":[{"fixture":true}],$TELEMETRY}}\n' "$id"
    ;;
  *) printf '{"error":"unexpected native static request"}\n' ;;
esac
done
`, "$TELEMETRY", telemetry)
	return writeShellScript(t, "native-static-finalize-stream-worker.sh", script)
}

func fakeNativeStaticAnalyzeDoneFactsWorker(t *testing.T) string {
	t.Helper()
	telemetry := `"telemetry":{"node":{"started":false,"reasons":[]},"nativeOnly":{"eligible":true,"reasons":[]},"timings":[],"files":{"selected":1,"cacheHits":0,"cacheMisses":1,"analyzed":1,"skipped":0},"cache":{"readHits":0,"readMisses":1,"writes":0,"writeErrors":0},"facts":{"definitions":1,"relations":0,"sourceRefs":0,"diagnostics":0,"lintFindings":0,"ruleDescriptors":0,"sources":0,"sourceGraph":0}}`
	script := strings.ReplaceAll(`while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *nativeStaticAnalyze*) printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":1,"method":"nativeStaticAnalyze","facts":[{"root":"/repo","projectName":"stream"}],"diagnostics":[{"id":"fixture"}],"extensionEvidenceJobs":[{"id":"fixture-job"}],$TELEMETRY}}\n' "$id" ;;
  *) printf '{"error":"unexpected native static request"}\n' ;;
esac
done
`, "$TELEMETRY", telemetry)
	return writeShellScript(t, "native-static-analyze-done-facts-worker.sh", script)
}

func fakeNativeStaticAnalyzeUnlabeledEventWorker(t *testing.T) string {
	t.Helper()
	script := `while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *nativeStaticAnalyze*) printf '{"id":%s,"ok":true,"response":{"protocolVersion":1,"method":"nativeStaticAnalyze","facts":[],"diagnostics":[],"extensionEvidenceJobs":[]}}\n' "$id" ;;
  *) printf '{"error":"unexpected native static request"}\n' ;;
esac
done
`
	return writeShellScript(t, "native-static-analyze-unlabeled-event-worker.sh", script)
}

func fakeNativeStaticAnalyzeStreamWorker(t *testing.T) string {
	t.Helper()
	telemetry := `"telemetry":{"node":{"started":false,"reasons":[]},"nativeOnly":{"eligible":true,"reasons":[]},"timings":[],"files":{"selected":1,"cacheHits":0,"cacheMisses":1,"analyzed":1,"skipped":0},"cache":{"readHits":0,"readMisses":1,"writes":0,"writeErrors":0},"facts":{"definitions":1,"relations":0,"sourceRefs":0,"diagnostics":0,"lintFindings":0,"ruleDescriptors":0,"sources":0,"sourceGraph":0}}`
	script := strings.ReplaceAll(`while IFS= read -r line; do
id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
case "$line" in
  *nativeStaticAnalyze*)
    printf '{"id":%s,"ok":true,"type":"extensionEvidenceJobs","extensionEvidenceJobs":[{"id":"job:writer"}]}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"fact","fact":{"root":"/repo","projectName":"stream","definitions":[{"id":"prompt:writer","kind":"prompt","name":"writer","fidelity":"resolved","status":"active"}]}}\n' "$id"
    printf '{"id":%s,"ok":true,"type":"done","response":{"protocolVersion":1,"method":"nativeStaticAnalyze","facts":[],"diagnostics":[],"extensionEvidenceJobs":[],$TELEMETRY}}\n' "$id"
    ;;
  *) printf '{"error":"unexpected native static request"}\n' ;;
esac
done
`, "$TELEMETRY", telemetry)
	return writeShellScript(t, "native-static-analyze-stream-worker.sh", script)
}

type streamingNativeStaticCutoverCompiler struct {
	nativeStaticCutoverCompiler
	streamAnalyzeCalls int
}

func (c *streamingNativeStaticCutoverCompiler) NativeStaticAnalyzeStream(
	_ context.Context,
	request staticprotocol.AnalyzeRequest,
	handle staticprotocol.AnalyzeStreamHandler,
) (staticprotocol.AnalyzeResponse, error) {
	c.streamAnalyzeCalls++
	c.analyzeFiles = append([]staticprotocol.AnalyzeFile(nil), request.Files...)
	if !request.Stream {
		return staticprotocol.AnalyzeResponse{}, fmt.Errorf("stream flag = false, want true")
	}
	fact := json.RawMessage(`{"kind":"definition","id":"prompt:native-static-cutover"}`)
	if err := handle(staticprotocol.AnalyzeStreamEvent{
		ID:   request.ID,
		OK:   true,
		Type: "fact",
		Fact: fact,
	}); err != nil {
		return staticprotocol.AnalyzeResponse{}, err
	}
	return staticprotocol.AnalyzeResponse{
		ProtocolVersion:       staticprotocol.Version,
		Method:                staticprotocol.AnalyzeMethod,
		Facts:                 []json.RawMessage{fact},
		Diagnostics:           []json.RawMessage{},
		ExtensionEvidenceJobs: []json.RawMessage{},
		Telemetry:             nativeStaticTestTelemetry(1, 0, 1, len(request.Files)),
	}, nil
}

var _ StaticCompiler = (*streamingNativeStaticCutoverCompiler)(nil)
