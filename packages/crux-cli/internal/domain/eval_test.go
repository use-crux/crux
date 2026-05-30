package domain

import "testing"

func TestDeriveStatus_success(t *testing.T) {
	result := &EvalRunResult{Name: "test"}
	if s := DeriveStatus(result); s != "success" {
		t.Errorf("expected success, got %s", s)
	}
}

func TestDeriveStatus_error(t *testing.T) {
	result := &EvalRunResult{Name: "test", Error: "something broke"}
	if s := DeriveStatus(result); s != "error" {
		t.Errorf("expected error, got %s", s)
	}
}

func TestDeriveStatus_fail(t *testing.T) {
	result := &EvalRunResult{
		Name: "test",
		Report: &EvalReport{
			Summary: EvalReportSummary{Total: 3, Passed: 2, Failed: 1},
		},
	}
	if s := DeriveStatus(result); s != "fail" {
		t.Errorf("expected fail, got %s", s)
	}
}

func TestDeriveStatus_errorTakesPrecedence(t *testing.T) {
	result := &EvalRunResult{
		Name:  "test",
		Error: "crash",
		Report: &EvalReport{
			Summary: EvalReportSummary{Total: 3, Passed: 2, Failed: 1},
		},
	}
	// Error should take precedence over failures.
	if s := DeriveStatus(result); s != "error" {
		t.Errorf("expected error, got %s", s)
	}
}

func TestDeriveStatus_allPassed(t *testing.T) {
	result := &EvalRunResult{
		Name: "test",
		Report: &EvalReport{
			Summary: EvalReportSummary{Total: 5, Passed: 5, Failed: 0},
		},
	}
	if s := DeriveStatus(result); s != "success" {
		t.Errorf("expected success, got %s", s)
	}
}
