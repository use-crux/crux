package editorcmd

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestInstallerDownloadsExactReleaseAndInstallsVSCode(t *testing.T) {
	const version = "1.2.3"
	const asset = "crux-vscode-1.2.3.vsix"
	vsix := []byte("fixture-vsix")
	digest := sha256.Sum256(vsix)
	requests := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests = append(requests, r.URL.Path)
		switch filepath.Base(r.URL.Path) {
		case "SHA256SUMS":
			fmt.Fprintf(w, "%x  %s\n", digest, asset)
		case asset:
			_, _ = w.Write(vsix)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	var executable string
	var arguments []string
	var installedPath string
	installer := newInstaller(installerDependencies{
		client:         server.Client(),
		releaseBaseURL: server.URL,
		lookPath: func(name string) (string, error) {
			if name != "code" {
				t.Fatalf("lookPath(%q), want code", name)
			}
			return "/fixture/code", nil
		},
		runEditor: func(_ context.Context, path string, args []string) error {
			executable = path
			arguments = append([]string(nil), args...)
			installedPath = args[1]
			installed, err := os.ReadFile(args[1])
			if err != nil {
				return err
			}
			if !reflect.DeepEqual(installed, vsix) {
				t.Fatalf("installed bytes = %q, want %q", installed, vsix)
			}
			return nil
		},
	})

	if _, err := installer.install(context.Background(), installRequest{
		version: version,
		editor:  editorVSCode,
	}); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(requests, []string{
		"/v1.2.3/SHA256SUMS",
		"/v1.2.3/" + asset,
	}) {
		t.Fatalf("requests = %#v", requests)
	}
	if executable != "/fixture/code" {
		t.Fatalf("executable = %q", executable)
	}
	if !reflect.DeepEqual(arguments[:1], []string{"--install-extension"}) ||
		arguments[2] != "--force" {
		t.Fatalf("arguments = %#v", arguments)
	}
	if _, err := os.Stat(installedPath); !os.IsNotExist(err) {
		t.Fatalf("temporary VSIX still exists after installation: %v", err)
	}
}

func TestInstallerCanDownloadVerifiedVSIXWithoutExecutingAnEditor(t *testing.T) {
	const version = "1.2.3"
	const asset = "crux-vscode-1.2.3.vsix"
	vsix := []byte("download-only-vsix")
	digest := sha256.Sum256(vsix)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch filepath.Base(r.URL.Path) {
		case "SHA256SUMS":
			fmt.Fprintf(w, "%x  %s\n", digest, asset)
		case asset:
			_, _ = w.Write(vsix)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)

	destination := t.TempDir()
	installer := newInstaller(installerDependencies{
		client:         server.Client(),
		releaseBaseURL: server.URL,
		lookPath: func(string) (string, error) {
			t.Fatal("download-only installation looked for an editor")
			return "", nil
		},
		runEditor: func(context.Context, string, []string) error {
			t.Fatal("download-only installation executed an editor")
			return nil
		},
	})

	result, err := installer.install(context.Background(), installRequest{
		version:     version,
		editor:      editorCursor,
		downloadDir: destination,
	})
	if err != nil {
		t.Fatal(err)
	}
	wantPath := filepath.Join(destination, asset)
	if result.outputPath != wantPath {
		t.Fatalf("output path = %q, want %q", result.outputPath, wantPath)
	}
	actual, err := os.ReadFile(wantPath)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(actual, vsix) {
		t.Fatalf("downloaded bytes = %q, want %q", actual, vsix)
	}
}

func TestInstallerFailsClosedBeforeEditorExecution(t *testing.T) {
	const asset = "crux-vscode-1.2.3.vsix"
	vsix := []byte("fixture-vsix")
	digest := sha256.Sum256(vsix)
	cases := []struct {
		name      string
		checksums string
		status    int
		wantError string
	}{
		{
			name:      "missing release",
			status:    http.StatusNotFound,
			wantError: "HTTP 404",
		},
		{
			name:      "missing asset checksum",
			checksums: fmt.Sprintf("%x  another.vsix\n", digest),
			status:    http.StatusOK,
			wantError: "does not contain",
		},
		{
			name:      "checksum mismatch",
			checksums: fmt.Sprintf("%064x  %s\n", 0, asset),
			status:    http.StatusOK,
			wantError: "checksum does not match",
		},
		{
			name:      "oversized checksum response",
			checksums: strings.Repeat("x", maxChecksumBytes+1),
			status:    http.StatusOK,
			wantError: "exceeds",
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if testCase.status != http.StatusOK {
					http.Error(w, "private response body", testCase.status)
					return
				}
				if filepath.Base(r.URL.Path) == "SHA256SUMS" {
					_, _ = w.Write([]byte(testCase.checksums))
					return
				}
				_, _ = w.Write(vsix)
			}))
			t.Cleanup(server.Close)

			executed := false
			installer := newInstaller(installerDependencies{
				client:         server.Client(),
				releaseBaseURL: server.URL,
				lookPath:       func(string) (string, error) { return "/fixture/code", nil },
				runEditor: func(context.Context, string, []string) error {
					executed = true
					return nil
				},
			})
			_, err := installer.install(context.Background(), installRequest{
				version: "1.2.3",
				editor:  editorVSCode,
			})
			if err == nil || !strings.Contains(err.Error(), testCase.wantError) {
				t.Fatalf("error = %v, want %q", err, testCase.wantError)
			}
			if strings.Contains(err.Error(), "private response body") {
				t.Fatalf("error leaked response body: %v", err)
			}
			if executed {
				t.Fatal("editor executed before release verification completed")
			}
		})
	}
}
