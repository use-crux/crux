package mapping

import "testing"

func TestFileURIAndInverse(t *testing.T) {
	for _, test := range []struct {
		root string
		file string
		uri  string
		path string
	}{
		{root: "/repo space", file: "src/é#x.ts", uri: "file:///repo%20space/src/%C3%A9%23x.ts", path: "/repo space/src/é#x.ts"},
		{root: "/ignored", file: "/absolute/a.ts", uri: "file:///absolute/a.ts", path: "/absolute/a.ts"},
		{root: `C:\repo`, file: `src\a b.ts`, uri: "file:///C:/repo/src/a%20b.ts", path: "C:/repo/src/a b.ts"},
	} {
		if got := FileURI(test.root, test.file); got != test.uri {
			t.Errorf("FileURI(%q, %q) = %q, want %q", test.root, test.file, got, test.uri)
		}
		path, err := URIToPath(test.uri)
		if err != nil || path != test.path {
			t.Errorf("URIToPath(%q) = (%q, %v), want %q", test.uri, path, err, test.path)
		}
	}
}

func TestURIToPathRejectsNonFileURI(t *testing.T) {
	if _, err := URIToPath("https://usecrux.dev/docs"); err == nil {
		t.Fatal("non-file URI was accepted")
	}
}
