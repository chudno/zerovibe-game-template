package static_test

import (
	"io/fs"
	"os"
	"strings"
	"testing"
)

// Игра уезжает на сайт заказчика: имени платформы в ней быть не должно
// нигде — ни в разметке, ни в коде, ни в комментариях.
func TestИмениПлатформыВСтатикеНет(t *testing.T) {
	forbidden := []string{"zerovibe", "Zerovibe", "ZeroVibe", "ZEROVIBE"}
	fsys := os.DirFS(root)
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		text := string(data)
		for _, word := range forbidden {
			if strings.Contains(text, word) {
				t.Errorf("%s: встречается %q", p, word)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}
