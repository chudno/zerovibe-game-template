package static_test

import (
	"io/fs"
	"os"
	"path"
	"strings"
	"testing"

	"github.com/dop251/goja"
)

// Битый JS никак не ловится сборкой Go: тест парсит весь код игры движком
// goja — синтаксическая ошибка валит проверку до публикации.
func TestКодИгрыПарсится(t *testing.T) {
	forEachJS(t, func(p string, src string) {
		if _, err := goja.Compile(p, src, true); err != nil {
			t.Errorf("%s: %v", p, err)
		}
	})
}

// config.js исполняется в песочнице: он должен объявлять ZV_GAME с
// известным архетипом — опечатка здесь означает пустой экран у игрока.
func TestКонфигВаленИАрхетипИзвестен(t *testing.T) {
	src, err := os.ReadFile(path.Join(root, "game/config.js"))
	if err != nil {
		t.Fatal(err)
	}
	vm := goja.New()
	if err := vm.Set("window", vm.NewObject()); err != nil {
		t.Fatal(err)
	}
	if err := vm.Set("location", map[string]any{"search": ""}); err != nil {
		t.Fatal(err)
	}
	// URLSearchParams в goja нет — подменяем заглушкой, конфигу хватает get().
	if _, err := vm.RunString(`function URLSearchParams(s){ this.get=function(){ return null; }; }`); err != nil {
		t.Fatal(err)
	}
	if _, err := vm.RunString(string(src)); err != nil {
		t.Fatalf("config.js не исполняется: %v", err)
	}
	game := vm.Get("window").ToObject(vm).Get("ZV_GAME")
	if game == nil || goja.IsUndefined(game) {
		t.Fatal("config.js не объявил window.ZV_GAME")
	}
	obj := game.ToObject(vm)
	arch := obj.Get("archetype")
	if arch == nil {
		t.Fatal("в ZV_GAME нет archetype")
	}
	name := arch.String()
	if _, err := os.Stat(path.Join(root, "game/kits", name, "kit.js")); err != nil {
		t.Fatalf("archetype %q: нет кита game/kits/%s/kit.js", name, name)
	}
	for _, field := range []string{"title", "brand"} {
		if v := obj.Get(field); v == nil || goja.IsUndefined(v) {
			t.Errorf("в ZV_GAME нет поля %q", field)
		}
	}
}

func forEachJS(t *testing.T, fn func(path, src string)) {
	t.Helper()
	fsys := os.DirFS(root)
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if strings.ToLower(path.Ext(p)) != ".js" || strings.HasPrefix(p, "vendor/") {
			return nil
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		fn(p, string(data))
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
