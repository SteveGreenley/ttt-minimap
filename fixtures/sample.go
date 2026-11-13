// Package fixture exercises the minimap: top-level declarations, nested
// blocks, a struct, comments, deep indentation and one very long line.
package main

import (
	"fmt"
	"sort"
	"strings"
)

const defaultGreeting = "hello"

var registry = map[string]int{
	"alpha":   1,
	"beta":    2,
	"delta":   4,
	"epsilon": 5,
}

// Item is a sortable record with a nested helper type.
type Item struct {
	Name     string
	Weight   int
	Children []*Item
	Meta     struct {
		Source string
		Tags   []string
	}
}

// Score returns a deterministic score for an item, scaled by weight.
func (it *Item) Score() int {
	if it == nil {
		return 0
	}
	total := it.Weight
	for _, child := range it.Children {
		if child == nil {
			continue
		}
		total += child.Score()
	}
	for _, tag := range it.Meta.Tags {
		switch tag {
		case "bonus":
			total *= 2
		case "penalty":
			total /= 2
		default:
			total += len(tag)
		}
	}
	return total
}

func collect(nodes []*Item) []*Item {
	out := make([]*Item, 0, len(nodes))
	for _, node := range nodes {
		if node == nil {
			continue
		}
		out = append(out, node)
		out = append(out, collect(node.Children)...)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Score() != out[j].Score() {
			return out[i].Score() > out[j].Score()
		}
		return out[i].Name < out[j].Name
	})
	return out
}

func render(items []*Item) string {
	var b strings.Builder
	for i, item := range items {
		indent := strings.Repeat("  ", i%4)
		fmt.Fprintf(&b, "%s%s weight=%d score=%d tags=%s source=%s\n", indent, item.Name, item.Weight, item.Score(), strings.Join(item.Meta.Tags, ","), item.Meta.Source)
	}
	return b.String()
}

func main() {
	root := &Item{Name: "root", Weight: 3}
	root.Children = []*Item{
		{Name: "first", Weight: 5, Meta: struct {
			Source string
			Tags   []string
		}{Source: defaultGreeting, Tags: []string{"bonus", "leaf"}}},
		{Name: "second", Weight: 1},
	}
	for name, weight := range registry {
		root.Children = append(root.Children, &Item{Name: name, Weight: weight})
	}
	fmt.Print(render(collect([]*Item{root})))
}
