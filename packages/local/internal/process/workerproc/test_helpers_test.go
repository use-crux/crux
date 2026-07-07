package workerproc

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

func fakePersistentWorker(t *testing.T) string {
	t.Helper()
	script := `while IFS= read -r line; do
case "$line" in
  *slow*) sleep 10 ;;
  *crash*) exit 3 ;;
  *error*) printf '{"error":"bad request"}\n' ;;
  *large*) printf '{"value":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"}\n' ;;
  *) printf '{"value":"ok"}\n' ;;
esac
done
`
	return writeShellScript(t, "persistent-worker.sh", script)
}

func fakePrewarmWorker(t *testing.T) string {
	t.Helper()
	script := `printf started > "$1"
while IFS= read -r line; do
  printf '{"value":"ok"}\n'
done
`
	return writeShellScript(t, "prewarm-worker.sh", script)
}

func fakeStubbornWorker(t *testing.T) string {
	t.Helper()
	script := `while IFS= read -r line; do
  printf '{"value":"ok"}\n'
done
while :; do sleep 10; done
`
	return writeShellScript(t, "stubborn-worker.sh", script)
}

func fakeStreamWorker(t *testing.T) string {
	t.Helper()
	script := `printf '{"type":"first"}\n'
printf 'not-json\n'
printf '{"type":"second"}\n'
printf 'stream stderr\n' >&2
exit 7
`
	return writeShellScript(t, "stream-worker.sh", script)
}

func fakeSessionWorker(t *testing.T) string {
	t.Helper()
	script := `count=0
while IFS= read -r line; do
  count=$((count + 1))
  case "$line" in
    *done*)
      printf '{"type":"summary","count":%s}\n' "$count"
      printf '{"type":"done"}\n'
      ;;
  esac
done
`
	return writeShellScript(t, "session-worker.sh", script)
}

func fakeSlowStreamWorker(t *testing.T) string {
	t.Helper()
	return writeShellScript(t, "slow-stream-worker.sh", "sleep 10\n")
}

func writeShellScript(t *testing.T, name string, script string) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script subprocess tests require a POSIX shell")
	}
	path := filepath.Join(t.TempDir(), name)
	if err := os.WriteFile(path, []byte(script), 0o755); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
	return path
}

func shellPath(t *testing.T) string {
	t.Helper()
	if runtime.GOOS == "windows" {
		t.Skip("shell script subprocess tests require a POSIX shell")
	}
	return "/bin/sh"
}

func waitForFile(t *testing.T, path string) {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for {
		if _, err := os.Stat(path); err == nil {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("file %s was not created", path)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
