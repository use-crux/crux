package prompttext

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"sync"
	"testing"

	"github.com/use-crux/crux/packages/local/internal/api"
	"github.com/use-crux/crux/packages/local/internal/lsp/protocol"
	"github.com/use-crux/crux/packages/local/internal/lsp/readmodel"
	"github.com/use-crux/crux/packages/local/internal/lsp/transient"
	"github.com/use-crux/crux/packages/local/internal/projectindex/sourcehash"
	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

type editorConformanceFixture struct {
	Version string `json:"version"`
	Query   struct {
		File       string                          `json:"file"`
		LanguageID string                          `json:"languageId"`
		SourceHash string                          `json:"sourceHash"`
		Limits     staticprotocol.PromptTextLimits `json:"limits"`
	} `json:"query"`
	Analysis     readmodel.PromptTextResult `json:"analysis"`
	Semantic     json.RawMessage            `json:"semantic"`
	Views        editorConformanceViews     `json:"views"`
	SemanticData editorConformanceSemantic  `json:"-"`
	Source       string                     `json:"-"`
	Path         string                     `json:"-"`
}

type editorConformanceSemantic struct {
	DefinitionID string                `json:"definitionId"`
	SourceRef    api.ProjectSourceRef  `json:"sourceRef"`
	Diagnostics  []api.IndexDiagnostic `json:"diagnostics"`
}

type editorConformanceViews struct {
	Decorations     []protocol.PromptTextDecoration `json:"decorations"`
	Folding         []protocol.FoldingRange         `json:"folding"`
	Symbols         []protocol.DocumentSymbol       `json:"symbols"`
	Links           []protocol.DocumentLink         `json:"links"`
	PreviewText     string                          `json:"previewText"`
	PreviewEvidence string                          `json:"previewEvidence"`
}

func TestSharedEditorConformanceAnalysisFeedsEveryDerivedView(t *testing.T) {
	t.Parallel()

	fixture := readEditorConformanceFixture(t)
	revision := transient.NewRevision(1, 1, fixture.Source)
	if revision.SourceHash != fixture.Query.SourceHash ||
		fixture.Analysis.Revision != revision {
		t.Fatalf(
			"fixture identity = %q / %#v, source revision = %#v",
			fixture.Query.SourceHash,
			fixture.Analysis.Revision,
			revision,
		)
	}
	document := transient.Document{
		URI:        protocol.DocumentURI("file://" + fixture.Query.File),
		LanguageID: fixture.Query.LanguageID,
		Version:    1,
		Text:       fixture.Source,
		Revision:   revision,
	}
	owner := fixture.Analysis.Templates[1]
	sourceRef := conformanceOwnerSourceRef(
		t, fixture.Source, fixture.Query.File, owner, fixture.SemanticData.SourceRef,
	)
	analyzer := &sharedFoldingSource{
		started: make(chan struct{}),
		release: make(chan struct{}),
		result:  fixture.Analysis,
	}
	controller := NewController(&fixedDocumentSource{document: document})
	request := Request{
		URI: document.URI, File: fixture.Query.File, Root: "/repo",
		ScopeID: "/repo", SourceEpoch: 1, Analyzer: analyzer,
		Views: conformanceViewProvider(
			document, fixture.Query.File, fixture.SemanticData.DefinitionID,
			sourceRef, fixture.SemanticData.Diagnostics,
		),
	}

	var (
		decorations Result
		folding     FoldingResult
		symbols     SymbolResult
		links       LinkResult
		preview     PreviewResult
		diagnostics DiagnosticResult
		wait        sync.WaitGroup
	)
	wait.Add(6)
	go func() {
		defer wait.Done()
		decorations = controller.Decorations(context.Background(), request)
	}()
	go func() {
		defer wait.Done()
		folding = controller.Folding(context.Background(), request)
	}()
	go func() {
		defer wait.Done()
		symbols = controller.Symbols(context.Background(), request)
	}()
	go func() {
		defer wait.Done()
		links = controller.Links(context.Background(), request)
	}()
	go func() {
		defer wait.Done()
		preview = controller.StaticPreview(context.Background(), request, PreviewTarget{
			Kind: PreviewTargetTemplateRange, Range: editorRange(owner.Range),
		})
	}()
	go func() {
		defer wait.Done()
		diagnostics = controller.Diagnostics(context.Background(), request)
	}()
	<-analyzer.started
	close(analyzer.release)
	wait.Wait()

	if analyzer.callCount() != 1 {
		t.Fatalf("analysis calls = %d, want one shared identity", analyzer.callCount())
	}
	assertConformanceDecorations(t, fixture.Source, decorations)
	if folding.Revision != revision || len(folding.Ranges) == 0 {
		t.Fatalf("folding = %#v, want current nonempty lexical ranges", folding)
	}
	if symbols.Revision != revision ||
		!symbolLabelsEqual(symbols.Symbols, []string{"Héllo team 😀", "Combining é"}) {
		t.Fatalf("symbols = %#v, want Rust labels from the owner", symbols)
	}
	if links.Revision != revision || len(links.Links) != 1 ||
		links.Links[0].Target != "https://example.com/docs" {
		t.Fatalf("links = %#v, want only the canonical owner link", links)
	}
	if preview.Revision != revision || preview.Kind != PreviewResultReady ||
		preview.Selection.Range != editorRange(owner.Range) ||
		preview.Text != owner.Preview.Text {
		t.Fatalf("preview = %#v, want exact shared analysis bytes", preview)
	}
	assertConformanceDiagnosticsAndActions(
		t, controller, request, diagnostics, fixture.SemanticData.Diagnostics,
	)
	gotViews := editorConformanceViews{
		Decorations:     decorations.Decorations,
		Folding:         folding.Ranges,
		Symbols:         symbols.Symbols,
		Links:           links.Links,
		PreviewText:     preview.Text,
		PreviewEvidence: string(preview.Evidence),
	}
	if os.Getenv("CRUX_UPDATE_PROMPT_TEXT_CONFORMANCE") != "" {
		fixture.Views = gotViews
		encoded, err := json.MarshalIndent(fixture, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		encoded = append(encoded, '\n')
		if err := os.WriteFile(fixture.Path, encoded, 0o644); err != nil {
			t.Fatal(err)
		}
		return
	}
	if !reflect.DeepEqual(gotViews, fixture.Views) {
		t.Fatalf("derived views = %#v, fixture = %#v", gotViews, fixture.Views)
	}
}

func readEditorConformanceFixture(t testing.TB) editorConformanceFixture {
	t.Helper()
	_, current, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("resolve conformance fixture caller")
	}
	root := filepath.Clean(filepath.Join(
		filepath.Dir(current),
		"../../../../indexer/__tests__/fixtures",
	))
	source, err := os.ReadFile(filepath.Join(root, "prompt-text-editor-conformance-v1.ts"))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(root, "prompt-text-editor-conformance-v1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var fixture editorConformanceFixture
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&fixture); err != nil {
		t.Fatal(err)
	}
	semanticDecoder := json.NewDecoder(bytes.NewReader(fixture.Semantic))
	semanticDecoder.DisallowUnknownFields()
	if err := semanticDecoder.Decode(&fixture.SemanticData); err != nil {
		t.Fatal(err)
	}
	fixture.Source = string(source)
	fixture.Path = filepath.Join(root, "prompt-text-editor-conformance-v1.json")
	if fixture.Version != "crux-prompt-text-editor-conformance-v1" ||
		fixture.SemanticData.DefinitionID == "" ||
		sourcehash.Sum(source) != fixture.Query.SourceHash {
		t.Fatalf("invalid conformance fixture identity: %#v", fixture.Query)
	}
	return fixture
}

func assertConformanceDecorations(t *testing.T, source string, result Result) {
	t.Helper()
	roles := make(map[DecorationRole]bool)
	for _, decoration := range result.Decorations {
		roles[decoration.Role] = true
	}
	for _, role := range []DecorationRole{
		DecorationRoleHeading,
		DecorationRoleStrong,
		DecorationRoleBlockquote,
		DecorationRoleEmphasis,
		DecorationRoleList,
		DecorationRoleLink,
		DecorationRoleCode,
	} {
		if !roles[role] {
			t.Fatalf("decorations omit %q: %#v", role, result.Decorations)
		}
	}
	for _, decoration := range result.Decorations {
		if conformanceTextAtRange(t, source, decoration.Range) == "Not canonical" {
			t.Fatalf("impostor decoration escaped semantic filtering: %#v", decoration)
		}
	}
}

func conformanceTextAtRange(t *testing.T, source string, value protocol.Range) string {
	t.Helper()
	_, start, ok := sourcePosition(
		source,
		int(value.Start.Line)+1,
		int(value.Start.Character)+1,
	)
	if !ok {
		t.Fatal("resolve range start")
	}
	_, end, ok := sourcePosition(
		source,
		int(value.End.Line)+1,
		int(value.End.Character)+1,
	)
	if !ok {
		t.Fatal("resolve range end")
	}
	return source[start:end]
}

func symbolLabelsEqual(
	symbols []protocol.DocumentSymbol,
	expected []string,
) bool {
	if len(symbols) != len(expected) {
		return false
	}
	for index := range symbols {
		if symbols[index].Name != expected[index] {
			return false
		}
	}
	return true
}
