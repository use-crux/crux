//go:build linux

package anydocsupervisor

import (
	"os"
	"testing"
	"time"
)

const systemdIntegrationEnv = "CRUX_SYSTEMD_INTEGRATION"

// requireSystemdIntegration keeps the expensive host-containment gate out of
// ordinary developer test runs. CI sets the variable and must then provide a
// real system bus; an unavailable bus is a failure, never a skip.
func requireSystemdIntegration(t *testing.T) {
	t.Helper()
	if os.Getenv(systemdIntegrationEnv) != "1" {
		t.Skipf("set %s=1 to run the real systemd containment gate", systemdIntegrationEnv)
	}
}

func TestSystemdIntegrationGate(t *testing.T) {
	old := os.Getenv(systemdIntegrationEnv)
	t.Cleanup(func() { _ = os.Setenv(systemdIntegrationEnv, old) })
	_ = os.Unsetenv(systemdIntegrationEnv)
	if os.Getenv(systemdIntegrationEnv) == "1" {
		t.Fatal("test setup did not clear integration gate")
	}
}

func TestHostileContainmentSpecContract(t *testing.T) {
	spec, err := newTestServiceSpec("/run/crux-anydoc-test/input/source", "/run/crux-anydoc-test/runtime", "/run/crux-anydoc-test/private", Limits{
		MemoryMax:       64 << 20,
		TasksMax:        8,
		CPUQuotaPercent: 25,
		RuntimeMax:      2 * time.Second,
	})
	if err != nil {
		t.Fatal(err)
	}

	properties := propertiesByName(systemdProperties(spec))
	for _, check := range []struct {
		name string
		ok   bool
	}{
		{"filesystem fixed input and private temporary directory", len(spec.BindReadOnlyPaths) == 2 && len(spec.ReadWritePaths) == 1 && spec.ProtectSystem == "strict" && spec.ProtectHome && spec.PrivateTmp},
		{"network IPv4 IPv6 and DNS denial", spec.PrivateNetwork && same(spec.RestrictAddressFamilies, []string{"AF_UNIX"})},
		{"no new privileges capabilities uid namespace", spec.NoNewPrivileges && properties["DynamicUser"] == true && properties["PrivateUsers"] == true && properties["CapabilityBoundingSet"] == uint64(0) && properties["AmbientCapabilities"] == uint64(0)},
		{"memory and pids bounded", spec.MemoryMax == 64<<20 && spec.MemorySwapMax == 0 && spec.TasksMax == 8},
		{"CPU and wall clock bounded", spec.CPUQuotaPercent == 25 && spec.RuntimeMax == 2*time.Second && spec.KillMode == "control-group"},
	} {
		t.Run(check.name, func(t *testing.T) {
			if !check.ok {
				t.Fatal("containment property missing")
			}
		})
	}
}
