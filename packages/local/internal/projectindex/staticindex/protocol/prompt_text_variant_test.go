package protocol

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestPromptTextVariantsMarshalRustRequiredZeroAndNullFields(t *testing.T) {
	t.Parallel()

	sourceRange := PromptTextRange{}
	cases := []struct {
		name  string
		value any
		want  string
	}{
		{
			name: "heading zero level",
			value: PromptTextBlock{
				Kind: PromptTextBlockHeading, TextRange: &sourceRange,
			},
			want: `{
				"kind":"heading","index":0,"island":0,"level":0,
				"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},
				"textRange":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}}
			}`,
		},
		{
			name:  "blockquote empty markers",
			value: PromptTextBlock{Kind: PromptTextBlockBlockquote},
			want: `{
				"kind":"blockquote","index":0,"island":0,
				"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},
				"markerRanges":[]
			}`,
		},
		{
			name:  "unordered list without start",
			value: PromptTextBlock{Kind: PromptTextBlockList},
			want: `{
				"kind":"list","index":0,"island":0,
				"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},
				"ordered":false,"start":null
			}`,
		},
		{
			name: "unfenced code without info",
			value: PromptTextBlock{
				Kind: PromptTextBlockCode, ContentRange: &sourceRange,
			},
			want: `{
				"kind":"code-block","index":0,"island":0,
				"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},
				"contentRange":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},
				"fenced":false,"info":null
			}`,
		},
		{
			name: "inline link without title",
			value: PromptTextLink{
				Kind: PromptTextLinkInline, DestinationRange: &sourceRange,
			},
			want: `{
				"kind":"inline","index":0,"island":0,
				"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},
				"textRange":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},
				"destinationRange":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},
				"destination":"","title":null
			}`,
		},
		{
			name: "known value at first interpolation",
			value: PromptTextPreviewSegment{
				Kind: PromptTextPreviewKnownValue,
			},
			want: `{"kind":"known-value","text":"","interpolation":0}`,
		},
		{
			name: "empty fragment identity",
			value: PromptTextPreviewSegment{
				Kind: PromptTextPreviewFragment,
			},
			want: `{"kind":"fragment","text":"","fragmentId":"","sourceHash":""}`,
		},
		{
			name: "placeholder at first interpolation",
			value: PromptTextPreviewSegment{
				Kind: PromptTextPreviewPlaceholder,
			},
			want: `{"kind":"placeholder","text":"","interpolation":0}`,
		},
	}
	for _, testCase := range cases {
		testCase := testCase
		t.Run(testCase.name, func(t *testing.T) {
			t.Parallel()
			assertPromptTextJSONEqual(t, testCase.value, testCase.want)
		})
	}
}

func assertPromptTextJSONEqual(t *testing.T, value any, wantJSON string) {
	t.Helper()

	gotJSON, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal PromptText variant: %v", err)
	}
	var got, want any
	if err := json.Unmarshal(gotJSON, &got); err != nil {
		t.Fatalf("decode marshaled PromptText variant: %v", err)
	}
	if err := json.Unmarshal([]byte(wantJSON), &want); err != nil {
		t.Fatalf("decode expected PromptText variant: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("PromptText variant JSON = %s, want %s", gotJSON, wantJSON)
	}
}
