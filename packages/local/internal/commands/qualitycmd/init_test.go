package qualitycmd

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/cli"
)

func TestQualityCommandRegistersAdoptionCommands(t *testing.T) {
	cmd := New(&cli.Factory{})
	foundInit := false
	foundImport := false
	for _, child := range cmd.Commands() {
		if child.Name() == "init" {
			foundInit = true
			if child.Flags().Lookup("force") == nil {
				t.Fatal("quality init is missing --force")
			}
		}
		if child.Name() == "import-traces" {
			foundImport = true
			if child.Flags().Lookup("definition") == nil {
				t.Fatal("quality import-traces is missing --definition")
			}
		}
	}
	if !foundInit {
		t.Fatal("quality command did not register init")
	}
	if !foundImport {
		t.Fatal("quality command did not register import-traces")
	}
}

func TestQualityInitImportPathUsesRelativeCwdWithAbsoluteSource(t *testing.T) {
	cwd := filepath.Join("packages", "local-workers", "lib", "__fixtures__", "quality-project")
	sourceFile, err := filepath.Abs(filepath.Join(cwd, "crux.config.ts"))
	if err != nil {
		t.Fatal(err)
	}
	projectDir, err := qualityInitProjectDir(cwd, sourceFile)
	if err != nil {
		t.Fatal(err)
	}
	relProjectDir, err := filepath.Rel(mustGetwd(t), projectDir)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.ToSlash(relProjectDir) != filepath.ToSlash(cwd) {
		t.Fatalf("projectDir = %q, want cwd %q", relProjectDir, cwd)
	}
	importPath := qualityInitImportPath(filepath.Join(projectDir, "evals"), sourceFile)
	if importPath != "../crux.config" {
		t.Fatalf("import path = %q", importPath)
	}
}

func mustGetwd(t *testing.T) string {
	t.Helper()
	wd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	return wd
}

func TestRenderQualityInitEvalScaffoldsRunnableStarter(t *testing.T) {
	source, err := renderQualityInitEval(qualityInitTemplateData{
		EvalID:         "prompt.fixture.greeter",
		ImportPath:     "../crux.config",
		ImportName:     "greeter",
		TaskExpression: "greeter",
		DefinitionID:   "prompt:fixture.greeter",
		SampleInput:    `{"q":"hi"}`,
	})
	if err != nil {
		t.Fatalf("renderQualityInitEval error: %v", err)
	}

	for _, want := range []string{
		"import { evaluate, scorers } from '@use-crux/core/quality'",
		"import { greeter } from '../crux.config'",
		"export default evaluate('prompt.fixture.greeter', {",
		"task: greeter,",
		"covers: ['prompt:fixture.greeter'],",
		"{ name: 'first trace-backed case', input: {\"q\":\"hi\"} },",
		"crux quality run prompt.fixture.greeter",
	} {
		if !strings.Contains(source, want) {
			t.Fatalf("scaffold missing %q:\n%s", want, source)
		}
	}
}
