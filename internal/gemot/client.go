package gemot

import (
	"bytes"
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

func (c *Client) call(method string, params map[string]any) (json.RawMessage, error) {
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

	httpReq, err := http.NewRequest(http.MethodPost, c.baseURL+"/a2a", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("new request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Authorization", "Bearer "+c.bearerToken)

	resp, err := c.httpClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("http: %w", err)
	}
	defer resp.Body.Close()

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
func (c *Client) ListDeliberations() ([]Deliberation, error) {
	raw, err := c.call("gemot/deliberation", map[string]any{"action": "list"})
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
func (c *Client) GetDeliberation(id string) (*Deliberation, error) {
	raw, err := c.call("gemot/deliberation", map[string]any{"action": "get", "deliberation_id": id})
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
func (c *Client) GetPositions(deliberationID string) ([]Position, error) {
	raw, err := c.call("gemot/participate", map[string]any{"action": "get_positions", "deliberation_id": deliberationID})
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
func (c *Client) GetVotes(deliberationID string) ([]Vote, error) {
	raw, err := c.call("gemot/decide", map[string]any{"action": "get_commitments", "deliberation_id": deliberationID})
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
func (c *Client) GetAnalysisResult(deliberationID string) (*AnalysisResult, error) {
	raw, err := c.call("gemot/analyze", map[string]any{"action": "get_result", "deliberation_id": deliberationID})
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

// ListByGroup calls gemot/deliberation action:list_by_group.
func (c *Client) ListByGroup(groupID string) ([]Deliberation, error) {
	raw, err := c.call("gemot/deliberation", map[string]any{"action": "list_by_group", "group_id": groupID})
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
func (c *Client) ListByAgent(agentID string) ([]Deliberation, error) {
	raw, err := c.call("gemot/deliberation", map[string]any{"action": "list_by_agent", "agent_id": agentID})
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
func (c *Client) ExportDeliberation(deliberationID string) (json.RawMessage, error) {
	return c.call("gemot/deliberation", map[string]any{"action": "export", "deliberation_id": deliberationID})
}

// GetAuditLog calls gemot/deliberation action:export and extracts audit data.
// Gemot doesn't have a separate audit log endpoint — the export contains the full history.
func (c *Client) GetAuditLog(deliberationID string) (*AuditLog, error) {
	// The export contains positions/votes/analysis which serve as the audit trail.
	// Return an empty audit log — the poller builds the audit from state changes.
	return &AuditLog{}, nil
}
