package promptlatest

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
)

const (
	RequestHeader      = "X-Crux-Devtools-Request"
	RequestHeaderValue = "prompt-latest-run-v1"

	maxRequestTargetBytes = 8_192
	maxResponseBytes      = 16_384
	maxIDCodeUnits        = 512
	maxSafeInteger        = int64(9_007_199_254_740_991)
)

var messages = map[string]string{
	"owner-not-found":         "This Prompt is no longer present in the current Project Index.",
	"owner-not-prompt":        "Latest Run is available only for canonical Prompt definitions.",
	"invalid_request":         "The latest-Run request is invalid.",
	"forbidden":               "The latest-Run request is not allowed.",
	"method_not_allowed":      "This latest-Run method is not allowed.",
	"temporarily_unavailable": "Latest Run is temporarily unavailable. Retry.",
}

type resolverPort interface {
	Resolve(context.Context, string) (Result, error)
}

// NewHandler intercepts the private latest-Run facade and delegates all other
// requests unchanged. It never redirects, reads a request body, or exposes
// concrete Run and runtime payloads.
func NewHandler(next http.Handler, resolver resolverPort) http.Handler {
	return http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if !isLatestRunPath(request.URL.EscapedPath()) {
			next.ServeHTTP(writer, request)
			return
		}
		setPrivacyHeaders(writer)
		if request.Method != http.MethodGet {
			writeError(writer, http.StatusMethodNotAllowed, "method_not_allowed")
			return
		}
		if !validProtection(request) {
			writeError(writer, http.StatusForbidden, "forbidden")
			return
		}
		if request.ContentLength > 0 || len(request.TransferEncoding) > 0 {
			writeError(writer, http.StatusBadRequest, "invalid_request")
			return
		}
		definitionID, valid := parseDefinitionID(
			request.RequestURI,
			request.URL.EscapedPath(),
			request.URL.RawQuery,
			request.URL.ForceQuery,
			request.URL.Fragment,
		)
		if !valid {
			writeError(writer, http.StatusBadRequest, "invalid_request")
			return
		}
		result, err := resolver.Resolve(request.Context(), definitionID)
		if err != nil {
			writeError(writer, http.StatusServiceUnavailable, "temporarily_unavailable")
			return
		}
		writeResult(writer, definitionID, result)
	})
}

func isLatestRunPath(path string) bool {
	base := strings.TrimSuffix(routePrefix, "/")
	return path == base || strings.HasPrefix(path, routePrefix)
}

func validProtection(request *http.Request) bool {
	if values := request.Header.Values(RequestHeader); len(values) != 1 ||
		values[0] != RequestHeaderValue {
		return false
	}
	origins := request.Header.Values("Origin")
	if len(origins) == 0 {
		return true
	}
	if len(origins) != 1 {
		return false
	}
	origin, err := url.Parse(origins[0])
	if err != nil || origin.Scheme == "" || origin.Host == "" ||
		origin.User != nil || origin.Path != "" || origin.RawQuery != "" ||
		origin.Fragment != "" {
		return false
	}
	scheme := "http"
	if request.TLS != nil {
		scheme = "https"
	}
	return strings.EqualFold(origin.Scheme, scheme) &&
		strings.EqualFold(origin.Host, request.Host)
}

func writeResult(writer http.ResponseWriter, requestedID string, result Result) {
	var response any
	switch {
	case result.Status == StatusFound &&
		result.DefinitionID == requestedID &&
		validRevision(result.ObservabilityRevision) &&
		validScalarString(result.OperationID, 1, maxIDCodeUnits):
		response = struct {
			Status                string `json:"status"`
			DefinitionID          string `json:"definitionId"`
			ObservabilityRevision int64  `json:"observabilityRevision"`
			OperationID           string `json:"operationId"`
			Path                  string `json:"path"`
		}{
			Status: "found", DefinitionID: requestedID,
			ObservabilityRevision: result.ObservabilityRevision,
			OperationID:           result.OperationID,
			Path:                  "/runs/" + encodeURIComponent(result.OperationID),
		}
	case result.Status == StatusEmpty &&
		result.DefinitionID == requestedID &&
		validRevision(result.ObservabilityRevision):
		availability := "unavailable"
		if result.ExactPreviewAvailable {
			availability = "available"
		}
		response = struct {
			Status                string `json:"status"`
			DefinitionID          string `json:"definitionId"`
			ObservabilityRevision int64  `json:"observabilityRevision"`
			Path                  string `json:"path"`
			ExactPreview          struct {
				Status string `json:"status"`
			} `json:"exactPreview"`
		}{
			Status: "empty", DefinitionID: requestedID,
			ObservabilityRevision: result.ObservabilityRevision,
			Path:                  "/library/index/" + encodeURIComponent(requestedID) + "/runs",
			ExactPreview: struct {
				Status string `json:"status"`
			}{Status: availability},
		}
	case result.Status == StatusUnavailable &&
		(result.UnavailableReason == ReasonOwnerNotFound ||
			result.UnavailableReason == ReasonOwnerNotPrompt):
		reason := string(result.UnavailableReason)
		response = struct {
			Status  string `json:"status"`
			Reason  string `json:"reason"`
			Message string `json:"message"`
		}{Status: "unavailable", Reason: reason, Message: messages[reason]}
	default:
		writeError(writer, http.StatusServiceUnavailable, "temporarily_unavailable")
		return
	}
	writeJSON(writer, response, http.StatusOK)
}

func validRevision(revision int64) bool {
	return revision >= 0 && revision <= maxSafeInteger
}

func writeError(writer http.ResponseWriter, status int, code string) {
	writeJSON(writer, struct {
		Status  string `json:"status"`
		Code    string `json:"code"`
		Message string `json:"message"`
	}{Status: "error", Code: code, Message: messages[code]}, status)
}

func writeJSON(writer http.ResponseWriter, value any, status int) {
	encoded, err := json.Marshal(value)
	if err != nil || len(encoded) > maxResponseBytes {
		encoded, _ = json.Marshal(struct {
			Status  string `json:"status"`
			Code    string `json:"code"`
			Message string `json:"message"`
		}{
			Status: "error", Code: "temporarily_unavailable",
			Message: messages["temporarily_unavailable"],
		})
		status = http.StatusServiceUnavailable
	}
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(status)
	_, _ = writer.Write(encoded)
}

func setPrivacyHeaders(writer http.ResponseWriter) {
	writer.Header().Set("Cache-Control", "no-store")
	writer.Header().Set("Referrer-Policy", "no-referrer")
}
