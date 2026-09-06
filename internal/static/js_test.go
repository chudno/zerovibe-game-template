package static_test

import (
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Синтаксис JS игры проверяем через node --check, если node есть в окружении;
// без node тест пропускается. Внешних Go-зависимостей у шаблона нет намеренно:
// любая из них с директивой go 1.24+ уводит сборщик функций на чужой тулчейн,
// и плагин не грузится («plugin was built with a different version…»).
func TestJSSyntax(t *testing.T) {
	node, err := exec.LookPath("node")
	if err != nil {
		t.Skip("node не найден — синтаксис JS проверяет превью")
	}
	root := filepath.Join("..", "..", "static")
	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() || !strings.HasSuffix(p, ".js") || strings.Contains(p, string(filepath.Separator)+"vendor"+string(filepath.Separator)) {
			return nil
		}
		out, cerr := exec.Command(node, "--check", p).CombinedOutput()
		if cerr != nil {
			t.Errorf("%s: %v\n%s", p, cerr, out)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// config.js: archetype указывает на существующий кит.
func TestConfigArchetypeExists(t *testing.T) {
	src, err := os.ReadFile(filepath.Join("..", "..", "static", "game", "config.js"))
	if err != nil {
		t.Fatal(err)
	}
	m := regexp.MustCompile(`archetype:\s*"([a-z0-9_-]+)"`).FindSubmatch(src)
	if m == nil {
		t.Fatal("в config.js не найден archetype")
	}
	kit := filepath.Join("..", "..", "static", "game", "kits", string(m[1]), "kit.js")
	if _, err := os.Stat(kit); err != nil {
		t.Fatalf("кит %q не найден: %v", m[1], err)
	}
}
