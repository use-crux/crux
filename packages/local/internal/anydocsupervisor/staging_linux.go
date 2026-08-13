//go:build linux

package anydocsupervisor

import (
	"context"
	"crypto/sha256"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"syscall"

	"golang.org/x/sys/unix"
)

const stagedSourceTarget = "/run/crux-anydoc/input/source"

// Stager owns the host-side source directory. Callers provide bytes, never a
// pathname to make visible to the sandbox.
type Stager struct{ root string }

type StagedSource struct {
	HostPath string
	dir      string
	size     int64
	hash     []byte
	dev      uint64
	ino      uint64
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
	sum := hash.Sum(nil)
	if err == nil {
		var identity stagedSourceIdentity
		identity, err = inspectStagedSource(staged.HostPath, written, sum, limit)
		if err == nil {
			staged.size = identity.size
			staged.hash = append([]byte(nil), identity.hash...)
			staged.dev = identity.dev
			staged.ino = identity.ino
		}
	}
	if err != nil {
		_ = staged.Cleanup()
		return nil, err
	}
	return staged, nil
}

type stagedSourceIdentity struct {
	size     int64
	hash     []byte
	dev, ino uint64
	uid, gid uint32
	mode     os.FileMode
}

func verifyStagedSource(path string, size int64, want []byte, limit int64) error {
	_, err := inspectStagedSource(path, size, want, limit)
	return err
}

func inspectStagedSource(path string, size int64, want []byte, limit int64) (stagedSourceIdentity, error) {
	fd, err := unix.Open(path, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return stagedSourceIdentity{}, err
	}
	defer unix.Close(fd)
	return inspectStagedSourceFD(fd, size, want, limit)
}

func inspectStagedSourceFD(fd int, size int64, want []byte, limit int64) (stagedSourceIdentity, error) {
	// fstat immediately before hashing so identity cannot be observed from a
	// stale snapshot taken earlier in the caller.
	var before unix.Stat_t
	if err := unix.Fstat(fd, &before); err != nil {
		return stagedSourceIdentity{}, err
	}
	if err := validateStagedSourceStat(&before, size, limit); err != nil {
		return stagedSourceIdentity{}, err
	}
	if _, err := unix.Seek(fd, 0, io.SeekStart); err != nil {
		return stagedSourceIdentity{}, err
	}
	hash := sha256.New()
	buf := make([]byte, 64<<10)
	var read int64
	for {
		n, err := unix.Read(fd, buf)
		if n > 0 {
			if read+int64(n) > limit {
				return stagedSourceIdentity{}, errors.New("invalid staged source")
			}
			_, _ = hash.Write(buf[:n])
			read += int64(n)
		}
		if err != nil {
			return stagedSourceIdentity{}, err
		}
		if n == 0 {
			break
		}
	}
	sum := hash.Sum(nil)
	if read != size || !sameBytes(sum, want) {
		return stagedSourceIdentity{}, errors.New("invalid staged source")
	}
	// fstat immediately after hashing; any identity drift during the read
	// (including same-mode chmod ctime bumps) fails closed.
	var after unix.Stat_t
	if err := unix.Fstat(fd, &after); err != nil {
		return stagedSourceIdentity{}, err
	}
	if !sameStagedSourceStat(&before, &after) {
		return stagedSourceIdentity{}, errors.New("invalid staged source")
	}
	return stagedSourceIdentity{
		size: size,
		hash: append([]byte(nil), sum...),
		dev:  uint64(after.Dev),
		ino:  after.Ino,
		uid:  after.Uid,
		gid:  after.Gid,
		mode: os.FileMode(after.Mode & 0777),
	}, nil
}

func validateStagedSourceStat(stat *unix.Stat_t, size, limit int64) error {
	mode := os.FileMode(stat.Mode & 0777)
	if stat.Mode&unix.S_IFMT != unix.S_IFREG || int64(stat.Size) != size || int64(stat.Size) > limit || mode != 0400 {
		return errors.New("invalid staged source")
	}
	return nil
}

// sameStagedSourceStat reports whether two fstat results describe the same
// immutable staged-source identity across a hash: device, inode, size, full
// type/mode, ownership, and mtime/ctime.
func sameStagedSourceStat(a, b *unix.Stat_t) bool {
	return a.Dev == b.Dev &&
		a.Ino == b.Ino &&
		a.Size == b.Size &&
		a.Mode == b.Mode &&
		a.Uid == b.Uid &&
		a.Gid == b.Gid &&
		a.Mtim == b.Mtim &&
		a.Ctim == b.Ctim
}

// GrantAccess transfers ownership of the exact staged source inode to the
// verified DynamicUser while retaining mode 0400. The host parent directory is
// intentionally left untouched (root-owned 0700). All mutation happens on an
// O_NOFOLLOW-opened descriptor with immediate pre/post inode identity checks.
func (s *StagedSource) GrantAccess(uid uint32) error {
	if s == nil || uid == 0 || s.size < 0 || len(s.hash) != sha256.Size || s.dev == 0 && s.ino == 0 {
		return errors.New("invalid staged source grant")
	}
	if filepath.Base(s.HostPath) != "source" || filepath.Dir(s.HostPath) != s.dir {
		return errors.New("unsafe staged source grant")
	}
	parentInfo, err := os.Lstat(s.dir)
	if err != nil || parentInfo.Mode()&os.ModeSymlink != 0 || !parentInfo.IsDir() || parentInfo.Mode().Perm() != 0700 {
		return errors.New("unsafe staged source parent")
	}
	parentStat, ok := parentInfo.Sys().(*syscall.Stat_t)
	if !ok {
		return errors.New("unsafe staged source parent")
	}

	fd, err := unix.Open(s.HostPath, unix.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return errors.New("invalid staged source")
	}
	defer unix.Close(fd)

	before, err := inspectStagedSourceFD(fd, s.size, s.hash, s.size)
	if err != nil || before.dev != s.dev || before.ino != s.ino || before.size != s.size || !sameBytes(before.hash, s.hash) {
		return errors.New("invalid staged source")
	}
	// Requested DynamicUser ownership is uid for both owner and group.
	if err := unix.Fchown(fd, int(uid), int(uid)); err != nil {
		return err
	}
	if err := unix.Fchmod(fd, 0400); err != nil {
		return err
	}
	// Re-inspect through pre/post fstat hashing, then require the exact
	// requested uid AND gid, regular 0400 mode/type, and expected identity.
	after, err := inspectStagedSourceFD(fd, s.size, s.hash, s.size)
	if err != nil ||
		after.dev != s.dev || after.ino != s.ino ||
		after.size != s.size || !sameBytes(after.hash, s.hash) ||
		after.uid != uid || after.gid != uid ||
		after.mode != 0400 {
		return errors.New("invalid staged source grant")
	}

	parentAfter, err := os.Lstat(s.dir)
	if err != nil || parentAfter.Mode().Perm() != 0700 || !parentAfter.IsDir() {
		return errors.New("unsafe staged source parent")
	}
	parentAfterStat, ok := parentAfter.Sys().(*syscall.Stat_t)
	if !ok || parentAfterStat.Uid != parentStat.Uid || parentAfterStat.Gid != parentStat.Gid || parentAfterStat.Ino != parentStat.Ino {
		return errors.New("unsafe staged source parent")
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

// grantVerifiedSourceAccess re-checks the live unit report for a non-zero
// DynamicUser, proves the unit's read-only bind still names this staged host
// path, then transfers ownership of that exact inode to the worker UID.
func grantVerifiedSourceAccess(ctx context.Context, unit Unit, staged *StagedSource) error {
	if unit == nil || staged == nil {
		return errors.New("authorization unavailable")
	}
	report, err := unit.Report(ctx)
	if err != nil || !report.DynamicUser || report.UID == 0 || !report.PrivateUsers || report.ProtectProc != "invisible" || report.ProcSubset != "pid" {
		return errors.New("authorization unavailable")
	}
	if !bindMatchesStagedSource(report.BindReadOnlyPaths, staged.HostPath) {
		return errors.New("staged source bind mismatch")
	}
	return staged.GrantAccess(uint32(report.UID))
}

func bindMatchesStagedSource(binds []string, hostPath string) bool {
	if !validAbsolutePath(hostPath) {
		return false
	}
	want := hostPath + ":" + stagedSourceTarget
	for _, bind := range binds {
		if bind == want {
			return true
		}
	}
	return false
}
