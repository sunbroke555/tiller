package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestHardwareDiagnosticsExplainFailureWithoutSecrets(t *testing.T) {
	for _, tc := range []struct {
		name, code string
		failure    *hardwareFailure
	}{
		{"shell syntax", "SHELL_SYNTAX", hardwareTerminalError("初始化节点 Shell", context.DeadlineExceeded, "zsh:set:1: no such option: history\npassword=private-secret", false)},
		{"unknown timeout", "TERMINAL_TIMEOUT", hardwareTerminalError("初始化节点 Shell", context.DeadlineExceeded, "private-secret", false)},
		{"DNS", "PVE_DNS", hardwareAccessError("打开节点 Shell", &url.Error{Op: "Post", URL: "https://private-secret", Err: &net.DNSError{Err: "lookup failed", Name: "private-secret"}})},
		{"permission", "PVE_ACCESS_DENIED", hardwareAccessError("打开节点 Shell", &hardwareHTTPError{status: 403})},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := httptest.NewRecorder()
			writeHardwareError(w, 502, tc.failure)
			var body struct {
				Message    string
				Diagnostic hardwareFailure
			}
			if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
				t.Fatal(err)
			}
			if body.Diagnostic.Code != tc.code || body.Diagnostic.State != hardwareNotStarted || body.Diagnostic.Suggestion == "" {
				t.Fatalf("missing diagnostic: %s", w.Body.String())
			}
			if strings.Contains(w.Body.String(), "private-secret") {
				t.Fatal("private terminal/network data leaked")
			}
		})
	}
	unknown := hardwareTerminalError("等待节点结果", errors.New("private-secret"), "", true)
	if unknown.State == hardwareNotStarted || !strings.Contains(unknown.State, "可能已开始") {
		t.Fatal("lost connection falsely claimed that nothing executed")
	}
}

func TestHardwareDiagnosticsClassifyCurrentStep(t *testing.T) {
	p := newHardwareInstallProgress(context.Background())
	p.feed("TILLER_STAGE:安装node_exporter\nE: Failed to fetch https://user:private-secret@repo Temporary failure resolving 'private-host'\n")
	failure := hardwareExecutionError(p, "100")
	if failure.Code != "PACKAGE_DNS" || failure.Stage != "安装 node_exporter" {
		t.Fatalf("wrong package diagnostic: %+v", failure)
	}
	raw, _ := json.Marshal(failure)
	if strings.Contains(string(raw), "private-") {
		t.Fatal("software source credentials leaked")
	}
	p.feed("TILLER_STAGE:写入配置\n")
	if hardwareExecutionError(p, "1").Code != "NODE_COMMAND_FAILED" {
		t.Fatal("old package warning misdiagnosed later failure")
	}
	p.feed("TILLER_STAGE:检查卸载依赖\nTILLER_ERROR:DEPENDENCIES\n")
	failure = hardwareExecutionError(p, "83")
	if failure.Code != "PACKAGE_DEPENDENCIES" || failure.State != hardwareNotStarted {
		t.Fatal("dependency cancellation lost its unchanged state")
	}
}

func TestHardwareDiagnosticSurvivesProgressStream(t *testing.T) {
	r := httptest.NewRequest("POST", "/hardware", nil)
	w := httptest.NewRecorder()
	stream, _, finish := streamHardware(w, r)
	writeHardwareError(stream, 502, hardwareTerminalError("初始化节点 Shell", context.DeadlineExceeded, "", false))
	finish()
	var event struct {
		Type   string
		Status int
		Data   struct{ Diagnostic hardwareFailure }
	}
	if err := json.Unmarshal(w.Body.Bytes(), &event); err != nil {
		t.Fatal(err)
	}
	if event.Type != "result" || event.Status != 502 || event.Data.Diagnostic.Code != "TERMINAL_TIMEOUT" {
		t.Fatalf("stream lost diagnosis: %s", w.Body.String())
	}
}
