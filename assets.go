package main

import (
	"embed"
	"io/fs"
)

// gameFiles — вся игра одним embed. Директива //go:embed работает только в
// пакете, рядом с которым лежит каталог, поэтому она здесь, а раздача — в
// internal/static.
//
//go:embed all:static
var gameFiles embed.FS

// StaticFS — содержимое каталога static/ (без самого префикса).
func StaticFS() fs.FS {
	sub, err := fs.Sub(gameFiles, "static")
	if err != nil {
		panic("static: подкаталог: " + err.Error())
	}
	return sub
}
