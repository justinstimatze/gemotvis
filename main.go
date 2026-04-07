package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/justinstimatze/gemotvis/internal/gemot"
	"github.com/justinstimatze/gemotvis/internal/hub"
	"github.com/justinstimatze/gemotvis/internal/poller"
	"github.com/justinstimatze/gemotvis/internal/server"
)

const usage = `gemotvis — MAGI-style visualization for gemot deliberations

Usage:
  gemotvis                     Demo mode (default, no setup needed)
  gemotvis demo [flags]        Demo with built-in sample deliberations
  gemotvis watch [flags]       Live monitoring of a gemot instance
  gemotvis replay <file|url>   Display a saved deliberation snapshot
  gemotvis export [flags]      Export a deliberation to JSON

Run 'gemotvis <command> --help' for details on each command.
`

func main() {
	log.SetFlags(log.Ltime)

	cmd := "demo"
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "-h", "--help", "help":
			fmt.Print(usage)
			return
		}
		if !strings.HasPrefix(os.Args[1], "-") {
			cmd = os.Args[1]
			os.Args = append(os.Args[:1], os.Args[2:]...)
		}
	}

	switch cmd {
	case "demo":
		cmdDemo()
	case "watch":
		cmdWatch()
	case "replay":
		cmdReplay()
	case "export":
		cmdExport()
	default:
		fmt.Fprintf(os.Stderr, "unknown command: %s\n\n", cmd)
		fmt.Print(usage)
		os.Exit(1)
	}
}

func cmdDemo() {
	fs := flag.NewFlagSet("demo", flag.ExitOnError)
	addr := fs.String("addr", envOr("GEMOTVIS_ADDR", ":9090"), "listen address")
	cycle := fs.Duration("cycle", 20*time.Second, "auto-cycle interval (0 to disable)")
	gemotURL := fs.String("gemot-url", envOr("GEMOTVIS_GEMOT_URL", ""), "gemot URL for live watching via join codes")
	serviceKey := fs.String("service-key", envOr("GEMOTVIS_SERVICE_KEY", ""), "gemot API key for live watching")
	fs.Parse(os.Args[1:])

	// Load any testdata files as additional named datasets
	extra := loadTestdata("testdata", "/data")

	s := server.NewDemo(*cycle, *gemotURL, *serviceKey, extra)
	if len(extra) > 0 {
		log.Printf("gemotvis demo on %s (cycle: %s, %d extra datasets)", *addr, *cycle, len(extra))
	} else {
		log.Printf("gemotvis demo on %s (cycle: %s)", *addr, *cycle)
	}
	serve(*addr, s, s)
}

// loadTestdata scans directories for .json snapshot files and returns them as named datasets.
func loadTestdata(dirs ...string) map[string]*poller.Snapshot {
	datasets := make(map[string]*poller.Snapshot)
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue // directory doesn't exist, skip
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
				continue
			}
			path := dir + "/" + e.Name()
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			var snap poller.Snapshot
			if err := json.Unmarshal(data, &snap); err != nil || len(snap.Deliberations) == 0 {
				continue
			}
			name := strings.TrimSuffix(e.Name(), ".json")
			datasets[name] = &snap
			log.Printf("  loaded dataset %q from %s (%d deliberations)", name, path, len(snap.Deliberations))
		}
	}
	return datasets
}

func cmdWatch() {
	fs := flag.NewFlagSet("watch", flag.ExitOnError)
	gemotURL := fs.String("gemot-url", envOr("GEMOTVIS_GEMOT_URL", "http://localhost:8080"), "gemot instance URL")
	apiKey := fs.String("api-key", envOr("GEMOTVIS_API_KEY", ""), "gemot API key (Bearer token)")
	addr := fs.String("addr", envOr("GEMOTVIS_ADDR", ":9090"), "listen address")
	pollInterval := fs.Duration("poll-interval", envDuration("GEMOTVIS_POLL_INTERVAL", 10*time.Second), "polling interval")
	delibID := fs.String("deliberation", envOr("GEMOTVIS_DELIBERATION_ID", ""), "watch specific deliberation ID")
	fs.Parse(os.Args[1:])

	if *apiKey == "" {
		log.Fatal("--api-key required (or set GEMOTVIS_API_KEY)")
	}

	warnIfInsecure(*gemotURL)

	client := gemot.NewClient(*gemotURL, *apiKey)
	h := hub.New()
	p := poller.New(client, h, *pollInterval, *delibID)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go p.Run(ctx)

	s := server.New(p, h)

	log.Printf("gemotvis watching %s on %s", *gemotURL, *addr)
	if *delibID != "" {
		log.Printf("deliberation: %s", *delibID)
	}
	serve(*addr, s, s)
	cancel()
}

func cmdReplay() {
	fs := flag.NewFlagSet("replay", flag.ExitOnError)
	addr := fs.String("addr", envOr("GEMOTVIS_ADDR", ":9090"), "listen address")
	fs.Parse(os.Args[1:])

	if fs.NArg() < 1 {
		log.Fatal("usage: gemotvis replay <file.json ...>")
	}

	// Load all specified files as named datasets
	datasets := make(map[string]*poller.Snapshot)
	var firstName string
	for _, source := range fs.Args() {
		var data []byte
		var err error
		if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
			data, err = fetchURL(source)
		} else {
			data, err = os.ReadFile(source)
		}
		if err != nil {
			log.Fatalf("load snapshot %s: %v", source, err)
		}

		var snapshot poller.Snapshot
		if err := json.Unmarshal(data, &snapshot); err != nil {
			log.Fatalf("parse snapshot %s: %v", source, err)
		}
		if len(snapshot.Deliberations) == 0 {
			log.Printf("warning: %s contains no deliberations, skipping", source)
			continue
		}

		// Derive name from filename: "testdata/v9-diplomacy.json" -> "diplomacy"
		name := source
		if idx := strings.LastIndex(name, "/"); idx >= 0 {
			name = name[idx+1:]
		}
		name = strings.TrimSuffix(name, ".json")
		name = strings.TrimPrefix(name, "v9-")
		name = strings.TrimPrefix(name, "hermes-")

		datasets[name] = &snapshot
		if firstName == "" {
			firstName = name
		}
		log.Printf("  loaded %s: %d deliberation(s)", name, len(snapshot.Deliberations))
	}

	if len(datasets) == 0 {
		log.Fatal("no valid snapshots loaded")
	}

	s := server.NewReplayMulti(datasets, firstName)
	log.Printf("gemotvis replay on %s (%d dataset(s))", *addr, len(datasets))
	serve(*addr, s, s)
}

func cmdExport() {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	gemotURL := fs.String("gemot-url", envOr("GEMOTVIS_GEMOT_URL", "http://localhost:8080"), "gemot instance URL")
	apiKey := fs.String("api-key", envOr("GEMOTVIS_API_KEY", ""), "gemot API key")
	delibID := fs.String("deliberation", "", "deliberation ID to export")
	groupID := fs.String("group", "", "group ID to export (all deliberations in group)")
	fs.Parse(os.Args[1:])

	if *apiKey == "" {
		log.Fatal("--api-key required")
	}
	if *delibID == "" && *groupID == "" {
		log.Fatal("--deliberation or --group required")
	}

	warnIfInsecure(*gemotURL)

	client := gemot.NewClient(*gemotURL, *apiKey)

	// Collect deliberation IDs to export
	var delibIDs []string
	if *groupID != "" {
		delibs, err := client.ListByGroup(context.Background(), *groupID)
		if err != nil {
			log.Fatalf("list group %s: %v", *groupID, err)
		}
		for _, d := range delibs {
			delibIDs = append(delibIDs, d.ID)
		}
		log.Printf("exporting %d deliberations from group %s", len(delibIDs), *groupID)
	} else {
		delibIDs = []string{*delibID}
	}

	snapshot := poller.Snapshot{
		Deliberations: make(map[string]*poller.DelibState),
		FetchedAt:     time.Now(),
	}

	for _, id := range delibIDs {
		ds := exportDelib(client, id)
		if ds != nil {
			snapshot.Deliberations[id] = ds
		}
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(snapshot); err != nil {
		log.Fatalf("encode: %v", err)
	}
}

func exportDelib(client *gemot.Client, id string) *poller.DelibState {
	ctx := context.Background()
	delib, err := client.GetDeliberation(ctx, id)
	if err != nil {
		log.Printf("  skip %s: %v", id, err)
		return nil
	}

	positions, err := client.GetPositions(ctx, id)
	if err != nil {
		log.Printf("  skip %s: %v", id, err)
		return nil
	}

	votes, _ := client.GetVotes(ctx, id)
	analysis, _ := client.GetAnalysisResult(ctx, id)
	auditLog, _ := client.GetAuditLog(ctx, id)

	agentMap := make(map[string]*poller.AgentInfo)
	for _, pos := range positions {
		if _, exists := agentMap[pos.AgentID]; !exists {
			agentMap[pos.AgentID] = &poller.AgentInfo{
				ID:          pos.AgentID,
				ModelFamily: pos.ModelFamily,
				Conviction:  pos.Conviction,
			}
		}
	}
	if analysis != nil {
		for _, cluster := range analysis.Clusters {
			for _, agentID := range cluster.AgentIDs {
				if info, ok := agentMap[agentID]; ok {
					clusterID := cluster.ID
					info.ClusterID = &clusterID
				}
			}
		}
	}
	var agents []poller.AgentInfo
	for _, info := range agentMap {
		agents = append(agents, *info)
	}
	sort.Slice(agents, func(i, j int) bool { return agents[i].ID < agents[j].ID })

	log.Printf("  %s: %d positions, %d votes, %d agents", id, len(positions), len(votes), len(agents))

	return &poller.DelibState{
		Deliberation: delib,
		Positions:    positions,
		Votes:        votes,
		Analysis:     analysis,
		AuditLog:     auditLog,
		Agents:       agents,
	}
}

// serve starts the HTTP server with graceful shutdown on SIGINT/SIGTERM.
// If s is non-nil, its Close method is called during shutdown.
func serve(addr string, handler http.Handler, s *server.Server) {
	httpSrv := &http.Server{
		Addr:         addr,
		Handler:      handler,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}

	go func() {
		if err := httpSrv.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	<-sigCh

	log.Println("shutting down...")
	if s != nil {
		s.Close()
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := httpSrv.Shutdown(ctx); err != nil {
		log.Printf("shutdown error: %v", err)
	}
}

func warnIfInsecure(rawURL string) {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.Scheme == "https" {
		return
	}
	host := parsed.Hostname()
	if host == "localhost" || host == "127.0.0.1" || host == "::1" {
		return
	}
	log.Printf("WARNING: API key will be sent over unencrypted HTTP to %s", rawURL)
}

func fetchURL(u string) ([]byte, error) {
	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 3 {
				return fmt.Errorf("too many redirects")
			}
			// Only follow redirects to http(s)
			if req.URL.Scheme != "http" && req.URL.Scheme != "https" {
				return fmt.Errorf("refusing redirect to %s", req.URL.Scheme)
			}
			return nil
		},
	}
	resp, err := client.Get(u)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d", resp.StatusCode)
	}
	return io.ReadAll(io.LimitReader(resp.Body, 50<<20)) // 50MB max
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil {
			return d
		}
	}
	return fallback
}
