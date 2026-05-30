package commands

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"
)

// findListeningPID returns the PID of the process listening on the given TCP
// port, best-effort and cross-platform. Empty string when not found.
func findListeningPID(port int) string {
	switch runtime.GOOS {
	case "linux", "darwin":
		// Try lsof first (most reliable), then fall back to `ss`.
		if pid := runForPID("lsof", "-iTCP:"+itoa(port), "-sTCP:LISTEN", "-t", "-Pn"); pid != "" {
			return pid
		}
		if pid := pidFromSS(port); pid != "" {
			return pid
		}
		return pidFromFuser(port)
	case "windows":
		return pidFromNetstat(port)
	}
	return ""
}

// killCommand returns the platform-appropriate one-liner the user can copy to
// kill the listener.
func killCommand(pid string) string {
	if runtime.GOOS == "windows" {
		return "taskkill /PID " + pid + " /F"
	}
	return "kill " + pid
}

// findListenerHint returns a copy-paste command that prints the listener's
// PID. Used when we couldn't find it ourselves (e.g. lsof not installed).
func findListenerHint(port int) string {
	switch runtime.GOOS {
	case "windows":
		return fmt.Sprintf("netstat -ano | findstr :%d", port)
	default:
		return fmt.Sprintf("lsof -iTCP:%d -sTCP:LISTEN", port)
	}
}

func runForPID(name string, args ...string) string {
	out, err := exec.Command(name, args...).Output()
	if err != nil {
		return ""
	}
	pid := strings.TrimSpace(string(out))
	// lsof -t can return multiple PIDs (one per line). Take the first.
	if idx := strings.IndexAny(pid, "\r\n"); idx >= 0 {
		pid = pid[:idx]
	}
	if _, err := atoiSafe(pid); err != nil {
		return ""
	}
	return pid
}

func pidFromSS(port int) string {
	out, err := exec.Command("ss", "-ltnp", "sport", "=", ":"+itoa(port)).Output()
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(out), "\n") {
		// users:(("crux",pid=12345,fd=7))
		if i := strings.Index(line, "pid="); i >= 0 {
			rest := line[i+4:]
			j := strings.IndexAny(rest, ",)")
			if j > 0 {
				if _, err := atoiSafe(rest[:j]); err == nil {
					return rest[:j]
				}
			}
		}
	}
	return ""
}

func pidFromFuser(port int) string {
	out, err := exec.Command("fuser", itoa(port)+"/tcp").Output()
	if err != nil {
		return ""
	}
	pid := strings.TrimSpace(string(out))
	if _, err := atoiSafe(pid); err == nil {
		return pid
	}
	return ""
}

func pidFromNetstat(port int) string {
	out, err := exec.Command("netstat", "-ano", "-p", "TCP").Output()
	if err != nil {
		return ""
	}
	needle := fmt.Sprintf(":%d ", port)
	for _, line := range strings.Split(string(out), "\n") {
		if !strings.Contains(line, needle) || !strings.Contains(line, "LISTENING") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) >= 5 {
			if _, err := atoiSafe(fields[len(fields)-1]); err == nil {
				return fields[len(fields)-1]
			}
		}
	}
	return ""
}

func itoa(i int) string  { return fmt.Sprintf("%d", i) }
func atoiSafe(s string) (int, error) {
	var n int
	_, err := fmt.Sscanf(s, "%d", &n)
	if err != nil {
		return 0, err
	}
	return n, nil
}
