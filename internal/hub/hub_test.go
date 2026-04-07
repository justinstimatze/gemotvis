package hub

import (
	"encoding/json"
	"sync"
	"testing"
	"time"
)

func TestSubscribeReturnsChannel(t *testing.T) {
	h := New()
	ch, unsub := h.Subscribe()
	defer unsub()

	if ch == nil {
		t.Fatal("Subscribe returned nil channel")
	}
}

func TestBroadcastDeliversToSubscriber(t *testing.T) {
	h := New()
	ch, unsub := h.Subscribe()
	defer unsub()

	h.Broadcast("test", map[string]string{"key": "value"})

	select {
	case msg := <-ch:
		var envelope map[string]json.RawMessage
		if err := json.Unmarshal(msg, &envelope); err != nil {
			t.Fatalf("unmarshal: %v", err)
		}
		var eventType string
		if err := json.Unmarshal(envelope["type"], &eventType); err != nil {
			t.Fatalf("unmarshal type: %v", err)
		}
		if eventType != "test" {
			t.Errorf("type = %q, want %q", eventType, "test")
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for broadcast")
	}
}

func TestBroadcastDeliversToMultipleSubscribers(t *testing.T) {
	h := New()
	const n = 5
	channels := make([]<-chan []byte, n)
	unsubs := make([]func(), n)
	for i := 0; i < n; i++ {
		channels[i], unsubs[i] = h.Subscribe()
		defer unsubs[i]() //nolint:gocritic // defer in loop is fine for test cleanup
	}

	h.Broadcast("multi", "hello")

	for i, ch := range channels {
		select {
		case msg := <-ch:
			if msg == nil {
				t.Errorf("subscriber %d got nil message", i)
			}
		case <-time.After(time.Second):
			t.Errorf("subscriber %d timed out", i)
		}
	}
}

func TestUnsubscribeStopsDelivery(t *testing.T) {
	h := New()
	ch, unsub := h.Subscribe()
	unsub()

	// After unsubscribe, channel should be closed.
	_, ok := <-ch
	if ok {
		t.Error("expected channel to be closed after unsubscribe")
	}

	// Verify the client was removed from the hub.
	h.mu.RLock()
	count := len(h.clients)
	h.mu.RUnlock()
	if count != 0 {
		t.Errorf("clients count = %d, want 0", count)
	}
}

func TestSlowClientDropsMessages(t *testing.T) {
	h := New()
	ch, unsub := h.Subscribe()
	defer unsub()

	// Fill up the buffer (capacity is 64).
	for i := 0; i < 70; i++ {
		h.Broadcast("fill", i)
	}

	// We should get exactly 64 messages (the buffer size), the rest dropped.
	count := 0
	for {
		select {
		case <-ch:
			count++
		default:
			goto done
		}
	}
done:
	if count != 64 {
		t.Errorf("received %d messages, want 64 (buffer size)", count)
	}
}

func TestConcurrentSubscribeAndBroadcast(t *testing.T) {
	h := New()
	var wg sync.WaitGroup

	// Spawn subscribers concurrently.
	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ch, unsub := h.Subscribe()
			defer unsub()
			// Drain a few messages.
			for j := 0; j < 3; j++ {
				select {
				case <-ch:
				case <-time.After(500 * time.Millisecond):
					return
				}
			}
		}()
	}

	// Broadcast concurrently.
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			h.Broadcast("concurrent", i)
		}(i)
	}

	wg.Wait()
	// No race condition or panic means pass.
}

func TestBroadcastWithNoSubscribers(t *testing.T) {
	h := New()
	// Should not panic.
	h.Broadcast("noop", nil)
}

func TestBroadcastPayloadFormat(t *testing.T) {
	h := New()
	ch, unsub := h.Subscribe()
	defer unsub()

	h.Broadcast("state", map[string]int{"count": 42})

	msg := <-ch
	var payload struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(msg, &payload); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if payload.Type != "state" {
		t.Errorf("type = %q, want %q", payload.Type, "state")
	}

	var data map[string]int
	if err := json.Unmarshal(payload.Data, &data); err != nil {
		t.Fatalf("unmarshal data: %v", err)
	}
	if data["count"] != 42 {
		t.Errorf("data.count = %d, want 42", data["count"])
	}
}
