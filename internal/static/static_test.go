package static_test

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/zerovibe/game-template/internal/static"
)

func serve(t *testing.T, path string) *httptest.ResponseRecorder {
	t.Helper()
	h := static.Handler(os.DirFS("../../static"))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, path, nil))
	return rec
}

func TestКореньОтдаётОболочку(t *testing.T) {
	rec := serve(t, "/")
	if rec.Code != http.StatusOK {
		t.Fatalf("код %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type %q", ct)
	}
	if !strings.Contains(rec.Body.String(), `id="game"`) {
		t.Fatal("в оболочке нет контейнера игры")
	}
	if rec.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("html должен быть без кэша, а не %q", rec.Header().Get("Cache-Control"))
	}
}

func TestДвижокКэшируетсяНавсегда(t *testing.T) {
	rec := serve(t, "/vendor/phaser-arcade-physics.min.js")
	if rec.Code != http.StatusOK {
		t.Fatalf("код %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "application/javascript") {
		t.Fatalf("Content-Type %q", ct)
	}
	if !strings.Contains(rec.Header().Get("Cache-Control"), "immutable") {
		t.Fatalf("Cache-Control %q", rec.Header().Get("Cache-Control"))
	}
}

func TestТипыПоРасширению(t *testing.T) {
	cases := map[string]string{
		"/assets/placeholder.png": "image/png",
		"/game/style.css":         "text/css",
		"/game/config.js":         "application/javascript",
	}
	for path, want := range cases {
		rec := serve(t, path)
		if rec.Code != http.StatusOK {
			t.Fatalf("%s: код %d", path, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, want) {
			t.Fatalf("%s: Content-Type %q, ждали %q", path, ct, want)
		}
	}
}

func TestНеизвестноеДаёт404(t *testing.T) {
	for _, path := range []string{"/нет-такого.js", "/game/kits/runner/README.md", "/../go.mod", "/handler.go"} {
		if rec := serve(t, path); rec.Code != http.StatusNotFound {
			t.Fatalf("%s: код %d, ждали 404", path, rec.Code)
		}
	}
}
