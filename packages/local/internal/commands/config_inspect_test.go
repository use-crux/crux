package commands

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
)

func TestConfigInspectJSONPrintsResolvedProjectModel(t *testing.T) {
	oldResolver := resolveProjectModelForConfigInspect
	defer func() { resolveProjectModelForConfigInspect = oldResolver }()

	root := t.TempDir()
	resolveProjectModelForConfigInspect = func(_ context.Context, gotRoot string, configPath string, projectName string) (json.RawMessage, error) {
		if gotRoot != root {
			t.Fatalf("root = %q, want %q", gotRoot, root)
		}
		if configPath != "" {
			t.Fatalf("configPath = %q, want empty", configPath)
		}
		if projectName != "" {
			t.Fatalf("projectName = %q, want empty", projectName)
		}
		return json.RawMessage(`{
		  "root": { "value": "` + jsonEscape(root) + `", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "resolved project root" } },
		  "configFiles": [],
		  "sourceRoots": [],
		  "ignoredPaths": [],
		  "definitions": [],
		  "quality": {
		    "persistenceRoot": { "value": "` + jsonEscape(root) + `/.crux/quality", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "default quality persistence root" } },
		    "includeGlobs": [],
		    "excludeGlobs": [],
		    "evaluationFiles": []
		  },
		  "diagnostics": [
		    {
		      "id": "diagnostic:project-model:dynamic-tools",
		      "code": "project_model.dynamic_tool_map_unproven",
		      "severity": "info",
		      "message": "Tool map is runtime-dependent.",
		      "provenance": { "kind": "source", "file": "` + jsonEscape(root) + `/src/tools.ts" }
		    }
		  ]
		}`), nil
	}

	cmd := NewConfigCmd(&cli.Factory{})
	var out strings.Builder
	var errOut strings.Builder
	cmd.SetOut(&out)
	cmd.SetErr(&errOut)
	cmd.SetArgs([]string{"inspect", "--json", "--cwd", root})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("config inspect --json error: %v\nstderr:\n%s", err, errOut.String())
	}

	var decoded map[string]any
	if err := json.Unmarshal([]byte(out.String()), &decoded); err != nil {
		t.Fatalf("decode JSON: %v\n%s", err, out.String())
	}
	if _, ok := decoded["root"].(map[string]any); !ok {
		t.Fatalf("root field missing from JSON: %#v", decoded["root"])
	}
	diagnostics, ok := decoded["diagnostics"].([]any)
	if !ok || len(diagnostics) != 1 {
		t.Fatalf("diagnostics missing from JSON: %#v", decoded["diagnostics"])
	}
	diagnostic, ok := diagnostics[0].(map[string]any)
	if !ok {
		t.Fatalf("diagnostic is not an object: %#v", diagnostics[0])
	}
	if diagnostic["code"] != "project_model.dynamic_tool_map_unproven" {
		t.Fatalf("diagnostic code = %#v", diagnostic["code"])
	}
	provenance, ok := diagnostic["provenance"].(map[string]any)
	if !ok || provenance["kind"] != "source" {
		t.Fatalf("diagnostic provenance missing from JSON: %#v", diagnostic["provenance"])
	}
	if strings.Contains(out.String(), "\x1b[") {
		t.Fatalf("JSON output contains ANSI styling: %q", out.String())
	}
}

func TestConfigInspectHumanOutputSummarizesProjectModel(t *testing.T) {
	oldResolver := resolveProjectModelForConfigInspect
	defer func() { resolveProjectModelForConfigInspect = oldResolver }()

	root := t.TempDir()
	resolveProjectModelForConfigInspect = func(_ context.Context, gotRoot string, configPath string, projectName string) (json.RawMessage, error) {
		if gotRoot != root {
			t.Fatalf("root = %q, want %q", gotRoot, root)
		}
		return json.RawMessage(`{
		  "root": { "value": "` + jsonEscape(root) + `", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "resolved project root" } },
		  "packageName": { "value": "@fixture/model", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `/package.json", "convention": "package.json name" } },
		  "configFiles": [
		    { "path": { "value": "` + jsonEscape(root) + `/crux.config.ts", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "crux config search" } }, "status": { "value": "missing", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "crux config search" } } }
		  ],
		  "sourceRoots": [
		    { "value": "` + jsonEscape(root) + `", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "project source root" } }
		  ],
		  "ignoredPaths": [
		    { "value": "**/node_modules/**", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "default ignored path" } }
		  ],
		  "definitions": [
		    { "id": "prompt:writer", "kind": "prompt", "visibility": { "value": "inferred", "provenance": { "kind": "source", "file": "` + jsonEscape(root) + `/src/writer.ts" } } },
		    { "id": "evaluation:writer-eval", "kind": "evaluation", "visibility": { "value": "inferred", "provenance": { "kind": "source", "file": "` + jsonEscape(root) + `/evals/writer.eval.ts" } } }
		  ],
		  "relations": [
		    { "id": "relation:prompt.uses_context:prompt:writer:context:brand", "type": "prompt.uses_context", "from": "prompt:writer", "to": "context:brand", "visibility": { "value": "inferred", "provenance": { "kind": "source", "file": "` + jsonEscape(root) + `/src/writer.ts" } } }
		  ],
		  "quality": {
		    "id": { "value": "@fixture/model", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `/package.json", "convention": "package.json name" } },
		    "persistenceRoot": { "value": "` + jsonEscape(root) + `/.crux/quality", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "default quality persistence root" } },
		    "includeGlobs": [
		      { "value": "evals/**/*.eval.ts", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "default quality include" } },
		      { "value": "**/*.eval.ts", "provenance": { "kind": "filesystem", "path": "` + jsonEscape(root) + `", "convention": "default quality include" } }
		    ],
		    "excludeGlobs": [],
		    "evaluationFiles": [
		      { "value": "` + jsonEscape(root) + `/evals/writer.eval.ts", "provenance": { "kind": "source", "file": "` + jsonEscape(root) + `/evals/writer.eval.ts" } }
		    ]
		  },
		  "diagnostics": [
		    { "id": "diagnostic:project-model:source-only", "code": "project_model.source_only_discovery", "severity": "info", "message": "Source discovery only." }
		  ]
		}`), nil
	}

	cmd := NewConfigCmd(&cli.Factory{})
	var out strings.Builder
	var errOut strings.Builder
	cmd.SetOut(&out)
	cmd.SetErr(&errOut)
	cmd.SetArgs([]string{"inspect", "--cwd", root})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("config inspect error: %v\nstderr:\n%s", err, errOut.String())
	}

	text := out.String()
	for _, want := range []string{
		"Project Model",
		"root: " + root,
		"package: @fixture/model",
		"config: missing",
		"source roots: " + root,
		"ignored paths: **/node_modules/**",
		"definitions: evaluation=1, prompt=1",
		"relations: prompt.uses_context=1",
		"visibility: inferred=2",
		"quality: id=@fixture/model, persistence=" + root + "/.crux/quality, includes=2, eval files=1",
		"diagnostics:",
		"info project_model.source_only_discovery - Source discovery only.",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("human output missing %q:\n%s", want, text)
		}
	}
}

func jsonEscape(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return strings.Trim(string(encoded), `"`)
}
