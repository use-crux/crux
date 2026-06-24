package projectindexer

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindexer/compiler"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticprotocol"
	"github.com/use-crux/crux/packages/local/internal/projectindexer/staticsource"
)

func TestSyntaxCompilerPoolUsesCommandWorker(t *testing.T) {
	pool := compiler.NewPool(2, shellPath(t), fakeNativeStaticCompilerWorker(t))
	defer pool.Close()

	identity := staticprotocol.SkeletonIdentity()
	prepare, err := pool.NativeStaticPrepare(context.Background(), staticprotocol.PrepareRequest{
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

	analyze, err := pool.NativeStaticAnalyzeStream(context.Background(), staticprotocol.AnalyzeRequest{
		ProtocolVersion: staticprotocol.Version,
		Method:          staticprotocol.AnalyzeMethod,
		Identity:        identity,
		Plan:            prepare.Plan,
		Files:           staticsource.AnalyzeFiles(prepare.Plan.CacheMisses),
	}, nil)
	if err != nil {
		t.Fatalf("NativeStaticAnalyzeStream error = %v", err)
	}

	finalize, err := pool.NativeStaticFinalize(context.Background(), staticprotocol.FinalizeRequest{
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
		t.Fatalf("finalize events = %d, want skeleton pool response", len(finalize.Events))
	}
}

var _ StaticCompiler = (*compiler.Pool)(nil)
