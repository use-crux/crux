// Package api provides an HTTP client for the crux devtools server REST API.
// All methods accept a context for cancellation and timeout control.
// If the server is unreachable, methods return a user-friendly error with
// instructions on how to start it.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

// ErrNotFound identifies a 404 response without exposing the response body.
var ErrNotFound = errors.New("not found")

// Client talks to a running crux devtools server over HTTP.
// Create one with [New] or [NewDefault]. All request methods are safe
// for concurrent use (the underlying http.Client handles connection pooling).
type Client struct {
	BaseURL    string
	httpClient *http.Client
	command    string
}

// New creates a client targeting the given base URL (e.g. "http://localhost:4400").
// The client uses a 10-second timeout for all requests.
func New(baseURL string) *Client {
	return &Client{
		BaseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

// NewDefault creates a client targeting http://localhost on the given port.
func NewDefault(port int) *Client {
	return New(fmt.Sprintf("http://localhost:%d", port))
}

// WithCommand returns a shallow copy whose connection remediation names the
// CLI command that issued the request.
func (c *Client) WithCommand(command string) *Client {
	clone := *c
	clone.command = command
	return &clone
}

func (c *Client) connectError() error {
	port := "4400"
	if parsed, err := url.Parse(c.BaseURL); err == nil && parsed.Port() != "" {
		port = parsed.Port()
	}
	command := c.command
	if command == "" {
		command = "<command>"
	}
	return fmt.Errorf(
		"cannot connect to crux devtools at %s\n\n  Start the server first:  crux dev\n  Or specify a port:       crux --port %s %s",
		c.BaseURL,
		port,
		command,
	)
}

func (c *Client) doGet(ctx context.Context, path string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.BaseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, c.connectError()
	}
	return resp, nil
}

// Ping checks whether the devtools server is reachable by hitting /api/stats.
// Returns nil on success or a descriptive error if the server is down.
func (c *Client) Ping(ctx context.Context) error {
	resp, err := c.doGet(ctx, "/api/stats")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != 200 {
		return fmt.Errorf("server responded with %d", resp.StatusCode)
	}
	return nil
}

// GetJSON fetches the given API path and JSON-decodes the response into target.
// Returns a descriptive error if the server is unreachable, responds with a
// non-200 status, or the response body cannot be decoded.
func (c *Client) GetJSON(ctx context.Context, path string, target any) error {
	resp, err := c.doGet(ctx, path)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return ErrNotFound
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}

	return json.NewDecoder(resp.Body).Decode(target)
}

// PostJSON posts a JSON request body and decodes the JSON response into target.
func (c *Client) PostJSON(ctx context.Context, path string, body any, target any) error {
	return c.postJSON(ctx, path, body, target, false)
}

// PostJSONStrict posts JSON and rejects unknown or trailing response fields.
// Use it for versioned private ABIs whose closed shape is part of correctness.
func (c *Client) PostJSONStrict(ctx context.Context, path string, body any, target any) error {
	return c.postJSON(ctx, path, body, target, true)
}

func (c *Client) postJSON(
	ctx context.Context,
	path string,
	body any,
	target any,
	strict bool,
) error {
	var payload bytes.Buffer
	if err := json.NewEncoder(&payload).Encode(body); err != nil {
		return fmt.Errorf("failed to encode request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.BaseURL+path, &payload)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return c.connectError()
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(data))
	}

	decoder := json.NewDecoder(resp.Body)
	if strict {
		decoder.DisallowUnknownFields()
	}
	if err := decoder.Decode(target); err != nil {
		return err
	}
	if strict {
		if err := decoder.Decode(&struct{}{}); err != io.EOF {
			if err == nil {
				return fmt.Errorf("decode JSON response: trailing data")
			}
			return fmt.Errorf("decode JSON response trailing data: %w", err)
		}
	}
	return nil
}

// DeleteJSON sends a JSON DELETE request and decodes the JSON response into target.
func (c *Client) DeleteJSON(ctx context.Context, path string, body any, target any) error {
	var payload io.Reader
	if body != nil {
		var buf bytes.Buffer
		if err := json.NewEncoder(&buf).Encode(body); err != nil {
			return fmt.Errorf("failed to encode request: %w", err)
		}
		payload = &buf
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodDelete, c.BaseURL+path, payload)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return c.connectError()
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return ErrNotFound
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		data, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("server error %d: %s", resp.StatusCode, string(data))
	}
	if target == nil {
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(target)
}

// GetRaw fetches the given API path and returns the response body as raw JSON bytes.
// Useful when the caller needs to forward the response without decoding it.
func (c *Client) GetRaw(ctx context.Context, path string) (json.RawMessage, error) {
	resp, err := c.doGet(ctx, path)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 {
		return nil, ErrNotFound
	}
	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("server error %d: %s", resp.StatusCode, string(body))
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(data), nil
}

// ObservabilityRunsPage loads the revisioned Runs read-model page.
func (c *Client) ObservabilityRunsPage(ctx context.Context) (ObservabilityRunsPage, error) {
	var page ObservabilityRunsPage
	if err := c.GetJSON(ctx, "/api/observability/runs/page", &page); err != nil {
		return ObservabilityRunsPage{}, err
	}
	return page, nil
}

// ObservabilityRuns loads Runs rows for list-oriented CLI rendering.
func (c *Client) ObservabilityRuns(ctx context.Context) ([]ObservabilityRunSummary, error) {
	page, err := c.ObservabilityRunsPage(ctx)
	return page.Rows, err
}

func (c *Client) ObservabilityRunDetail(ctx context.Context, runID string) (ObservabilityRunDetail, bool, error) {
	var detail ObservabilityRunDetail
	err := c.GetJSON(ctx, "/api/observability/runs/"+runID, &detail)
	if err != nil {
		if err.Error() == "not found" {
			return ObservabilityRunDetail{}, false, nil
		}
		return ObservabilityRunDetail{}, false, err
	}
	return detail, true, nil
}

func (c *Client) ObservabilityGraph(ctx context.Context, runID string) (ObservabilityGraph, bool, error) {
	var graph ObservabilityGraph
	err := c.GetJSON(ctx, "/api/observability/runs/"+runID+"/graph", &graph)
	if err != nil {
		if err.Error() == "not found" {
			return ObservabilityGraph{}, false, nil
		}
		return ObservabilityGraph{}, false, err
	}
	return graph, true, nil
}

func (c *Client) ObservabilityResourceActivity(ctx context.Context, family string) ([]ObservabilityResourceActivity, error) {
	var activity []ObservabilityResourceActivity
	err := c.GetJSON(ctx, "/api/observability/resources/"+family, &activity)
	return activity, err
}

func (c *Client) DeleteInspectRuns(ctx context.Context, operationIDs []string) (InspectDeleteRunsRecord, error) {
	var record InspectDeleteRunsRecord
	err := c.DeleteJSON(ctx, "/api/inspect/runs", InspectDeleteRunsRequest{OperationIDs: operationIDs}, &record)
	return record, err
}

func (c *Client) DeleteInspectRun(ctx context.Context, operationID string) (InspectDeleteRunsRecord, bool, error) {
	var record InspectDeleteRunsRecord
	err := c.DeleteJSON(ctx, "/api/inspect/runs/"+url.PathEscape(operationID), nil, &record)
	if err != nil {
		if err.Error() == "not found" {
			return InspectDeleteRunsRecord{}, false, nil
		}
		return InspectDeleteRunsRecord{}, false, err
	}
	return record, true, nil
}

func (c *Client) InspectInsightSilences(ctx context.Context, includeDeleted bool) ([]InspectInsightSilenceRecord, error) {
	path := "/api/inspect/insights/silences"
	if includeDeleted {
		path += "?include=deleted"
	}
	var silences []InspectInsightSilenceRecord
	err := c.GetJSON(ctx, path, &silences)
	return silences, err
}

func (c *Client) CreateInspectInsightSilence(ctx context.Context, req InspectInsightSilenceRequest) (InspectInsightSilenceRecord, error) {
	var record InspectInsightSilenceRecord
	err := c.PostJSON(ctx, "/api/inspect/insights/silences", req, &record)
	return record, err
}

func (c *Client) DeleteInspectInsightSilence(ctx context.Context, silenceID string) (InspectInsightSilenceRecord, bool, error) {
	var record InspectInsightSilenceRecord
	err := c.DeleteJSON(ctx, "/api/inspect/insights/silences/"+url.PathEscape(silenceID), nil, &record)
	if err != nil {
		if err.Error() == "not found" {
			return InspectInsightSilenceRecord{}, false, nil
		}
		return InspectInsightSilenceRecord{}, false, err
	}
	return record, true, nil
}
