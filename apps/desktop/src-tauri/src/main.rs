// The release build is a GUI app; a console window behind it would be Windows-only noise.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod env;
mod server;

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// The app's own top bar, which the window controls have to sit inside.
#[cfg(target_os = "macos")]
const TOP_BAR_HEIGHT: f64 = 56.0;

/// Where the controls start, and how much room they need.
///
/// macOS puts them near the top of a 28pt title bar; this bar is twice that, so left alone
/// they ride high above the wordmark beside them. The y centres a 12pt button in the bar:
/// half the bar, less half the button.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_X: f64 = 20.0;
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_Y: f64 = TOP_BAR_HEIGHT / 2.0 - 6.0;

/// Leading space the bar keeps clear of them: three buttons at 20pt spacing, plus a gap.
#[cfg(target_os = "macos")]
const TRAFFIC_LIGHT_INSET: f64 = 78.0;
#[cfg(not(target_os = "macos"))]
const TRAFFIC_LIGHT_INSET: f64 = 0.0;

fn main() {
	tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.setup(|app| {
			let handle = app.handle().clone();

			let started = server::start(&handle);
			let server = match started {
				Ok(server) => server,
				Err(message) => {
					// Nothing to show it in yet, so the failure goes to the console and the app
					// exits rather than opening a window onto nothing.
					eprintln!("LightningStrike could not start: {message}");
					std::process::exit(1);
				}
			};

			let url = format!("http://127.0.0.1:{}/", server.port)
				.parse()
				.expect("a url built from a port is a url");

			let mut builder = WebviewWindowBuilder::new(&handle, "main", WebviewUrl::External(url))
				.title("LightningStrike")
				.inner_size(1440.0, 900.0)
				.min_inner_size(1024.0, 660.0)
				.resizable(true)
				.initialization_script(&shell_hints(&server));

			#[cfg(target_os = "macos")]
			{
				use tauri::{LogicalPosition, TitleBarStyle};
				// Overlay puts the page under the title bar; without hiding the title as well,
				// the window's own name is drawn straight through the app's top bar.
				builder = builder
					.title_bar_style(TitleBarStyle::Overlay)
					.hidden_title(true)
					.traffic_light_position(LogicalPosition::new(TRAFFIC_LIGHT_X, TRAFFIC_LIGHT_Y));
			}

			// A failure from here on aborts the process before `RunEvent::Exit` can run, so the
			// sidecar has to be ended on the way out or it survives an app that never opened.
			let window = builder.build().inspect_err(|_| server::stop(&handle))?;

			// Fullscreen takes the controls away, so the bar should stop holding a gap for them.
			// Pushed as a custom property rather than an event the page subscribes to: this is
			// one number the shell knows and the page only ever reads.
			#[cfg(target_os = "macos")]
			{
				let follow = window.clone();
				window.on_window_event(move |event| {
					if !matches!(event, tauri::WindowEvent::Resized(_)) {
						return;
					}
					let inset = match follow.is_fullscreen() {
						Ok(true) => 0.0,
						_ => TRAFFIC_LIGHT_INSET,
					};
					let _ = follow.eval(set_inset(inset));
				});
			}

			window.show().inspect_err(|_| server::stop(&handle))?;
			Ok(())
		})
		.build(tauri::generate_context!())
		.expect("error while building LightningStrike")
		// The sidecar is a separate process and does not go away on its own. Without this the
		// server survives the window that started it, keeps its DDP loop running and carries on
		// lighting the room, and the next launch starts a second one beside it.
		.run(|app, event| {
			if let tauri::RunEvent::Exit = event {
				server::stop(app);
			}
		});
}

/// The one line that tells the page how much room the window controls need.
fn set_inset(inset: f64) -> String {
	format!("document.documentElement.style.setProperty('--traffic-inset', '{inset}px')")
}

/// Hand the page what only the shell knows, before any of its own script runs.
///
/// A global rather than an IPC call so the first paint already has it: the top bar has to
/// reserve space for the traffic lights on the very first frame, and a round trip would show
/// the layout moving.
fn shell_hints(server: &server::Server) -> String {
	let missing = serde_json::to_string(&server.missing_tools).unwrap_or_else(|_| "[]".into());
	format!(
		"window.__LIGHTNINGSTRIKE__ = {{ desktop: true, platform: {platform:?}, \
		 missingTools: {missing} }}; {inset};",
		platform = std::env::consts::OS,
		inset = set_inset(TRAFFIC_LIGHT_INSET),
	)
}
