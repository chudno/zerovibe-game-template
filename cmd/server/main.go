// Локальный запуск игры: go run ./cmd/server → http://localhost:8080
// Каталог cmd/ в функцию не едет (его вырезает сборщик), это инструмент
// разработки и автотестов.
package main

import (
	"log"
	"net/http"
	"os"

	"github.com/zerovibe/game-template/internal/static"
)

func main() {
	addr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		addr = ":" + p
	}
	// Локально статику читаем с диска — правки видны без пересборки.
	root := os.Getenv("STATIC_DIR")
	if root == "" {
		root = "static"
	}
	if _, err := os.Stat(root); err != nil {
		log.Fatalf("каталог статики %q не найден: %v", root, err)
	}
	log.Printf("игра на http://localhost%s (статика: %s)", addr, root)
	if err := http.ListenAndServe(addr, static.Handler(os.DirFS(root))); err != nil {
		log.Fatal(err)
	}
}
