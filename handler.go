// Вход серверлесс-функции: платформа вызывает Handler HTTP-событием.
//
// Игра — статика из embed, состояния между вызовами нет; sync.Once нужен
// только чтобы не пересобирать http.Handler на каждый запрос тёплого инстанса.
//
// Локально игра поднимается обычным сервером cmd/server — оба входа делят
// одну и ту же раздачу.
//
//go:debug httpmuxgo121=0

package main

import (
	"context"
	"sync"

	"github.com/zerovibe/game-template/internal/static"
	"github.com/zerovibe/game-template/internal/ycf"
)

var (
	once    sync.Once
	handler func(context.Context, []byte) ([]byte, error)
)

// main не вызывается: функцию собирают как plugin (точка входа — Handler),
// локально запускается cmd/server. Пустышка нужна для `go build ./...`.
func main() {}

// Handler — обработчик HTTP-вызова функции (формат события — internal/ycf).
func Handler(ctx context.Context, raw []byte) ([]byte, error) {
	once.Do(func() {
		handler = ycf.Wrap(static.Handler(StaticFS()))
	})
	return handler(ctx, raw)
}
