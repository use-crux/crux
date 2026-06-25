package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type nativeStaticProtocolSharedFixture struct {
	Requests  []json.RawMessage `json:"requests"`
	Responses []json.RawMessage `json:"responses"`
}

func TestSharedNativeStaticProtocolFixtureDecodes(t *testing.T) {
	var fixture nativeStaticProtocolSharedFixture
	readSharedNativeRuntimeFixture(t, "native-static-protocol.json", &fixture)

	requestMethods := make([]string, 0, len(fixture.Requests))
	for _, raw := range fixture.Requests {
		method := nativeStaticFixtureMethod(t, raw)
		requestMethods = append(requestMethods, method)
		switch method {
		case PrepareMethod:
			var request PrepareRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				t.Fatalf("decode prepare request: %v", err)
			}
			if request.Root != "/repo" || len(request.CallInterests) != 1 {
				t.Fatalf("prepare request = %+v, want shared fixture root and call interest", request)
			}
		case AnalyzeMethod:
			var request AnalyzeRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				t.Fatalf("decode analyze request: %v", err)
			}
			if !request.Stream || len(request.Files) != 1 {
				t.Fatalf("analyze request = %+v, want streamed file fixture", request)
			}
		case FinalizeMethod:
			var request FinalizeRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				t.Fatalf("decode finalize request: %v", err)
			}
			if len(request.NativeFacts) != 1 || len(request.RelationSpecs) == 0 {
				t.Fatalf("finalize request = %+v, want native facts and relation specs", request)
			}
		case CompileMethod:
			var request CompileRequest
			if err := json.Unmarshal(raw, &request); err != nil {
				t.Fatalf("decode compile request: %v", err)
			}
			if !request.Stream || len(request.Plan.CacheMisses) != 1 {
				t.Fatalf("compile request = %+v, want streamed cache-miss fixture", request)
			}
		default:
			t.Fatalf("unexpected request method %q", method)
		}
	}
	if got, want := requestMethods, []string{PrepareMethod, AnalyzeMethod, FinalizeMethod, CompileMethod}; !sameStrings(got, want) {
		t.Fatalf("request methods = %v, want %v", got, want)
	}

	for _, raw := range fixture.Responses {
		switch method := nativeStaticFixtureMethod(t, raw); method {
		case PrepareMethod:
			var response PrepareResponse
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatalf("decode prepare response: %v", err)
			}
		case AnalyzeMethod:
			var response AnalyzeResponse
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatalf("decode analyze response: %v", err)
			}
		case FinalizeMethod:
			var response FinalizeResponse
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatalf("decode finalize response: %v", err)
			}
		case CompileMethod:
			var response FinalizeResponse
			if err := json.Unmarshal(raw, &response); err != nil {
				t.Fatalf("decode compile response: %v", err)
			}
		default:
			t.Fatalf("unexpected response method %q", method)
		}
	}
}

func nativeStaticFixtureMethod(t *testing.T, raw json.RawMessage) string {
	t.Helper()
	var header struct {
		Method string `json:"method"`
	}
	if err := json.Unmarshal(raw, &header); err != nil {
		t.Fatalf("decode native static fixture method: %v", err)
	}
	return header.Method
}

func readSharedNativeRuntimeFixture(t *testing.T, name string, out any) {
	t.Helper()
	path := sharedNativeRuntimeFixturePath(t, name)
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read shared fixture %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		t.Fatalf("decode shared fixture %s: %v", path, err)
	}
}

func sharedNativeRuntimeFixturePath(t *testing.T, name string) string {
	t.Helper()
	_, file, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed")
	}
	repoRoot := filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", "..", "..", "..", ".."))
	return filepath.Join(repoRoot, "packages", "indexer", "indexer", "contracts", "fixtures", name)
}

func sameStrings(left []string, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}
