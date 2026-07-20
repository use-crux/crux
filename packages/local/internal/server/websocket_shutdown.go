package server

import "context"

// Close disconnects active clients, stops event forwarding, and waits for the
// hub's connection pumps to exit. It is safe to call concurrently.
func (h *WSHub) Close(ctx context.Context) error {
	if h == nil {
		return nil
	}
	h.initiateClose()
	select {
	case <-h.closeDone:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (h *WSHub) initiateClose() {
	h.closeOnce.Do(func() {
		if h.cancel != nil {
			h.cancel()
		}
		h.mu.Lock()
		h.closed = true
		clients := make([]*wsClient, 0, len(h.clients))
		for client := range h.clients {
			clients = append(clients, client)
		}
		h.mu.Unlock()

		for _, client := range clients {
			client.close()
		}
		go func() {
			h.workers.Wait()
			close(h.closeDone)
		}()
	})
}
