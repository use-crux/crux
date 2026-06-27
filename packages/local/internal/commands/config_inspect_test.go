package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/output"
)

// loadedConfigFixture is an effective-config payload for a project that set a few
// quality values explicitly and left everything else at its default.
func loadedConfigFixture(root string) json.RawMessage {
	return json.RawMessage(`{
	  "root": "` + jsonEscape(root) + `",
	  "packageName": "@fixture/model",
	  "configFile": { "path": "` + jsonEscape(root) + `/crux.config.ts", "status": "loaded", "origin": "discovered" },
	  "quality": {
	    "id": { "value": "acme-backend", "origin": "config" },
	    "dir": { "value": "` + jsonEscape(root) + `/.crux/quality", "origin": "default" },
	    "include": { "values": ["evals/**/*.eval.ts", "**/*.eval.ts"], "origin": "default" },
	    "exclude": { "values": [], "origin": "default" },
	    "redact": { "values": ["customer.email"], "origin": "config" },
	    "trials": { "value": "3", "origin": "config" },
	    "concurrency": { "value": "5", "origin": "default" },
	    "timeoutMs": { "value": "60000", "origin": "default" },
	    "replay": { "value": "record-new", "origin": "config" }
	  },
	  "generation": {
	    "autoEscape": { "value": "true", "origin": "default" },
	    "securityWarnings": { "value": "true", "origin": "default" },
	    "tokenizer": { "value": "set", "origin": "set" },
	    "middleware": { "value": "none", "origin": "none" }
	  },
	  "indexer": {
	    "trust": { "value": "first-party-only", "origin": "default" },
	    "extensions": { "values": [], "origin": "default" }
	  },
	  "experimental": {
	    "indexer": {
	      "native": { "value": "true", "origin": "config" },
	      "nativeAst": { "value": "false", "origin": "default" },
	      "nativeEngine": { "value": "tsgo", "origin": "config" },
	      "tsserverPath": { "value": "` + jsonEscape(root) + `/bin/tsgo", "origin": "config" }
	    }
	  },
	  "observability": {
	    "enabled": { "value": "true", "origin": "default" },
	    "serverUrl": { "value": "none", "origin": "none" },
	    "token": { "value": "none", "origin": "none" },
	    "transport": { "value": "none", "origin": "none" }
	  },
	  "devtools": {
	    "serverUrl": { "value": "none", "origin": "none" },
	    "bridge": { "value": "none", "origin": "none" }
	  },
	  "persistence": { "store": { "value": "set", "origin": "set" } },
	  "lint": {
	    "profile": { "value": "strict", "origin": "config" },
	    "rules": { "value": "2", "origin": "config" }
	  },
	  "plugins": { "values": ["@acme/tracer"], "origin": "config" },
	  "discovered": { "definitions": 12, "relations": 7, "evaluations": 3, "definitionKinds": { "prompt": 5, "tool": 4 } },
	  "diagnostics": [
	    { "severity": "info", "code": "project_model.missing_stable_id", "message": "router uses a fallback id." }
	  ]
	}`)
}

func TestConfigInspectJSONPrintsEffectiveConfig(t *testing.T) {
	oldResolver := resolveProjectConfigForInspect
	defer func() { resolveProjectConfigForInspect = oldResolver }()

	root := t.TempDir()
	resolveProjectConfigForInspect = func(_ context.Context, gotRoot, configPath, projectName string) (json.RawMessage, error) {
		if gotRoot != root {
			t.Fatalf("root = %q, want %q", gotRoot, root)
		}
		if configPath != "" {
			t.Fatalf("configPath = %q, want empty", configPath)
		}
		return loadedConfigFixture(root), nil
	}

	cmd := NewConfigCmd(&cli.Factory{})
	var out, errOut strings.Builder
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
	if _, ok := decoded["quality"].(map[string]any); !ok {
		t.Fatalf("quality domain missing from JSON: %#v", decoded["quality"])
	}
	if _, ok := decoded["generation"].(map[string]any); !ok {
		t.Fatalf("generation domain missing from JSON: %#v", decoded["generation"])
	}
	if _, ok := decoded["experimental"].(map[string]any); !ok {
		t.Fatalf("experimental domain missing from JSON: %#v", decoded["experimental"])
	}
	if strings.Contains(out.String(), "\x1b[") {
		t.Fatalf("JSON output contains ANSI styling: %q", out.String())
	}
}

func TestConfigInspectHumanRendersEveryConfigDomain(t *testing.T) {
	root := t.TempDir()

	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	if err := printConfigInspect(io, loadedConfigFixture(root)); err != nil {
		t.Fatalf("printConfigInspect error: %v", err)
	}

	text := out.String()
	if strings.Contains(text, "\x1b") {
		t.Fatalf("colorless config inspect output contained an ANSI escape:\n%q", text)
	}
	for _, want := range []string{
		"◇ crux config inspect",
		// Project + config file (root-relative path, located by discovery).
		"Project", "root", root, "package", "@fixture/model", "(package.json)",
		"Config file", "file", "crux.config.ts", "(discovered)", "status", "✓ loaded",
		// quality: mirrors the QualityConfig interface; explicit vs default tags.
		"quality:",
		"id", "acme-backend", "(config)",
		"dir", ".crux/quality", "(default)",
		"include", "evals/**/*.eval.ts",
		"redact", "customer.email",
		"trials", "3",
		"replay", "record-new",
		// Every other config() domain is represented.
		"generation:", "autoEscape", "securityWarnings", "tokenizer", "middleware",
		"indexer:", "trust", "first-party-only", "extensions",
		"experimental:", "indexer.native", "true", "indexer.nativeAst", "false", "indexer.nativeEngine", "tsgo", "indexer.tsserverPath", "bin/tsgo",
		"observability:", "enabled", "serverUrl", "token", "transport",
		"devtools:", "bridge",
		"persistence:", "store",
		"lint:", "profile", "strict", "rules",
		"plugins:", "@acme/tracer",
		// Compact discovery summary + diagnostics.
		"Discovered", "definitions", "relations", "evaluations",
		"Diagnostics  1", "info", "project_model.missing_stable_id",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("human output missing %q:\n%s", want, text)
		}
	}

	// Explicit values must be tagged as config, defaults as default.
	if !strings.Contains(text, "acme-backend  (config)") {
		t.Fatalf("explicit quality.id was not tagged (config):\n%s", text)
	}
	if !strings.Contains(text, "first-party-only  (default)") {
		t.Fatalf("default indexer.trust was not tagged (default):\n%s", text)
	}
	// Paths normalize: the absolute root prefix never leaks into the dir value.
	if strings.Contains(text, root+"/.crux/quality") {
		t.Fatalf("quality.dir was not normalized relative to root:\n%s", text)
	}
}

func TestConfigInspectHumanZeroConfigReadsAsDefaults(t *testing.T) {
	raw := json.RawMessage(`{
	  "root": "/tmp/project",
	  "configFile": { "status": "missing", "origin": "none" },
	  "quality": {
	    "id": { "value": "none", "origin": "none" },
	    "dir": { "value": "/tmp/project/.crux/quality", "origin": "default" },
	    "include": { "values": ["evals/**/*.eval.ts", "**/*.eval.ts"], "origin": "default" },
	    "exclude": { "values": [], "origin": "default" },
	    "redact": { "values": [], "origin": "default" },
	    "trials": { "value": "1", "origin": "default" },
	    "concurrency": { "value": "5", "origin": "default" },
	    "timeoutMs": { "value": "60000", "origin": "default" },
	    "replay": { "value": "live", "origin": "default" }
	  },
	  "generation": {
	    "autoEscape": { "value": "true", "origin": "default" },
	    "securityWarnings": { "value": "true", "origin": "default" },
	    "tokenizer": { "value": "none", "origin": "none" },
	    "middleware": { "value": "none", "origin": "none" }
	  },
	  "indexer": { "trust": { "value": "first-party-only", "origin": "default" }, "extensions": { "values": [], "origin": "default" } },
	  "experimental": { "indexer": { "native": { "value": "false", "origin": "default" }, "nativeAst": { "value": "false", "origin": "default" }, "nativeEngine": { "value": "none", "origin": "none" }, "tsserverPath": { "value": "none", "origin": "none" } } },
	  "observability": { "enabled": { "value": "true", "origin": "default" }, "serverUrl": { "value": "none", "origin": "none" }, "token": { "value": "none", "origin": "none" }, "transport": { "value": "none", "origin": "none" } },
	  "devtools": { "serverUrl": { "value": "none", "origin": "none" }, "bridge": { "value": "none", "origin": "none" } },
	  "persistence": { "store": { "value": "none", "origin": "none" } },
	  "lint": { "profile": { "value": "recommended", "origin": "default" }, "rules": { "value": "0", "origin": "default" } },
	  "plugins": { "values": [], "origin": "default" },
	  "discovered": { "definitions": 0, "relations": 0, "evaluations": 0, "definitionKinds": {} },
	  "diagnostics": []
	}`)

	var out, errBuf bytes.Buffer
	io := output.NewTestIO(&out, &errBuf, output.TestIOOptions{ColorEnabled: false})
	if err := printConfigInspect(io, raw); err != nil {
		t.Fatalf("printConfigInspect error: %v", err)
	}

	text := out.String()
	if strings.Contains(text, "\x1b") {
		t.Fatalf("colorless config inspect output contained an ANSI escape:\n%q", text)
	}
	for _, want := range []string{
		"◇ crux config inspect",
		"Config file", "status", "✗ missing",
		"dir", ".crux/quality", "(default)",
		"replay", "live", "(default)",
		"experimental:", "indexer.native", "false", "(default)", "indexer.nativeAst", "false", "indexer.nativeEngine", "none", "indexer.tsserverPath", "none",
		"lint:", "recommended", "(default)",
		"Diagnostics  0", "✓ none",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("zero-config inspect missing %q:\n%s", want, text)
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
