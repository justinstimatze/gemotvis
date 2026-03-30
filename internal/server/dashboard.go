package server

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sync"
	"sync/atomic"
	"time"

	"github.com/justinstimatze/gemotvis/internal/gemot"
	"github.com/justinstimatze/gemotvis/internal/hub"
	"github.com/justinstimatze/gemotvis/internal/poller"
)

const (
	maxDashboardSessions    = 100
	dashboardSessionTimeout = 24 * time.Hour
	dashboardPollInterval   = 10 * time.Second
	sessionCookieName       = "gemotvis_session"
)

type dashboardSession struct {
	id           string
	encryptedKey []byte // AES-GCM encrypted API key
	poller       *poller.Poller
	hub          *hub.Hub
	lastAccess   atomic.Int64 // unix timestamp, safe for concurrent access
	cancel       context.CancelFunc
}

func (ds *dashboardSession) touch()                { ds.lastAccess.Store(time.Now().Unix()) }
func (ds *dashboardSession) idleSince() time.Duration { return time.Since(time.Unix(ds.lastAccess.Load(), 0)) }

type dashboardManager struct {
	mu        sync.RWMutex
	sessions  map[string]*dashboardSession
	gemotURL  string
	cryptoKey [32]byte // derived from server secret
	done      chan struct{}
}

func newDashboardManager(gemotURL, serverSecret string) *dashboardManager {
	// Derive a crypto key from the server secret
	key := sha256.Sum256([]byte("gemotvis-dashboard:" + serverSecret))

	dm := &dashboardManager{
		sessions:  make(map[string]*dashboardSession),
		gemotURL:  gemotURL,
		cryptoKey: key,
		done:      make(chan struct{}),
	}
	go dm.reapLoop()
	return dm
}

func (dm *dashboardManager) reapLoop() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			dm.reap()
		case <-dm.done:
			return
		}
	}
}

// Close stops the reap loop and cleans up all sessions.
func (dm *dashboardManager) Close() {
	close(dm.done)
	dm.mu.Lock()
	defer dm.mu.Unlock()
	for id, sess := range dm.sessions {
		sess.cancel()
		delete(dm.sessions, id)
	}
}

func (dm *dashboardManager) reap() {
	dm.mu.Lock()
	defer dm.mu.Unlock()

	for id, sess := range dm.sessions {
		if sess.idleSince() > dashboardSessionTimeout {
			log.Printf("dashboard: reaping session %s", id[:8])
			sess.cancel()
			delete(dm.sessions, id)
		}
	}
}

func (dm *dashboardManager) encrypt(plaintext string) ([]byte, error) {
	block, err := aes.NewCipher(dm.cryptoKey[:])
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}
	return gcm.Seal(nonce, nonce, []byte(plaintext), nil), nil
}

func (dm *dashboardManager) decrypt(ciphertext []byte) (string, error) {
	block, err := aes.NewCipher(dm.cryptoKey[:])
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonceSize := gcm.NonceSize()
	if len(ciphertext) < nonceSize {
		return "", fmt.Errorf("ciphertext too short")
	}
	nonce, ciphertext := ciphertext[:nonceSize], ciphertext[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, ciphertext, nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

// createSession validates the API key with gemot, creates a poller, and returns a session ID.
func (dm *dashboardManager) createSession(apiKey string) (string, error) {
	// Validate the key by trying list_deliberations
	client := gemot.NewClient(dm.gemotURL, apiKey)
	_, err := client.ListDeliberations()
	if err != nil {
		return "", fmt.Errorf("invalid API key: %w", err)
	}

	dm.mu.Lock()
	defer dm.mu.Unlock()

	if len(dm.sessions) >= maxDashboardSessions {
		return "", fmt.Errorf("too many active sessions")
	}

	// Generate session ID
	idBytes := make([]byte, 32)
	if _, err := rand.Read(idBytes); err != nil {
		return "", err
	}
	sessionID := hex.EncodeToString(idBytes)

	// Encrypt the API key
	encKey, err := dm.encrypt(apiKey)
	if err != nil {
		return "", fmt.Errorf("encrypt key: %w", err)
	}

	// Start a poller for this user's deliberations
	h := hub.New()
	p := poller.New(client, h, dashboardPollInterval, "")

	ctx, cancel := context.WithCancel(context.Background())
	go p.Run(ctx)

	sess := &dashboardSession{
		id:           sessionID,
		encryptedKey: encKey,
		poller:       p,
		hub:          h,
		cancel:       cancel,
	}
	sess.touch()
	dm.sessions[sessionID] = sess

	log.Printf("dashboard: new session %s", sessionID[:8])
	return sessionID, nil
}

func (dm *dashboardManager) getSession(sessionID string) *dashboardSession {
	dm.mu.RLock()
	defer dm.mu.RUnlock()
	sess, ok := dm.sessions[sessionID]
	if ok {
		sess.touch()
	}
	return sess
}

func (dm *dashboardManager) deleteSession(sessionID string) {
	dm.mu.Lock()
	defer dm.mu.Unlock()
	if sess, ok := dm.sessions[sessionID]; ok {
		sess.cancel()
		delete(dm.sessions, sessionID)
		log.Printf("dashboard: deleted session %s", sessionID[:8])
	}
}

// ---- HTTP Handlers ----

func (s *Server) handleSessionCreate(w http.ResponseWriter, r *http.Request) {
	if s.dashboards == nil {
		http.Error(w, "dashboard not available", http.StatusServiceUnavailable)
		return
	}

	var req struct {
		APIKey string `json:"api_key"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 4096)).Decode(&req); err != nil || req.APIKey == "" {
		http.Error(w, "api_key required", http.StatusBadRequest)
		return
	}

	sessionID, err := s.dashboards.createSession(req.APIKey)
	if err != nil {
		http.Error(w, err.Error(), http.StatusUnauthorized)
		return
	}

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    sessionID,
		Path:     "/",
		HttpOnly: true,
		Secure:   true,
		SameSite: http.SameSiteStrictMode,
		MaxAge:   int(dashboardSessionTimeout.Seconds()),
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"}) //nolint:errcheck
}

func (s *Server) handleSessionDelete(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookieName)
	if err == nil && s.dashboards != nil {
		s.dashboards.deleteSession(cookie.Value)
	}

	http.SetCookie(w, &http.Cookie{
		Name:   sessionCookieName,
		Value:  "",
		Path:   "/",
		MaxAge: -1,
	})

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"}) //nolint:errcheck
}

func (s *Server) handleDashboardState(w http.ResponseWriter, r *http.Request) {
	sess := s.getDashboardSession(r)
	if sess == nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(sess.poller.GetSnapshot()) //nolint:errcheck
}

func (s *Server) handleDashboardEvents(w http.ResponseWriter, r *http.Request) {
	sess := s.getDashboardSession(r)
	if sess == nil {
		http.Error(w, "not authenticated", http.StatusUnauthorized)
		return
	}

	current := s.sseClients.Add(1)
	defer s.sseClients.Add(-1)
	if current > maxSSEClients {
		http.Error(w, "too many connections", http.StatusServiceUnavailable)
		return
	}

	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")

	ch, unsub := sess.hub.Subscribe()
	defer unsub()

	snapshot, _ := json.Marshal(map[string]any{
		"type": "snapshot",
		"data": sess.poller.GetSnapshot(),
	})
	fmt.Fprintf(w, "data: %s\n\n", snapshot)
	flusher.Flush()

	ping := time.NewTicker(15 * time.Second)
	defer ping.Stop()

	for {
		select {
		case msg := <-ch:
			fmt.Fprintf(w, "data: %s\n\n", msg)
			flusher.Flush()
			sess.touch()
		case <-ping.C:
			fmt.Fprintf(w, "data: {\"type\":\"ping\"}\n\n")
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *Server) getDashboardSession(r *http.Request) *dashboardSession {
	if s.dashboards == nil {
		return nil
	}
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil
	}
	return s.dashboards.getSession(cookie.Value)
}
