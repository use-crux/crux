package prompttext

import (
	"encoding/hex"
	"reflect"
	"strings"
	"testing"

	staticprotocol "github.com/use-crux/crux/packages/local/internal/projectindex/staticindex/protocol"
)

func TestCanonicalizeFragmentsUsesTheNamedEmptyCatalogueDigest(t *testing.T) {
	t.Parallel()

	fragments, digest, err := CanonicalizeFragments(nil, DefaultLimits())
	if err != nil {
		t.Fatal(err)
	}
	if fragments == nil || len(fragments) != 0 {
		t.Fatalf("canonical fragments = %#v, want non-nil empty", fragments)
	}
	const want = "98ae68c7e1000785759e8e128c5a5c4a3aadd3c86e8ce98aab3a1d97913216fe"
	if got := hex.EncodeToString(digest[:]); got != want {
		t.Fatalf("empty catalogue digest = %s, want %s", got, want)
	}
}

func TestCanonicalizeFragmentsSortsTheExactWorkerVector(t *testing.T) {
	t.Parallel()

	second := fragment("second", "z")
	first := fragment("first", "a")
	got, leftDigest, err := CanonicalizeFragments(
		[]Fragment{second, first},
		DefaultLimits(),
	)
	if err != nil {
		t.Fatal(err)
	}
	want := []Fragment{first, second}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("canonical fragments = %#v, want %#v", got, want)
	}
	_, rightDigest, err := CanonicalizeFragments(want, DefaultLimits())
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
	_, baselineDigest, err := CanonicalizeFragments([]Fragment{baseline}, DefaultLimits())
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
			_, digest, err := CanonicalizeFragments([]Fragment{changed}, DefaultLimits())
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
	invalidUTF8 := fragment("utf8", "c")
	invalidUTF8.Snippet = string([]byte{0xff})

	for name, fragments := range map[string][]Fragment{
		"duplicate ID": {duplicate, duplicate},
		"range":        {invalidRange},
		"UTF-8":        {invalidUTF8},
		"identity":     {fragment("", "d")},
	} {
		t.Run(name, func(t *testing.T) {
			if _, _, err := CanonicalizeFragments(fragments, DefaultLimits()); err == nil {
				t.Fatal("CanonicalizeFragments succeeded, want fail-closed error")
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

	if _, _, err := CanonicalizeFragments(fragments, exact); err != nil {
		t.Fatalf("exact aggregate catalogue rejected: %v", err)
	}

	overflow := exact
	overflow.MaxFragmentBytes--
	if _, _, err := CanonicalizeFragments(fragments, overflow); err == nil {
		t.Fatal("one-byte aggregate overflow succeeded")
	}
}

func TestCanonicalizeFragmentsZeroBytesPermitsOnlyTheEmptyCatalogue(t *testing.T) {
	t.Parallel()

	limits := DefaultLimits()
	limits.MaxFragmentBytes = 0
	if _, _, err := CanonicalizeFragments(nil, limits); err != nil {
		t.Fatalf("empty zero-budget catalogue rejected: %v", err)
	}
	if _, _, err := CanonicalizeFragments(
		[]Fragment{fragment("record", "")},
		limits,
	); err == nil {
		t.Fatal("nonempty zero-budget catalogue succeeded")
	}
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
