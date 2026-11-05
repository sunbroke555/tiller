package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const pveRenewAfter = time.Hour
const pveTicketLifetime = 2 * time.Hour

type connectionAuthError struct{ message string }

func (e *connectionAuthError) Error() string { return e.message }

type pveSession struct {
	ticket, csrf string
	issued       time.Time
}

// One ticket cache per immutable instance revision. Neither these tickets nor
// the decrypted password are returned to the browser or written to disk.
type passwordTransport struct {
	base      http.RoundTripper
	address   string
	username  string
	password  string
	mu        sync.Mutex
	session   pveSession
	lastError error
	retryAt   time.Time
	failures  int
	now       func() time.Time
}

func newPasswordTransport(base http.RoundTripper, c InstanceConfig, password string) *passwordTransport {
	return &passwordTransport{base: base, address: c.URL, username: c.Username + "@" + c.Realm, password: password, now: time.Now}
}

func (t *passwordTransport) login(ctx context.Context, credential string) (pveSession, error) {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	body := url.Values{"username": {t.username}, "password": {credential}, "new-format": {"1"}}
	r, err := http.NewRequestWithContext(ctx, "POST", t.address+ticketPath, strings.NewReader(body.Encode()))
	if err != nil {
		return pveSession{}, err
	}
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := t.base.RoundTrip(r)
	if err != nil {
		return pveSession{}, err
	}
	defer res.Body.Close()
	if res.StatusCode == 401 || res.StatusCode == 403 {
		return pveSession{}, &connectionAuthError{"PVE 用户名、密码或认证域不正确，或账户已被禁用，请编辑实例连接后重试"}
	}
	if res.StatusCode != 200 {
		return pveSession{}, &connectionAuthError{"PVE 登录接口暂不可用，请检查实例地址与连接"}
	}
	var out struct {
		Data struct {
			Username string          `json:"username"`
			Ticket   string          `json:"ticket"`
			CSRF     string          `json:"CSRFPreventionToken"`
			NeedTFA  json.RawMessage `json:"NeedTFA"`
		} `json:"data"`
	}
	if json.NewDecoder(io.LimitReader(res.Body, 64<<10)).Decode(&out) != nil {
		return pveSession{}, &connectionAuthError{"PVE 登录返回了无效数据"}
	}
	tfa := strings.TrimSpace(string(out.Data.NeedTFA))
	if isTFATicket(out.Data.Ticket) || (tfa != "" && tfa != "0" && tfa != "false" && tfa != "null") {
		return pveSession{}, &connectionAuthError{"此 PVE 账户需要两步验证，持续连接请改用 API Token"}
	}
	if out.Data.Username != t.username || !strings.HasPrefix(out.Data.Ticket, "PVE:"+t.username+":") || out.Data.CSRF == "" || strings.ContainsAny(out.Data.Ticket+out.Data.CSRF, "\r\n") {
		return pveSession{}, &connectionAuthError{"PVE 登录未返回有效的用户会话"}
	}
	return pveSession{ticket: out.Data.Ticket, csrf: out.Data.CSRF, issued: t.now()}, nil
}

func (t *passwordTransport) ensure(ctx context.Context) (pveSession, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if err := ctx.Err(); err != nil {
		return pveSession{}, err
	}
	now := t.now()
	if t.session.ticket != "" && now.Sub(t.session.issued) < pveRenewAfter {
		return t.session, nil
	}
	if t.lastError != nil && now.Before(t.retryAt) {
		return pveSession{}, t.lastError
	}
	credential := t.password
	renewing := t.session.ticket != "" && now.Sub(t.session.issued) < pveTicketLifetime
	if renewing {
		credential = t.session.ticket
	}
	session, err := t.login(ctx, credential)
	var authErr *connectionAuthError
	if renewing && errors.As(err, &authErr) {
		session, err = t.login(ctx, t.password)
	}
	if err != nil {
		// A cancelled browser request must not poison the shared connection.
		if ctx.Err() == nil {
			t.failures++
			t.retryAt = now.Add(min(30*time.Second*time.Duration(1<<min(t.failures-1, 4)), 5*time.Minute))
			t.lastError = err
		}
		return pveSession{}, err
	}
	t.session, t.lastError, t.failures = session, nil, 0
	return session, nil
}

func (t *passwordTransport) invalidate(session pveSession) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.session.ticket == session.ticket {
		t.session = pveSession{}
	}
}

func (t *passwordTransport) send(r *http.Request, session pveSession) (*http.Response, error) {
	r = r.Clone(r.Context())
	r.Header.Del("Cookie")
	r.Header.Del("Authorization")
	r.Header.Del("CSRFPreventionToken")
	r.AddCookie(&http.Cookie{Name: authCookieName, Value: url.QueryEscape(session.ticket)})
	if r.Method != "GET" && r.Method != "HEAD" {
		r.Header.Set("CSRFPreventionToken", session.csrf)
	}
	return t.base.RoundTrip(r)
}

func (t *passwordTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	session, err := t.ensure(r.Context())
	if err != nil {
		if r.Body != nil {
			r.Body.Close()
		}
		return nil, err
	}
	res, err := t.send(r, session)
	if err != nil || res.StatusCode != 401 {
		return res, err
	}
	res.Body.Close()
	t.invalidate(session)
	// Only replay safe, bodyless reads after an unexpectedly expired ticket.
	// Never retry writes/uploads: the browser must explicitly submit them again.
	if (r.Method == "GET" || r.Method == "HEAD") && (r.Body == nil || r.Body == http.NoBody) {
		session, err = t.ensure(r.Context())
		if err != nil {
			return nil, err
		}
		res, err = t.send(r, session)
		if err != nil || res.StatusCode != 401 {
			return res, err
		}
		res.Body.Close()
		t.invalidate(session)
	}
	return nil, &connectionAuthError{"PVE 会话已失效，请重试；如仍失败，请检查此实例的账户配置"}
}
