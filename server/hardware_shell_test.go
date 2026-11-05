package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestHardwareBootstrapWithBashAndZsh(t *testing.T) {
	for _, shell := range []string{"bash", "zsh"} {
		t.Run(shell, func(t *testing.T) {
			path, err := exec.LookPath(shell)
			if err != nil {
				t.Skip("optional shell not installed: " + shell)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			defer cancel()
			cmd := exec.CommandContext(ctx, "python3", "-c", hardwarePTYFixture, path)
			cmd.Stdin = strings.NewReader(hardwareShellBootstrap("TILLER_READY_test"))
			if out, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("terminal bootstrap failed: %v\n%s", err, out)
			}
		})
	}
}

// Exercise a real PTY, including shell replacement, frame-sized payload lines,
// terminal echo, exit status and hostile inherited Bash startup configuration.
const hardwarePTYFixture = `import base64, os, pty, select, signal, sys, tempfile, time
from pathlib import Path
bootstrap = sys.stdin.read().encode()
shell = sys.argv[1]
with tempfile.TemporaryDirectory() as directory:
    home = Path(directory)
    poison = home / 'startup'
    poison.write_text('echo UNEXPECTED_STARTUP; exit 99\n')
    pid, fd = pty.fork()
    if pid == 0:
        os.environ.update(HOME=directory, HISTFILE=str(home/'history'), BASH_ENV=str(poison), ENV=str(poison), SHELLOPTS='xtrace', TERM='dumb')
        args = [shell, '-f', '-i'] if Path(shell).name == 'zsh' else [shell, '--noprofile', '--norc', '-i']
        os.execv(shell, args)
    output = b''
    def expect(marker):
        global output
        end = time.monotonic() + 5
        while marker not in output.replace(b'\r', b''):
            if time.monotonic() >= end: raise AssertionError('terminal timeout: '+repr(output[-3000:]))
            if select.select([fd], [], [], 0.1)[0]: output += os.read(fd, 8192)
    try:
        os.write(fd, b'printf "\\nPARENT_READY\\n"\r')
        expect(b'\nPARENT_READY\n')
        os.write(fd, bootstrap)
        expect(b'\nTILLER_READY_test\n')
        output = b''
        payload = base64.b64encode(b"printf 'SCRIPT_OK\\n'; exit 7\n")
        os.write(fd, b'TILLER_B64="'+payload+b'"; printf "\\nPART_OK\\n"\r')
        expect(b'\nPART_OK\n')
        os.write(fd, b'printf %s "$TILLER_B64" | base64 -d | bash; printf "\\nDONE:%s\\n" "$?"; unset TILLER_B64\r')
        expect(b'\nDONE:7\n')
        assert b'SCRIPT_OK' in output, output
        assert payload not in output, 'installer payload was echoed or traced'
        assert b'UNEXPECTED_STARTUP' not in output, 'inherited shell startup hook executed'
    finally:
        os.close(fd)
        try: os.kill(pid, signal.SIGKILL)
        except ProcessLookupError: pass
        os.waitpid(pid, 0)
`

func TestHardwareRetryUnfinishedInstallationDoesNotResume(t *testing.T) {
	var discovered atomic.Bool
	pve := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api2/json/cluster/status" {
			discovered.Store(true)
		}
		fmt.Fprint(w, `{"data":{}}`)
	}))
	defer pve.Close()
	h := newHardwareService(&Config{InstancesFile: filepath.Join(t.TempDir(), "instances.json")}, InstanceConfig{ID: "one", Version: "v1", URL: pve.URL}, pve.Client().Transport, pve.Client().Transport.(*http.Transport))
	conn := hardwareConnection{Managed: true, URL: "https://127.0.0.1:19100/metrics", Version: 2}
	if _, err := h.connection("lab", &conn); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("POST", "/api/hardware/lab/connect", nil)
	r = r.WithContext(context.WithValue(r.Context(), adminContextKey{}, &adminSession{}))
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	if !discovered.Load() {
		t.Fatalf("unfinished install entered service-resume flow: %d %s", w.Code, w.Body.String())
	}
}
