package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestHardwareProgressStreamsBeforeCompletion(t *testing.T) {
	release := make(chan struct{})
	var once sync.Once
	unblock := func() { once.Do(func() { close(release) }) }
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w, r, finish := streamHardware(w, r)
		defer finish()
		hardwareProgress(r.Context(), "正在安装软件包")
		<-release
		writePVEError(w, 502, "软件包安装失败")
	}))
	defer srv.Close()
	defer unblock()
	client := &http.Client{Timeout: 3 * time.Second}
	response, err := client.Get(srv.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.Header.Get("Content-Type") != "application/x-ndjson" {
		t.Fatal("stream content type lost")
	}
	decoder := json.NewDecoder(response.Body)
	var event struct {
		Type, Message string
		Status        int
		Data          struct{ Message string }
	}
	if err := decoder.Decode(&event); err != nil || event.Type != "log" || event.Message != "正在安装软件包" {
		t.Fatalf("progress buffered until completion: %+v, %v", event, err)
	}
	unblock()
	if err := decoder.Decode(&event); err != nil || event.Type != "result" || event.Status != 502 || event.Data.Message != "软件包安装失败" {
		t.Fatalf("final failure lost: %+v, %v", event, err)
	}
}

func TestHardwareProgressOnlyPublishesKnownMilestones(t *testing.T) {
	var logs []string
	ctx := context.WithValue(context.Background(), hardwareProgressKey{}, func(s string) { logs = append(logs, s) })
	p := newHardwareInstallProgress(ctx)
	text := "password=secret\nTILLER_B64=credential-payload\nTILLER_STAGE:安装软件包\r\nTILLER_STAGE:安装软件包\nhttps://user:secret@repo\nTILLER_STAGE:private-secret\nTILLER_STAGE:写入配置\n"
	// Byte-by-byte terminal frames can split markers and multi-byte characters.
	for i := range len(text) {
		p.feed(text[i : i+1])
	}
	if len(logs) != 2 || p.stage != "写入配置" {
		t.Fatalf("missing or duplicated stages: %v", logs)
	}
	if strings.Contains(strings.Join(logs, ""), "secret") || strings.Contains(strings.Join(logs, ""), "credential") {
		t.Fatal("terminal credentials leaked")
	}
	p.feed(strings.Repeat("x", 20000))
	if len(p.pending) > 8192 {
		t.Fatal("unbounded terminal buffer")
	}
}

func TestHardwareStreamPreservesAuthorizationAndInstallHandoff(t *testing.T) {
	pve := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api2/json/cluster/status" {
			w.Write([]byte(`{"data":[{"type":"node","name":"lab","ip":"127.0.0.1"}]}`))
		} else {
			w.Write([]byte(`{"data":{}}`))
		}
	}))
	defer pve.Close()
	h := newHardwareService(&Config{InstancesFile: filepath.Join(t.TempDir(), "instances.json")}, InstanceConfig{ID: "one", Version: "v1", URL: pve.URL}, http.DefaultTransport, http.DefaultTransport.(*http.Transport))
	for _, authorized := range []bool{false, true} {
		r := httptest.NewRequest("POST", "/api/hardware/lab/upgrade", nil)
		r.Header.Set("Accept", "application/x-ndjson")
		if authorized {
			r = r.WithContext(context.WithValue(r.Context(), adminContextKey{}, &adminSession{}))
		}
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if !authorized {
			if w.Code != 401 || strings.Contains(w.Body.String(), `"type":"log"`) {
				t.Fatal("unauthorized request opened progress stream")
			}
			continue
		}
		lines := strings.Split(strings.TrimSpace(w.Body.String()), "\n")
		var result struct {
			Type   string
			Status int
			Data   struct{ NeedsInstall bool }
		}
		if err := json.Unmarshal([]byte(lines[len(lines)-1]), &result); err != nil {
			t.Fatal(err)
		}
		if result.Type != "result" || result.Status != 409 || !result.Data.NeedsInstall {
			t.Fatalf("authorization handoff lost: %+v", result)
		}
	}
}
