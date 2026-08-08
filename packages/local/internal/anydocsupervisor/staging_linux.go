//go:build linux

package anydocsupervisor

import (
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/unix"
)

const stagedSourceTarget = "/run/crux-anydoc/input/source"

// Stager owns the host-side source directory. Callers provide bytes, never a
// pathname to make visible to the sandbox.
type Stager struct{ root string }

type StagedSource struct {
	HostPath string
	dir      string
	once     sync.Once
	cleanup  error
}

func NewStager(root string) *Stager { return &Stager{root: root} }

func (s *Stager) Stage(input []byte, limit int64) (*StagedSource, error) {
	if s == nil || !validAbsolutePath(s.root) || int64(len(input)) > limit {
		return nil, errors.New("invalid source staging request")
	}
	if err := os.MkdirAll(s.root, 0700); err != nil {
		return nil, err
	}
	rootInfo, err := os.Lstat(s.root)
	if err != nil || rootInfo.Mode()&os.ModeSymlink != 0 || !rootInfo.IsDir() {
		return nil, errors.New("unsafe source staging root")
	}
	dir, err := os.MkdirTemp(s.root, "run-")
	if err != nil {
		return nil, err
	}
	staged := &StagedSource{HostPath: filepath.Join(dir, "source"), dir: dir}
	if err := os.Chmod(dir, 0700); err != nil {
		_ = staged.Cleanup()
		return nil, err
	}
	fd, err := unix.Open(staged.HostPath, unix.O_WRONLY|unix.O_CREAT|unix.O_EXCL|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0400)
	if err != nil {
		_ = staged.Cleanup()
		return nil, err
	}
	if err := unix.Fchmod(fd, 0400); err != nil {
		_ = unix.Close(fd)
		_ = staged.Cleanup()
		return nil, err
	}
	file := os.NewFile(uintptr(fd), staged.HostPath)
	hash := sha256.New()
	var written int64
	for len(input) > 0 && err == nil {
		chunkSize := len(input)
		if chunkSize > 64<<10 {
			chunkSize = 64 << 10
		}
		chunk := input[:chunkSize]
		if written+int64(len(chunk)) > limit {
			err = errors.New("source exceeds staging limit")
			break
		}
		for len(chunk) > 0 {
			n, writeErr := file.Write(chunk)
			if n > 0 {
				_, _ = hash.Write(chunk[:n])
				written += int64(n)
				chunk = chunk[n:]
			}
			if writeErr != nil {
				err = writeErr
				break
			}
			if n == 0 {
				err = io.ErrShortWrite
				break
			}
		}
		input = input[chunkSize:]
	}
	if err == nil {
		err = file.Sync()
	}
	closeErr := file.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = syncDirectory(dir)
	}
	if err == nil {
		err = verifyStagedSource(staged.HostPath, written, hash.Sum(nil), limit)
	}
	if err != nil {
		_ = staged.Cleanup()
		return nil, err
	}
	return staged, nil
}

func verifyStagedSource(path string, size int64, want []byte, limit int64) error {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() != size || info.Size() > limit || info.Mode().Perm() != 0400 {
		return errors.New("invalid staged source")
	}
	hash := sha256.New()
	read, err := io.Copy(hash, io.LimitReader(file, limit+1))
	if err != nil || read != size || !sameBytes(hash.Sum(nil), want) {
		return errors.New("invalid staged source")
	}
	return nil
}

func syncDirectory(path string) error {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_DIRECTORY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return err
	}
	err = unix.Fsync(fd)
	closeErr := unix.Close(fd)
	if err != nil {
		return err
	}
	return closeErr
}

func (s *StagedSource) Cleanup() error {
	if s == nil {
		return nil
	}
	s.once.Do(func() {
		if filepath.Base(s.HostPath) != "source" || filepath.Dir(s.HostPath) != s.dir || filepath.Base(s.dir) == "." {
			s.cleanup = errors.New("unsafe staged source cleanup")
			return
		}
		if err := os.Remove(s.HostPath); err != nil && !os.IsNotExist(err) {
			s.cleanup = err
			return
		}
		s.cleanup = os.Remove(s.dir)
		if os.IsNotExist(s.cleanup) {
			s.cleanup = nil
		}
	})
	return s.cleanup
}

func sameBytes(a, b []byte) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
