package observability

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSharedFixtureCorpusConformance(t *testing.T) {
	ctx := context.Background()
	fixtures := loadConformanceFixtures(t)

	knownRecordTypes := map[RecordType]bool{
		RecordRunStart:  false,
		RecordRunEnd:    false,
		RecordSpanStart: false,
		RecordSpanEnd:   false,
		RecordSpan:      false,
		RecordSpanEvent: false,
		RecordArtifact:  false,
		RecordEdge:      false,
	}

	for _, fixture := range fixtures {
		service := newTestService(t)
		for _, record := range fixture.Batch.Records {
			if err := ValidateRecord(record); err != nil {
				t.Fatalf("%s record %s failed validation: %v", fixture.Name, record.RecordID, err)
			}
			if _, ok := knownRecordTypes[record.Type]; ok {
				knownRecordTypes[record.Type] = true
			}
		}
		if err := service.Ingest(ctx, fixture.Batch); err != nil {
			t.Fatalf("%s failed ingest: %v", fixture.Name, err)
		}
	}

	for recordType, covered := range knownRecordTypes {
		if !covered {
			t.Fatalf("fixture corpus does not cover record type %q", recordType)
		}
	}
}

func TestForwardCompatFixturesPreserveRawPayloads(t *testing.T) {
	ctx := context.Background()
	fixtures := loadConformanceFixtures(t)

	for _, fixture := range fixtures {
		if !strings.HasPrefix(fixture.Name, "forward-") {
			continue
		}

		service := newTestService(t)
		if err := service.Ingest(ctx, fixture.Batch); err != nil {
			t.Fatalf("%s failed ingest: %v", fixture.Name, err)
		}
		if fixture.Name == "forward-unknown-record.json" && service.unknownRecordTypes.Load() != 1 {
			t.Fatalf("%s unknown record counter = %d, want 1", fixture.Name, service.unknownRecordTypes.Load())
		}
		for _, record := range fixture.Batch.Records {
			records, err := service.listRecords(ctx, record.RunID)
			if err != nil {
				t.Fatalf("%s failed raw record read: %v", fixture.Name, err)
			}
			if len(records) != len(fixture.Batch.Records) {
				t.Fatalf("%s stored records = %d, want %d", fixture.Name, len(records), len(fixture.Batch.Records))
			}
			if !strings.Contains(records[0].PayloadJSON, `"futureField"`) {
				t.Fatalf("%s payload = %s, want futureField preserved", fixture.Name, records[0].PayloadJSON)
			}
		}
	}
}

type conformanceFixture struct {
	Name  string
	Batch Batch
}

func loadConformanceFixtures(t *testing.T) []conformanceFixture {
	t.Helper()
	files, err := filepath.Glob("../../../core/observability/fixtures/*.json")
	if err != nil {
		t.Fatal(err)
	}
	fixtures := make([]conformanceFixture, 0, len(files))
	for _, file := range files {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var batch Batch
		if err := json.Unmarshal(raw, &batch); err != nil {
			t.Fatalf("%s failed decode: %v", file, err)
		}
		fixtures = append(fixtures, conformanceFixture{
			Name:  filepath.Base(file),
			Batch: batch,
		})
	}
	return fixtures
}
