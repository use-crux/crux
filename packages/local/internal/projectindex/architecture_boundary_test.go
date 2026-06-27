package projectindex_test

import (
	"go/ast"
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

type pendingInternalPackage struct {
	current string
	target  string
	phase   int
	note    string
}

func TestProjectIndexArchitecturePackagesUseBoundedContextLayout(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not determine test file location")
	}

	projectIndexDir := filepath.Dir(filename)
	internalDir := filepath.Dir(projectIndexDir)

	expectedPackages := []expectedInternalPackage{
		{"projectindex/cache", "snapshot cache ownership moves here in Phase 2"},
		{"projectindex/host", "current TypeScript worker host boundary until Phase 4 moves it to projectindex/workers"},
		{"projectindex/host/client", "current worker host client boundary until Phase 4 splits focused worker lanes"},
		{"projectindex/host/indexwire", "current TypeScript worker request boundary until Phase 4 moves it to workers/requestwire"},
		{"projectindex/host/node", "current Node-specific worker wrapper until Phase 4 moves it to workers/node"},
		{"projectindex/host/runtime", "current runtime indexing host boundary until Phase 4 moves it to workers/runtime"},
		{"projectindex/host/semantic", "current semantic host boundary until Phase 4 moves it to workers/semantic"},
		{"projectindex/model", "shared Project Index data model"},
		{"projectindex/readmodel", "derived Project Index read model"},
		{"projectindex/service", "runtime-facing Project Index service"},
		{"projectindex/staticindex/cache", "Static Index cache boundary"},
		{"projectindex/staticindex/client", "current Static Index compiler client boundary until Phase 6 moves it to staticindex/compiler"},
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
		{"projectindex/staticindex/syntax", "current Static Syntax frontend boundary until Phase 6 moves it to staticindex/frontend"},
		{"projectindex/staticindex/syntax/record", "current Static Syntax record model until Phase 6 moves it under staticindex/frontend"},
		{"projectindex/staticindex/syntax/stream", "current Static Syntax stream decoder until Phase 6 moves it under staticindex/frontend"},
		{"projectindex/wire", "current Project Index worker event stream until Phase 4 moves it to projectindex/eventwire"},
		{"process/workerproc", "generic JSON-lines worker process package"},
		{"assets", "generated local runtime asset owner"},
	}
	for _, expected := range expectedPackages {
		if info, err := os.Stat(filepath.Join(internalDir, expected.path)); err != nil || !info.IsDir() {
			t.Fatalf("expected Project Index package %q to exist under internal/ (%s)", expected.path, expected.note)
		}
	}

	pendingTargets := []pendingInternalPackage{
		{"projectindex/wire", "projectindex/eventwire", 4, "Project Index worker event stream"},
		{"projectindex/host", "projectindex/workers", 4, "TypeScript worker hosting composition root"},
		{"projectindex/host/indexwire", "projectindex/workers/requestwire", 4, "TypeScript worker request batching"},
		{"projectindex/host/client", "projectindex/workers/source", 4, "source worker lane"},
		{"projectindex/host/semantic", "projectindex/workers/semantic", 4, "semantic worker lane"},
		{"projectindex/host/runtime", "projectindex/workers/runtime", 4, "runtime worker lane"},
		{"projectindex/host/node", "projectindex/workers/node", 4, "Node worker adapter"},
		{"projectindex/staticindex/syntax", "projectindex/staticindex/frontend", 6, "Static Syntax frontend process adapter"},
		{"projectindex/staticindex/client", "projectindex/staticindex/compiler", 6, "Rust Static Index compiler client"},
	}
	for _, pending := range pendingTargets {
		if info, err := os.Stat(filepath.Join(internalDir, pending.current)); err != nil || !info.IsDir() {
			t.Fatalf("current package %q must remain explicit until Phase %d moves it to %q (%s)", pending.current, pending.phase, pending.target, pending.note)
		}
		if _, err := os.Stat(filepath.Join(internalDir, pending.target)); !os.IsNotExist(err) {
			t.Fatalf("target package %q exists before Phase %d updates this pending inventory (%s)", pending.target, pending.phase, pending.note)
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
		"projectindexstore",
		"projectindexwire",
	}
	for _, packagePath := range oldRoots {
		if _, err := os.Stat(filepath.Join(internalDir, packagePath)); !os.IsNotExist(err) {
			t.Fatalf("old Project Index package root %q must be moved under internal/projectindex/", packagePath)
		}
	}
}

func TestProjectIndexArchitectureRootDoesNotAliasCacheOwnership(t *testing.T) {
	_, filename, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("could not determine test file location")
	}

	projectIndexDir := filepath.Dir(filename)
	deprecatedAliasFile := filepath.Join(projectIndexDir, "store_aliases.go")
	if _, err := os.Stat(deprecatedAliasFile); !os.IsNotExist(err) {
		t.Fatalf("Project Index cache aliases must live under projectindex/cache, not root shim %q", deprecatedAliasFile)
	}

	forbidden := map[string]string{
		"Cache":                   "cache.Cache",
		"FactStore":               "cache.FactStore",
		"SQLiteIndexFactStore":    "cache.SQLiteIndexFactStore",
		"NewCache":                "cache.NewCache",
		"NewSQLiteIndexFactStore": "cache.NewSQLiteIndexFactStore",
		"HasPatchFacts":           "cache.HasPatchFacts",
	}
	forEachProjectIndexRootObject(t, projectIndexDir, func(path string, name string) {
		if owner, ok := forbidden[name]; ok {
			rel, _ := filepath.Rel(projectIndexDir, path)
			t.Fatalf("root projectindex package re-exports %s in %s; import %s directly instead", name, rel, owner)
		}
	})
}

func TestProjectIndexArchitectureServerAndDevtoolsDoNotImportProjectIndexInternals(t *testing.T) {
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
				if forbiddenRouteProjectIndexImport(importPath, strings.HasSuffix(path, "_test.go")) {
					rel, _ := filepath.Rel(internalDir, path)
					t.Fatalf("%s imports Project Index internals directly via %q; route/devtools code should use projectindex service/readmodel APIs", rel, importPath)
				}
			}
			return nil
		}); err != nil {
			t.Fatalf("scan route imports under %s: %v", routeRoot, err)
		}
	}
}

func forbiddenRouteProjectIndexImport(importPath string, testFile bool) bool {
	const projectIndex = "github.com/use-crux/crux/packages/local/internal/projectindex/"
	if strings.HasPrefix(importPath, projectIndex+"staticindex/") {
		return true
	}
	if testFile {
		return false
	}
	switch {
	case importPath == projectIndex+"cache":
		return true
	case importPath == projectIndex+"eventwire":
		return true
	case importPath == projectIndex+"host" || strings.HasPrefix(importPath, projectIndex+"host/"):
		return true
	case importPath == projectIndex+"model":
		return true
	case importPath == projectIndex+"wire":
		return true
	case importPath == projectIndex+"workers" || strings.HasPrefix(importPath, projectIndex+"workers/"):
		return true
	default:
		return false
	}
}

func forEachProjectIndexRootObject(t *testing.T, projectIndexDir string, visit func(path string, name string)) {
	t.Helper()
	entries, err := os.ReadDir(projectIndexDir)
	if err != nil {
		t.Fatalf("read projectindex package: %v", err)
	}

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".go") || strings.HasSuffix(entry.Name(), "_test.go") {
			continue
		}
		path := filepath.Join(projectIndexDir, entry.Name())
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.SkipObjectResolution)
		if err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		for _, decl := range file.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok {
				continue
			}
			for _, spec := range gen.Specs {
				switch spec := spec.(type) {
				case *ast.TypeSpec:
					visit(path, spec.Name.Name)
				case *ast.ValueSpec:
					for _, name := range spec.Names {
						visit(path, name.Name)
					}
				}
			}
		}
	}
}

func TestProjectIndexArchitectureCacheIdentityLivesInCachePackage(t *testing.T) {
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
