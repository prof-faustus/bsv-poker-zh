package relay

import (
	"io"
	"strings"
)

// jsonBody 将一个字面量 JSON 字符串包装为请求体 reader。
func jsonBody(s string) io.Reader { return strings.NewReader(s) }
