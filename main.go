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
	"sort"
	"strings"
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
	fs.Parse(os.Args[1:])

	srv := &http.Server{
		Addr:         *addr,
		Handler:      server.NewDemo(*cycle),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}
	log.Printf("gemotvis demo on %s (cycle: %s)", *addr, *cycle)
	log.Fatal(srv.ListenAndServe())
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

	go p.Run(context.Background())

	httpSrv := &http.Server{
		Addr:         *addr,
		Handler:      server.New(p, h),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}

	log.Printf("gemotvis watching %s on %s", *gemotURL, *addr)
	if *delibID != "" {
		log.Printf("deliberation: %s", *delibID)
	}
	log.Fatal(httpSrv.ListenAndServe())
}

func cmdReplay() {
	fs := flag.NewFlagSet("replay", flag.ExitOnError)
	addr := fs.String("addr", envOr("GEMOTVIS_ADDR", ":9090"), "listen address")
	fs.Parse(os.Args[1:])

	if fs.NArg() < 1 {
		log.Fatal("usage: gemotvis replay <file.json | https://...>")
	}
	source := fs.Arg(0)

	// Load snapshot from file or URL
	var data []byte
	var err error
	if strings.HasPrefix(source, "http://") || strings.HasPrefix(source, "https://") {
		data, err = fetchURL(source)
	} else {
		data, err = os.ReadFile(source)
	}
	if err != nil {
		log.Fatalf("load snapshot: %v", err)
	}

	var snapshot poller.Snapshot
	if err := json.Unmarshal(data, &snapshot); err != nil {
		log.Fatalf("parse snapshot: %v", err)
	}

	n := len(snapshot.Deliberations)
	if n == 0 {
		log.Fatal("snapshot contains no deliberations")
	}

	srv := &http.Server{
		Addr:         *addr,
		Handler:      server.NewReplay(&snapshot),
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Minute,
		IdleTimeout:  2 * time.Minute,
	}
	log.Printf("gemotvis replay on %s (%d deliberation(s) from %s)", *addr, n, source)
	log.Fatal(srv.ListenAndServe())
}

func cmdExport() {
	fs := flag.NewFlagSet("export", flag.ExitOnError)
	gemotURL := fs.String("gemot-url", envOr("GEMOTVIS_GEMOT_URL", "http://localhost:8080"), "gemot instance URL")
	apiKey := fs.String("api-key", envOr("GEMOTVIS_API_KEY", ""), "gemot API key")
	delibID := fs.String("deliberation", "", "deliberation ID to export (required)")
	fs.Parse(os.Args[1:])

	if *apiKey == "" {
		log.Fatal("--api-key required")
	}
	if *delibID == "" {
		log.Fatal("--deliberation required")
	}

	warnIfInsecure(*gemotURL)

	client := gemot.NewClient(*gemotURL, *apiKey)

	// Fetch all data for this deliberation
	delib, err := client.GetDeliberation(*delibID)
	if err != nil {
		log.Fatalf("get deliberation: %v", err)
	}

	positions, err := client.GetPositions(*delibID)
	if err != nil {
		log.Fatalf("get positions: %v", err)
	}

	votes, err := client.GetVotes(*delibID)
	if err != nil {
		log.Fatalf("get votes: %v", err)
	}

	analysis, _ := client.GetAnalysisResult(*delibID)
	auditLog, _ := client.GetAuditLog(*delibID)

	// Build agent info from positions
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

	snapshot := poller.Snapshot{
		Deliberations: map[string]*poller.DelibState{
			*delibID: {
				Deliberation: delib,
				Positions:    positions,
				Votes:        votes,
				Analysis:     analysis,
				AuditLog:     auditLog,
				Agents:       agents,
			},
		},
		FetchedAt: time.Now(),
	}

	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	if err := enc.Encode(snapshot); err != nil {
		log.Fatalf("encode: %v", err)
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
