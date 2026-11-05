package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"sync"
	"time"
)

type hardwareProgressKey struct{}

func hardwareProgress(ctx context.Context, message string) {
	if report, ok := ctx.Value(hardwareProgressKey{}).(func(string)); ok {
		report(message)
	}
}

// Only publish known installer milestones, never terminal output: that channel
// also carries credentials, encoded scripts and potentially private apt URLs.
type hardwareInstallProgress struct {
	ctx     context.Context
	pending string
	seen    map[string]bool
	stage   string
	failure *hardwareFailure
	hint    *hardwareFailure
}

func newHardwareInstallProgress(ctx context.Context) *hardwareInstallProgress {
	return &hardwareInstallProgress{ctx: ctx, seen: map[string]bool{}, stage: "检查环境"}
}

func (p *hardwareInstallProgress) feed(chunk string) {
	p.pending += chunk
	for {
		line, rest, found := strings.Cut(p.pending, "\n")
		if !found {
			if len(p.pending) > 8192 {
				p.pending = ""
			}
			return
		}
		p.pending = rest
		line = strings.TrimSuffix(line, "\r")
		if shell, ok := strings.CutPrefix(line, "TILLER_SHELL:"); ok {
			switch shell {
			case "bash", "zsh", "fish", "dash", "sh":
				if !p.seen["shell"] {
					hardwareProgress(p.ctx, "节点登录 Shell："+shell+"；已启用独立 Bash 执行环境")
					p.seen["shell"] = true
				}
			}
			continue
		}
		if code, ok := strings.CutPrefix(line, "TILLER_ERROR:"); ok {
			if failure := hardwareMarkerError(code, p.stage); failure != nil {
				p.failure = failure
				hardwareProgress(p.ctx, failure.Reason)
			}
			continue
		}
		stage, ok := strings.CutPrefix(line, "TILLER_STAGE:")
		if !ok {
			if hint := hardwareOutputHint(p.stage, line); hint != nil {
				p.hint = hint
			}
			continue
		}
		if p.seen[stage] {
			continue
		}
		message, ok := map[string]string{
			"检查环境":            "正在检查 PVE 环境与采集服务归属",
			"安装软件包":           "正在检查 node_exporter、Python 3 与 smartmontools",
			"更新软件源":           "正在更新软件包索引，软件源响应较慢时可能需要等待",
			"软件源部分失败":         "部分软件源更新失败，将尝试使用已有的签名索引安装",
			"安装node_exporter": "正在安装 node_exporter 传感器采集工具",
			"复用node_exporter": "已检测到 node_exporter，复用已安装的软件包",
			"安装SMART依赖":       "正在安装 SMART 采集依赖：Python 3、smartmontools",
			"复用SMART依赖":       "Python 3 与 smartmontools 已安装，无需重复安装",
			"写入配置":            "正在配置加密访问与 SMART 采集任务（每 10 分钟一次，跳过休眠盘）",
			"启动服务":            "正在启动采集服务与 SMART 定时任务",
			"SMART定时任务已启动":    "SMART 定时任务已启动，正在安排首次后台采集",
			"采集服务已启动":         "节点采集服务已启动，正在返回连接结果",
			"停止采集":            "正在停止 Tiller 采集服务、SMART 定时器及正在执行的 SMART 任务",
			"采集已停止":           "Tiller 创建的采集任务已停止，开机自启已关闭",
			"恢复采集":            "正在恢复已有采集服务和定时任务，无需重新安装软件",
			"检查卸载依赖":          "正在核对安装记录及软件包依赖，暂未更改节点服务",
			"旧版安装记录缺失":        "旧版缺少完整安装记录，无法确认归属的软件包将保留",
			"卸载软件包":           "依赖检查通过，正在卸载本次接入安装的软件包",
			"卸载服务":            "正在删除 Tiller 创建的服务与采集配置",
			"服务已卸载":           "Tiller 采集服务已卸载，系统原有服务与软件包已保留",
		}[stage]
		if ok {
			p.hint = nil
			p.seen[stage] = true
			p.stage = stage
			hardwareProgress(p.ctx, message)
		}
	}
}

// Opt-in streaming keeps the existing JSON API working. The final JSON response
// (including its HTTP status) is the last event, after actual progress events.
type hardwareStream struct {
	http.ResponseWriter
	header http.Header
	body   bytes.Buffer
	status int
	mu     sync.Mutex
}

func (s *hardwareStream) Header() http.Header { return s.header }

func (s *hardwareStream) WriteHeader(status int) {
	if s.status == 0 {
		s.status = status
	}
}
func (s *hardwareStream) Write(p []byte) (int, error) {
	s.WriteHeader(http.StatusOK)
	return s.body.Write(p)
}
func (s *hardwareStream) emit(event any) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_ = json.NewEncoder(s.ResponseWriter).Encode(event)
	_ = http.NewResponseController(s.ResponseWriter).Flush()
}
func streamHardware(w http.ResponseWriter, r *http.Request) (http.ResponseWriter, *http.Request, func()) {
	w.Header().Set("Content-Type", "application/x-ndjson")
	w.Header().Set("X-Accel-Buffering", "no")
	s := &hardwareStream{ResponseWriter: w, header: w.Header().Clone()}
	report := func(message string) {
		s.emit(map[string]any{"type": "log", "at": time.Now().UTC().Format(time.RFC3339), "message": message})
	}
	ctx := context.WithValue(r.Context(), hardwareProgressKey{}, report)
	stop, stopped := make(chan struct{}), make(chan struct{})
	go func() {
		defer close(stopped)
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.emit(map[string]string{"type": "heartbeat"})
			}
		}
	}()
	return s, r.WithContext(ctx), func() {
		close(stop)
		<-stopped
		if !json.Valid(s.body.Bytes()) {
			s.status = http.StatusInternalServerError
			s.body.Reset()
			s.body.WriteString(`{"message":"接入未返回有效结果，请重新检查连接"}`)
		}
		s.emit(map[string]any{"type": "result", "status": s.status, "data": json.RawMessage(s.body.Bytes())})
	}
}
