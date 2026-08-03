//go:build windows

package workerproc

import (
	"fmt"
	"os/exec"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

type processGroupState struct {
	cmd       *exec.Cmd
	job       windows.Handle
	closeOnce sync.Once
}

func configureProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_NEW_PROCESS_GROUP}
}

func prepareProcessGroup(cmd *exec.Cmd) (*processGroupState, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return nil, fmt.Errorf("create Windows Job Object: %w", err)
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	if _, err := windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	); err != nil {
		windows.CloseHandle(job)
		return nil, fmt.Errorf("configure Windows Job Object: %w", err)
	}
	cmd.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_SUSPENDED | windows.CREATE_NEW_PROCESS_GROUP}
	return &processGroupState{cmd: cmd, job: job}, nil
}

func startProcessGroup(group *processGroupState) error {
	if err := group.cmd.Start(); err != nil {
		closeProcessGroup(group)
		return err
	}
	if err := assignAndResume(group); err != nil {
		_ = group.cmd.Process.Kill()
		_ = group.cmd.Wait()
		closeProcessGroup(group)
		return err
	}
	return nil
}

func assignAndResume(group *processGroupState) error {
	process, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(group.cmd.Process.Pid),
	)
	if err != nil {
		return fmt.Errorf("open suspended Runtime worker: %w", err)
	}
	defer windows.CloseHandle(process)
	if err := windows.AssignProcessToJobObject(group.job, process); err != nil {
		return fmt.Errorf("assign Runtime worker to Windows Job Object: %w", err)
	}
	if err := resumeProcessThreads(uint32(group.cmd.Process.Pid)); err != nil {
		return fmt.Errorf("resume Runtime worker: %w", err)
	}
	return nil
}

func resumeProcessThreads(pid uint32) error {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
	if err != nil {
		return err
	}
	defer windows.CloseHandle(snapshot)
	entry := windows.ThreadEntry32{Size: uint32(unsafe.Sizeof(windows.ThreadEntry32{}))}
	if err := windows.Thread32First(snapshot, &entry); err != nil {
		return err
	}
	resumed := false
	for {
		if entry.OwnerProcessID == pid {
			thread, openErr := windows.OpenThread(windows.THREAD_SUSPEND_RESUME, false, entry.ThreadID)
			if openErr != nil {
				return openErr
			}
			_, resumeErr := windows.ResumeThread(thread)
			windows.CloseHandle(thread)
			if resumeErr != nil {
				return resumeErr
			}
			resumed = true
		}
		if err := windows.Thread32Next(snapshot, &entry); err != nil {
			if err == windows.ERROR_NO_MORE_FILES {
				break
			}
			return err
		}
	}
	if !resumed {
		return fmt.Errorf("suspended Runtime worker has no thread")
	}
	return nil
}

func signalConfiguredProcessGroup(group *processGroupState) error {
	if group == nil || group.cmd == nil || group.cmd.Process == nil {
		return nil
	}
	return windows.GenerateConsoleCtrlEvent(windows.CTRL_BREAK_EVENT, uint32(group.cmd.Process.Pid))
}

func killConfiguredProcessGroup(group *processGroupState) {
	closeProcessGroup(group)
}

func killProcessGroup(cmd *exec.Cmd) {
	if cmd == nil || cmd.Process == nil {
		return
	}
	_ = cmd.Process.Kill()
}

func closeProcessGroup(group *processGroupState) {
	if group == nil {
		return
	}
	group.closeOnce.Do(func() { _ = windows.CloseHandle(group.job) })
}
