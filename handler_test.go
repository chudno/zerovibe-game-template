package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

type fnResponse struct {
	StatusCode        int                 `json:"statusCode"`
	MultiValueHeaders map[string][]string `json:"multiValueHeaders"`
	Body              string              `json:"body"`
	IsBase64Encoded   bool                `json:"isBase64Encoded"`
}

func call(t *testing.T, url string) fnResponse {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"httpMethod": "GET", "url": url})
	if err != nil {
		t.Fatal(err)
	}
	out, err := Handler(context.Background(), raw)
	if err != nil {
		t.Fatalf("%s: %v", url, err)
	}
	var resp fnResponse
	if err := json.Unmarshal(out, &resp); err != nil {
		t.Fatal(err)
	}
	return resp
}

func (r fnResponse) header(name string) string {
	for k, v := range r.MultiValueHeaders {
		if strings.EqualFold(k, name) && len(v) > 0 {
			return v[0]
		}
	}
	return ""
}

func (r fnResponse) decoded(t *testing.T) []byte {
	t.Helper()
	if !r.IsBase64Encoded {
		return []byte(r.Body)
	}
	b, err := base64.StdEncoding.DecodeString(r.Body)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestФункцияОтдаётОболочку(t *testing.T) {
	resp := call(t, "/")
	if resp.StatusCode != 200 {
		t.Fatalf("код %d", resp.StatusCode)
	}
	if ct := resp.header("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type %q", ct)
	}
	if !strings.Contains(string(resp.decoded(t)), `id="game"`) {
		t.Fatal("нет контейнера игры")
	}
}

func TestФункцияОтдаётДвижок(t *testing.T) {
	resp := call(t, "/vendor/phaser-arcade-physics.min.js")
	if resp.StatusCode != 200 {
		t.Fatalf("код %d", resp.StatusCode)
	}
	if ct := resp.header("Content-Type"); !strings.HasPrefix(ct, "application/javascript") {
		t.Fatalf("Content-Type %q", ct)
	}
	if len(resp.decoded(t)) < 100_000 {
		t.Fatal("движок подозрительно мал — файл повреждён?")
	}
}

func TestФункцияОтдаётКартинкуВBase64(t *testing.T) {
	resp := call(t, "/assets/placeholder.png")
	if resp.StatusCode != 200 {
		t.Fatalf("код %d", resp.StatusCode)
	}
	if ct := resp.header("Content-Type"); ct != "image/png" {
		t.Fatalf("Content-Type %q", ct)
	}
	if !resp.IsBase64Encoded {
		t.Fatal("бинарь должен ехать base64")
	}
	if !strings.HasPrefix(string(resp.decoded(t)), "\x89PNG") {
		t.Fatal("это не PNG")
	}
}

func TestФункцияНеЗнаетЧужихПутей(t *testing.T) {
	if resp := call(t, "/api/secret"); resp.StatusCode != 404 {
		t.Fatalf("код %d, ждали 404", resp.StatusCode)
	}
}

// /healthz — прогрев функции платформой: 200 без обращения к статике.
func TestHandler_Healthz(t *testing.T) {
	resp := call(t, "/healthz")
	if resp.StatusCode != 200 {
		t.Fatalf("/healthz: %d, ждали 200", resp.StatusCode)
	}
}
