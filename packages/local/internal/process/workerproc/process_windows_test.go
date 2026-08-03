//go:build windows

package workerproc

import (
	"os"
	"os/exec"
	"strconv"
	"testing"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

func TestWindowsJobObjectKillsDescendantsAndClosesHandle(t *testing.T) {
	if os.Getenv("CRUX_WORKERPROC_HELPER") == "1" {
		runWindowsDescendantHelper()
		return
	}
	marker := t.TempDir() + `\child.pid`
	cmd := exec.Command(os.Args[0], "-test.run=TestWindowsJobObjectKillsDescendantsAndClosesHandle")
	cmd.Env = append(os.Environ(), "CRUX_WORKERPROC_HELPER=1", "CRUX_WORKERPROC_MARKER="+marker)
	group, err := ConfigureProcessGroup(cmd)
	if err != nil {
		t.Fatal(err)
	}
	if err := group.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		CloseProcessGroup(group)
		_, _ = cmd.Process.Wait()
	}()
	childPID := waitForWindowsPID(t, marker)
	KillProcessGroup(group)
	_ = cmd.Wait()
	assertWindowsProcessGone(t, childPID)

	CloseProcessGroup(group)
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	if err := windows.QueryInformationJobObject(
		group.state.job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
		nil,
	); err == nil {
		t.Fatal("closed Job Object handle remained usable")
	}
}

func runWindowsDescendantHelper() {
	child := exec.Command("ping", "-t", "127.0.0.1")
	if err := child.Start(); err != nil {
		os.Exit(2)
	}
	if err := os.WriteFile(os.Getenv("CRUX_WORKERPROC_MARKER"), []byte(strconv.Itoa(child.Process.Pid)), 0o600); err != nil {
		os.Exit(3)
	}
	_ = child.Wait()
}

func waitForWindowsPID(t *testing.T, marker string) uint32 {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		raw, err := os.ReadFile(marker)
		if err == nil {
			pid, parseErr := strconv.ParseUint(string(raw), 10, 32)
			if parseErr != nil {
				t.Fatal(parseErr)
			}
			return uint32(pid)
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("descendant pid marker was not written")
	return 0
}

func assertWindowsProcessGone(t *testing.T, pid uint32) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		handle, err := windows.OpenProcess(windows.PROCESS_QUERY_LIMITED_INFORMATION, false, pid)
		if err != nil {
			return
		}
		windows.CloseHandle(handle)
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("descendant process %d survived Job Object closure", pid)
}
