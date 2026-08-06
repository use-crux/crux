package commands

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
	"github.com/use-crux/crux/packages/local/internal/output"
	"github.com/use-crux/crux/packages/local/internal/store"
)

// loadedConfigFixture is a representative effective-config payload.
func loadedConfigFixture(root string) json.RawMessage {
	return json.RawMessage(`{
	  "root": "` + jsonEscape(root) + `",
	  "packageName": "@fixture/model",
	  "configFile": { "path": "` + jsonEscape(root) + `/crux.config.ts", "status": "loaded", "origin": "discovered" },
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
	  "discovered": { "definitions": 12, "relations": 7, "evals": 3, "definitionKinds": { "prompt": 5, "tool": 4 } },
	  "diagnostics": [
	    { "severity": "info", "code": "project_model.missing_stable_id", "message": "router uses a fallback id." }
	  ]
	}`)
}

func TestConfigInspectJSONPrintsEffectiveConfig(t *testing.T) {
	oldResolver := resolveProjectConfigForInspect
	defer func() { resolveProjectConfigForInspect = oldResolver }()

	root := t.TempDir()
	resolveProjectConfigForInspect = func(_ context.Context, gotRoot, configPath, projectName string, _ commandWorkerProcess) (json.RawMessage, error) {
		if gotRoot != root {
			t.Fatalf("root = %q, want %q", gotRoot, root)
		}
		if configPath != "" {
			t.Fatalf("configPath = %q, want empty", configPath)
		}
		return loadedConfigFixture(root), nil
	}

	var out, errOut strings.Builder
	streams := output.NewTestIO(&out, &errOut, output.TestIOOptions{StderrTTY: true})
	cmd := NewConfigCmd(cli.NewFactoryWithStreams(streams))
	cmd.SetArgs([]string{"inspect", "--json", "--cwd", root})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("config inspect --json error: %v\nstderr:\n%s", err, errOut.String())
	}

	var decoded map[string]any
	if err := json.Unmarshal([]byte(out.String()), &decoded); err != nil {
		t.Fatalf("decode JSON: %v\n%s", err, out.String())
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
	if errOut.Len() != 0 {
		t.Fatalf("JSON config inspect wrote spinner frames to stderr: %q", errOut.String())
	}
}

func TestConfigInspectMissingCWDIsUsageError(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "missing")
	var out, errOut strings.Builder
	cmd := NewConfigCmd(cli.NewFactoryWithStreams(
		output.NewTestIO(&out, &errOut, output.TestIOOptions{StderrTTY: true}),
	))
	cmd.SetArgs([]string{"inspect", "--cwd", missing})

	err := cmd.Execute()
	var exitErr domain.ExitError
	if !errors.As(err, &exitErr) || exitErr.Code != 2 {
		t.Fatalf("error = %T %v, want usage exit 2", err, err)
	}
	if out.Len() != 0 {
		t.Fatalf("stdout = %q, want empty", out.String())
	}
	if !strings.Contains(errOut.String(), `--cwd path "`+missing+`" does not exist`) {
		t.Fatalf("stderr = %q, want missing path", errOut.String())
	}
	if strings.Contains(errOut.String(), "\r") || strings.Contains(errOut.String(), "\x1b[") {
		t.Fatalf("stderr contains spinner frames: %q", errOut.String())
	}
}

func TestConfigInspectDefaultRootStopsAtNearestPackageBoundary(t *testing.T) {
	workspace := t.TempDir()
	if err := os.WriteFile(filepath.Join(workspace, "crux.config.ts"), []byte("export default {}"), 0o600); err != nil {
		t.Fatal(err)
	}
	project := filepath.Join(workspace, "packages", "demo")
	nested := filepath.Join(project, "src")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "package.json"), []byte(`{"name":"demo"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Chdir(nested)

	root, err := resolveConfigInspectRoot("")
	if err != nil {
		t.Fatal(err)
	}
	if root != project {
		t.Fatalf("default root = %q, want nearest package %q", root, project)
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
		// Every other config() domain is represented.
		"generation:", "autoEscape", "securityWarnings", "tokenizer", "middleware",
		"indexer:", "trust", "first-party-only", "extensions",
		"experimental:", "indexer.native", "true", "indexer.nativeEngine", "tsgo", "indexer.tsserverPath", "bin/tsgo",
		"observability:", "enabled", "serverUrl", "token", "transport",
		"devtools:", "bridge",
		"persistence:", "store",
		"lint:", "profile", "strict", "rules",
		"plugins:", "@acme/tracer",
		// The scoped config model is explicitly distinguished from the full Index.
		"Project Index discovery", "definitions", "relations", "Evals",
		"config imports only; Project Index counts unavailable (discovery was not run)",
		"Diagnostics  1", "info", "project_model.missing_stable_id",
	} {
		if !strings.Contains(text, want) {
			t.Fatalf("human output missing %q:\n%s", want, text)
		}
	}

	// Explicit values must be tagged as config, defaults as default.
	if !strings.Contains(text, "first-party-only  (default)") {
		t.Fatalf("default indexer.trust was not tagged (default):\n%s", text)
	}
}

func TestMergeConfigDiscoveryReplacesCountsAndExplainsSource(t *testing.T) {
	raw, err := mergeConfigDiscovery(loadedConfigFixture(t.TempDir()), store.IndexData{
		Definitions: []store.ProjectDefinition{
			{ID: "prompt:a", Kind: "prompt"},
			{ID: "eval:a", Kind: "eval"},
		},
		Relations: []store.ProjectRelation{{ID: "relation:a"}},
	}, "live Project Index", nil)
	if err != nil {
		t.Fatal(err)
	}
	var model configInspect
	if err := json.Unmarshal(raw, &model); err != nil {
		t.Fatal(err)
	}
	if model.Discovered.Definitions != 2 || model.Discovered.Relations != 1 || model.Discovered.Evals != 1 {
		t.Fatalf("discovery counts = %#v", model.Discovered)
	}
	if scope := configDiscoveryScope(model.Diagnostics); scope != "Project Index counts from live Project Index." {
		t.Fatalf("scope = %q", scope)
	}
}

func TestMergeConfigDiscoveryMakesUnavailableCountsExplicit(t *testing.T) {
	raw, err := mergeConfigDiscovery(loadedConfigFixture(t.TempDir()), store.IndexData{}, "", errors.New("compiler unavailable"))
	if err != nil {
		t.Fatal(err)
	}
	var model configInspect
	if err := json.Unmarshal(raw, &model); err != nil {
		t.Fatal(err)
	}
	if scope := configDiscoveryScope(model.Diagnostics); !strings.Contains(scope, "counts unavailable: compiler unavailable") {
		t.Fatalf("scope = %q", scope)
	}
}

func TestConfigInspectPipedStderrDoesNotAnimateWhenColorIsForced(t *testing.T) {
	if os.Getenv("CRUX_CONFIG_PIPE_HELPER") == "1" {
		streams := output.NewIO(false)
		oldResolver := resolveProjectConfigForInspect
		resolveProjectConfigForInspect = func(context.Context, string, string, string, commandWorkerProcess) (json.RawMessage, error) {
			time.Sleep(2 * configSpinnerInterval)
			return loadedConfigFixture("/tmp/project"), nil
		}
		defer func() { resolveProjectConfigForInspect = oldResolver }()
		_, err := resolveProjectConfigWithProgress(context.Background(), streams, "/tmp/project", "", "", commandWorkerProcess{})
		if err != nil {
			fmt.Fprintln(os.Stderr, err)
			os.Exit(1)
		}
		return
	}

	cmd := exec.Command(os.Args[0], "-test.run=^TestConfigInspectPipedStderrDoesNotAnimateWhenColorIsForced$")
	cmd.Env = append(os.Environ(), "CRUX_CONFIG_PIPE_HELPER=1", "CLICOLOR_FORCE=1", "NO_COLOR=")
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		t.Fatalf("helper failed: %v\nstderr:\n%s", err, stderr.String())
	}
	if stderr.Len() != 0 {
		t.Fatalf("piped stderr received spinner frames: %q", stderr.String())
	}
}

func TestConfigInspectHumanZeroConfigReadsAsDefaults(t *testing.T) {
	raw := json.RawMessage(`{
	  "root": "/tmp/project",
	  "configFile": { "status": "missing", "origin": "none" },
	  "generation": {
	    "autoEscape": { "value": "true", "origin": "default" },
	    "securityWarnings": { "value": "true", "origin": "default" },
	    "tokenizer": { "value": "none", "origin": "none" },
	    "middleware": { "value": "none", "origin": "none" }
	  },
	  "indexer": { "trust": { "value": "first-party-only", "origin": "default" }, "extensions": { "values": [], "origin": "default" } },
	  "experimental": { "indexer": { "native": { "value": "false", "origin": "default" }, "nativeEngine": { "value": "none", "origin": "none" }, "tsserverPath": { "value": "none", "origin": "none" } } },
	  "observability": { "enabled": { "value": "true", "origin": "default" }, "serverUrl": { "value": "none", "origin": "none" }, "token": { "value": "none", "origin": "none" }, "transport": { "value": "none", "origin": "none" } },
	  "devtools": { "serverUrl": { "value": "none", "origin": "none" }, "bridge": { "value": "none", "origin": "none" } },
	  "persistence": { "store": { "value": "none", "origin": "none" } },
	  "lint": { "profile": { "value": "recommended", "origin": "default" }, "rules": { "value": "0", "origin": "default" } },
	  "plugins": { "values": [], "origin": "default" },
	  "discovered": { "definitions": 0, "relations": 0, "evals": 0, "definitionKinds": {} },
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
		"experimental:", "indexer.native", "false", "(default)", "indexer.nativeEngine", "none", "indexer.tsserverPath", "none",
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
