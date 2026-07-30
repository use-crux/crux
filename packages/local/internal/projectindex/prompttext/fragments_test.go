package prompttext

import (
	"encoding/hex"
	"reflect"
	"strings"
	"testing"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestCanonicalizePreviewEvidenceUsesTheNamedEmptyDigest(t *testing.T) {
	t.Parallel()

	fragments, joins, digest, err := CanonicalizePreviewEvidence(
		"/repo/src/writer.ts",
		strings.Repeat("c", 64),
		nil,
		nil,
		DefaultLimits(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if fragments == nil || len(fragments) != 0 {
		t.Fatalf("canonical fragments = %#v, want non-nil empty", fragments)
	}
	if joins == nil || len(joins) != 0 {
		t.Fatalf("canonical joins = %#v, want non-nil empty", joins)
	}
	const want = "6e6550df1ee9835c362c9f846fc0327d5cec77c9c0dea2f7768c8aa550679895"
	if got := hex.EncodeToString(digest[:]); got != want {
		t.Fatalf("empty preview-evidence digest = %s, want %s", got, want)
	}
}

func TestCanonicalizeFragmentsSortsTheExactWorkerVector(t *testing.T) {
	t.Parallel()

	second := fragment("second", "z")
	first := fragment("first", "a")
	got, _, leftDigest, err := canonicalizeEvidenceForTest(
		[]Fragment{second, first},
		nil,
		DefaultLimits(),
	)
	if err != nil {
		t.Fatal(err)
	}
	want := []Fragment{first, second}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("canonical fragments = %#v, want %#v", got, want)
	}
	_, _, rightDigest, err := canonicalizeEvidenceForTest(want, nil, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	if leftDigest != rightDigest {
		t.Fatal("catalogue digest depends on caller ordering")
	}
}

func TestCanonicalizeFragmentsDigestIsSensitiveToEveryEncodedField(t *testing.T) {
	t.Parallel()

	baseline := fragment("first", "a")
	_, _, baselineDigest, err := canonicalizeEvidenceForTest(
		[]Fragment{baseline},
		nil,
		DefaultLimits(),
	)
	if err != nil {
		t.Fatal(err)
	}
	mutations := map[string]func(*Fragment){
		"id":              func(value *Fragment) { value.ID = "other" },
		"symbol":          func(value *Fragment) { value.Symbol = "other" },
		"file":            func(value *Fragment) { value.File = "/repo/src/other.ts" },
		"source hash":     func(value *Fragment) { value.SourceHash = strings.Repeat("b", 64) },
		"start line":      func(value *Fragment) { value.Range.Start.Line-- },
		"start character": func(value *Fragment) { value.Range.Start.Character-- },
		"end line":        func(value *Fragment) { value.Range.End.Line++ },
		"end character":   func(value *Fragment) { value.Range.End.Character++ },
		"snippet":         func(value *Fragment) { value.Snippet = "other" },
	}
	for name, mutate := range mutations {
		t.Run(name, func(t *testing.T) {
			changed := baseline
			mutate(&changed)
			_, _, digest, err := canonicalizeEvidenceForTest(
				[]Fragment{changed},
				nil,
				DefaultLimits(),
			)
			if err != nil {
				t.Fatal(err)
			}
			if digest == baselineDigest {
				t.Fatalf("%s mutation did not change the catalogue digest", name)
			}
		})
	}
}

func TestCanonicalizeFragmentsRejectsDuplicateIDsAndMalformedRecords(t *testing.T) {
	t.Parallel()

	duplicate := fragment("same", "a")
	invalidRange := fragment("range", "b")
	invalidRange.Range.End.Line = invalidRange.Range.Start.Line - 1
	emptyRange := fragment("empty-range", "b")
	emptyRange.Range.End = emptyRange.Range.Start
	invalidUTF8 := fragment("utf8", "c")
	invalidUTF8.Snippet = string([]byte{0xff})

	for name, fragments := range map[string][]Fragment{
		"duplicate ID": {duplicate, duplicate},
		"range":        {invalidRange},
		"empty range":  {emptyRange},
		"UTF-8":        {invalidUTF8},
		"identity":     {fragment("", "d")},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, _, err := canonicalizeEvidenceForTest(
				fragments,
				nil,
				DefaultLimits(),
			); err == nil {
				t.Fatal("CanonicalizePreviewEvidence succeeded, want fail-closed error")
			}
		})
	}
}

func TestCanonicalizeFragmentsBoundsTheAggregateCanonicalRecords(t *testing.T) {
	t.Parallel()

	fragments := []Fragment{fragment("first", "a"), fragment("second", "b")}
	recordBytes := canonicalRecordBytes(fragments[0]) + canonicalRecordBytes(fragments[1])
	exact := DefaultLimits()
	exact.MaxFragmentBytes = uint32(recordBytes)

	if _, _, _, err := canonicalizeEvidenceForTest(fragments, nil, exact); err != nil {
		t.Fatalf("exact aggregate catalogue rejected: %v", err)
	}

	overflow := exact
	overflow.MaxFragmentBytes--
	if _, _, _, err := canonicalizeEvidenceForTest(fragments, nil, overflow); err == nil {
		t.Fatal("one-byte aggregate overflow succeeded")
	}
}

func TestCanonicalizeFragmentsZeroBytesPermitsOnlyTheEmptyCatalogue(t *testing.T) {
	t.Parallel()

	limits := DefaultLimits()
	limits.MaxFragmentBytes = 0
	if _, _, _, err := canonicalizeEvidenceForTest(nil, nil, limits); err != nil {
		t.Fatalf("empty zero-budget catalogue rejected: %v", err)
	}
	if _, _, _, err := canonicalizeEvidenceForTest(
		[]Fragment{fragment("record", "")},
		nil,
		limits,
	); err == nil {
		t.Fatal("nonempty zero-budget catalogue succeeded")
	}
}

func canonicalizeEvidenceForTest(
	fragments []Fragment,
	joins []FragmentJoin,
	limits staticprotocol.PromptTextLimits,
) ([]Fragment, []FragmentJoin, [32]byte, error) {
	return CanonicalizePreviewEvidence(
		"/repo/src/writer.ts",
		strings.Repeat("c", 64),
		fragments,
		joins,
		limits,
	)
}

func fragment(id, snippet string) Fragment {
	return Fragment{
		ID: id, Symbol: "fragment", File: "/repo/src/fragments.ts",
		SourceHash: strings.Repeat("a", 64), Snippet: snippet,
		Range: staticprotocol.PromptTextRange{
			Start: staticprotocol.PromptTextPosition{Line: 2, Character: 3},
			End:   staticprotocol.PromptTextPosition{Line: 2, Character: 4},
		},
	}
}

func canonicalRecordBytes(fragment Fragment) int {
	return 5*4 +
		len(fragment.ID) +
		len(fragment.Symbol) +
		len(fragment.File) +
		len(fragment.SourceHash) +
		len(fragment.Snippet) +
		4*4
}
