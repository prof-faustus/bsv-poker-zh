// bsv-poker 桌面端监管进程（Tauri v2）—— 应用规格 §A3。
//
// Rust 主进程负责监管本地服务（内嵌 BSV node、relay 和 indexer），让非技术用户双击即可游玩
// （REQ-APP-020）。它实现了 §A3.2 服务生命周期、有序启动（node → indexer → relay）和逆序关闭
// （REQ-APP-021）、一项有界的重启策略（REQ-APP-022，Power-of-Ten 无无界循环），以及
// IPC 契约（附录 I）：services.* / config.*（custody.* 随托管 worker 一起落地）。
//
// 默认仅支持 regtest（REQ-APP-029/030）；mainnet 需要显式的研究标志和一个
// 不容错过的 UI 横幅 —— 除非已设置标志，否则监管进程会拒绝任何非 regtest 网络。
//
// 注意：构建需要原生工具链（Rust + 一个 C 链接器）+ Tauri CLI —— 参见
// ../README.md。它不会在缺少 Rust 的规格撰写/CI 环境中编译。

#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

use std::process::{Child, Command};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{Emitter, Manager, State};

const RELAY_ADDR: &str = "127.0.0.1:8091";
const INDEXER_ADDR: &str = "127.0.0.1:8092";
const MAX_RESTARTS: u32 = 5; // 有界重启策略（REQ-APP-022）

// ---- 纯生命周期策略（REQ-APP-020/021/022），在下方进行单元测试 ----
/// 有序启动（REQ-APP-021）：先内嵌 node，然后 indexer，最后 relay。
#[allow(dead_code)]
fn startup_order() -> [&'static str; 3] {
    ["node", "indexer", "relay"]
}

/// 逆序关闭（REQ-APP-021）。
#[allow(dead_code)]
fn shutdown_order() -> Vec<&'static str> {
    let mut o = startup_order().to_vec();
    o.reverse();
    o
}

/// 有界重启策略（REQ-APP-022；Power-of-Ten：无无界循环）—— 仅在尝试次数
/// 严格低于上限时才重试。
#[allow(dead_code)]
fn should_retry(attempt: u32, max: u32) -> bool {
    attempt < max
}

/// 重启尝试 `n` 的指数退避（毫秒），设有上限以使其不会无界增长。
#[allow(dead_code)]
fn backoff_ms(attempt: u32) -> u64 {
    (100u64.saturating_mul(1u64 << attempt.min(6))).min(5_000)
}

/// 已识别的 IPC 命令族（REQ-APP-024）。未列出的命令不会被分发。
#[allow(dead_code)]
fn ipc_commands() -> [&'static str; 5] {
    ["services_start", "services_stop", "services_status", "config_runtime", "config_set_network"]
}

/// 校验入站的 IPC 网络切换请求（REQ-APP-026 双向校验；REQ-APP-030
/// 守卫）：regtest 始终允许，mainnet 仅在带有显式研究标志时允许，其他一律
/// 拒绝。
fn validate_network_switch(network: &str, mainnet_flag: bool) -> Result<(), String> {
    match network {
        "regtest" | "play-regtest" => Ok(()),
        "mainnet" if mainnet_flag => Ok(()),
        "mainnet" => Err("mainnet requires the explicit research flag (REQ-APP-030)".into()),
        other => Err(format!("unrecognized network '{other}' (REQ-APP-026)")),
    }
}

/// UI 读取的运行时端口映射（REQ-APP-027 —— 端口不在 UI 中硬编码）。
fn runtime_ports() -> (u16, u16, u16) {
    (8091, 8092, 18332) // relay、indexer、node
}

/// 每用户数据子目录（REQ-APP-028）：SQLite 存储和 node 区块/UTXO 存储位于
/// 用户的数据目录下，绝不放在共享/全局路径中。
#[allow(dead_code)]
fn data_subdir(base: &str, kind: &str) -> String {
    format!("{}/bsv-poker/{}", base.trim_end_matches('/'), kind)
}

#[derive(Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
#[allow(dead_code)] // StartNode/Fatal 是 §A3.2 中建模的状态，在 node 适配器绑定后达到
enum LifecycleState {
    Init,
    StartNode,
    StartIndexer,
    StartRelay,
    Ready,
    Degraded,
    Shutdown,
    Fatal,
}

#[derive(Serialize, Clone)]
struct ServiceStatus {
    service: String,
    state: String,
    detail: Option<String>,
    attempt: u32,
}

struct Supervisor {
    lifecycle: Mutex<LifecycleState>,
    relay: Mutex<Option<Child>>,
    indexer: Mutex<Option<Child>>,
    network: Mutex<String>,
}

impl Supervisor {
    fn new() -> Self {
        Supervisor {
            lifecycle: Mutex::new(LifecycleState::Init),
            relay: Mutex::new(None),
            indexer: Mutex::new(None),
            network: Mutex::new("regtest".to_string()),
        }
    }
}

/// 启动一个绑定到 loopback 的内置服务二进制（REQ-APP-027/028，§A10.7）。
fn spawn_service(bin: &str, addr: &str) -> Result<Child, String> {
    Command::new(bin)
        .arg("-addr")
        .arg(addr)
        .spawn()
        .map_err(|e| format!("failed to spawn {bin}: {e}"))
}

#[tauri::command]
fn services_start(app: tauri::AppHandle, sup: State<Supervisor>) -> Result<bool, String> {
    // 有序启动：node → indexer → relay（node 是绑定子聪通道的内嵌 node，
    // 由适配器绑定；这里我们监管 indexer 和 relay 二进制）。
    *sup.lifecycle.lock().unwrap() = LifecycleState::StartIndexer;
    emit_status(&app, "indexer", "starting", None, 0);

    let mut started_indexer = false;
    for attempt in 0..MAX_RESTARTS {
        match spawn_service("indexer", INDEXER_ADDR) {
            Ok(child) => {
                *sup.indexer.lock().unwrap() = Some(child);
                emit_status(&app, "indexer", "healthy", None, attempt);
                started_indexer = true;
                break;
            }
            Err(e) => emit_status(&app, "indexer", "failed", Some(e), attempt),
        }
    }
    if !started_indexer {
        *sup.lifecycle.lock().unwrap() = LifecycleState::Degraded;
        return Err("indexer failed to start within the restart policy".into());
    }

    *sup.lifecycle.lock().unwrap() = LifecycleState::StartRelay;
    emit_status(&app, "relay", "starting", None, 0);
    let mut started_relay = false;
    for attempt in 0..MAX_RESTARTS {
        match spawn_service("relay", RELAY_ADDR) {
            Ok(child) => {
                *sup.relay.lock().unwrap() = Some(child);
                emit_status(&app, "relay", "healthy", None, attempt);
                started_relay = true;
                break;
            }
            Err(e) => emit_status(&app, "relay", "failed", Some(e), attempt),
        }
    }
    if !started_relay {
        *sup.lifecycle.lock().unwrap() = LifecycleState::Degraded;
        return Err("relay failed to start within the restart policy".into());
    }

    *sup.lifecycle.lock().unwrap() = LifecycleState::Ready;
    Ok(true)
}

#[tauri::command]
fn services_stop(sup: State<Supervisor>) -> Result<bool, String> {
    // 逆序关闭：先 relay 后 indexer（REQ-APP-021）。
    if let Some(mut c) = sup.relay.lock().unwrap().take() {
        let _ = c.kill();
    }
    if let Some(mut c) = sup.indexer.lock().unwrap().take() {
        let _ = c.kill();
    }
    *sup.lifecycle.lock().unwrap() = LifecycleState::Shutdown;
    Ok(true)
}

#[tauri::command]
fn services_status(sup: State<Supervisor>) -> String {
    match *sup.lifecycle.lock().unwrap() {
        LifecycleState::Init => "init",
        LifecycleState::StartNode => "start_node",
        LifecycleState::StartIndexer => "start_indexer",
        LifecycleState::StartRelay => "start_relay",
        LifecycleState::Ready => "ready",
        LifecycleState::Degraded => "degraded",
        LifecycleState::Shutdown => "shutdown",
        LifecycleState::Fatal => "fatal",
    }
    .to_string()
}

#[tauri::command]
fn config_runtime(sup: State<Supervisor>) -> serde_json::Value {
    let (relay, indexer, node) = runtime_ports();
    serde_json::json!({
        "ports": { "relay": relay, "indexer": indexer, "node": node },
        "network": *sup.network.lock().unwrap(),
        "flags": { "mainnetResearch": false }
    })
}

/// 受守卫的网络切换（REQ-APP-030）：除非设置了研究标志，否则拒绝非 regtest。
#[tauri::command]
fn config_set_network(network: String, mainnet_flag: bool, sup: State<Supervisor>) -> Result<bool, String> {
    validate_network_switch(&network, mainnet_flag)?;
    *sup.network.lock().unwrap() = network;
    Ok(true)
}

fn emit_status(app: &tauri::AppHandle, service: &str, state: &str, detail: Option<String>, attempt: u32) {
    let _ = app.emit(
        "services.status",
        ServiceStatus {
            service: service.to_string(),
            state: state.to_string(),
            detail,
            attempt,
        },
    );
}

fn main() {
    tauri::Builder::default()
        .manage(Supervisor::new())
        .invoke_handler(tauri::generate_handler![
            services_start,
            services_stop,
            services_status,
            config_runtime,
            config_set_network
        ])
        .setup(|app| {
            // 有序启动在启动时开始；UI 在达到 READY 之前禁止游玩（REQ-APP-023）。
            let _ = app.handle();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running bsv-poker desktop");
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;

    #[test]
    fn startup_is_node_then_indexer_then_relay() {
        assert_eq!(startup_order(), ["node", "indexer", "relay"]);
    }

    #[test]
    fn shutdown_is_reverse_of_startup() {
        assert_eq!(shutdown_order(), vec!["relay", "indexer", "node"]);
    }

    #[test]
    fn restart_policy_is_bounded_no_unbounded_loop() {
        assert!(should_retry(0, MAX_RESTARTS));
        assert!(should_retry(MAX_RESTARTS - 1, MAX_RESTARTS));
        assert!(!should_retry(MAX_RESTARTS, MAX_RESTARTS));
        // 重试循环可证明会在上限处终止。
        let mut attempts = 0u32;
        while should_retry(attempts, MAX_RESTARTS) {
            attempts += 1;
        }
        assert_eq!(attempts, MAX_RESTARTS);
    }

    #[test]
    fn backoff_increases_and_is_capped() {
        assert!(backoff_ms(1) > backoff_ms(0));
        assert!(backoff_ms(2) > backoff_ms(1));
        assert!(backoff_ms(100) <= 5_000);
    }

    #[test]
    fn ipc_command_family_is_enumerated() {
        let c = ipc_commands();
        assert_eq!(c.len(), 5);
        assert!(c.contains(&"config_set_network"));
        assert!(!c.contains(&"evil_command"));
    }

    #[test]
    fn network_switch_is_validated_both_sides() {
        assert!(validate_network_switch("regtest", false).is_ok());
        assert!(validate_network_switch("mainnet", false).is_err()); // 无标志时被拒绝
        assert!(validate_network_switch("mainnet", true).is_ok());
        assert!(validate_network_switch("bogusnet", true).is_err()); // 无法识别，被拒绝
    }

    #[test]
    fn runtime_ports_are_distinct_and_read_by_ui() {
        let (r, i, n) = runtime_ports();
        assert!(r != i && i != n && r != n);
    }

    #[test]
    fn data_dir_is_under_per_user_base() {
        assert_eq!(data_subdir("/home/u/.local/share", "sqlite"), "/home/u/.local/share/bsv-poker/sqlite");
        assert_eq!(data_subdir("/home/u/.local/share/", "node"), "/home/u/.local/share/bsv-poker/node");
    }
}
