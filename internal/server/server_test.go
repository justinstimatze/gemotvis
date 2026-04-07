package server

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/justinstimatze/gemotvis/internal/poller"
)

func loadTestdataForTests() map[string]*poller.Snapshot {
	datasets := make(map[string]*poller.Snapshot)
	// testdata is at repo root, two levels up from internal/server
	for _, dir := range []string{"../../testdata", "testdata"} {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			data, err := os.ReadFile(dir + "/" + e.Name())
			if err != nil {
				continue
			}
			var snap poller.Snapshot
			if err := json.Unmarshal(data, &snap); err != nil || len(snap.Deliberations) == 0 {
				continue
			}
			name := strings.TrimSuffix(e.Name(), ".json")
			datasets[name] = &snap
		}
		if len(datasets) > 0 {
			break
		}
	}
	return datasets
}

func newTestServer() *Server {
	return NewDemo(0, "", "", loadTestdataForTests())
}

func TestSecurityHeaders(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	tests := []struct {
		header string
		want   string
	}{
		{"X-Content-Type-Options", "nosniff"},
		{"X-Frame-Options", "DENY"},
		{"Referrer-Policy", "no-referrer"},
	}

	for _, tt := range tests {
		t.Run(tt.header, func(t *testing.T) {
			got := w.Header().Get(tt.header)
			if got != tt.want {
				t.Errorf("%s = %q, want %q", tt.header, got, tt.want)
			}
		})
	}

	csp := w.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Error("Content-Security-Policy header is empty")
	}
}

func TestSecurityHeadersOnAllRoutes(t *testing.T) {
	srv := newTestServer()

	paths := []string{"/", "/api/state", "/api/config"}
	for _, path := range paths {
		t.Run(path, func(t *testing.T) {
			req := httptest.NewRequest("GET", path, nil)
			w := httptest.NewRecorder()
			srv.ServeHTTP(w, req)

			if got := w.Header().Get("X-Content-Type-Options"); got != "nosniff" {
				t.Errorf("X-Content-Type-Options = %q, want %q", got, "nosniff")
			}
		})
	}
}

func TestAPIConfigResponse(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var config map[string]any
	if err := json.NewDecoder(w.Body).Decode(&config); err != nil {
		t.Fatalf("decode: %v", err)
	}

	// NewDemo(0, "", "") should yield replay mode (static snapshot, no cycle).
	if mode, ok := config["mode"].(string); !ok || mode != "replay" {
		t.Errorf("mode = %v, want %q", config["mode"], "replay")
	}

	if ci, ok := config["cycle_interval"].(float64); !ok || ci != 0 {
		t.Errorf("cycle_interval = %v, want 0", config["cycle_interval"])
	}

	if we, ok := config["watch_enabled"].(bool); !ok || we != false {
		t.Errorf("watch_enabled = %v, want false", config["watch_enabled"])
	}

	if de, ok := config["dashboard_enabled"].(bool); !ok || de != false {
		t.Errorf("dashboard_enabled = %v, want false", config["dashboard_enabled"])
	}
}

func TestAPIConfigDemoMode(t *testing.T) {
	srv := NewDemo(5*time.Second, "", "", loadTestdataForTests())
	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	var config map[string]any
	if err := json.NewDecoder(w.Body).Decode(&config); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if mode := config["mode"].(string); mode != "demo" {
		t.Errorf("mode = %q, want %q", mode, "demo")
	}

	if ci := config["cycle_interval"].(float64); ci != 5000 {
		t.Errorf("cycle_interval = %v, want 5000", ci)
	}
}

func TestAPIStateResponse(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/api/state", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	ct := w.Header().Get("Content-Type")
	if ct != "application/json" {
		t.Errorf("Content-Type = %q, want %q", ct, "application/json")
	}

	var snap poller.Snapshot
	if err := json.NewDecoder(w.Body).Decode(&snap); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if len(snap.Deliberations) == 0 {
		t.Error("expected demo snapshot to have deliberations")
	}

	// Each deliberation should have a topic and at least one position
	for id, ds := range snap.Deliberations {
		if ds.Deliberation == nil || ds.Deliberation.Topic == "" {
			t.Errorf("deliberation %q has no topic", id)
		}
		if len(ds.Positions) == 0 {
			t.Errorf("deliberation %q has no positions", id)
		}
	}
}

func TestAPIStateHasDeliberationFields(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/api/state", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	var snap poller.Snapshot
	if err := json.NewDecoder(w.Body).Decode(&snap); err != nil {
		t.Fatalf("decode: %v", err)
	}

	for id, state := range snap.Deliberations {
		if state.Deliberation == nil {
			t.Errorf("deliberation %q has nil Deliberation", id)
			continue
		}
		if state.Deliberation.Topic == "" {
			t.Errorf("deliberation %q has empty topic", id)
		}
	}
}

func TestStaticFileServing(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}

	body := w.Body.String()
	if len(body) == 0 {
		t.Error("expected non-empty response body for /")
	}
}

func TestSPAFallback(t *testing.T) {
	srv := newTestServer()
	// A path that doesn't match any static file should still return index.html (SPA fallback).
	req := httptest.NewRequest("GET", "/nonexistent-route", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("SPA fallback: status = %d, want %d", w.Code, http.StatusOK)
	}
}

func TestReplayServer(t *testing.T) {
	snap := &poller.Snapshot{
		Deliberations: map[string]*poller.DelibState{},
		FetchedAt:     time.Now(),
	}
	srv := NewReplay(snap)

	req := httptest.NewRequest("GET", "/api/config", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	var config map[string]any
	json.NewDecoder(w.Body).Decode(&config) //nolint:errcheck // test helper

	if mode := config["mode"].(string); mode != "replay" {
		t.Errorf("mode = %q, want %q", mode, "replay")
	}
}

func TestExtractWatchCode(t *testing.T) {
	tests := []struct {
		name   string
		path   string
		prefix string
		suffix string
		want   string
	}{
		{"valid state", "/api/watch/bold-cedar-123/state", "/api/watch/", "/state", "bold-cedar-123"},
		{"valid events", "/api/watch/my-code/events", "/api/watch/", "/events", "my-code"},
		{"empty code", "/api/watch//state", "/api/watch/", "/state", ""},
		{"nested slash", "/api/watch/bad/code/state", "/api/watch/", "/state", ""},
		{"no suffix match", "/api/watch/code", "/api/watch/", "/state", "code"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractWatchCode(tt.path, tt.prefix, tt.suffix)
			if got != tt.want {
				t.Errorf("extractWatchCode(%q, %q, %q) = %q, want %q",
					tt.path, tt.prefix, tt.suffix, got, tt.want)
			}
		})
	}
}

func TestWatchEndpointWithoutManager(t *testing.T) {
	srv := newTestServer() // no gemotURL/serviceKey -> watches is nil

	req := httptest.NewRequest("GET", "/api/watch/some-code/state", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}
}

func TestDashboardEndpointWithoutManager(t *testing.T) {
	srv := newTestServer() // dashboards is nil

	req := httptest.NewRequest("GET", "/api/dashboard/state", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d, want %d", w.Code, http.StatusUnauthorized)
	}
}

func TestSessionCreateWithoutDashboards(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("POST", "/api/session", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusServiceUnavailable {
		t.Errorf("status = %d, want %d", w.Code, http.StatusServiceUnavailable)
	}
}

func TestEncryptDecryptRoundtrip(t *testing.T) {
	dm := &dashboardManager{
		sessions: make(map[string]*dashboardSession),
	}
	// Set up a crypto key (normally done via sha256 in newDashboardManager).
	key := [32]byte{}
	copy(key[:], "test-secret-key-for-encryption!!")
	dm.cryptoKey = key

	tests := []struct {
		name      string
		plaintext string
	}{
		{"short string", "api-key-123"},
		{"empty string", ""},
		{"long string", "sk-ant-api03-very-long-api-key-that-has-many-characters-in-it-for-testing-purposes"},
		{"special chars", "key!@#$%^&*()_+-={}[]|\\:\";<>?,./~`"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			encrypted, err := dm.encrypt(tt.plaintext)
			if err != nil {
				t.Fatalf("encrypt: %v", err)
			}

			decrypted, err := dm.decrypt(encrypted)
			if err != nil {
				t.Fatalf("decrypt: %v", err)
			}

			if decrypted != tt.plaintext {
				t.Errorf("roundtrip: got %q, want %q", decrypted, tt.plaintext)
			}
		})
	}
}

func TestEncryptProducesDifferentCiphertexts(t *testing.T) {
	dm := &dashboardManager{}
	key := [32]byte{}
	copy(key[:], "test-secret-key-for-encryption!!")
	dm.cryptoKey = key

	ct1, err := dm.encrypt("same-input")
	if err != nil {
		t.Fatalf("encrypt 1: %v", err)
	}
	ct2, err := dm.encrypt("same-input")
	if err != nil {
		t.Fatalf("encrypt 2: %v", err)
	}

	// Due to random nonces, encrypting the same plaintext should produce different ciphertexts.
	if string(ct1) == string(ct2) { //nolint:gocritic // comparing encrypted bytes as strings is fine here
		t.Error("encrypting same plaintext twice should produce different ciphertexts (random nonce)")
	}
}

func TestDecryptInvalidCiphertext(t *testing.T) {
	dm := &dashboardManager{}
	key := [32]byte{}
	copy(key[:], "test-secret-key-for-encryption!!")
	dm.cryptoKey = key

	tests := []struct {
		name       string
		ciphertext []byte
	}{
		{"too short", []byte("short")},
		{"garbage", []byte("this is definitely not valid aes-gcm ciphertext padding")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := dm.decrypt(tt.ciphertext)
			if err == nil {
				t.Error("expected error decrypting invalid ciphertext")
			}
		})
	}
}

func TestDecryptWithWrongKey(t *testing.T) {
	dm1 := &dashboardManager{}
	key1 := [32]byte{}
	copy(key1[:], "key-one-for-encrypting-stuff!!!!")
	dm1.cryptoKey = key1

	dm2 := &dashboardManager{}
	key2 := [32]byte{}
	copy(key2[:], "key-two-different-from-key-one!!")
	dm2.cryptoKey = key2

	ct, err := dm1.encrypt("secret-data")
	if err != nil {
		t.Fatalf("encrypt: %v", err)
	}

	_, err = dm2.decrypt(ct)
	if err == nil {
		t.Error("expected error decrypting with wrong key")
	}
}

func TestCSPNoUnsafeInline(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	csp := w.Header().Get("Content-Security-Policy")
	if csp == "" {
		t.Fatal("missing Content-Security-Policy header")
	}
	if contains(csp, "unsafe-inline") {
		t.Error("CSP contains unsafe-inline, which should have been removed")
	}
	if !contains(csp, "fonts.googleapis.com") {
		t.Error("CSP missing fonts.googleapis.com for Google Fonts")
	}
	if !contains(csp, "fonts.gstatic.com") {
		t.Error("CSP missing fonts.gstatic.com for font files")
	}
}

func TestServerClose(t *testing.T) {
	srv := newTestServer()
	// Close should not panic on a server with nil managers
	srv.Close()
}

func TestServerCloseWithManagers(t *testing.T) {
	srv := NewDemo(0, "http://localhost:9999", "fake-key", nil)
	// This creates watches, dashboards, groups managers
	// Close should stop their reap loops without deadlock
	srv.Close()
}

func TestDemoSnapshotHasPositionTimestamps(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/api/state", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	var snap poller.Snapshot
	if err := json.NewDecoder(w.Body).Decode(&snap); err != nil {
		t.Fatalf("decode: %v", err)
	}

	for id, ds := range snap.Deliberations {
		for _, p := range ds.Positions {
			if p.CreatedAt.IsZero() {
				t.Errorf("deliberation %q: position by %q has no created_at (needed for scrubber filter)", id, p.AgentID)
			}
		}
	}
}

func TestDemoSnapshotHasVoteTimestamps(t *testing.T) {
	srv := newTestServer()
	req := httptest.NewRequest("GET", "/api/state", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	var snap poller.Snapshot
	if err := json.NewDecoder(w.Body).Decode(&snap); err != nil {
		t.Fatalf("decode: %v", err)
	}

	for id, ds := range snap.Deliberations {
		for _, v := range ds.Votes {
			if v.CreatedAt.IsZero() {
				t.Errorf("deliberation %q: vote by %q has no created_at (needed for scrubber filter)", id, v.AgentID)
			}
		}
	}
}

func TestExtractGroupID(t *testing.T) {
	tests := []struct {
		name string
		path string
		want string
	}{
		{"valid events", "/api/g/my-group-id/events", "my-group-id"},
		{"valid state", "/api/g/my-group-id/state", "my-group-id"},
		{"no suffix", "/api/g/abcde", "abcde"},
		{"with underscores", "/api/g/my_group_123/events", "my_group_123"},
		{"empty", "/api/g/", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractGroupID(tt.path)
			if got != tt.want {
				t.Errorf("extractGroupID(%q) = %q, want %q", tt.path, got, tt.want)
			}
		})
	}
}

func contains(s, substr string) bool {
	return len(s) >= len(substr) && searchString(s, substr)
}

func searchString(s, sub string) bool {
	for i := 0; i <= len(s)-len(sub); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
