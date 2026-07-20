package localserver

import (
	"context"
	"io"
	"log/slog"
	"net/http"
)

type requestLoggerContextKey struct{}

var discardLogger = slog.New(slog.NewTextHandler(io.Discard, nil))

func requestLoggerMiddleware(next http.Handler, logger *slog.Logger) http.Handler {
	if logger == nil {
		logger = discardLogger
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ctx := context.WithValue(r.Context(), requestLoggerContextKey{}, logger)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

func requestLogger(r *http.Request) *slog.Logger {
	logger, _ := r.Context().Value(requestLoggerContextKey{}).(*slog.Logger)
	if logger == nil {
		return discardLogger
	}
	return logger
}
