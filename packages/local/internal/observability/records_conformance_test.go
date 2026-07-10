package observability

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
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

func TestComparisonFixtureToleratesExternalRunEdgeRefs(t *testing.T) {
	ctx := context.Background()
	fixtures := loadConformanceFixtures(t)
	var comparison *conformanceFixture
	for i := range fixtures {
		if fixtures[i].Name == "comparison-report.json" {
			comparison = &fixtures[i]
			break
		}
	}
	if comparison == nil {
		t.Fatal("comparison-report.json fixture missing")
	}

	service := newTestService(t)
	if err := service.Ingest(ctx, comparison.Batch); err != nil {
		t.Fatalf("comparison fixture ingest failed: %v", err)
	}
	if _, err := service.RunDetail(ctx, "run_dddddddddddddddddddddddd"); err != nil {
		t.Fatalf("RunDetail failed for comparison fixture with external edge target: %v", err)
	}
}

func TestSharedTaxonomyFixtureMatchesGoTaxonomy(t *testing.T) {
	var taxonomy taxonomyFixture
	raw := readCoreObservabilityFixture(t, "taxonomy.json")
	if err := json.Unmarshal(raw, &taxonomy); err != nil {
		t.Fatal(err)
	}

	if !reflect.DeepEqual(taxonomy.PrimitiveFamilies, primitiveFamilyByName) {
		t.Fatalf("primitive family taxonomy drift\nfixture=%v\ngo=%v", taxonomy.PrimitiveFamilies, primitiveFamilyByName)
	}
	if got := stringSet(taxonomy.ArtifactKinds); !reflect.DeepEqual(got, canonicalArtifactKinds) {
		t.Fatalf("artifact taxonomy drift\nfixture=%v\ngo=%v", taxonomy.ArtifactKinds, got)
	}
	if got := stringSet(taxonomy.EdgeTypes); !reflect.DeepEqual(got, canonicalEdgeTypes) {
		t.Fatalf("edge taxonomy drift\nfixture=%v\ngo=%v", taxonomy.EdgeTypes, got)
	}
}

func TestSharedV2ContractFixturesValidateSegmentView(t *testing.T) {
	var corpus v2ContractCorpus
	raw := readCoreObservabilityFixture(t, "v2-contract-cases.json")
	if err := json.Unmarshal(raw, &corpus); err != nil {
		t.Fatal(err)
	}
	wantNames := []string{
		"one-segment-success",
		"one-segment-error",
		"one-segment-cancelled",
		"suspend-resume-fresh-process",
		"concurrent-segments",
		"child-before-parent-and-terminal-before-start",
		"duplicate-identical-and-conflicting-record-id",
		"pre-v2-local-store-migration-reset",
		"missing-parent-segment-gap",
		"crash-incomplete-distinct-from-suspend-and-terminal",
	}
	gotNames := make([]string, 0, len(corpus.Cases))
	for _, testCase := range corpus.Cases {
		gotNames = append(gotNames, testCase.Name)
	}
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("case names = %#v, want %#v", gotNames, wantNames)
	}

	for _, testCase := range corpus.Cases {
		if len(testCase.Records) != len(testCase.Expected) {
			t.Fatalf("%s records = %d, expected = %d", testCase.Name, len(testCase.Records), len(testCase.Expected))
		}
		phase3BaseEnvelopeOnly := testCase.Name == "suspend-resume-fresh-process" ||
			testCase.Name == "concurrent-segments" ||
			testCase.Name == "crash-incomplete-distinct-from-suspend-and-terminal"
		for i, record := range testCase.Records {
			var err error
			if phase3BaseEnvelopeOnly {
				// Phase 3 owns lifecycle record behavior; Phase 1 only proves the
				// future examples carry the v2 base envelope.
				err = ValidateRecordBase(record)
			} else {
				err = ValidateRecord(record)
			}
			if err != nil {
				t.Fatalf("%s record %s failed validation: %v", testCase.Name, record.RecordID, err)
			}
			got := v2ContractExpected{
				RecordID:      record.RecordID,
				SchemaVersion: record.SchemaVersion,
				SegmentID:     record.SegmentID,
				SegmentSeq:    record.SegmentSeq,
			}
			if !reflect.DeepEqual(got, testCase.Expected[i]) {
				t.Fatalf("%s normalized[%d] = %#v, want %#v", testCase.Name, i, got, testCase.Expected[i])
			}
		}
	}
}

type conformanceFixture struct {
	Name  string
	Batch Batch
}

type taxonomyFixture struct {
	PrimitiveFamilies map[string]string `json:"primitiveFamilies"`
	ArtifactKinds     []string          `json:"artifactKinds"`
	EdgeTypes         []string          `json:"edgeTypes"`
}

type v2ContractCorpus struct {
	Cases []v2ContractCase `json:"cases"`
}

type v2ContractCase struct {
	Name     string               `json:"name"`
	Records  []Record             `json:"records"`
	Expected []v2ContractExpected `json:"expected"`
}

type v2ContractExpected struct {
	RecordID      string `json:"recordId"`
	SchemaVersion int    `json:"schemaVersion"`
	SegmentID     string `json:"segmentId"`
	SegmentSeq    int    `json:"segmentSeq"`
}

func loadConformanceFixtures(t *testing.T) []conformanceFixture {
	t.Helper()
	files := globCoreObservabilityFixtures(t, "*.json")
	fixtures := make([]conformanceFixture, 0, len(files))
	for _, file := range files {
		if filepath.Base(file) == "taxonomy.json" {
			continue
		}
		if filepath.Base(file) == "v2-contract-cases.json" {
			continue
		}
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

func stringSet(values []string) map[string]struct{} {
	set := make(map[string]struct{}, len(values))
	for _, value := range values {
		set[value] = struct{}{}
	}
	return set
}
