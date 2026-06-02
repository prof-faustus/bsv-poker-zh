// Command indexer 启动 bsv-poker 牌桌交易索引器。
//
// REQ-NET-004（core §8.4）：摄取不透明的协议交易记录并
// 提供按牌桌划分的投影。
// REQ-NET-001（core §8.1）：仅为便利性投影，绝不作为事实
// 来源。由 Tauri 主进程监管（app §A3.1，按有序启动规则
// REQ-APP-021 在 relay 之前启动）。
//
// 运行：go run . -addr 127.0.0.1:8092
package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os"
	"os/signal"
	"time"

	"github.com/bsv-poker/bsv-poker/apps/indexer-go/indexer"
)

func main() {
	addr := flag.String("addr", "127.0.0.1:8092", "loopback listen address host:port")
	flag.Parse()

	srv := indexer.NewServer()
	httpSrv := &http.Server{
		Addr:              *addr,
		Handler:           srv.Handler(),
		ReadHeaderTimeout: 5 * time.Second,
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt)
	defer cancel()

	go func() {
		log.Printf("indexer: listening on %s (convenience projection; never source of truth)", *addr)
		if err := httpSrv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("indexer: listen error: %v", err)
		}
	}()

	<-ctx.Done()
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer shutdownCancel()
	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		log.Printf("indexer: shutdown error: %v", err)
	}
	log.Printf("indexer: stopped")
}
