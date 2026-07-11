package observability

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestSanitizedArtifactPreviewBoundsMalformedNestedMedia(t *testing.T) {
	items := make([]string, 0, mediaSanitizeMaxArrayItems+1)
	for index := 0; index <= mediaSanitizeMaxArrayItems; index++ {
		items = append(items, `{"kind":"image","sourceCategory":"bytes","width":-1,"fileId":"SECRET_ID"}`)
	}
	preview := json.RawMessage(`{"items":[` + strings.Join(items, ",") + `],"sentinel":"[Circular]","deep":{"a":{"b":{"c":{"d":{"e":{"f":{"g":{"secret":"data:image/png;base64,SECRET"}}}}}}}}}`)

	got, changed := sanitizedArtifactPreview(preview)
	if !changed {
		t.Fatal("expected malformed media preview to change")
	}
	text := string(got)
	for _, secret := range []string{"SECRET_ID", "data:image", "base64,SECRET"} {
		if strings.Contains(text, secret) {
			t.Fatalf("sanitized preview leaked %q: %s", secret, text)
		}
	}
	if !strings.Contains(text, `"[Truncated]"`) || !strings.Contains(text, `"sentinel":"[Circular]"`) {
		t.Fatalf("sanitized preview did not preserve sentinels and bounds: %s", text)
	}
}
