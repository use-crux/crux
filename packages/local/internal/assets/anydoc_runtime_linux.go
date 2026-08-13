//go:build linux

package assets

import (
	"crypto/sha256"
	"embed"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"

	"github.com/use-crux/crux/packages/local/internal/process/workerproc"
)

// InstalledAnydocRuntime is minted only after the embedded runtime tree has
// been fully extracted and attested. Its paths are deliberately not forgeable.
type InstalledAnydocRuntime struct{ root, runner, digest string }

func (r InstalledAnydocRuntime) Root() string   { return r.root }
func (r InstalledAnydocRuntime) Runner() string { return r.runner }
func (r InstalledAnydocRuntime) Digest() string { return r.digest }

// AnydocNode is a canonical, non-writable Node executable attested at launch.
type AttestedNode struct {
	path, sha256 string
	dev, inode   uint64
}

func (n AttestedNode) Path() string   { return n.path }
func (n AttestedNode) SHA256() string { return n.sha256 }
func (n AttestedNode) Dev() uint64    { return n.dev }
func (n AttestedNode) Inode() uint64  { return n.inode }

func ResolveAnydocNode() (AttestedNode, error) { return resolveAnydocNode(workerproc.FindNodePath) }

func resolveAnydocNode(find func() (string, error)) (AttestedNode, error) {
	path, err := find()
	if err != nil {
		return AttestedNode{}, err
	}
	path, err = filepath.EvalSymlinks(path)
	if err != nil || !filepath.IsAbs(path) {
		return AttestedNode{}, errors.New("Anydoc containment unavailable: invalid Node executable")
	}
	info, err := os.Stat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o022 != 0 {
		return AttestedNode{}, errors.New("Anydoc containment unavailable: unsafe Node executable")
	}
	if err := safeParentChain(path); err != nil {
		return AttestedNode{}, err
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return AttestedNode{}, errors.New("Anydoc containment unavailable: Node stat unavailable")
	}
	bytes, err := os.ReadFile(path)
	if err != nil {
		return AttestedNode{}, err
	}
	return AttestedNode{path: path, sha256: sha256Hex(bytes), dev: uint64(stat.Dev), inode: stat.Ino}, nil
}

func safeParentChain(path string) error {
	for dir := filepath.Dir(path); ; dir = filepath.Dir(dir) {
		info, err := os.Stat(dir)
		if err != nil || !info.IsDir() || info.Mode().Perm()&0o022 != 0 {
			return errors.New("Anydoc containment unavailable: unsafe Node parent")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || (stat.Uid != 0 && stat.Uid != uint32(os.Geteuid())) {
			return errors.New("Anydoc containment unavailable: untrusted Node parent owner")
		}
		if dir == "/" {
			return nil
		}
	}
}

type anydocManifest struct {
	Platform string `json:"platform"`
	Packages map[string]struct {
		Version   string `json:"version"`
		Integrity string `json:"integrity"`
	} `json:"packages"`
	Files []struct {
		Path   string `json:"path"`
		SHA256 string `json:"sha256"`
		Size   int64  `json:"size"`
		Mode   string `json:"mode"`
	} `json:"files"`
}

// InstallAnydocRuntime atomically materializes only the embedded, manifest-listed
// files. Existing trees are accepted only after every file is re-attested.
func InstallAnydocRuntime(source embed.FS) (InstalledAnydocRuntime, error) {
	if runtime.GOARCH != "amd64" || !gnuPlatformProbe() {
		return InstalledAnydocRuntime{}, errors.New("Anydoc containment unavailable on this platform")
	}
	manifestBytes, err := source.ReadFile("embed/anydoc-runtime/manifest.json")
	if err != nil {
		return InstalledAnydocRuntime{}, fmt.Errorf("read Anydoc manifest: %w", err)
	}
	var manifest anydocManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil || manifest.Platform != "linux-x64-gnu" || len(manifest.Files) == 0 || !validPackages(manifest.Packages) {
		return InstalledAnydocRuntime{}, errors.New("Anydoc containment unavailable: invalid runtime manifest")
	}
	digestBytes := sha256.Sum256(manifestBytes)
	digest := hex.EncodeToString(digestBytes[:])
	base := os.Getenv("CRUX_CACHE_DIR")
	if base == "" {
		base, err = os.UserCacheDir()
		if err != nil {
			return InstalledAnydocRuntime{}, fmt.Errorf("Anydoc containment unavailable: cache directory: %w", err)
		}
		base = filepath.Join(base, "crux")
	}
	if err := os.MkdirAll(base, 0o700); err != nil {
		return InstalledAnydocRuntime{}, err
	}
	root := filepath.Join(base, "anydoc-runtime-"+digest[:16])
	if treeDigest, verifyErr := verifyRuntime(root, manifest); verifyErr == nil {
		return InstalledAnydocRuntime{root: root, runner: filepath.Join(root, "runner.mjs"), digest: treeDigest}, nil
	}
	partial, err := os.MkdirTemp(base, ".anydoc-runtime-"+digest[:16]+"-")
	if err != nil {
		return InstalledAnydocRuntime{}, err
	}
	defer func() {
		_ = os.Chmod(partial, 0o700)
		_ = os.RemoveAll(partial)
	}()
	if err := os.Chmod(partial, 0o755); err != nil {
		return InstalledAnydocRuntime{}, err
	}
	for _, file := range manifest.Files {
		if !safeRuntimePath(file.Path) {
			return InstalledAnydocRuntime{}, errors.New("Anydoc containment unavailable: unsafe manifest path")
		}
		bytes, readErr := source.ReadFile("embed/anydoc-runtime/" + file.Path)
		if readErr != nil || int64(len(bytes)) != file.Size || sha256Hex(bytes) != file.SHA256 {
			return InstalledAnydocRuntime{}, errors.New("Anydoc containment unavailable: embedded runtime integrity mismatch")
		}
		destination := filepath.Join(partial, filepath.FromSlash(file.Path))
		if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
			return InstalledAnydocRuntime{}, err
		}
		fd, openErr := syscall.Open(destination, syscall.O_WRONLY|syscall.O_CREAT|syscall.O_EXCL|syscall.O_NOFOLLOW, 0o600)
		if openErr != nil {
			return InstalledAnydocRuntime{}, openErr
		}
		out := os.NewFile(uintptr(fd), destination)
		if _, err := out.Write(bytes); err != nil || out.Sync() != nil || out.Close() != nil {
			_ = out.Close()
			return InstalledAnydocRuntime{}, errors.New("Anydoc containment unavailable: runtime write failed")
		}
		if err := os.Chmod(destination, 0o444); err != nil {
			return InstalledAnydocRuntime{}, err
		}
	}
	if _, err := verifyRuntimeFiles(partial, manifest, false); err != nil {
		return InstalledAnydocRuntime{}, err
	}
	marker, err := os.OpenFile(filepath.Join(partial, ".complete"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o444)
	if err != nil || marker.Sync() != nil || marker.Close() != nil {
		return InstalledAnydocRuntime{}, errors.New("Anydoc containment unavailable: completion marker")
	}
	if err := os.Chmod(partial, 0o555); err != nil {
		return InstalledAnydocRuntime{}, err
	}
	if err := os.Rename(partial, root); err != nil {
		if _, verifyErr := verifyRuntime(root, manifest); verifyErr != nil {
			return InstalledAnydocRuntime{}, err
		}
	}
	treeDigest, err := verifyRuntime(root, manifest)
	if err != nil {
		return InstalledAnydocRuntime{}, err
	}
	return InstalledAnydocRuntime{root: root, runner: filepath.Join(root, "runner.mjs"), digest: treeDigest}, nil
}

var gnuPlatformProbe = trustedGNUPlatform

func trustedGNUPlatform() bool {
	// The pinned addon is x86_64 glibc. These are fixed host paths, not PATH
	// lookups; both must be root-owned, non-writable regular ELF files.
	for _, path := range []string{"/lib64/ld-linux-x86-64.so.2", "/lib/x86_64-linux-gnu/libc.so.6"} {
		info, err := os.Stat(path)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o022 != 0 {
			return false
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 {
			return false
		}
		bytes, err := os.ReadFile(path)
		if err != nil || len(bytes) < 20 || string(bytes[:4]) != "\x7fELF" || bytes[4] != 2 || bytes[5] != 1 {
			return false
		}
	}
	return true
}

func validPackages(packages map[string]struct {
	Version   string `json:"version"`
	Integrity string `json:"integrity"`
}) bool {
	if len(packages) != 2 {
		return false
	}
	for _, name := range []string{"@firecrawl/anydoc", "@firecrawl/anydoc-linux-x64-gnu"} {
		pkg, ok := packages[name]
		if !ok || pkg.Version != "0.1.7" || !strings.HasPrefix(pkg.Integrity, "sha512-") {
			return false
		}
		if _, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(pkg.Integrity, "sha512-")); err != nil {
			return false
		}
	}
	return true
}

func verifyRuntime(root string, manifest anydocManifest) (string, error) {
	marker, err := os.Lstat(filepath.Join(root, ".complete"))
	if err != nil || !marker.Mode().IsRegular() || marker.Mode().Perm() != 0o444 {
		return "", errors.New("Anydoc containment unavailable: incomplete runtime")
	}
	return verifyRuntimeFiles(root, manifest, true)
}

func verifyRuntimeFiles(root string, manifest anydocManifest, complete bool) (string, error) {
	expected := map[string]struct{}{".complete": {}}
	rootInfo, err := os.Lstat(root)
	wantRootMode := os.FileMode(0o755)
	if complete {
		wantRootMode = 0o555
	}
	if err != nil || !rootInfo.IsDir() || rootInfo.Mode().Perm() != wantRootMode || !ownedByCurrentUser(rootInfo) {
		return "", errors.New("Anydoc containment unavailable: unsafe runtime root")
	}
	if err := safeOwnerParentChain(root); err != nil {
		return "", err
	}
	for _, file := range manifest.Files {
		if !safeRuntimePath(file.Path) {
			return "", errors.New("Anydoc containment unavailable: unsafe manifest path")
		}
		path := filepath.Join(root, filepath.FromSlash(file.Path))
		if _, exists := expected[file.Path]; exists {
			return "", errors.New("Anydoc containment unavailable: duplicate runtime file")
		}
		expected[file.Path] = struct{}{}
		info, err := os.Lstat(path)
		if err != nil || !info.Mode().IsRegular() || info.Mode().Perm() != 0o444 || info.Size() != file.Size || !ownedByCurrentUser(info) {
			return "", errors.New("Anydoc containment unavailable: runtime file mismatch")
		}
		bytes, err := os.ReadFile(path)
		if err != nil || sha256Hex(bytes) != file.SHA256 {
			return "", errors.New("Anydoc containment unavailable: runtime hash mismatch")
		}
	}
	h := sha256.New()
	err = filepath.WalkDir(root, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if rel == "." {
			_, _ = fmt.Fprintf(h, "d\x00.\x00%04o\x00", info.Mode().Perm())
			return nil
		}
		rel = filepath.ToSlash(rel)
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() && !info.IsDir() {
			return errors.New("Anydoc containment unavailable: unsafe runtime entry")
		}
		if !ownedByCurrentUser(info) {
			return errors.New("Anydoc containment unavailable: untrusted runtime owner")
		}
		if info.IsDir() {
			if info.Mode().Perm() != 0o755 {
				return errors.New("Anydoc containment unavailable: writable runtime directory")
			}
			_, _ = fmt.Fprintf(h, "d\x00%s\x00%04o\x00", rel, info.Mode().Perm())
			return nil
		}
		if _, ok := expected[rel]; !ok {
			return errors.New("Anydoc containment unavailable: unexpected runtime file")
		}
		if info.Mode().Perm() != 0o444 {
			return errors.New("Anydoc containment unavailable: runtime file mode mismatch")
		}
		contents, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		_, _ = fmt.Fprintf(h, "f\x00%s\x00%04o\x00%d\x00%s\x00", rel, info.Mode().Perm(), info.Size(), sha256Hex(contents))
		return nil
	})
	if err != nil {
		return "", err
	}
	if !complete {
		return "", nil
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

func ownedByCurrentUser(info os.FileInfo) bool {
	stat, ok := info.Sys().(*syscall.Stat_t)
	return ok && stat.Uid == uint32(os.Geteuid())
}

func safeOwnerParentChain(path string) error {
	for dir := filepath.Dir(path); ; dir = filepath.Dir(dir) {
		info, err := os.Stat(dir)
		if err != nil || !info.IsDir() {
			return errors.New("Anydoc containment unavailable: unsafe runtime parent")
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if !ok || stat.Uid != 0 && stat.Uid != uint32(os.Geteuid()) {
			return errors.New("Anydoc containment unavailable: untrusted runtime parent owner")
		}
		writable := info.Mode().Perm()&0o022 != 0
		stickyRoot := info.Mode()&os.ModeSticky != 0 && stat.Uid == 0
		if writable && !stickyRoot {
			return errors.New("Anydoc containment unavailable: unsafe runtime parent")
		}
		if dir == "/" {
			return nil
		}
	}
}

func safeRuntimePath(path string) bool {
	return path != "" && !strings.HasPrefix(path, "/") && filepath.Clean(path) == path && !strings.Contains(path, "..")
}

func sha256Hex(bytes []byte) string { sum := sha256.Sum256(bytes); return hex.EncodeToString(sum[:]) }
