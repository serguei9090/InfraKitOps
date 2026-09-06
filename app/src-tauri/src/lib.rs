use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

/// When true, closing the window hides it to the tray instead of quitting, so
/// the backend sidecar (and its monitors) keep running. Toggled from
/// Settings → Monitors on the desktop build (MONITORS_MODULE_PLAN.md M3).
struct KeepAlive(AtomicBool);

#[tauri::command]
fn set_keep_alive(state: tauri::State<'_, KeepAlive>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// Connection details for the `infrakit-backend` network sidecar, shared with
/// the frontend via the `backend_endpoint` command. `endpoint` is empty when
/// the sidecar failed to start — the UI then shows a "backend unavailable"
/// state (see NETWORK_MODULE_PLAN.md §2.1).
struct BackendState {
    endpoint: String,
    token: String,
    child: Mutex<Option<CommandChild>>,
}

#[derive(serde::Serialize)]
struct BackendEndpoint {
    endpoint: String,
    token: String,
    available: bool,
}

#[tauri::command]
fn backend_endpoint(state: tauri::State<'_, BackendState>) -> BackendEndpoint {
    BackendEndpoint {
        endpoint: state.endpoint.clone(),
        token: state.token.clone(),
        available: !state.endpoint.is_empty(),
    }
}

fn random_token() -> String {
    // 32 CSPRNG bytes as lowercase hex (64 chars) — matches the capability's
    // `^[0-9a-f]{64}$` arg validator.
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("csprng");
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

/// Spawns the backend sidecar, blocks (with a timeout) until it announces its
/// port on stdout, and stashes the endpoint + a kill handle in managed state.
fn start_backend(app: &tauri::App) -> BackendState {
    let token = random_token();
    let parent_pid = std::process::id().to_string();

    let sidecar = match app.shell().sidecar("infrakit-backend") {
        Ok(cmd) => cmd.args([
            "--addr",
            "127.0.0.1:0",
            "--token",
            token.as_str(),
            "--parent-pid",
            parent_pid.as_str(),
            "--idle-timeout",
            "45s",
        ]),
        Err(e) => {
            log::error!("cannot locate infrakit-backend sidecar: {e}");
            return BackendState {
                endpoint: String::new(),
                token,
                child: Mutex::new(None),
            };
        }
    };

    let (mut rx, child) = match sidecar.spawn() {
        Ok(pair) => pair,
        Err(e) => {
            log::error!("failed to spawn infrakit-backend: {e}");
            return BackendState {
                endpoint: String::new(),
                token,
                child: Mutex::new(None),
            };
        }
    };

    let (tx, endpoint_rx) = mpsc::channel::<String>();
    tauri::async_runtime::spawn(async move {
        let mut announced = false;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(line) => {
                    let text = String::from_utf8_lossy(&line);
                    for l in text.lines() {
                        if let Some(addr) = l.strip_prefix("LISTENING ") {
                            if !announced {
                                let _ = tx.send(format!("http://{}", addr.trim()));
                                announced = true;
                            }
                        }
                    }
                }
                CommandEvent::Stderr(line) => {
                    log::warn!("[backend] {}", String::from_utf8_lossy(&line).trim_end());
                }
                CommandEvent::Terminated(payload) => {
                    log::warn!("[backend] terminated: {payload:?}");
                    break;
                }
                _ => {}
            }
        }
    });

    match endpoint_rx.recv_timeout(Duration::from_secs(10)) {
        Ok(endpoint) => {
            log::info!("infrakit-backend listening at {endpoint}");
            BackendState {
                endpoint,
                token,
                child: Mutex::new(Some(child)),
            }
        }
        Err(_) => {
            log::error!("infrakit-backend did not announce a port within 10s");
            BackendState {
                endpoint: String::new(),
                token,
                child: Mutex::new(Some(child)),
            }
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![backend_endpoint, set_keep_alive])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let keep = window
                    .app_handle()
                    .state::<KeepAlive>()
                    .0
                    .load(Ordering::Relaxed);
                if keep {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            app.manage(KeepAlive(AtomicBool::new(false)));

            let show = MenuItem::with_id(app, "show", "Show InfraKit Studio", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("InfraKit Studio")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;

            let state = start_backend(app);
            app.manage(state);
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {
                if let Some(state) = app_handle.try_state::<BackendState>() {
                    if let Some(child) = state.child.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        });
}
