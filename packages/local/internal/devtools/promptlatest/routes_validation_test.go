package promptlatest

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type resolverFunc func(context.Context, string) (Result, error)

func (resolve resolverFunc) Resolve(
	ctx context.Context,
	definitionID string,
) (Result, error) {
	return resolve(ctx, definitionID)
}

func TestLatestRunRouteProjectsClosedEmptyAndUnavailableResults(t *testing.T) {
	for _, test := range []struct {
		name       string
		result     Result
		wantStatus int
		wantBody   string
	}{
		{
			name: "empty with exact preview",
			result: Result{
				Status: StatusEmpty, DefinitionID: "prompt:greeting",
				ObservabilityRevision: 11, ExactPreviewAvailable: true,
			},
			wantStatus: http.StatusOK,
			wantBody: `{"status":"empty","definitionId":"prompt:greeting",` +
				`"observabilityRevision":11,` +
				`"path":"/library/index/prompt%3Agreeting/runs",` +
				`"exactPreview":{"status":"available"}}`,
		},
		{
			name: "owner not found",
			result: Result{
				Status: StatusUnavailable, UnavailableReason: ReasonOwnerNotFound,
			},
			wantStatus: http.StatusOK,
			wantBody: `{"status":"unavailable","reason":"owner-not-found",` +
				`"message":"This Prompt is no longer present in the current Project Index."}`,
		},
		{
			name: "owner not prompt",
			result: Result{
				Status: StatusUnavailable, UnavailableReason: ReasonOwnerNotPrompt,
			},
			wantStatus: http.StatusOK,
			wantBody: `{"status":"unavailable","reason":"owner-not-prompt",` +
				`"message":"Latest Run is available only for canonical Prompt definitions."}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := NewHandler(http.NotFoundHandler(), resolverStub{
				result: test.result,
			})
			request := validLatestRunRequest(t, "prompt%3Agreeting")
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != test.wantStatus ||
				response.Body.String() != test.wantBody {
				t.Fatalf(
					"response = %d %s, want %d %s",
					response.Code,
					response.Body.String(),
					test.wantStatus,
					test.wantBody,
				)
			}
		})
	}
}

func TestLatestRunRouteDecodesOneStrictPathComponent(t *testing.T) {
	for _, test := range []struct {
		name      string
		component string
		wantID    string
		wantCode  int
	}{
		{name: "unicode", component: "prompt%3A%E2%9C%93", wantID: "prompt:✓", wantCode: 200},
		{name: "plus remains plus", component: "prompt+plus", wantID: "prompt+plus", wantCode: 200},
		{name: "double encoding stays encoded", component: "prompt%253Aid", wantID: "prompt%3Aid", wantCode: 200},
		{name: "encoded slash", component: "prompt%2Fid", wantCode: 400},
		{name: "encoded backslash", component: "prompt%5Cid", wantCode: 400},
		{name: "control", component: "prompt%00id", wantCode: 400},
		{name: "extra component", component: "prompt/id", wantCode: 400},
	} {
		t.Run(test.name, func(t *testing.T) {
			var gotID string
			handler := NewHandler(http.NotFoundHandler(), resolverFunc(
				func(_ context.Context, definitionID string) (Result, error) {
					gotID = definitionID
					return Result{
						Status: StatusEmpty, DefinitionID: definitionID,
					}, nil
				},
			))
			request := validLatestRunRequest(t, test.component)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != test.wantCode {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			if gotID != test.wantID {
				t.Fatalf("definition ID = %q, want %q", gotID, test.wantID)
			}
		})
	}
}

func TestLatestRunRouteRejectsProtectionAndEnvelopeViolations(t *testing.T) {
	for _, test := range []struct {
		name     string
		mutate   func(*http.Request)
		wantCode int
		wantKey  string
	}{
		{
			name: "missing header",
			mutate: func(request *http.Request) {
				request.Header.Del(RequestHeader)
			},
			wantCode: 403, wantKey: `"code":"forbidden"`,
		},
		{
			name: "foreign origin",
			mutate: func(request *http.Request) {
				request.Header.Set("Origin", "http://foreign.test")
			},
			wantCode: 403, wantKey: `"code":"forbidden"`,
		},
		{
			name: "multiple origins",
			mutate: func(request *http.Request) {
				request.Header.Add("Origin", "http://127.0.0.1:7821")
				request.Header.Add("Origin", "http://127.0.0.1:7821")
			},
			wantCode: 403, wantKey: `"code":"forbidden"`,
		},
		{
			name: "query",
			mutate: func(request *http.Request) {
				request.URL.RawQuery = "owner=other"
				request.RequestURI += "?owner=other"
			},
			wantCode: 400, wantKey: `"code":"invalid_request"`,
		},
		{
			name: "oversized target",
			mutate: func(request *http.Request) {
				request.RequestURI += strings.Repeat("x", maxRequestTargetBytes)
			},
			wantCode: 400, wantKey: `"code":"invalid_request"`,
		},
		{
			name: "transfer encoding",
			mutate: func(request *http.Request) {
				request.TransferEncoding = []string{"chunked"}
			},
			wantCode: 400, wantKey: `"code":"invalid_request"`,
		},
		{
			name: "wrong method",
			mutate: func(request *http.Request) {
				request.Method = http.MethodPost
			},
			wantCode: 405, wantKey: `"code":"method_not_allowed"`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := NewHandler(http.NotFoundHandler(), resolverStub{})
			request := validLatestRunRequest(t, "prompt%3Agreeting")
			test.mutate(request)
			response := httptest.NewRecorder()

			handler.ServeHTTP(response, request)

			if response.Code != test.wantCode ||
				!strings.Contains(response.Body.String(), test.wantKey) {
				t.Fatalf("response = %d %s", response.Code, response.Body.String())
			}
			if response.Header().Get("Location") != "" ||
				response.Header().Get("Access-Control-Allow-Origin") != "" {
				t.Fatalf("unsafe headers = %#v", response.Header())
			}
		})
	}
}

func TestLatestRunRouteRejectsBodyWithoutReadingIt(t *testing.T) {
	handler := NewHandler(http.NotFoundHandler(), resolverStub{})
	request := validLatestRunRequest(t, "prompt%3Agreeting")
	request.Body = panicReadCloser{}
	request.ContentLength = 1
	response := httptest.NewRecorder()

	handler.ServeHTTP(response, request)

	if response.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
	}
}

func TestLatestRunRouteFailsClosedOnUnsafeServiceIdentity(t *testing.T) {
	for _, result := range []Result{
		{
			Status: StatusFound, DefinitionID: "prompt:other",
			ObservabilityRevision: 1, OperationID: "operation",
		},
		{
			Status: StatusFound, DefinitionID: "prompt:greeting",
			ObservabilityRevision: -1, OperationID: "operation",
		},
		{
			Status: StatusFound, DefinitionID: "prompt:greeting",
			ObservabilityRevision: maxSafeInteger + 1, OperationID: "operation",
		},
		{
			Status: StatusFound, DefinitionID: "prompt:greeting",
			ObservabilityRevision: 1, OperationID: "",
		},
	} {
		handler := NewHandler(http.NotFoundHandler(), resolverStub{result: result})
		request := validLatestRunRequest(t, "prompt%3Agreeting")
		response := httptest.NewRecorder()

		handler.ServeHTTP(response, request)

		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("result %+v produced %d %s", result, response.Code, response.Body.String())
		}
	}
}

func validLatestRunRequest(t *testing.T, component string) *http.Request {
	t.Helper()
	request := httptest.NewRequest(
		http.MethodGet,
		"http://127.0.0.1:7821"+routePrefix+component,
		nil,
	)
	request.Header.Set(RequestHeader, RequestHeaderValue)
	return request
}

type panicReadCloser struct{}

func (panicReadCloser) Read([]byte) (int, error) {
	panic("latest-Run handler read a rejected request body")
}

func (panicReadCloser) Close() error {
	return nil
}

var _ io.ReadCloser = panicReadCloser{}
