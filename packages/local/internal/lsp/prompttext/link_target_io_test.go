package prompttext

import (
	"net/url"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestPromptTextDocumentLinkGuaranteesLexicalNotPhysicalContainment(t *testing.T) {
	t.Parallel()

	if runtime.GOOS == "windows" {
		t.Skip("symlink creation requires additional Windows privileges")
	}
	root := t.TempDir()
	outside := t.TempDir()
	sourceDirectory := filepath.Join(root, "src")
	if err := os.MkdirAll(sourceDirectory, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(sourceDirectory, "linked")); err != nil {
		t.Fatal(err)
	}

	target, ok := resolveLinkTarget(
		"linked/nonexistent.md",
		filepath.Join(sourceDirectory, "writer.ts"),
		root,
	)
	if !ok {
		t.Fatal("lexically contained path was rejected because of physical state")
	}
	want := (&url.URL{
		Scheme: "file",
		Path: filepath.ToSlash(
			filepath.Join(sourceDirectory, "linked", "nonexistent.md"),
		),
	}).String()
	if string(target) != want {
		t.Fatalf("target = %q, want lexical target %q", target, want)
	}
}

func TestPromptTextDocumentLinkWindowsFileURIUsesNoStringConcatenation(t *testing.T) {
	t.Parallel()

	target, ok := localFileTargetURI(
		`C:\repo\src\guide name.md`,
		"usage notes",
	)
	const want = "file:///C:/repo/src/guide%20name.md#usage%20notes"
	if !ok || string(target) != want {
		t.Fatalf("target = (%q, %t), want (%q, true)", target, ok, want)
	}
}
