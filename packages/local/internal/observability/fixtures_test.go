package observability

import (
	"os"
	"path/filepath"
	"regexp"
	"testing"
)

const coreObservabilityFixturesDir = "../../../core/src/observability/fixtures"
const coreEvidenceFixturesDir = "../../../core/src/evidence/fixtures"

func readCoreObservabilityFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(coreObservabilityFixturesDir, name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func readCoreEvidenceFixture(t *testing.T, name string) []byte {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(coreEvidenceFixturesDir, name))
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func globCoreObservabilityFixtures(t *testing.T, pattern string) []string {
	t.Helper()
	files, err := filepath.Glob(filepath.Join(coreObservabilityFixturesDir, pattern))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) == 0 {
		t.Fatalf("no shared observability fixtures matched %q", filepath.Join(coreObservabilityFixturesDir, pattern))
	}
	return files
}

func TestPositiveInlineV2FixturesKeepSegmentIdentityUnique(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	recordPattern := regexp.MustCompile(`\{"schemaVersion":2[^` + "`" + `\n]*\}`)
	fieldPattern := func(name string) *regexp.Regexp {
		return regexp.MustCompile(`"` + name + `":"([^"]+)"`)
	}
	seqPattern := regexp.MustCompile(`"segmentSeq":(\d+)`)
	recordIDPattern := fieldPattern("recordId")
	runIDPattern := fieldPattern("runId")
	segmentIDPattern := fieldPattern("segmentId")

	segmentOwners := map[string]string{}
	slots := map[string]string{}
	inspected := 0
	for _, file := range files {
		if filepath.Base(file) == "storage_v2_test.go" {
			continue
		}
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		for _, match := range recordPattern.FindAllString(string(raw), -1) {
			recordIDMatch := recordIDPattern.FindStringSubmatch(match)
			runIDMatch := runIDPattern.FindStringSubmatch(match)
			segmentIDMatch := segmentIDPattern.FindStringSubmatch(match)
			seqMatch := seqPattern.FindStringSubmatch(match)
			if recordIDMatch == nil || runIDMatch == nil || segmentIDMatch == nil || seqMatch == nil {
				continue
			}
			inspected++
			recordID := recordIDMatch[1]
			runID := runIDMatch[1]
			segmentID := segmentIDMatch[1]
			if segmentID == "seg_inline" {
				t.Fatalf("%s record %s uses shared seg_inline", file, recordID)
			}
			if owner, ok := segmentOwners[segmentID]; ok && owner != runID {
				t.Fatalf("%s record %s maps segment %s to run %s after run %s", file, recordID, segmentID, runID, owner)
			}
			segmentOwners[segmentID] = runID

			slot := runID + "\x00" + segmentID + "\x00" + seqMatch[1]
			if previous, ok := slots[slot]; ok && previous != recordID {
				t.Fatalf("%s record %s reuses segment slot %q already used by %s", file, recordID, slot, previous)
			}
			slots[slot] = recordID
		}
	}
	if inspected == 0 {
		t.Fatal("inspected 0 inline v2 records")
	}
}
