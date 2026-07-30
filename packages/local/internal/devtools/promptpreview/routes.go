package promptpreview

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
)

const discoveryPrefix = "/api/devtools/prompt-preview/"

func RegisterRoutes(mux *http.ServeMux, service *Service) {
	mux.HandleFunc("GET "+discoveryPrefix+"{definitionId}", func(w http.ResponseWriter, r *http.Request) {
		setPrivacyHeaders(w)
		if !validProtection(r, false) {
			writeError(w, http.StatusForbidden)
			return
		}
		definitionID := r.PathValue("definitionId")
		if definitionID == "" {
			writeError(w, http.StatusBadRequest)
			return
		}
		writeJSON(w, service.Discover(definitionID), http.StatusOK)
	})
	mux.HandleFunc(discoveryPrefix, func(w http.ResponseWriter, r *http.Request) {
		setPrivacyHeaders(w)
		if r.Method != http.MethodGet {
			writeError(w, http.StatusMethodNotAllowed)
			return
		}
		writeError(w, http.StatusBadRequest)
	})
	mux.HandleFunc("POST /api/devtools/prompt-preview", func(w http.ResponseWriter, r *http.Request) {
		setPrivacyHeaders(w)
		if !validProtection(r, true) {
			writeBrowserResponse(w, browserError("endpoint_not_allowed", nil))
			return
		}
		if !hasExactHeader(r, "Content-Type", "application/json") {
			writeBrowserResponse(w, browserError("invalid_request", nil))
			return
		}
		body := http.MaxBytesReader(w, r.Body, maxBrowserBodyBytes)
		data, err := io.ReadAll(body)
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				writeBrowserResponse(w, browserError("input_limit_exceeded", nil))
				return
			}
			writeBrowserResponse(w, browserError("invalid_request", nil))
			return
		}
		request, err := decodeBrowserRequest(data)
		if err != nil {
			writeBrowserResponse(w, browserError("invalid_request", nil))
			return
		}
		writeBrowserResponse(w, service.Dispatch(r.Context(), request))
	})
	mux.HandleFunc("/api/devtools/prompt-preview", func(w http.ResponseWriter, _ *http.Request) {
		setPrivacyHeaders(w)
		writeError(w, http.StatusMethodNotAllowed)
	})
}

func validProtection(request *http.Request, requireOrigin bool) bool {
	if !hasExactHeader(request, RequestHeader, RequestHeaderValue) {
		return false
	}
	origins := request.Header.Values("Origin")
	if len(origins) == 0 {
		return !requireOrigin
	}
	if len(origins) != 1 {
		return false
	}
	origin := origins[0]
	parsed, err := url.Parse(origin)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" ||
		parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" ||
		parsed.Fragment != "" {
		return false
	}
	scheme := "http"
	if request.TLS != nil {
		scheme = "https"
	}
	return strings.EqualFold(parsed.Scheme, scheme) &&
		strings.EqualFold(parsed.Host, request.Host)
}

func hasExactHeader(request *http.Request, name, value string) bool {
	values := request.Header.Values(name)
	return len(values) == 1 && values[0] == value
}

func setPrivacyHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
}

func writeJSON(w http.ResponseWriter, value any, status int) {
	encoded, err := json.Marshal(value)
	if err != nil {
		writeError(w, http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}

func writeError(w http.ResponseWriter, status int) {
	http.Error(w, http.StatusText(status), status)
}

func writeBrowserResponse(w http.ResponseWriter, result BrowserResponse) {
	encoded, err := json.Marshal(result)
	if err != nil {
		result = browserError("internal_error", nil)
		encoded, _ = json.Marshal(result)
	}
	if len(encoded) > maxBrowserResponseBytes {
		result = browserError("response_limit_exceeded", nil)
		encoded, _ = json.Marshal(result)
	}
	writeEncodedJSON(w, encoded, browserStatus(result))
}

func writeEncodedJSON(w http.ResponseWriter, encoded []byte, status int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_, _ = w.Write(encoded)
}

func browserStatus(result BrowserResponse) int {
	if result.Status == "ready" || result.Status == "validation-error" {
		return http.StatusOK
	}
	switch result.Code {
	case "invalid_request":
		return http.StatusBadRequest
	case "endpoint_not_allowed":
		return http.StatusForbidden
	case "target_unavailable":
		return http.StatusNotFound
	case "deadline_exceeded":
		return http.StatusRequestTimeout
	case "catalogue_changed", "ambiguous_peer", "target_disappeared", "cancelled":
		return http.StatusConflict
	case "input_limit_exceeded":
		return http.StatusRequestEntityTooLarge
	case "internal_error":
		return http.StatusInternalServerError
	case "invalid_response", "command_failed", "response_limit_exceeded":
		return http.StatusBadGateway
	default:
		return http.StatusServiceUnavailable
	}
}
