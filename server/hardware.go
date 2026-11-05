package main

import (
	"bufio"
	"context"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"
)

const hardwarePoll = 5 * time.Second

var hardwareFileMu sync.Mutex
var hardwareNodeName = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9-]{0,62}$`)

type hardwareConnection struct {
	Enabled     bool   `json:"enabled"`
	URL         string `json:"url"`
	Fingerprint string `json:"fingerprint,omitempty"`
	Secret      string `json:"secret,omitempty"`
	Managed     bool   `json:"managed"`
	Version     int    `json:"version,omitempty"`
	Paused      bool   `json:"paused,omitempty"`
}
type hardwareNodeCache struct {
	mu          sync.Mutex
	snapshot    hardwareSnapshot
	checked     time.Time
	diskChecked time.Time
}
type hardwareService struct {
	instance  InstanceConfig
	auth      *localAuth
	file      string
	upstream  *http.Client
	transport *http.Transport
	mu        sync.Mutex
	nodes     map[string]*hardwareNodeCache
}

func newHardwareService(cfg *Config, c InstanceConfig, upstream http.RoundTripper, transport *http.Transport) *hardwareService {
	return &hardwareService{instance: c, auth: cfg.Auth, file: cfg.InstancesFile + ".hardware.json", upstream: &http.Client{Transport: upstream, Timeout: 20 * time.Second, CheckRedirect: rejectHardwareRedirect}, transport: transport, nodes: map[string]*hardwareNodeCache{}}
}
func rejectHardwareRedirect(_ *http.Request, _ []*http.Request) error {
	return errors.New("监控连接不接受重定向")
}
func (h *hardwareService) scope(node string) string {
	return h.instance.ID + ":" + h.instance.Version + ":" + node
}
func (h *hardwareService) cache(node string) *hardwareNodeCache {
	h.mu.Lock()
	defer h.mu.Unlock()
	if c := h.nodes[node]; c != nil {
		return c
	}
	c := &hardwareNodeCache{}
	h.nodes[node] = c
	return c
}
func (h *hardwareService) connection(node string, update *hardwareConnection) (hardwareConnection, error) {
	hardwareFileMu.Lock()
	defer hardwareFileMu.Unlock()
	all := map[string]hardwareConnection{}
	raw, e := os.ReadFile(h.file)
	if e != nil && !errors.Is(e, os.ErrNotExist) {
		return hardwareConnection{}, e
	}
	if len(raw) > 8<<20 {
		return hardwareConnection{}, errors.New("硬件连接配置过大")
	}
	if len(raw) > 0 {
		if e = json.Unmarshal(raw, &all); e != nil {
			return hardwareConnection{}, errors.New("硬件连接配置无法读取")
		}
	}
	if update != nil {
		all[h.scope(node)] = *update
		raw, e = json.Marshal(all)
		if e == nil {
			e = writePrivateFile(h.file, raw, false)
		}
		if e != nil {
			return hardwareConnection{}, e
		}
	}
	return all[h.scope(node)], nil
}
func (h *hardwareService) pve(ctx context.Context, path string, values url.Values, dst any) error {
	method := http.MethodGet
	var body io.Reader
	if values != nil {
		method = http.MethodPost
		body = strings.NewReader(values.Encode())
	}
	req, e := http.NewRequestWithContext(ctx, method, h.instance.URL+"/api2/json"+path, body)
	if e != nil {
		return e
	}
	if values != nil {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	res, e := h.upstream.Do(req)
	if e != nil {
		return errors.New("无法连接 PVE")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return fmt.Errorf("PVE 拒绝读取节点（HTTP %d），请检查连接及 Sys.Audit 权限", res.StatusCode)
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if e = json.NewDecoder(io.LimitReader(res.Body, 4<<20)).Decode(&envelope); e != nil {
		return e
	}
	if dst != nil {
		return json.Unmarshal(envelope.Data, dst)
	}
	return nil
}

func (h *hardwareService) nodeIP(ctx context.Context, node string) (string, error) {
	var nodes []struct {
		Type string `json:"type"`
		Name string `json:"name"`
		IP   string `json:"ip"`
	}
	if e := h.pve(ctx, "/cluster/status", nil, &nodes); e != nil {
		return "", e
	}
	for _, n := range nodes {
		if n.Type == "node" && n.Name == node {
			ip := net.ParseIP(n.IP)
			if ip == nil || ip.IsUnspecified() || ip.IsMulticast() || ip.IsLinkLocalUnicast() {
				return "", errors.New("PVE 没有提供可用的节点管理地址")
			}
			return ip.String(), nil
		}
	}
	return "", errors.New("PVE 中不存在此节点")
}

func (h *hardwareService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	if adminFrom(r) == nil {
		writePVEError(w, 401, "请先登录 Tiller")
		return
	}
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/api/hardware/"), "/")
	if len(parts) > 2 || !hardwareNodeName.MatchString(parts[0]) {
		writePVEError(w, 404, "节点不存在")
		return
	}
	node := parts[0]
	action := ""
	if len(parts) == 2 {
		action = parts[1]
	}
	if ((r.Method == "POST" && (action == "connect" || action == "upgrade" || action == "install" || action == "resume" || action == "uninstall")) || (r.Method == "DELETE" && action == "")) && r.Header.Get("Accept") == "application/x-ndjson" {
		var finish func()
		w, r, finish = streamHardware(w, r)
		defer finish()
		hardwareProgress(r.Context(), "正在检查节点访问权限")
	}
	// Verify the selected instance's current PVE permissions before returning
	// cached hardware values. A Tiller session does not grant PVE privileges.
	if e := h.pve(r.Context(), "/nodes/"+node+"/status", nil, nil); e != nil {
		writePVEError(w, 403, e.Error())
		return
	}
	c := h.cache(node)
	hardwareProgress(r.Context(), "等待节点接入任务，避免重复安装")
	c.mu.Lock()
	defer c.mu.Unlock()
	conn, e := h.connection(node, nil)
	if e != nil {
		writePVEError(w, 500, e.Error())
		return
	}
	switch {
	case r.Method == "GET" && action == "":
		if !conn.Enabled {
			json.NewEncoder(w).Encode(hardwareSnapshot{Managed: conn.Managed, Paused: conn.Paused, SmartAuto: conn.Version >= 2})
			return
		}
		if time.Since(c.checked) >= hardwarePoll {
			h.refresh(r.Context(), node, conn, c)
		}
		expireHardwarePower(&c.snapshot, time.Now())
		json.NewEncoder(w).Encode(c.snapshot)
	case r.Method == "POST" && (action == "connect" || action == "upgrade"):
		if action == "upgrade" && conn.Managed && conn.Version >= 2 {
			h.upgradeHardwareScripts(w, r, node, c, conn)
			return
		}
		if action == "connect" && conn.Managed && conn.Paused && conn.URL != "" {
			h.controlHardware(w, r, node, c, conn, "resume")
			return
		}
		hardwareProgress(r.Context(), "正在检测节点已有的采集服务")
		if conn.URL != "" && action == "connect" {
			conn.Enabled = true
			if e = h.probeAndSave(r.Context(), node, conn, c); e == nil {
				hardwareProgress(r.Context(), "已有采集服务连接成功，接入完成")
				json.NewEncoder(w).Encode(c.snapshot)
				return
			}
		}
		ip, err := h.nodeIP(r.Context(), node)
		if err != nil {
			writePVEError(w, 400, err.Error())
			return
		}
		candidate := hardwareConnection{Enabled: true, URL: "http://" + net.JoinHostPort(ip, "9100") + "/metrics"}
		if action == "upgrade" || h.probeAndSave(r.Context(), node, candidate, c) != nil {
			if h.savedRootConnection() != nil {
				hardwareProgress(r.Context(), "沿用实例中已有的节点管理员授权")
				r = r.Clone(r.Context())
				r.Body = io.NopCloser(strings.NewReader("{}"))
				h.install(w, r, node, c)
				return
			}
			w.WriteHeader(409)
			hardwareProgress(r.Context(), "需要一次节点管理员授权，才能安装采集服务")
			json.NewEncoder(w).Encode(map[string]any{"needsInstall": true, "message": "未发现可直接接入的采集服务，可在此安装并自动配置。"})
			return
		}
		hardwareProgress(r.Context(), "已接入节点现有的 node_exporter 服务")
		json.NewEncoder(w).Encode(c.snapshot)
	case r.Method == "POST" && action == "install":
		h.install(w, r, node, c)
	case r.Method == "DELETE" && action == "":
		if conn.Managed {
			h.controlHardware(w, r, node, c, conn, "stop")
			return
		}
		conn.Enabled = false
		if _, e = h.connection(node, &conn); e != nil {
			writePVEError(w, 500, "无法保存监控设置")
			return
		}
		c.snapshot = hardwareSnapshot{}
		c.checked = time.Time{}
		c.diskChecked = time.Time{}
		json.NewEncoder(w).Encode(c.snapshot)
	case r.Method == "POST" && (action == "resume" || action == "uninstall"):
		h.controlHardware(w, r, node, c, conn, action)
	case r.Method == "POST" && action == "disks":
		if !conn.Enabled {
			writePVEError(w, 409, "请先接入硬件监控")
			return
		}
		if conn.Version >= 2 {
			// Refresh the node's textfile cache only. A browser request never
			// bypasses the timer's disk power-state policy.
			h.refresh(r.Context(), node, conn, c)
			json.NewEncoder(w).Encode(c.snapshot)
			return
		}
		if c.checked.IsZero() {
			h.refresh(r.Context(), node, conn, c)
		}
		if time.Since(c.diskChecked) >= 10*time.Minute {
			if e = h.readDisks(r.Context(), node, c); e != nil {
				writePVEError(w, 502, e.Error())
				return
			}
		}
		json.NewEncoder(w).Encode(c.snapshot)
	default:
		writePVEError(w, 405, "不支持的操作")
	}
}

func (h *hardwareService) scrape(ctx context.Context, node string, c hardwareConnection, previous *hardwareSnapshot) (hardwareSnapshot, error) {
	client, t, e := h.hardwareClient(c)
	if e != nil {
		return hardwareSnapshot{}, e
	}
	defer t.CloseIdleConnections()
	collectors := []string{"hwmon", "rapl", "cpufreq", "powersupplyclass", "uname", "thermal_zone"}
	if c.Version >= 2 {
		collectors = append(collectors, "textfile")
	}
	return h.scrapeCollectors(ctx, node, c, client, collectors, previous)
}

func (h *hardwareService) hardwareClient(c hardwareConnection) (*http.Client, *http.Transport, error) {
	t := &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 3 * time.Second}).DialContext, TLSHandshakeTimeout: 3 * time.Second, ResponseHeaderTimeout: 4 * time.Second}
	if c.Fingerprint != "" {
		pin, e := hex.DecodeString(c.Fingerprint)
		if e != nil || len(pin) != 32 {
			return nil, nil, errors.New("采集服务证书配置无效")
		}
		t.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12, InsecureSkipVerify: true, VerifyConnection: func(cs tls.ConnectionState) error {
			if len(cs.PeerCertificates) == 0 {
				return errors.New("采集服务没有证书")
			}
			sum := sha256.Sum256(cs.PeerCertificates[0].Raw)
			if subtle.ConstantTimeCompare(sum[:], pin) != 1 {
				return errors.New("采集服务证书已变化，请重新接入")
			}
			return nil
		}}
	}
	return &http.Client{Transport: t, Timeout: 6 * time.Second, CheckRedirect: rejectHardwareRedirect}, t, nil
}

func (h *hardwareService) scrapeCollectors(ctx context.Context, node string, c hardwareConnection, client *http.Client, collectors []string, previous *hardwareSnapshot) (hardwareSnapshot, error) {
	started := time.Now()
	req, e := http.NewRequestWithContext(ctx, "GET", c.URL, nil)
	if e != nil {
		return hardwareSnapshot{}, e
	}
	// Hardware reads only. The textfile collector is enabled only for our
	// managed cache; no filesystem scan or request-time SMART command runs.
	query := req.URL.Query()
	query.Del("collect[]")
	query.Del("exclude[]")
	for _, collector := range collectors {
		query.Add("collect[]", collector)
	}
	req.URL.RawQuery = query.Encode()
	if c.Secret != "" {
		secret, e := h.auth.unseal(c.Secret, "hardware:"+h.scope(node))
		if e != nil {
			return hardwareSnapshot{}, e
		}
		req.SetBasicAuth("tiller", secret)
	}
	res, e := client.Do(req)
	if e != nil {
		return hardwareSnapshot{}, errors.New("无法连接节点采集服务，请检查服务状态及节点防火墙")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return hardwareSnapshot{}, fmt.Errorf("采集服务返回 HTTP %d", res.StatusCode)
	}
	raw, e := io.ReadAll(io.LimitReader(res.Body, (2<<20)+1))
	if e != nil {
		return hardwareSnapshot{}, e
	}
	if len(raw) > 2<<20 {
		return hardwareSnapshot{}, errors.New("采集数据超过大小限制")
	}
	s, e := parseHardwareMetrics(string(raw), previous, started.Add(time.Since(started)/2))
	s.Enabled = true
	s.Managed = c.Managed
	if c.Version >= 2 {
		s.SmartAuto = true
	}
	return s, e
}
func (h *hardwareService) probeAndSave(ctx context.Context, node string, conn hardwareConnection, c *hardwareNodeCache) error {
	s, e := h.scrape(ctx, node, conn, &c.snapshot)
	if e != nil {
		return e
	}
	if !s.SmartAuto {
		s.Disks = c.snapshot.Disks
		s.DisksUpdatedAt = c.snapshot.DisksUpdatedAt
	}
	if u, e := url.Parse(conn.URL); e == nil {
		s.Batteries = append(s.Batteries, readNodeUPS(ctx, u.Hostname())...)
	}
	if _, e = h.connection(node, &conn); e != nil {
		return e
	}
	c.snapshot = s
	c.checked = time.Now()
	expireHardwarePower(&c.snapshot, time.Now())
	return nil
}
func (h *hardwareService) refresh(ctx context.Context, node string, conn hardwareConnection, c *hardwareNodeCache) {
	s, e := h.scrape(ctx, node, conn, &c.snapshot)
	c.checked = time.Now()
	if e != nil {
		c.snapshot.Enabled = true
		c.snapshot.Managed = conn.Managed
		c.snapshot.SmartAuto = conn.Version >= 2 || c.snapshot.SmartAuto
		c.snapshot.Connected = false
		c.snapshot.Error = e.Error()
		expireHardwarePower(&c.snapshot, time.Now())
		return
	}
	if !s.SmartAuto {
		s.Disks = c.snapshot.Disks
		s.DisksUpdatedAt = c.snapshot.DisksUpdatedAt
	}
	if u, e := url.Parse(conn.URL); e == nil {
		s.Batteries = append(s.Batteries, readNodeUPS(ctx, u.Hostname())...)
	}
	c.snapshot = s
}

func (h *hardwareService) readDisks(ctx context.Context, node string, c *hardwareNodeCache) error {
	ctx, cancel := context.WithTimeout(ctx, 90*time.Second)
	defer cancel()
	var disks []struct {
		Device string `json:"devpath"`
		Model  string `json:"model"`
		Parent string `json:"parent"`
		Type   string `json:"type"`
	}
	if e := h.pve(ctx, "/nodes/"+node+"/disks/list?skipsmart=1", nil, &disks); e != nil {
		return e
	}
	result := []hardwareDisk{}
	for _, d := range disks {
		if d.Parent != "" || d.Type == "partition" {
			continue
		}
		if ctx.Err() != nil {
			return errors.New("磁盘信息读取超时，请稍后重试")
		}
		var smart struct {
			Health     string `json:"health"`
			Text       string `json:"text"`
			Attributes []struct {
				ID   json.RawMessage `json:"id"`
				Name string          `json:"name"`
				Raw  string          `json:"raw"`
			} `json:"attributes"`
		}
		item := hardwareDisk{Device: d.Device, Model: d.Model, Health: "UNKNOWN"}
		if e := h.pve(ctx, "/nodes/"+node+"/disks/smart?disk="+url.QueryEscape(d.Device), nil, &smart); e == nil {
			if smart.Health != "" {
				item.Health = smart.Health
			}
			for _, a := range smart.Attributes {
				id := strings.Trim(string(a.ID), "\"")
				if id == "194" || id == "190" || strings.Contains(a.Name, "Temperature") {
					v := firstHardwareNumber(a.Raw)
					if v != nil && *v >= -20 && *v <= 150 {
						item.Temperature = v
					}
				}
			}
			for _, line := range strings.Split(smart.Text, "\n") {
				kv := strings.SplitN(strings.TrimSpace(line), ":", 2)
				if len(kv) != 2 {
					continue
				}
				switch kv[0] {
				case "Temperature", "Current Drive Temperature":
					item.Temperature = firstHardwareNumber(kv[1])
				case "Percentage Used":
					if v := firstHardwareNumber(kv[1]); v != nil {
						left := max(0, 100-*v)
						item.Life = &left
					}
				}
			}
		}
		result = append(result, item)
	}
	c.snapshot.Disks = result
	c.snapshot.DisksUpdatedAt = time.Now()
	c.diskChecked = time.Now()
	return nil
}
func firstHardwareNumber(s string) *float64 {
	fields := strings.Fields(strings.TrimSpace(s))
	if len(fields) == 0 {
		return nil
	}
	v, e := strconv.ParseFloat(strings.TrimSuffix(fields[0], "%"), 64)
	if e != nil || math.IsNaN(v) || math.IsInf(v, 0) {
		return nil
	}
	return &v
}

// NUT's read-only LIST commands do not change UPS state. Discovery is restricted
// to the verified node address; arbitrary LAN scanning is never performed.
func readNodeUPS(ctx context.Context, host string) []hardwareBattery {
	ctx, cancel := context.WithTimeout(ctx, 1500*time.Millisecond)
	defer cancel()
	conn, e := (&net.Dialer{}).DialContext(ctx, "tcp", net.JoinHostPort(host, "3493"))
	if e != nil {
		return nil
	}
	defer conn.Close()
	conn.SetDeadline(time.Now().Add(1500 * time.Millisecond))
	r := bufio.NewReader(io.LimitReader(conn, 64<<10))
	fmt.Fprint(conn, "LIST UPS\n")
	name := ""
	for i := 0; i < 128; i++ {
		line, e := r.ReadString('\n')
		if e != nil {
			return nil
		}
		f := strings.Fields(line)
		if len(f) >= 2 && f[0] == "UPS" && name == "" {
			name = f[1]
		}
		if strings.HasPrefix(line, "END LIST UPS") || strings.HasPrefix(line, "ERR") {
			break
		}
	}
	if !regexp.MustCompile(`^[A-Za-z0-9_.-]{1,80}$`).MatchString(name) {
		return nil
	}
	fmt.Fprintf(conn, "LIST VAR %s\n", name)
	values := map[string]string{}
	for i := 0; i < 256; i++ {
		line, e := r.ReadString('\n')
		if e != nil {
			return nil
		}
		f := strings.SplitN(strings.TrimSpace(line), " ", 4)
		if len(f) == 4 && f[0] == "VAR" && f[1] == name {
			v, e := strconv.Unquote(f[3])
			if e == nil {
				values[f[2]] = v
			}
		}
		if strings.HasPrefix(line, "END LIST VAR") || strings.HasPrefix(line, "ERR") {
			break
		}
	}
	if len(values) == 0 {
		return nil
	}
	model := values["ups.model"]
	if model == "" {
		model = name
	}
	return []hardwareBattery{{Name: model, Status: values["ups.status"], Charge: firstHardwareNumber(values["battery.charge"]), Runtime: firstHardwareNumber(values["battery.runtime"]), Load: firstHardwareNumber(values["ups.load"]), Voltage: firstHardwareNumber(values["input.voltage"]), Source: "nut"}}
}
