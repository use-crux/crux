package completion

import (
	"context"
	"encoding/json"
	"reflect"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestServicePinsIdentityAndBuildsDeterministicCompilerQuery(t *testing.T) {
	column := 7
	compiler := &recordingCompleter{response: staticprotocol.CompletionResponse{
		Items: []staticprotocol.CompletionItem{{ID: "prompt:writer", Label: "writer"}},
	}}
	service := New(compiler)
	request := Request{
		File: "/repo/src/agent.ts", DocumentVersion: 17, LanguageID: "typescript",
		Text: "agent({ prompt: wr", Position: staticprotocol.CompletionPosition{Character: 18}, Limit: MaxItems + 20,
	}
	result, err := service.Complete(context.Background(), View{
		ProjectRoot: "/repo", Generation: 9,
		Definitions: []api.ProjectDefinition{
			completionDefinition("prompt:zeta", "zeta", "zeta", "src/zeta.ts", 4, &column),
			completionDefinition("prompt:default", "defaultPrompt", "default", "src/default.ts", 1, nil),
			completionDefinition("prompt:writer", "writer", "writer", "src/writer.ts", 2, nil),
		},
	}, request)
	if err != nil {
		t.Fatal(err)
	}
	if result.DocumentVersion != 17 || result.Generation != 9 || len(result.Items) != 1 {
		t.Fatalf("result = %+v, want V17/G9 and one item", result)
	}
	want := []staticprotocol.CompletionCandidate{
		{ID: "prompt:writer", Kind: "prompt", Name: "writer", Binding: "writer", File: "/repo/src/writer.ts", Line: 2},
		{ID: "prompt:zeta", Kind: "prompt", Name: "zeta", Binding: "zeta", File: "/repo/src/zeta.ts", Line: 4, Character: 7},
	}
	if !reflect.DeepEqual(compiler.query.Candidates, want) {
		t.Fatalf("candidates = %+v, want %+v", compiler.query.Candidates, want)
	}
	if compiler.query.Limit != MaxItems || compiler.query.Source != request.Text {
		t.Fatalf("query = %+v, want bounded limit and exact transient source", compiler.query)
	}
}

func TestServiceDefaultsNonPositiveLimitToMaximum(t *testing.T) {
	compiler := &recordingCompleter{}
	_, err := New(compiler).Complete(context.Background(), View{Generation: 1}, Request{
		File: "agent.ts", LanguageID: "typescript", Limit: -1,
	})
	if err != nil {
		t.Fatal(err)
	}
	if compiler.query.Limit != MaxItems {
		t.Fatalf("limit = %d, want %d", compiler.query.Limit, MaxItems)
	}
}

func TestServiceRequiresDirectExportProofOnlyForCrossFileCandidates(t *testing.T) {
	compiler := &recordingCompleter{}
	_, err := New(compiler).Complete(context.Background(), View{
		ProjectRoot: "/repo",
		Generation:  1,
		Definitions: []api.ProjectDefinition{
			completionDefinitionWithExportProof(
				"prompt:local",
				"local",
				"local",
				"src/agent.ts",
				1,
				false,
			),
			completionDefinitionWithExportProof(
				"prompt:unproven",
				"unproven",
				"unproven",
				"src/unproven.ts",
				2,
				false,
			),
			completionDefinitionWithExportProof(
				"prompt:exported",
				"exported",
				"exported",
				"src/exported.ts",
				3,
				true,
			),
		},
	}, Request{
		File: "/repo/src/agent.ts", LanguageID: "typescript",
	})
	if err != nil {
		t.Fatal(err)
	}
	want := []staticprotocol.CompletionCandidate{
		{
			ID: "prompt:local", Kind: "prompt", Name: "local", Binding: "local",
			File: "/repo/src/agent.ts", Line: 1,
		},
		{
			ID: "prompt:exported", Kind: "prompt", Name: "exported", Binding: "exported",
			File: "/repo/src/exported.ts", Line: 3,
		},
	}
	if !reflect.DeepEqual(compiler.query.Candidates, want) {
		t.Fatalf("candidates = %+v, want %+v", compiler.query.Candidates, want)
	}
}

func completionDefinition(id, name, exportName, file string, line int, column *int) api.ProjectDefinition {
	definition := completionDefinitionWithExportProof(id, name, exportName, file, line, true)
	definition.Source.Column = column
	return definition
}

func completionDefinitionWithExportProof(
	id string,
	name string,
	exportName string,
	file string,
	line int,
	exported bool,
) api.ProjectDefinition {
	metadata, _ := json.Marshal(map[string]any{
		"exportName": exportName,
		"exported":   exported,
	})
	return api.ProjectDefinition{
		ID: id, Kind: "prompt", Name: name, Metadata: metadata,
		Source: &api.SourceLoc{File: file, Line: line},
	}
}

type recordingCompleter struct {
	query    staticprotocol.CompletionQuery
	response staticprotocol.CompletionResponse
	err      error
}

func (c *recordingCompleter) Completion(_ context.Context, query staticprotocol.CompletionQuery) (staticprotocol.CompletionResponse, error) {
	c.query = query
	return c.response, c.err
}
