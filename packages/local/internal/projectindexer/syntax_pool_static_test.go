package projectindexer

import (
	"context"
	"encoding/json"
	"testing"
)

func TestSyntaxWorkerPoolNativeStaticCompilerUsesCommandWorker(t *testing.T) {
	pool := NewSyntaxWorkerPool(2, shellPath(t), fakeNativeStaticCompilerWorker(t))
	defer pool.Close()

	identity := projectNativeStaticSkeletonIdentity()
	prepare, err := pool.NativeStaticPrepare(context.Background(), projectNativeStaticPrepareRequest{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Method:          projectNativeStaticPrepareMethod,
		Root:            "/repo",
		ProjectName:     "native-static",
		Identity:        identity,
		Files: []projectNativeStaticSourceFile{
			{File: "/repo/src/cached.ts", SourceHash: "sha256:cached", CacheKey: "static:cached"},
			{File: "/repo/src/miss.ts", SourceHash: "sha256:miss"},
		},
	})
	if err != nil {
		t.Fatalf("NativeStaticPrepare error = %v", err)
	}

	analyze, err := pool.NativeStaticAnalyzeStream(context.Background(), projectNativeStaticAnalyzeRequest{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Method:          projectNativeStaticAnalyzeMethod,
		Identity:        identity,
		Plan:            prepare.Plan,
		Files:           projectNativeStaticAnalyzeFiles(prepare.Plan.CacheMisses),
	}, nil)
	if err != nil {
		t.Fatalf("NativeStaticAnalyzeStream error = %v", err)
	}

	finalize, err := pool.NativeStaticFinalize(context.Background(), projectNativeStaticFinalizeRequest{
		ProtocolVersion: projectNativeStaticProtocolVersion,
		Method:          projectNativeStaticFinalizeMethod,
		Identity:        identity,
		NativeFacts:     analyze.Facts,
		ExtensionFacts:  []json.RawMessage{},
	})
	if err != nil {
		t.Fatalf("NativeStaticFinalize error = %v", err)
	}
	if len(finalize.Events) != 0 {
		t.Fatalf("finalize events = %d, want skeleton pool response", len(finalize.Events))
	}
}

var _ StaticCompiler = (*SyntaxWorkerPool)(nil)
