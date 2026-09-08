package static_test

// Фикстуры — НАСТОЯЩИЕ картинки из платформы (testdata/assets, манифест рядом),
// а не нарисованные тестом прямоугольники: три дефекта кита прошли мимо
// проверок на заглушках именно потому, что у заглушек нет прозрачных полей,
// листа кадров и размеров «как у поставщика». Здесь проверяется контракт
// картинок, на который опираются киты и layout.js.

import (
	"encoding/json"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

type assetManifest struct {
	Canvas struct {
		Width  int `json:"width"`
		Height int `json:"height"`
	} `json:"canvas"`
	Hero struct {
		File        string `json:"file"`
		Width       int    `json:"width"`
		Height      int    `json:"height"`
		FrameWidth  int    `json:"frame_width"`
		FrameHeight int    `json:"frame_height"`
		Cols        int    `json:"cols"`
		Rows        int    `json:"rows"`
		Frames      int    `json:"frames"`
	} `json:"hero"`
	Items []struct {
		File   string `json:"file"`
		Width  int    `json:"width"`
		Height int    `json:"height"`
	} `json:"items"`
}

func loadManifest(t *testing.T) assetManifest {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("testdata", "assets", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	var m assetManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatal(err)
	}
	if m.Hero.FrameWidth == 0 || m.Hero.FrameHeight == 0 {
		t.Fatal("манифест без размеров кадра")
	}
	return m
}

func loadPNG(t *testing.T, name string) *image.NRGBA {
	t.Helper()
	f, err := os.Open(filepath.Join("testdata", "assets", name))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img, err := png.Decode(f)
	if err != nil {
		t.Fatalf("%s: %v", name, err)
	}
	b := img.Bounds()
	out := image.NewNRGBA(b)
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			out.Set(x, y, img.At(x, y))
		}
	}
	return out
}

// opaqueBounds — непрозрачная область прямоугольника (как ZV.sprite в shell.js).
func opaqueBounds(img *image.NRGBA, r image.Rectangle) (image.Rectangle, bool) {
	minX, minY, maxX, maxY := r.Max.X, r.Max.Y, -1, -1
	for y := r.Min.Y; y < r.Max.Y; y++ {
		for x := r.Min.X; x < r.Max.X; x++ {
			if img.NRGBAAt(x, y).A > 8 {
				if x < minX {
					minX = x
				}
				if y < minY {
					minY = y
				}
				if x > maxX {
					maxX = x
				}
				if y > maxY {
					maxY = y
				}
			}
		}
	}
	if maxX < 0 {
		return image.Rectangle{}, false
	}
	return image.Rect(minX, minY, maxX+1, maxY+1), true
}

// Лист героя: размеры как в манифесте, делится на кадры ровно, каждый кадр
// не пустой и с прозрачными полями (иначе автообрезка тела не нужна и ноги
// ставятся по низу кадра — а на настоящих листах это подвешивало героя).
func TestФикстураЛистГероя(t *testing.T) {
	m := loadManifest(t)
	img := loadPNG(t, m.Hero.File)
	b := img.Bounds()
	if b.Dx() != m.Hero.Width || b.Dy() != m.Hero.Height {
		t.Fatalf("лист %dx%d, манифест %dx%d", b.Dx(), b.Dy(), m.Hero.Width, m.Hero.Height)
	}
	if m.Hero.Width%m.Hero.FrameWidth != 0 || m.Hero.Height%m.Hero.FrameHeight != 0 {
		t.Fatalf("лист не делится на кадр %dx%d", m.Hero.FrameWidth, m.Hero.FrameHeight)
	}
	cols, rows := m.Hero.Width/m.Hero.FrameWidth, m.Hero.Height/m.Hero.FrameHeight
	if cols != m.Hero.Cols || rows != m.Hero.Rows || cols*rows != m.Hero.Frames {
		t.Fatalf("сетка %dx%d (%d кадров), манифест %dx%d (%d)", cols, rows, cols*rows, m.Hero.Cols, m.Hero.Rows, m.Hero.Frames)
	}
	for i := 0; i < m.Hero.Frames; i++ {
		x0, y0 := (i%cols)*m.Hero.FrameWidth, (i/cols)*m.Hero.FrameHeight
		fr := image.Rect(x0, y0, x0+m.Hero.FrameWidth, y0+m.Hero.FrameHeight)
		ob, ok := opaqueBounds(img, fr)
		if !ok {
			t.Fatalf("кадр %d пустой", i)
		}
		if ob.Dx() >= fr.Dx() && ob.Dy() >= fr.Dy() {
			t.Fatalf("кадр %d без прозрачных полей — не похоже на лист поставщика", i)
		}
		if ob.Dy() < fr.Dy()/2 {
			t.Fatalf("кадр %d: фигура ниже половины кадра (%d из %d) — лист нарезан неверно", i, ob.Dy(), fr.Dy())
		}
	}
	// Низ фигуры (ноги) во всех кадрах бега на одной высоте ±4 px: иначе герой
	// дёргается вверх-вниз на каждом кадре анимации.
	var bottoms []int
	for i := 0; i < m.Hero.Frames; i++ {
		x0, y0 := (i%cols)*m.Hero.FrameWidth, (i/cols)*m.Hero.FrameHeight
		ob, _ := opaqueBounds(img, image.Rect(x0, y0, x0+m.Hero.FrameWidth, y0+m.Hero.FrameHeight))
		bottoms = append(bottoms, ob.Max.Y-y0)
	}
	lo, hi := bottoms[0], bottoms[0]
	for _, v := range bottoms {
		if v < lo {
			lo = v
		}
		if v > hi {
			hi = v
		}
	}
	if hi-lo > 4 {
		t.Fatalf("низ фигуры гуляет между кадрами: %v", bottoms)
	}
}

// Предметы: размеры по манифесту, прозрачный фон есть (хромакей снят), но
// фигура не пустая.
func TestФикстурыПредметов(t *testing.T) {
	m := loadManifest(t)
	for _, it := range m.Items {
		img := loadPNG(t, it.File)
		b := img.Bounds()
		if b.Dx() != it.Width || b.Dy() != it.Height {
			t.Fatalf("%s: %dx%d, манифест %dx%d", it.File, b.Dx(), b.Dy(), it.Width, it.Height)
		}
		ob, ok := opaqueBounds(img, b)
		if !ok {
			t.Fatalf("%s: пустая картинка", it.File)
		}
		transparent := 0
		for y := b.Min.Y; y < b.Max.Y; y++ {
			for x := b.Min.X; x < b.Max.X; x++ {
				if img.NRGBAAt(x, y).A == 0 {
					transparent++
				}
			}
		}
		if transparent == 0 {
			t.Fatalf("%s: нет прозрачных пикселей — хромакей не снят", it.File)
		}
		if ob.Dx() < b.Dx()/3 || ob.Dy() < b.Dy()/3 {
			t.Fatalf("%s: фигура слишком мала (%dx%d в %dx%d)", it.File, ob.Dx(), ob.Dy(), b.Dx(), b.Dy())
		}
	}
}

// Канва манифеста — та, что у оболочки (ZV.WIDTH/HEIGHT в shell.js).
func TestМанифестКанвыСовпадаетСОболочкой(t *testing.T) {
	m := loadManifest(t)
	src, err := os.ReadFile(filepath.Join("..", "..", "static", "game", "shell.js"))
	if err != nil {
		t.Fatal(err)
	}
	if m.Canvas.Width != 360 || m.Canvas.Height != 640 {
		t.Fatalf("канва манифеста %dx%d", m.Canvas.Width, m.Canvas.Height)
	}
	for _, needle := range []string{"WIDTH = 360", "HEIGHT = 640"} {
		if !containsLoose(string(src), needle) {
			t.Fatalf("в shell.js не найдено %q", needle)
		}
	}
}

func containsLoose(s, needle string) bool {
	return len(s) > 0 && (indexFold(s, needle) >= 0)
}

func indexFold(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return i
		}
	}
	return -1
}
