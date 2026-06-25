package sourceprofile

import (
	"crypto/sha256"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/projectindex"
)

func TestProjectStaticIndexAnalyzeFilesUsePreparedSourceText(t *testing.T) {
	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	originalSource := "import { prompt } from '@crux/core'\nexport const writer = prompt({ id: 'original' })"
	if err := os.WriteFile(sourceFile, []byte(originalSource), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}

	input, err := FromPlan(projectindex.ProjectStaticSyntaxPlan{
		Root:  root,
		Files: []string{sourceFile},
	})
	if err != nil {
		t.Fatalf("FromPlan error = %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'changed' })"), 0o600); err != nil {
		t.Fatalf("mutate source: %v", err)
	}

	analyzeFiles, err := AnalyzeFilesWithSourceText(input.Files, input.SourceTextByFile)
	if err != nil {
		t.Fatalf("AnalyzeFilesWithSourceText error = %v", err)
	}
	if len(analyzeFiles) != 1 {
		t.Fatalf("analyze files = %d, want 1", len(analyzeFiles))
	}
	if analyzeFiles[0].SourceText != originalSource {
		t.Fatalf("source text = %q, want prepared source", analyzeFiles[0].SourceText)
	}
	wantHash := fmt.Sprintf("%x", sha256.Sum256([]byte(originalSource)))
	if analyzeFiles[0].SourceHash != wantHash {
		t.Fatalf("source hash = %q, want original hash %q", analyzeFiles[0].SourceHash, wantHash)
	}
}

func TestProjectStaticIndexSourceInputBuildsSemanticProfileFromPreparedSource(t *testing.T) {
	root := t.TempDir()
	sourceFile := filepath.Join(root, "src", "writer.ts")
	if err := os.MkdirAll(filepath.Dir(sourceFile), 0o755); err != nil {
		t.Fatalf("mkdir src: %v", err)
	}
	originalSource := "import { prompt } from '@crux/core'\nexport const writer = prompt({ id: 'original' })"
	if err := os.WriteFile(sourceFile, []byte(originalSource), 0o600); err != nil {
		t.Fatalf("write source: %v", err)
	}

	input, err := FromPlan(projectindex.ProjectStaticSyntaxPlan{
		Root:  root,
		Files: []string{sourceFile},
	})
	if err != nil {
		t.Fatalf("FromPlan error = %v", err)
	}
	if err := os.WriteFile(sourceFile, []byte("export const writer = prompt({ id: 'changed' })"), 0o600); err != nil {
		t.Fatalf("mutate source: %v", err)
	}

	profile := input.SemanticSourceProfile
	if profile == nil {
		t.Fatalf("semantic source profile was nil")
	}
	if len(profile.Files) != 1 {
		t.Fatalf("semantic profile files = %d, want 1", len(profile.Files))
	}
	wantHash := fmt.Sprintf("%x", sha256.Sum256([]byte(originalSource)))
	if profile.Files[0].File != sourceFile {
		t.Fatalf("semantic profile file = %q, want %q", profile.Files[0].File, sourceFile)
	}
	if profile.Files[0].SourceHash != wantHash {
		t.Fatalf("semantic profile hash = %q, want original hash %q", profile.Files[0].SourceHash, wantHash)
	}
	if profile.Files[0].SourceBytes != len(originalSource) {
		t.Fatalf("semantic profile source bytes = %d, want %d", profile.Files[0].SourceBytes, len(originalSource))
	}
	if profile.SourceBytes != len(originalSource) {
		t.Fatalf("semantic profile total bytes = %d, want %d", profile.SourceBytes, len(originalSource))
	}
	hints := profile.Files[0].Hints
	if hints == nil {
		t.Fatalf("semantic profile hints were nil")
	}
	if got, want := fmt.Sprint(hints.CruxCallNames), "[prompt]"; got != want {
		t.Fatalf("semantic profile call names = %s, want %s", got, want)
	}
	if hints.HasZodObject {
		t.Fatalf("semantic profile HasZodObject = true, want false")
	}
	if !hints.NativeDirectCruxCandidate {
		t.Fatalf("semantic profile NativeDirectCruxCandidate = false, want true")
	}
}

func TestProjectStaticIndexSourceInputUsesFilesToParse(t *testing.T) {
	root := t.TempDir()
	files := []string{
		fileWithStaticIndexSource(t, root, "src/primary.ts"),
		fileWithStaticIndexSource(t, root, "src/support.ts"),
	}

	input, err := FromPlan(projectindex.ProjectStaticSyntaxPlan{
		Root:         root,
		Files:        files,
		FilesToParse: files[1:],
	})
	if err != nil {
		t.Fatalf("FromPlan error = %v", err)
	}

	if len(input.Files) != 2 {
		t.Fatalf("prepared files = %d, want all selected files", len(input.Files))
	}
	if got, want := input.Files[0].File, files[0]; got != want {
		t.Fatalf("first prepared file = %q, want %q", got, want)
	}
	if _, ok := input.SourceTextByFile[files[0]]; ok {
		t.Fatalf("source text contained non-parse file %q", files[0])
	}
	if _, ok := input.SourceTextByFile[files[1]]; !ok {
		t.Fatalf("source text omitted parse file %q", files[1])
	}
}

func TestProjectStaticIndexSourceInputKeepsPrimaryFilesSeparateFromSupportFiles(t *testing.T) {
	root := t.TempDir()
	files := []string{
		fileWithStaticIndexSource(t, root, "src/primary.ts"),
		fileWithStaticIndexSource(t, root, "src/support.ts"),
	}

	input, err := FromPlan(projectindex.ProjectStaticSyntaxPlan{
		Root:         root,
		Files:        files,
		FilesToParse: files,
		CacheMisses:  files[:1],
	})
	if err != nil {
		t.Fatalf("FromPlan error = %v", err)
	}

	if len(input.Files) != 2 {
		t.Fatalf("prepared files = %d, want primary and support", len(input.Files))
	}
	if len(input.PrimaryFiles) != 1 {
		t.Fatalf("primary files = %d, want only cache miss", len(input.PrimaryFiles))
	}
	if got, want := input.PrimaryFiles[0].File, files[0]; got != want {
		t.Fatalf("primary file = %q, want %q", got, want)
	}
}

func fileWithStaticIndexSource(t testing.TB, root, name string) string {
	t.Helper()
	file := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		t.Fatalf("mkdir %s: %v", filepath.Dir(file), err)
	}
	if err := os.WriteFile(file, []byte("export const writer = prompt({ id: 'writer' })"), 0o600); err != nil {
		t.Fatalf("write %s: %v", file, err)
	}
	return file
}
