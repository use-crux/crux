package host

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex/host/compiler"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
	"github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/sourceprofile"
)

func TestSyntaxCompilerPoolUsesCommandWorker(t *testing.T) {
	pool := compiler.NewPool(2, shellPath(t), fakeNativeStaticCompilerWorker(t))
	defer pool.Close()

	identity := protocol.SkeletonIdentity()
	prepare, err := pool.NativeStaticPrepare(context.Background(), protocol.PrepareRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.PrepareMethod,
		Root:            "/repo",
		ProjectName:     "native-static",
		Identity:        identity,
		Files: []protocol.SourceFile{
			{File: "/repo/src/cached.ts", SourceHash: "sha256:cached", CacheKey: "static:cached"},
			{File: "/repo/src/miss.ts", SourceHash: "sha256:miss"},
		},
	})
	if err != nil {
		t.Fatalf("NativeStaticPrepare error = %v", err)
	}

	analyze, err := pool.NativeStaticAnalyzeStream(context.Background(), protocol.AnalyzeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.AnalyzeMethod,
		Identity:        identity,
		Plan:            prepare.Plan,
		Files:           sourceprofile.AnalyzeFiles(prepare.Plan.CacheMisses),
	}, nil)
	if err != nil {
		t.Fatalf("NativeStaticAnalyzeStream error = %v", err)
	}

	finalize, err := pool.NativeStaticFinalize(context.Background(), protocol.FinalizeRequest{
		ProtocolVersion: protocol.Version,
		Method:          protocol.FinalizeMethod,
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

var _ StaticCompiler = (*compiler.Pool)(nil)
