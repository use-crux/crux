package observability

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestRetainedSourceCategoryCanonicalizesDataURLs(t *testing.T) {
	preview := json.RawMessage(`{"content":[
		{"type":"image","source":"data:image/png;base64,SECRET","mediaType":"image/png"},
		{"kind":"image","mediaType":"image/png","sourceCategory":"data-url"},
		{"kind":"file","sourceCategory":"arbitrary-locator"}
	]}`)

	got, changed := sanitizedArtifactPreview(preview)
	if !changed {
		t.Fatal("expected source-category normalization to change preview")
	}
	text := string(got)
	if strings.Contains(text, `"data-url"`) {
		t.Fatalf("retained data-url alias: %s", text)
	}
	if strings.Contains(text, "arbitrary-locator") {
		t.Fatalf("passed through arbitrary sourceCategory: %s", text)
	}
	if !strings.Contains(text, `"sourceCategory":"data"`) {
		t.Fatalf("expected data URL to project as data: %s", text)
	}
	if !strings.Contains(text, `"sourceCategory":"unknown"`) {
		t.Fatalf("expected malformed category to become unknown: %s", text)
	}
	if strings.Contains(text, "SECRET") || strings.Contains(text, "base64") {
		t.Fatalf("leaked media payload: %s", text)
	}
}

func TestRetainedMediaDescriptorAudioVideoParity(t *testing.T) {
	preview := json.RawMessage(`{"content":[
		{"type":"audio","source":"data:audio/wav;base64,SECRET_AUDIO","mediaType":"audio/wav","filename":"SECRET.wav","url":"https://example.com/SECRET_AUDIO"},
		{"kind":"audio","mediaType":"audio/mpeg","sourceCategory":"data-url","ref":"asset://SECRET_AUDIO_REF"},
		{"type":"video","source":"https://cdn.example/SECRET_VIDEO.mp4?token=SECRET","mediaType":"video/mp4","fileId":"SECRET_FILE"},
		{"kind":"video","mediaType":"video/webm","sourceCategory":"arbitrary-locator","uri":"s3://bucket/SECRET"}
	]}`)

	got, changed := sanitizedArtifactPreview(preview)
	if !changed {
		t.Fatal("expected audio/video retention sanitization to change preview")
	}
	text := string(got)

	for _, secret := range []string{
		"SECRET_AUDIO",
		"SECRET.wav",
		"SECRET_AUDIO_REF",
		"SECRET_VIDEO",
		"SECRET_FILE",
		"token=SECRET",
		"s3://bucket/SECRET",
		"base64",
		`"data-url"`,
		"arbitrary-locator",
	} {
		if strings.Contains(text, secret) {
			t.Fatalf("audio/video retention leaked %q: %s", secret, text)
		}
	}

	if !strings.Contains(text, `"kind":"audio"`) {
		t.Fatalf("expected audio descriptors retained: %s", text)
	}
	if !strings.Contains(text, `"kind":"video"`) {
		t.Fatalf("expected video descriptors retained: %s", text)
	}
	if !strings.Contains(text, `"sourceCategory":"data"`) {
		t.Fatalf("expected audio data-url to project as data: %s", text)
	}
	if !strings.Contains(text, `"sourceCategory":"unknown"`) {
		t.Fatalf("expected video arbitrary category to become unknown: %s", text)
	}
	if !strings.Contains(text, `"sourceCategory":"url"`) {
		t.Fatalf("expected video URL source to project as url: %s", text)
	}
	// Forbidden locator keys must be stripped from reconstructed descriptors.
	// Match key tokens only so sourceCategory values like "url" do not false-positive.
	for _, forbidden := range []string{
		`"source":`,
		`"filename":`,
		`"url":`,
		`"ref":`,
		`"fileId":`,
		`"uri":`,
	} {
		if strings.Contains(text, forbidden) {
			t.Fatalf("retained forbidden locator field %s: %s", forbidden, text)
		}
	}
}

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
