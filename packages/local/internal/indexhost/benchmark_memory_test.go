package indexhost

import (
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type processTreeMemoryMeasurement struct {
	startBytes uint64
	endBytes   uint64
	peakBytes  uint64
}

func measureProcessTreeMemoryDuring(run func() error) (processTreeMemoryMeasurement, error) {
	measurement := processTreeMemoryMeasurement{}
	if runtime.GOOS != "linux" {
		return measurement, run()
	}
	rootPID := os.Getpid()
	measurement.startBytes = processTreeRSSBytes(rootPID)
	measurement.peakBytes = measurement.startBytes
	stop := make(chan struct{})
	done := make(chan struct{})
	go func() {
		defer close(done)
		ticker := time.NewTicker(25 * time.Millisecond)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				measurement.peakBytes = max(measurement.peakBytes, processTreeRSSBytes(rootPID))
			case <-stop:
				return
			}
		}
	}()
	err := run()
	close(stop)
	<-done
	measurement.endBytes = processTreeRSSBytes(rootPID)
	measurement.peakBytes = max(measurement.peakBytes, measurement.endBytes)
	return measurement, err
}

func processTreeRSSBytes(rootPID int) uint64 {
	return processTreeRSSBytesForPID(rootPID, map[int]bool{})
}

func processTreeRSSBytesForPID(pid int, visited map[int]bool) uint64 {
	if visited[pid] {
		return 0
	}
	visited[pid] = true
	total := processRSSBytes(pid)
	for _, childPID := range childPIDs(pid) {
		total += processTreeRSSBytesForPID(childPID, visited)
	}
	return total
}

func processRSSBytes(pid int) uint64 {
	data, err := os.ReadFile(filepath.Join("/proc", strconv.Itoa(pid), "status"))
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if !strings.HasPrefix(line, "VmRSS:") {
			continue
		}
		fields := strings.Fields(line)
		if len(fields) < 2 {
			return 0
		}
		kib, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil {
			return 0
		}
		return kib * 1024
	}
	return 0
}

func childPIDs(pid int) []int {
	taskDir := filepath.Join("/proc", strconv.Itoa(pid), "task")
	entries, err := os.ReadDir(taskDir)
	if err != nil {
		return nil
	}
	seen := map[int]bool{}
	for _, entry := range entries {
		data, err := os.ReadFile(filepath.Join(taskDir, entry.Name(), "children"))
		if err != nil {
			continue
		}
		for _, raw := range strings.Fields(string(data)) {
			childPID, err := strconv.Atoi(raw)
			if err == nil && childPID > 0 {
				seen[childPID] = true
			}
		}
	}
	children := make([]int, 0, len(seen))
	for childPID := range seen {
		children = append(children, childPID)
	}
	return children
}

func bytesToMiB(value uint64) float64 {
	return float64(value) / 1024 / 1024
}
