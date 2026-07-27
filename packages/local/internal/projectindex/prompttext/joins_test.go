package prompttext

import (
	"reflect"
	"strings"
	"testing"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestCanonicalizePreviewEvidenceSortsJoinsAndHashesEveryField(t *testing.T) {
	t.Parallel()

	firstFragment := fragment("first", "md`First`")
	secondFragment := fragment("second", "md`Second`")
	first := fragmentJoin("first", 0)
	second := fragmentJoin("second", 1)
	fragments := []Fragment{secondFragment, firstFragment}

	_, got, leftDigest, err := canonicalizeEvidenceForTest(
		fragments,
		[]FragmentJoin{second, first},
		DefaultLimits(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, []FragmentJoin{first, second}) {
		t.Fatalf("canonical joins = %#v, want source-key order", got)
	}
	_, _, rightDigest, err := canonicalizeEvidenceForTest(
		[]Fragment{firstFragment, secondFragment},
		[]FragmentJoin{first, second},
		DefaultLimits(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if leftDigest != rightDigest {
		t.Fatal("preview-evidence digest depends on caller ordering")
	}

	fragmentMap := map[string]Fragment{
		firstFragment.ID: firstFragment, secondFragment.ID: secondFragment,
	}
	_, baselineRecord, err := encodeJoin(
		first,
		first.Key.File,
		first.Key.SourceHash,
		fragmentMap,
	)
	if err != nil {
		t.Fatal(err)
	}
	mutations := map[string]func(*FragmentJoin){
		"file": func(value *FragmentJoin) {
			value.Key.File = "/repo/src/other.ts"
		},
		"source hash": func(value *FragmentJoin) {
			value.Key.SourceHash = strings.Repeat("d", 64)
		},
		"template start line": func(value *FragmentJoin) {
			value.Key.TemplateRange.Start.Line--
		},
		"template start character": func(value *FragmentJoin) {
			value.Key.TemplateRange.Start.Character++
		},
		"template end line": func(value *FragmentJoin) {
			value.Key.TemplateRange.End.Line++
		},
		"template end character": func(value *FragmentJoin) {
			value.Key.TemplateRange.End.Character--
		},
		"interpolation": func(value *FragmentJoin) {
			value.Key.Interpolation++
		},
		"expression start line": func(value *FragmentJoin) {
			value.Key.ExpressionRange.Start.Line--
		},
		"expression start character": func(value *FragmentJoin) {
			value.Key.ExpressionRange.Start.Character++
		},
		"expression end line": func(value *FragmentJoin) {
			value.Key.ExpressionRange.End.Line++
		},
		"expression end character": func(value *FragmentJoin) {
			value.Key.ExpressionRange.End.Character--
		},
		"fragment ID": func(value *FragmentJoin) {
			value.FragmentID = "second"
		},
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			changed := first
			mutate(&changed)
			_, record, err := encodeJoin(
				changed,
				changed.Key.File,
				changed.Key.SourceHash,
				fragmentMap,
			)
			if err != nil {
				t.Fatal(err)
			}
			if reflect.DeepEqual(record, baselineRecord) {
				t.Fatalf("%s mutation did not change the encoded join", name)
			}
		})
	}
}

func TestCanonicalizePreviewEvidenceRejectsInvalidJoins(t *testing.T) {
	t.Parallel()

	target := fragment("target", "md`Target`")
	valid := fragmentJoin("target", 0)
	duplicate := valid
	invalidRange := valid
	invalidRange.Key.ExpressionRange.End = invalidRange.Key.TemplateRange.End
	invalidRange.Key.ExpressionRange.End.Character++
	invalidProof := valid
	invalidProof.Proof = "syntax-exact"
	dangling := valid
	dangling.FragmentID = "missing"
	unknownOwner := valid
	unknownOwner.Key.File = "/repo/src/other.ts"
	unknownOwner.Key.SourceHash = strings.Repeat("d", 64)

	for name, joins := range map[string][]FragmentJoin{
		"duplicate key":      {valid, duplicate},
		"noncontained range": {invalidRange},
		"invalid proof":      {invalidProof},
		"dangling target":    {dangling},
		"unknown owner":      {unknownOwner},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, _, err := canonicalizeEvidenceForTest(
				[]Fragment{target},
				joins,
				DefaultLimits(),
			); err == nil {
				t.Fatal("invalid fragment join was accepted")
			}
		})
	}
}

func TestCanonicalizePreviewEvidenceBoundsCombinedRecords(t *testing.T) {
	t.Parallel()

	target := fragment("target", "md`Target`")
	join := fragmentJoin("target", 0)
	fragmentRecord, err := encodeFragment(target)
	if err != nil {
		t.Fatal(err)
	}
	_, joinRecord, err := encodeJoin(
		join,
		"/repo/src/writer.ts",
		strings.Repeat("c", 64),
		map[string]Fragment{target.ID: target},
	)
	if err != nil {
		t.Fatal(err)
	}
	exact := DefaultLimits()
	exact.MaxFragmentBytes = uint32(len(fragmentRecord) + len(joinRecord))
	if _, _, _, err := canonicalizeEvidenceForTest(
		[]Fragment{target},
		[]FragmentJoin{join},
		exact,
	); err != nil {
		t.Fatalf("exact combined evidence budget rejected: %v", err)
	}
	exact.MaxFragmentBytes--
	if _, _, _, err := canonicalizeEvidenceForTest(
		[]Fragment{target},
		[]FragmentJoin{join},
		exact,
	); err == nil {
		t.Fatal("one-byte combined evidence overflow succeeded")
	}
}

func fragmentJoin(fragmentID string, interpolation uint32) FragmentJoin {
	return FragmentJoin{
		Key: staticprotocol.PromptTextInterpolationJoinKey{
			File:       "/repo/src/writer.ts",
			SourceHash: strings.Repeat("c", 64),
			TemplateRange: staticprotocol.PromptTextRange{
				Start: staticprotocol.PromptTextPosition{Line: 1, Character: 2},
				End:   staticprotocol.PromptTextPosition{Line: 3, Character: 20},
			},
			Interpolation: interpolation,
			ExpressionRange: staticprotocol.PromptTextRange{
				Start: staticprotocol.PromptTextPosition{Line: 2, Character: 10},
				End:   staticprotocol.PromptTextPosition{Line: 2, Character: 15},
			},
		},
		FragmentID: fragmentID,
		Proof:      staticprotocol.PromptTextProofSemanticExact,
	}
}
