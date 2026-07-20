package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/signal"
	"sync"
	"syscall"

	"github.com/use-crux/crux/packages/local/internal/cli"
	"github.com/use-crux/crux/packages/local/internal/domain"
)

type signalNotifier interface {
	Notify(chan<- os.Signal, ...os.Signal)
	Stop(chan<- os.Signal)
	Reset(...os.Signal)
}

type processSignalNotifier struct{}

func (processSignalNotifier) Notify(ch chan<- os.Signal, signals ...os.Signal) {
	signal.Notify(ch, signals...)
}

func (processSignalNotifier) Stop(ch chan<- os.Signal) { signal.Stop(ch) }

func (processSignalNotifier) Reset(signals ...os.Signal) { signal.Reset(signals...) }

type receivedSignal struct {
	mu  sync.Mutex
	sig os.Signal
}

func runCLI(
	parent context.Context,
	factory *cli.Factory,
	notifier signalNotifier,
	args []string,
) int {
	rootCmd := newRootCommand(factory)
	rootCmd.SetArgs(args)
	return runWithSignalHandling(parent, factoryOutput{factory: factory, diagnostic: true}, notifier, rootCmd.ExecuteContext)
}

func (s *receivedSignal) Set(sig os.Signal) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sig = sig
}

func (s *receivedSignal) Get() os.Signal {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.sig
}

func runWithSignalHandling(
	parent context.Context,
	stderr io.Writer,
	notifier signalNotifier,
	execute func(context.Context) error,
) int {
	ctx, cancel := context.WithCancel(parent)
	defer cancel()

	signalCh := make(chan os.Signal, 1)
	notifier.Notify(signalCh, syscall.SIGINT, syscall.SIGTERM)
	var first receivedSignal
	handlerDone := make(chan struct{})
	go func() {
		defer close(handlerDone)
		select {
		case sig := <-signalCh:
			first.Set(sig)
			notifier.Reset(syscall.SIGINT, syscall.SIGTERM)
			cancel()
		case <-ctx.Done():
		}
	}()

	err := execute(ctx)
	notifier.Stop(signalCh)
	cancel()
	<-handlerDone

	if signalCode := exitCodeForSignal(first.Get()); signalCode != 0 {
		reportSignalError(stderr, err)
		return signalCode
	}
	return exitCodeForError(stderr, err)
}

func reportSignalError(stderr io.Writer, err error) {
	if err == nil {
		return
	}
	if joined, ok := err.(interface{ Unwrap() []error }); ok {
		for _, nested := range joined.Unwrap() {
			reportSignalError(stderr, nested)
		}
		return
	}
	var exitErr domain.ExitError
	if errors.Is(err, context.Canceled) || errors.As(err, &exitErr) {
		return
	}
	fmt.Fprintln(stderr, err)
}

func exitCodeForSignal(sig os.Signal) int {
	switch sig {
	case syscall.SIGINT:
		return 130
	case syscall.SIGTERM:
		return 143
	default:
		return 0
	}
}

func exitCodeForError(stderr io.Writer, err error) int {
	if err == nil {
		return 0
	}
	var exitErr domain.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.Code
	}
	fmt.Fprintln(stderr, err)
	return 1
}
