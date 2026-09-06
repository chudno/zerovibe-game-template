package static_test

import (
	"io/fs"
	"os"
	"path"
	"regexp"
	"strings"
	"testing"
)

const root = "../../static"

// Ссылки в разметке, стилях и коде: src=, href=, url( — всё, кроме внешних и
// data:, должно указывать на существующий файл. Иначе игра «работает» у автора
// и рассыпается в проде.
var linkRe = regexp.MustCompile(`(?:src|href)\s*=\s*["']([^"']+)["']|url\(\s*["']?([^"')]+)["']?\s*\)`)

func TestСсылкиРезолвятся(t *testing.T) {
	fsys := os.DirFS(root)
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		ext := strings.ToLower(path.Ext(p))
		if ext != ".html" && ext != ".css" && ext != ".js" {
			return nil
		}
		if strings.HasPrefix(p, "vendor/") {
			return nil
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		for _, m := range linkRe.FindAllStringSubmatch(string(data), -1) {
			ref := m[1]
			if ref == "" {
				ref = m[2]
			}
			if ref == "" || external(ref) {
				continue
			}
			target := resolve(p, ref)
			if _, err := fs.Stat(fsys, target); err != nil {
				t.Errorf("%s: ссылка %q → нет файла %q", p, ref, target)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

// Внешних адресов в игре быть не должно (White Label и офлайн-работа):
// движок лежит локально, ассеты приходят ссылками из кода уже во время работы.
func TestВнешнихАдресовНет(t *testing.T) {
	fsys := os.DirFS(root)
	err := fs.WalkDir(fsys, ".", func(p string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || strings.HasPrefix(p, "vendor/") {
			return err
		}
		ext := strings.ToLower(path.Ext(p))
		if ext != ".html" && ext != ".css" && ext != ".js" {
			return nil
		}
		data, err := fs.ReadFile(fsys, p)
		if err != nil {
			return err
		}
		for _, m := range linkRe.FindAllStringSubmatch(string(data), -1) {
			ref := m[1]
			if ref == "" {
				ref = m[2]
			}
			if strings.HasPrefix(ref, "http://") || strings.HasPrefix(ref, "https://") || strings.HasPrefix(ref, "//") {
				t.Errorf("%s: внешний адрес %q", p, ref)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
}

func external(ref string) bool {
	return strings.HasPrefix(ref, "http://") ||
		strings.HasPrefix(ref, "https://") ||
		strings.HasPrefix(ref, "//") ||
		strings.HasPrefix(ref, "data:") ||
		strings.HasPrefix(ref, "#") ||
		strings.HasPrefix(ref, "mailto:")
}

func resolve(from, ref string) string {
	if i := strings.IndexAny(ref, "?#"); i >= 0 {
		ref = ref[:i]
	}
	if strings.HasPrefix(ref, "/") {
		return path.Clean(strings.TrimPrefix(ref, "/"))
	}
	return path.Clean(path.Join(path.Dir(from), ref))
}
