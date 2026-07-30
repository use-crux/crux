package prompttext

import "testing"

func TestPromptTextDocumentLinkAcceptsOnlyHierarchicalHTTPAndHTTPS(t *testing.T) {
	t.Parallel()

	tests := []struct {
		destination string
		want        string
	}{
		{
			destination: "HTTP://example.com/path?q=a+b#part",
			want:        "http://example.com/path?q=a+b#part",
		},
		{
			destination: "https://127.0.0.1:1/a%2Fb",
			want:        "https://127.0.0.1:1/a%2Fb",
		},
		{
			destination: "https://[2001:db8::1]:65535/a%20b",
			want:        "https://[2001:db8::1]:65535/a%20b",
		},
		{
			destination: "https://[::ffff:192.0.2.1]/guide",
			want:        "https://[::ffff:192.0.2.1]/guide",
		},
		{
			destination: "https://sub_domain.example/~guide",
			want:        "https://sub_domain.example/~guide",
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.destination, func(t *testing.T) {
			t.Parallel()

			got, ok := resolveLinkTarget(
				test.destination,
				"/repo/src/writer.ts",
				"/repo",
			)
			if !ok || string(got) != test.want {
				t.Fatalf("resolve = (%q, %t), want (%q, true)", got, ok, test.want)
			}
		})
	}
}

func TestPromptTextDocumentLinkRejectsUnsafeOrAmbiguousWebTargets(t *testing.T) {
	t.Parallel()

	destinations := []string{
		"",
		"https:///missing-host",
		"https://éxample.com",
		"https://exa%6dple.com",
		"https://user@example.com",
		"https://[fe80::1%25eth0]/",
		"https:example.com",
		"//example.com/path",
		"https://example.com:",
		"https://example.com:0",
		"https://example.com:65536",
		"https://example.com:abc",
		"https://example.com/a%00b",
		"https://example.com/a%5Cb",
		"https://example.com/?q=%7f",
		"https://example.com/#%00",
		"http://[127.0.0.1]/",
		"file:///repo/guide.md",
		"command:run",
		"javascript:alert(1)",
		"data:text/plain,x",
		"mailto:docs@example.com",
		"ftp://example.com/guide",
		"custom://example.com/guide",
	}
	for _, destination := range destinations {
		destination := destination
		t.Run(destination, func(t *testing.T) {
			t.Parallel()

			if got, ok := resolveLinkTarget(
				destination,
				"/repo/src/writer.ts",
				"/repo",
			); ok {
				t.Fatalf("resolve = %q, want rejection", got)
			}
		})
	}
}

func TestPromptTextDocumentLinkLexicallyContainsWorkspaceRelativePaths(t *testing.T) {
	t.Parallel()

	tests := []struct {
		destination string
		want        string
	}{
		{destination: "./guide.md", want: "file:///repo/src/guide.md"},
		{destination: "../guide.md", want: "file:///repo/guide.md"},
		{destination: "%2e%2e/guide.md", want: "file:///repo/guide.md"},
		{
			destination: "guide.md#hello%20world",
			want:        "file:///repo/src/guide.md#hello%20world",
		},
		{
			destination: "missing%20guide.md",
			want:        "file:///repo/src/missing%20guide.md",
		},
		{
			destination: "%252e/file.md",
			want:        "file:///repo/src/%252e/file.md",
		},
		{
			destination: "safe%252fchild.md",
			want:        "file:///repo/src/safe%252fchild.md",
		},
	}
	for _, test := range tests {
		test := test
		t.Run(test.destination, func(t *testing.T) {
			t.Parallel()

			got, ok := resolveLinkTarget(
				test.destination,
				"/repo/src/writer.ts",
				"/repo",
			)
			if !ok || string(got) != test.want {
				t.Fatalf("resolve = (%q, %t), want (%q, true)", got, ok, test.want)
			}
		})
	}
}

func TestPromptTextDocumentLinkRejectsUnsafeLocalPaths(t *testing.T) {
	t.Parallel()

	destinations := []string{
		"../../outside.md",
		"guide.md?mode=raw",
		"guide.md?",
		"#usage",
		"/etc/passwd",
		"C:/Windows/system.ini",
		"C%3A/Windows/system.ini",
		"C%3Arelative.md",
		`C:\Windows\system.ini`,
		`\\server\share\guide.md`,
		"//server/share/guide.md",
		"folder%2fguide.md",
		"folder%2Fguide.md",
		"folder%5cguide.md",
		"folder%5Cguide.md",
		"guide%00.md",
		"guide%1f.md",
		"guide%7f.md",
		"guide.md#part%00",
		"bad%",
		"bad%2",
		"bad%zz",
	}
	for _, destination := range destinations {
		destination := destination
		t.Run(destination, func(t *testing.T) {
			t.Parallel()

			if got, ok := resolveLinkTarget(
				destination,
				"/repo/src/writer.ts",
				"/repo",
			); ok {
				t.Fatalf("resolve = %q, want rejection", got)
			}
		})
	}
}

func TestPromptTextDocumentLinkRequiresAbsoluteContainedAuthorities(t *testing.T) {
	t.Parallel()

	tests := []struct {
		source string
		root   string
	}{
		{source: "src/writer.ts", root: "/repo"},
		{source: "/repo/src/writer.ts", root: "repo"},
		{source: "/repo-other/writer.ts", root: "/repo"},
	}
	for _, test := range tests {
		test := test
		t.Run(test.source+"|"+test.root, func(t *testing.T) {
			t.Parallel()

			if got, ok := resolveLinkTarget(
				"guide.md",
				test.source,
				test.root,
			); ok {
				t.Fatalf("resolve = %q, want rejection", got)
			}
		})
	}
}
