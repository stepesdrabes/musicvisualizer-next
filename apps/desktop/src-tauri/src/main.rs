// The release build is a GUI app; a console window behind it would be Windows-only noise.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod env;
mod server;

use tauri::{WebviewUrl, WebviewWindowBuilder};

/// Room for the traffic lights, which `titleBarStyle: Overlay` leaves floating over the app's
/// own top bar. The web side reads it and insets its left cluster by the same amount, so the
/// number lives in one place rather than being guessed on both sides of the boundary.
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
				use tauri::TitleBarStyle;
				// Overlay puts the page under the title bar; without hiding the title as well,
				// the window's own name is drawn straight through the app's top bar.
				builder = builder.title_bar_style(TitleBarStyle::Overlay).hidden_title(true);
			}

			let window = builder.build()?;

			window.show()?;
			Ok(())
		})
		.run(tauri::generate_context!())
		.expect("error while running LightningStrike");
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
		 trafficLightInset: {inset}, missingTools: {missing} }};",
		platform = std::env::consts::OS,
		inset = TRAFFIC_LIGHT_INSET,
	)
}
