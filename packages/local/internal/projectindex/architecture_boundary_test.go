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
		{"projectindex/workers", "TypeScript worker hosting composition root"},
		{"projectindex/workers/source", "source/AST TypeScript worker phase client"},
		{"projectindex/workers/requestwire", "TypeScript worker request batching"},
		{"projectindex/workers/node", "Node worker process adapter"},
		{"projectindex/workers/runtime", "runtime indexing worker lane"},
		{"projectindex/workers/semantic", "semantic worker lane"},
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
		{"projectindex/eventwire", "Project Index worker event stream collector"},
		{"process/workerproc", "generic JSON-lines worker process package"},
		{"assets", "generated local runtime asset owner"},
	}
	for _, expected := range expectedPackages {
		if info, err := os.Stat(filepath.Join(internalDir, expected.path)); err != nil || !info.IsDir() {
			t.Fatalf("expected Project Index package %q to exist under internal/ (%s)", expected.path, expected.note)
		}
	}

	pendingTargets := []pendingInternalPackage{
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

	// Phase 4 retired the old worker hosting/wire package names. They must not
	// reappear as compatibility shims.
	movedPhase4Roots := []string{
		"projectindex/host",
		"projectindex/wire",
	}
	for _, packagePath := range movedPhase4Roots {
		if _, err := os.Stat(filepath.Join(internalDir, packagePath)); !os.IsNotExist(err) {
			t.Fatalf("old Phase 4 package %q must be moved under projectindex/workers or projectindex/eventwire without an alias", packagePath)
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
	case importPath == projectIndex+"model":
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
