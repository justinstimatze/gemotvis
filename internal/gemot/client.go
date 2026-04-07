package gemot

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"sync/atomic"
	"time"
)

// Client is a JSON-RPC 2.0 client for gemot's A2A endpoint.
type Client struct {
	baseURL     string
	bearerToken string
	httpClient  *http.Client

	nextID atomic.Int64
}

func (c *Client) BaseURL() string     { return c.baseURL }
func (c *Client) BearerToken() string { return c.bearerToken }

func NewClient(baseURL, bearerToken string) *Client {
	return &Client{
		baseURL:     baseURL,
		bearerToken: bearerToken,
		httpClient: &http.Client{
			Timeout: 30 * time.Second,
		},
	}
}

type rpcRequest struct {
	JSONRPC string         `json:"jsonrpc"`
	Method  string         `json:"method"`
	ID      int64          `json:"id"`
	Params  map[string]any `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      any             `json:"id"`
	Result  json.RawMessage `json:"result,omitempty"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func (c *Client) call(ctx context.Context, method string, params map[string]any) (json.RawMessage, error) {
	req := rpcRequest{
		JSONRPC: "2.0",
		Method:  method,
		ID:      c.nextID.Add(1),
		Params:  params,
	}
	body, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/a2a", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.bearerToken)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close() //nolint:errcheck

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("gemot returned HTTP %d", resp.StatusCode)
	}

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 10<<20)) // 10MB max
	if err != nil {
		return nil, fmt.Errorf("read body: %w", err)
	}

	var rpcResp rpcResponse
	if err := json.Unmarshal(respBody, &rpcResp); err != nil {
		return nil, fmt.Errorf("unmarshal response: %w", err)
	}
	if rpcResp.Error != nil {
		return nil, fmt.Errorf("rpc error %d: %s", rpcResp.Error.Code, rpcResp.Error.Message)
	}
	return rpcResp.Result, nil
}

// ListDeliberations calls gemot/deliberation action:list.
func (c *Client) ListDeliberations(ctx context.Context) ([]Deliberation, error) {
	raw, err := c.call(ctx, "gemot/deliberation", map[string]any{"action": "list"})
	if err != nil {
		return nil, err
	}
	var result []Deliberation
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal deliberations: %w", err)
	}
	return result, nil
}

// GetDeliberation calls gemot/deliberation action:get.
func (c *Client) GetDeliberation(ctx context.Context, id string) (*Deliberation, error) {
	raw, err := c.call(ctx, "gemot/deliberation", map[string]any{"action": "get", "deliberation_id": id})
	if err != nil {
		return nil, err
	}
	var result Deliberation
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal deliberation: %w", err)
	}
	return &result, nil
}

// GetPositions calls gemot/participate action:get_positions.
func (c *Client) GetPositions(ctx context.Context, deliberationID string) ([]Position, error) {
	raw, err := c.call(ctx, "gemot/participate", map[string]any{"action": "get_positions", "deliberation_id": deliberationID})
	if err != nil {
		return nil, err
	}
	var result []Position
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal positions: %w", err)
	}
	return result, nil
}

// GetVotes calls gemot/decide action:get_commitments (votes are commitments in gemot).
func (c *Client) GetVotes(ctx context.Context, deliberationID string) ([]Vote, error) {
	raw, err := c.call(ctx, "gemot/decide", map[string]any{"action": "get_commitments", "deliberation_id": deliberationID})
	if err != nil {
		return nil, err
	}
	var result []Vote
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal votes: %w", err)
	}
	return result, nil
}

// GetAnalysisResult calls gemot/analyze action:get_result.
func (c *Client) GetAnalysisResult(ctx context.Context, deliberationID string) (*AnalysisResult, error) {
	raw, err := c.call(ctx, "gemot/analyze", map[string]any{"action": "get_result", "deliberation_id": deliberationID})
	if err != nil {
		return nil, err
	}
	if string(raw) == "null" {
		return nil, nil
	}
	var result AnalysisResult
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal analysis: %w", err)
	}
	return &result, nil
}

// GetAllAnalysisResults calls gemot/analyze action:get_result with round:-1 to fetch all rounds.
func (c *Client) GetAllAnalysisResults(ctx context.Context, deliberationID string) ([]AnalysisResult, error) {
	raw, err := c.call(ctx, "gemot/analyze", map[string]any{"action": "get_result", "deliberation_id": deliberationID, "round": -1})
	if err != nil {
		return nil, err
	}
	if string(raw) == "null" {
		return nil, nil
	}
	var results []AnalysisResult
	if err := json.Unmarshal(raw, &results); err != nil {
		// Fallback: server may not support round:-1, try single result
		var single AnalysisResult
		if err2 := json.Unmarshal(raw, &single); err2 == nil {
			return []AnalysisResult{single}, nil
		}
		return nil, fmt.Errorf("unmarshal analysis results: %w", err)
	}
	return results, nil
}

// ListByGroup calls gemot/deliberation action:list_by_group.
func (c *Client) ListByGroup(ctx context.Context, groupID string) ([]Deliberation, error) {
	raw, err := c.call(ctx, "gemot/deliberation", map[string]any{"action": "list_by_group", "group_id": groupID})
	if err != nil {
		return nil, err
	}
	var result []Deliberation
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal deliberations: %w", err)
	}
	return result, nil
}

// ListByAgent calls gemot/deliberation action:list_by_agent.
func (c *Client) ListByAgent(ctx context.Context, agentID string) ([]Deliberation, error) {
	raw, err := c.call(ctx, "gemot/deliberation", map[string]any{"action": "list_by_agent", "agent_id": agentID})
	if err != nil {
		return nil, err
	}
	var result []Deliberation
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal deliberations: %w", err)
	}
	return result, nil
}

// ExportDeliberation calls gemot/deliberation action:export — returns full deliberation with all rounds, positions, votes, analysis.
func (c *Client) ExportDeliberation(ctx context.Context, deliberationID string) (json.RawMessage, error) {
	return c.call(ctx, "gemot/deliberation", map[string]any{"action": "export", "deliberation_id": deliberationID})
}

// GetAuditLog extracts audit_log from the deliberation export.
func (c *Client) GetAuditLog(ctx context.Context, deliberationID string) (*AuditLog, error) {
	raw, err := c.ExportDeliberation(ctx, deliberationID)
	if err != nil {
		return &AuditLog{}, nil //nolint:nilerr // best-effort: return empty on failure
	}

	var export struct {
		AuditLog []map[string]string `json:"audit_log"`
	}
	if err := json.Unmarshal(raw, &export); err != nil || len(export.AuditLog) == 0 {
		return &AuditLog{}, nil //nolint:nilerr // best-effort: return empty on parse failure
	}

	return &AuditLog{Operations: export.AuditLog}, nil
}
