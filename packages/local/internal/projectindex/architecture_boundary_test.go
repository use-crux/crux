package projectindex_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"testing"
)

type expectedInternalPackage struct {
	path string
	note string
}

func TestProjectIndexPackagesUseBoundedContextLayout(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not determine test file location")
	}

	projectIndexDir := filepath.Dir(filename)
	internalDir := filepath.Dir(projectIndexDir)

	expectedPackages := []expectedInternalPackage{
		{"projectindex/cache", "snapshot cache ownership moves here in Phase 2"},
		{"projectindex/host", "Project Index host boundary"},
		{"projectindex/host/client", "worker host client boundary"},
		{"projectindex/host/indexwire", "host wire request boundary"},
		{"projectindex/host/node", "Node-specific Project Index host wrapper"},
		{"projectindex/host/runtime", "runtime indexing host boundary"},
		{"projectindex/host/semantic", "semantic host boundary"},
		{"projectindex/model", "shared Project Index data model"},
		{"projectindex/readmodel", "derived Project Index read model"},
		{"projectindex/service", "runtime-facing Project Index service"},
		{"projectindex/staticindex/cache", "Static Index cache boundary"},
		{"projectindex/staticindex/client", "Static Index worker client boundary"},
		{"projectindex/staticindex/compat", "Static Index compatibility helpers"},
		{"projectindex/staticindex/planner", "Static Index source planning boundary"},
		{"projectindex/staticindex/planner/sourcegraph", "Static Index source graph planning"},
		{"projectindex/staticindex/protocol", "Static Index JSON contract mirror"},
		{"projectindex/staticindex/run", "Static Index execution result shaping"},
		{"projectindex/staticindex/run/evidence", "Static Index evidence conversion"},
		{"projectindex/staticindex/run/lint", "Static Index lint result shaping"},
		{"projectindex/staticindex/run/parity", "Static Index parity normalization"},
		{"projectindex/staticindex/run/patch", "Static Index patch projection"},
		{"projectindex/staticindex/session", "Static Index session orchestration boundary"},
		{"projectindex/staticindex/sourceprofile", "Static Index source profile boundary"},
		{"projectindex/staticindex/syntax", "Static Syntax worker boundary"},
		{"projectindex/staticindex/syntax/record", "Static Syntax record model"},
		{"projectindex/staticindex/syntax/stream", "Static Syntax stream decoder"},
		{"projectindex/wire", "Project Index worker event stream"},
		{"process/workerproc", "generic JSON-lines worker process package"},
		{"assets", "generated local runtime asset owner"},
	}
	for _, expected := range expectedPackages {
		if info, err := os.Stat(filepath.Join(internalDir, expected.path)); err != nil || !info.IsDir() {
			t.Fatalf("expected Project Index package %q to exist under internal/ (%s)", expected.path, expected.note)
		}
	}

	oldRoots := []string{
		"indexhost",
		filepath.Join("indexhost", "native"),
		"indexread",
		"indexservice",
		"localassets",
		"nodeworker",
		filepath.Join("process", "node"),
		filepath.Join("projectindex", "staticindex", "compiler"),
		"projectindexstore",
		"projectindexwire",
	}
	for _, packagePath := range oldRoots {
		if _, err := os.Stat(filepath.Join(internalDir, packagePath)); !os.IsNotExist(err) {
			t.Fatalf("old Project Index package root %q must be moved under internal/projectindex/", packagePath)
		}
	}
}

func TestServerAndDevtoolsDoNotImportStaticIndexInternals(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not determine test file location")
	}

	projectIndexDir := filepath.Dir(filename)
	internalDir := filepath.Dir(projectIndexDir)

	routeRoots := []string{
		filepath.Join(internalDir, "devtools"),
		filepath.Join(internalDir, "server"),
	}
	for _, routeRoot := range routeRoots {
		if err := filepath.WalkDir(routeRoot, func(path string, entry fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if entry.IsDir() || !strings.HasSuffix(path, ".go") {
				return nil
			}
			file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
			if err != nil {
				return err
			}
			for _, spec := range file.Imports {
				importPath, err := strconv.Unquote(spec.Path.Value)
				if err != nil {
					return err
				}
				if strings.HasPrefix(importPath, "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/") {
					rel, _ := filepath.Rel(internalDir, path)
					t.Fatalf("%s imports Static Index internals directly via %q; route/devtools code should use projectindex service/readmodel APIs", rel, importPath)
				}
			}
			return nil
		}); err != nil {
			t.Fatalf("scan route imports under %s: %v", routeRoot, err)
		}
	}
}

func TestProjectIndexCacheIdentityLivesInCachePackage(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not determine test file location")
	}

	projectIndexDir := filepath.Dir(filename)
	internalDir := filepath.Dir(projectIndexDir)
	cacheIdentity := filepath.Join(projectIndexDir, "cache", "identity.go")
	if info, err := os.Stat(cacheIdentity); err != nil || info.IsDir() {
		t.Fatalf("expected Project Index cache identity owner %q to be a file", cacheIdentity)
	}

	devtoolsIdentity := filepath.Join(internalDir, "devtools", "index_cache_identity.go")
	if _, err := os.Stat(devtoolsIdentity); !os.IsNotExist(err) {
		t.Fatalf("devtools must not own Project Index cache identity at %q", devtoolsIdentity)
	}
}
