package editorcmd

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	defaultReleaseBaseURL = "https://github.com/use-crux/crux/releases/download"
	maxChecksumBytes      = 64 << 10
	maxVSIXBytes          = 100 << 20
)

type editor string

const (
	editorVSCode editor = "vscode"
	editorCursor editor = "cursor"
)

type installRequest struct {
	version     string
	editor      editor
	downloadDir string
}

type installResult struct {
	outputPath string
}

type installerDependencies struct {
	client         *http.Client
	releaseBaseURL string
	lookPath       func(string) (string, error)
	runEditor      func(context.Context, string, []string) error
}

type installer struct {
	dependencies installerDependencies
}

func newInstaller(dependencies installerDependencies) installer {
	if dependencies.client == nil {
		dependencies.client = &http.Client{Timeout: 30 * time.Second}
	}
	if dependencies.releaseBaseURL == "" {
		dependencies.releaseBaseURL = defaultReleaseBaseURL
	}
	if dependencies.lookPath == nil {
		dependencies.lookPath = exec.LookPath
	}
	if dependencies.runEditor == nil {
		dependencies.runEditor = runEditor
	}
	return installer{dependencies: dependencies}
}

func (i installer) install(ctx context.Context, request installRequest) (installResult, error) {
	if !releaseVersionPattern.MatchString(request.version) {
		return installResult{}, fmt.Errorf(
			"Crux version %q does not identify a published GitHub Release",
			request.version,
		)
	}
	executableName, err := request.editor.executable()
	if err != nil {
		return installResult{}, err
	}
	assetName := fmt.Sprintf("crux-vscode-%s.vsix", request.version)
	releaseURL := fmt.Sprintf(
		"%s/v%s",
		strings.TrimRight(i.dependencies.releaseBaseURL, "/"),
		request.version,
	)
	checksums, err := i.download(ctx, releaseURL+"/SHA256SUMS", maxChecksumBytes)
	if err != nil {
		return installResult{}, fmt.Errorf("download release checksums: %w", err)
	}
	expected, err := checksumForAsset(checksums, assetName)
	if err != nil {
		return installResult{}, err
	}
	vsix, err := i.download(ctx, releaseURL+"/"+assetName, maxVSIXBytes)
	if err != nil {
		return installResult{}, fmt.Errorf("download editor extension: %w", err)
	}
	actual := sha256.Sum256(vsix)
	if actual != expected {
		return installResult{}, errors.New("downloaded editor extension checksum does not match SHA256SUMS")
	}
	if request.downloadDir != "" {
		outputPath, err := writeDownloadedAsset(request.downloadDir, assetName, vsix)
		if err != nil {
			return installResult{}, err
		}
		return installResult{outputPath: outputPath}, nil
	}

	workspace, err := os.MkdirTemp("", "crux-editor-install-*")
	if err != nil {
		return installResult{}, fmt.Errorf("create editor install workspace: %w", err)
	}
	defer os.RemoveAll(workspace)
	vsixPath := filepath.Join(workspace, assetName)
	if err := os.WriteFile(vsixPath, vsix, 0o600); err != nil {
		return installResult{}, fmt.Errorf("write editor extension: %w", err)
	}

	executable, err := i.dependencies.lookPath(executableName)
	if err != nil {
		return installResult{}, fmt.Errorf(
			"%s CLI was not found in PATH: %w",
			request.editor.label(),
			err,
		)
	}
	if err := i.dependencies.runEditor(
		ctx,
		executable,
		[]string{"--install-extension", vsixPath, "--force"},
	); err != nil {
		return installResult{}, fmt.Errorf(
			"%s extension installation failed: %w",
			request.editor.label(),
			err,
		)
	}
	return installResult{}, nil
}

func (i installer) download(ctx context.Context, url string, limit int64) ([]byte, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	response, err := i.dependencies.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub Release returned HTTP %d", response.StatusCode)
	}
	bytes, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(bytes)) > limit {
		return nil, fmt.Errorf("download exceeds %d-byte limit", limit)
	}
	return bytes, nil
}

func checksumForAsset(checksums []byte, assetName string) ([sha256.Size]byte, error) {
	var match [sha256.Size]byte
	found := false
	for _, line := range strings.Split(strings.TrimSpace(string(checksums)), "\n") {
		parts := strings.SplitN(line, "  ", 2)
		if len(parts) != 2 || parts[1] != assetName {
			continue
		}
		if found {
			return match, fmt.Errorf("SHA256SUMS contains duplicate entries for %s", assetName)
		}
		decoded, err := hex.DecodeString(parts[0])
		if err != nil || len(decoded) != sha256.Size {
			return match, fmt.Errorf("SHA256SUMS contains an invalid checksum for %s", assetName)
		}
		copy(match[:], decoded)
		found = true
	}
	if !found {
		return match, fmt.Errorf("SHA256SUMS does not contain %s", assetName)
	}
	return match, nil
}

func (e editor) executable() (string, error) {
	switch e {
	case editorVSCode:
		return "code", nil
	case editorCursor:
		return "cursor", nil
	default:
		return "", fmt.Errorf("unsupported editor %q; choose vscode or cursor", e)
	}
}

func (e editor) label() string {
	if e == editorCursor {
		return "Cursor"
	}
	return "Visual Studio Code"
}

func runEditor(ctx context.Context, executable string, arguments []string) error {
	command := exec.CommandContext(ctx, executable, arguments...)
	command.Stdin = os.Stdin
	command.Stdout = os.Stdout
	command.Stderr = os.Stderr
	return command.Run()
}
