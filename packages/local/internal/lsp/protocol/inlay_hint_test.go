package protocol

import (
	"encoding/json"
	"testing"
)

func TestInlayHintWireShape(t *testing.T) {
	t.Parallel()

	hint := InlayHint{
		Position: Position{Line: 4, Character: 17},
		Label:    "⚑ 2 findings",
		Tooltip: &MarkupContent{
			Kind: MarkupKindMarkdown, Value: "**Writer** — prompt",
		},
		PaddingLeft: true,
	}
	encoded, err := json.Marshal(hint)
	if err != nil {
		t.Fatal(err)
	}
	want := `{"position":{"line":4,"character":17},"label":"⚑ 2 findings","tooltip":{"kind":"markdown","value":"**Writer** — prompt"},"paddingLeft":true}`
	if string(encoded) != want {
		t.Fatalf("inlay hint = %s, want %s", encoded, want)
	}
}

func TestInlayRefreshCapabilitiesDecodeIndependently(t *testing.T) {
	t.Parallel()

	var capabilities ClientCapabilities
	if err := json.Unmarshal([]byte(`{
		"workspace":{
			"inlayHint":{"refreshSupport":true},
			"codeLens":{"refreshSupport":false}
		}
	}`), &capabilities); err != nil {
		t.Fatal(err)
	}
	if capabilities.Workspace == nil || capabilities.Workspace.InlayHint == nil ||
		!capabilities.Workspace.InlayHint.RefreshSupport {
		t.Fatalf("inlay refresh capability = %#v", capabilities.Workspace)
	}
	if capabilities.Workspace.CodeLens == nil || capabilities.Workspace.CodeLens.RefreshSupport {
		t.Fatalf("code lens refresh capability = %#v", capabilities.Workspace)
	}
}
