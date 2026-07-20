package server

import (
	"context"
	"errors"
	"sync"
)

type devServerShutdown struct {
	once sync.Once
	err  error
}

type devServerWorkers struct {
	wg sync.WaitGroup
}

func (w *devServerWorkers) Go(run func()) {
	if w == nil {
		go run()
		return
	}
	w.wg.Add(1)
	go func() {
		defer w.wg.Done()
		run()
	}()
}

func (w *devServerWorkers) Wait(ctx context.Context) error {
	if w == nil {
		return nil
	}
	done := make(chan struct{})
	go func() {
		w.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// Shutdown gracefully stops the server and all services it owns. Concurrent
// callers observe the same cleanup result; owned resources are released once.
func (d *DevServer) Shutdown(ctx context.Context) error {
	d.shutdown.once.Do(func() {
		d.shutdown.err = d.shutdownOnce(ctx)
	})
	return d.shutdown.err
}

func (d *DevServer) shutdownOnce(ctx context.Context) error {
	d.logger.Info("shutting down devtools server")
	d.cancel()
	if d.Devtools != nil {
		d.Devtools.Shutdown()
	}

	var shutdownErrs []error
	if err := d.httpServer.Shutdown(ctx); err != nil {
		shutdownErrs = append(shutdownErrs, err)
		// Shutdown can time out while handlers are still active. Close is the
		// final ownership boundary: the listener must never survive cleanup.
		if closeErr := d.httpServer.Close(); closeErr != nil {
			shutdownErrs = append(shutdownErrs, closeErr)
		}
	}
	if d.webSocketHub != nil {
		if err := d.webSocketHub.Close(ctx); err != nil {
			shutdownErrs = append(shutdownErrs, err)
		}
	}
	if err := d.workers.Wait(ctx); err != nil {
		shutdownErrs = append(shutdownErrs, err)
	}
	if d.Observability != nil {
		if err := d.Observability.Close(); err != nil {
			shutdownErrs = append(shutdownErrs, err)
		}
	}
	if d.closeRuntimeArtifacts != nil {
		if err := d.closeRuntimeArtifacts(); err != nil {
			shutdownErrs = append(shutdownErrs, err)
		}
	}
	return errors.Join(shutdownErrs...)
}
