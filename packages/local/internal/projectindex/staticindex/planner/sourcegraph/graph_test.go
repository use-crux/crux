package sourcegraph

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestMarshalDiscoversWorkspaceShardsAndReferences(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "package.json"), `{"name":"root","workspaces":["packages/*"]}`)
	writeFile(t, filepath.Join(root, "tsconfig.json"), `{"references":[{"path":"packages/app"}]}`)
	writeFile(t, filepath.Join(root, "packages", "app", "package.json"), `{"name":"app"}`)
	writeFile(t, filepath.Join(root, "packages", "app", "tsconfig.json"), `{"references":[{"path":"../lib"}]}`)
	writeFile(t, filepath.Join(root, "packages", "lib", "package.json"), `{"name":"lib"}`)
	writeFile(t, filepath.Join(root, "packages", "lib", "tsconfig.json"), `{}`)

	data, err := Marshal(root)
	if err != nil {
		t.Fatalf("Marshal error = %v", err)
	}
	var got graph
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("decode graph: %v", err)
	}

	shards := shardsByID(got.Shards)
	for _, id := range []string{".", "packages/app", "packages/lib"} {
		if _, ok := shards[id]; !ok {
			t.Fatalf("missing shard %q in %+v", id, got.Shards)
		}
	}
	if shards["packages/app"].Name != "app" {
		t.Fatalf("app shard name = %q, want app", shards["packages/app"].Name)
	}
	if !contains(shards["."].References, "packages/app") {
		t.Fatalf("root references = %v, want packages/app", shards["."].References)
	}
	if !contains(shards["packages/app"].References, "packages/lib") {
		t.Fatalf("app references = %v, want packages/lib", shards["packages/app"].References)
	}
}

func TestMarshalReadsPnpmWorkspacePatterns(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "pnpm-workspace.yaml"), "packages:\n  - 'apps/*'\n")
	writeFile(t, filepath.Join(root, "apps", "docs", "package.json"), `{"name":"docs"}`)

	data, err := Marshal(root)
	if err != nil {
		t.Fatalf("Marshal error = %v", err)
	}
	var got graph
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatalf("decode graph: %v", err)
	}
	if _, ok := shardsByID(got.Shards)["apps/docs"]; !ok {
		t.Fatalf("shards = %+v, want apps/docs from pnpm workspace", got.Shards)
	}
}

func writeFile(t *testing.T, path string, data string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(path), err)
	}
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func shardsByID(shards []shard) map[string]shard {
	out := map[string]shard{}
	for _, shard := range shards {
		out[shard.ID] = shard
	}
	return out
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
