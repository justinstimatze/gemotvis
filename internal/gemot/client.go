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

func (c *Client) ListDeliberations() ([]Deliberation, error) {
	raw, err := c.call("gemot/list_deliberations", nil)
	if err != nil {
		return nil, err
	}
	var result []Deliberation
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal deliberations: %w", err)
	}
	return result, nil
}

func (c *Client) GetDeliberation(id string) (*Deliberation, error) {
	raw, err := c.call("gemot/get_deliberation", map[string]any{"deliberation_id": id})
	if err != nil {
		return nil, err
	}
	var result Deliberation
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal deliberation: %w", err)
	}
	return &result, nil
}

func (c *Client) GetPositions(deliberationID string) ([]Position, error) {
	raw, err := c.call("gemot/get_positions", map[string]any{"deliberation_id": deliberationID})
	if err != nil {
		return nil, err
	}
	var result []Position
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal positions: %w", err)
	}
	return result, nil
}

func (c *Client) GetVotes(deliberationID string) ([]Vote, error) {
	raw, err := c.call("gemot/get_votes", map[string]any{"deliberation_id": deliberationID})
	if err != nil {
		return nil, err
	}
	var result []Vote
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal votes: %w", err)
	}
	return result, nil
}

func (c *Client) GetAnalysisResult(deliberationID string) (*AnalysisResult, error) {
	raw, err := c.call("gemot/get_analysis_result", map[string]any{"deliberation_id": deliberationID})
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

func (c *Client) ListByGroup(groupID string) ([]Deliberation, error) {
	raw, err := c.call("gemot/list_by_group", map[string]any{"group_id": groupID})
	if err != nil {
		return nil, err
	}
	var result []Deliberation
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal deliberations: %w", err)
	}
	return result, nil
}

func (c *Client) ListByAgent(agentID string) ([]Deliberation, error) {
	raw, err := c.call("gemot/list_by_agent", map[string]any{"agent_id": agentID})
	if err != nil {
		return nil, err
	}
	var result []Deliberation
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal deliberations: %w", err)
	}
	return result, nil
}

func (c *Client) GetAuditLog(deliberationID string) (*AuditLog, error) {
	raw, err := c.call("gemot/get_audit_log", map[string]any{"deliberation_id": deliberationID})
	if err != nil {
		return nil, err
	}
	var result AuditLog
	if err := json.Unmarshal(raw, &result); err != nil {
		return nil, fmt.Errorf("unmarshal audit log: %w", err)
	}
	return &result, nil
}
