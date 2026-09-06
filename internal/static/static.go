// Package static — раздача статики игры: HTML-оболочка, движок, код китов и
// заглушки ассетов. Одна и та же для функции (handler.go) и локального сервера.
package static

import (
	"io/fs"
	"net/http"
	"path"
	"strings"
)

// contentTypes — Content-Type по расширению. Список закрытый: файл с
// неизвестным расширением в игру не попадает (404), чтобы случайный мусор в
// репозитории не уезжал в прод.
var contentTypes = map[string]string{
	".html":  "text/html; charset=utf-8",
	".js":    "application/javascript; charset=utf-8",
	".css":   "text/css; charset=utf-8",
	".json":  "application/json; charset=utf-8",
	".png":   "image/png",
	".jpg":   "image/jpeg",
	".jpeg":  "image/jpeg",
	".webp":  "image/webp",
	".svg":   "image/svg+xml",
	".mp3":   "audio/mpeg",
	".ogg":   "audio/ogg",
	".wav":   "audio/wav",
	".woff2": "font/woff2",
	".ico":   "image/x-icon",
}

// Handler отдаёт статику игры из files (embed каталога static/ — см. assets.go
// в корне: //go:embed живёт только в пакете, где лежит каталог).
func Handler(files fs.FS) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if name == "" || name == "." {
			name = "index.html"
		}
		ext := strings.ToLower(path.Ext(name))
		ctype, ok := contentTypes[ext]
		if !ok {
			http.NotFound(w, r)
			return
		}
		data, err := fs.ReadFile(files, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", ctype)
		w.Header().Set("Cache-Control", cacheControl(name, ext))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Length", itoa(len(data)))
		if r.Method == http.MethodHead {
			return
		}
		_, _ = w.Write(data)
	})
}

// cacheControl: движок в vendor/ прибит версией — кэшируется навсегда;
// оболочка не кэшируется, иначе после публикации у игрока остаётся старая.
func cacheControl(name, ext string) string {
	if strings.HasPrefix(name, "vendor/") {
		return "public, max-age=31536000, immutable"
	}
	if ext == ".html" {
		return "no-store"
	}
	return "public, max-age=300"
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var buf [20]byte
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
