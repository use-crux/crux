package prompttext

import "testing"

func TestPromptTextDocumentLinkRejectsRawUnicodeWhitespaceAndControls(t *testing.T) {
	t.Parallel()

	rawWhitespace := []rune{
		0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x0020, 0x0085,
		0x00a0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
		0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028,
		0x2029, 0x202f, 0x205f, 0x3000,
	}
	for _, value := range rawWhitespace {
		destination := "guide" + string(value) + ".md"
		if got, ok := resolveLinkTarget(
			destination,
			"/repo/src/writer.ts",
			"/repo",
		); ok {
			t.Fatalf("raw whitespace U+%04X resolved as %q", value, got)
		}
	}
	for _, destination := range []string{
		"guide\x00.md",
		"guide\x1f.md",
		"guide\x7f.md",
		`guide\name.md`,
		string([]byte{'g', 'u', 'i', 'd', 'e', 0xff}),
	} {
		if got, ok := resolveLinkTarget(
			destination,
			"/repo/src/writer.ts",
			"/repo",
		); ok {
			t.Fatalf("unsafe raw destination resolved as %q", got)
		}
	}
}

func TestPromptTextDocumentLinkDecodesComponentsExactlyOnce(t *testing.T) {
	t.Parallel()

	accepted := []struct {
		destination string
		want        string
	}{
		{
			destination: "guide%C2%A0name.md",
			want:        "file:///repo/src/guide%C2%A0name.md",
		},
		{
			destination: "guide%C2%85name.md",
			want:        "file:///repo/src/guide%C2%85name.md",
		},
		{
			destination: "guide+name.md",
			want:        "file:///repo/src/guide+name.md",
		},
		{
			destination: "https://example.com/?q=a+b%20c",
			want:        "https://example.com/?q=a+b%20c",
		},
	}
	for _, test := range accepted {
		got, ok := resolveLinkTarget(
			test.destination,
			"/repo/src/writer.ts",
			"/repo",
		)
		if !ok || string(got) != test.want {
			t.Fatalf(
				"resolve %q = (%q, %t), want (%q, true)",
				test.destination,
				got,
				ok,
				test.want,
			)
		}
	}

	for _, destination := range []string{
		"guide%ff.md",
		"guide%c3%28.md",
		"guide.md#%ff",
		"https://example.com/%ff",
		"https://example.com/?q=%c3%28",
		"https://example.com/#%ff",
	} {
		if got, ok := resolveLinkTarget(
			destination,
			"/repo/src/writer.ts",
			"/repo",
		); ok {
			t.Fatalf("invalid decoded UTF-8 %q resolved as %q", destination, got)
		}
	}
}
