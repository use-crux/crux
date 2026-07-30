package observability

import (
	"database/sql"
	"fmt"
	"strings"
	"testing"
)

func assertNoLogicalStorageContains(
	t *testing.T,
	db *sql.DB,
	sentinel string,
) {
	t.Helper()
	tables, err := db.Query(`
		SELECT name FROM sqlite_master
		WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
	`)
	if err != nil {
		t.Fatal(err)
	}
	var names []string
	for tables.Next() {
		var name string
		if err := tables.Scan(&name); err != nil {
			t.Fatal(err)
		}
		names = append(names, name)
	}
	if err := tables.Close(); err != nil {
		t.Fatal(err)
	}
	for _, table := range names {
		columns, err := db.Query(
			`PRAGMA table_info(` + quoteSQLiteIdentifier(table) + `)`,
		)
		if err != nil {
			t.Fatal(err)
		}
		var textColumns []string
		for columns.Next() {
			var cid int
			var name, kind string
			var notNull, primaryKey int
			var defaultValue any
			if err := columns.Scan(
				&cid,
				&name,
				&kind,
				&notNull,
				&defaultValue,
				&primaryKey,
			); err != nil {
				t.Fatal(err)
			}
			if strings.Contains(strings.ToUpper(kind), "TEXT") ||
				strings.Contains(strings.ToUpper(kind), "BLOB") {
				textColumns = append(textColumns, name)
			}
		}
		if err := columns.Close(); err != nil {
			t.Fatal(err)
		}
		for _, column := range textColumns {
			query := fmt.Sprintf(
				"SELECT COUNT(*) FROM %s WHERE instr(CAST(%s AS TEXT), ?) > 0",
				quoteSQLiteIdentifier(table),
				quoteSQLiteIdentifier(column),
			)
			var count int
			if err := db.QueryRow(query, sentinel).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf(
					"sentinel remains in %s.%s (%d rows)",
					table,
					column,
					count,
				)
			}
		}
	}
}

func quoteSQLiteIdentifier(value string) string {
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
