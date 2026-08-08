use std::process::Command;

/// Where Homebrew puts things, on both architectures, plus the standard system directories.
const FALLBACKS: &[&str] = &["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];

/// The tools the analysis pipeline shells out to. Missing ones are named at startup rather
/// than surfacing later as a failed ingest with a message about a missing binary.
pub const REQUIRED_TOOLS: &[&str] = &["ffmpeg", "ffprobe", "yt-dlp"];

/// The PATH the sidecar should run with.
///
/// An app launched from Finder inherits a minimal PATH that contains neither Homebrew
/// directory, so `ffmpeg` and `yt-dlp` are invisible to it however carefully they were
/// installed. Asking the user's login shell is the only way to get the PATH they actually
/// have; the fallbacks cover the case where that fails or the shell is not configured.
pub fn resolve_path() -> String {
	let mut parts: Vec<String> = login_shell_path()
		.map(|p| p.split(':').map(str::to_owned).collect())
		.unwrap_or_default();

	for dir in FALLBACKS {
		if !parts.iter().any(|p| p == dir) {
			parts.push((*dir).to_owned());
		}
	}

	parts.join(":")
}

/// `-ilc` so login and rc files both run, which is where a PATH edit usually lives.
fn login_shell_path() -> Option<String> {
	let shell = std::env::var("SHELL").ok()?;
	let out = Command::new(shell).args(["-ilc", "printf %s \"$PATH\""]).output().ok()?;
	if !out.status.success() {
		return None;
	}
	let path = String::from_utf8(out.stdout).ok()?;
	let trimmed = path.trim();
	(!trimmed.is_empty()).then(|| trimmed.to_owned())
}

/// Which of the required tools cannot be found on the given PATH.
pub fn missing_tools(path: &str) -> Vec<&'static str> {
	REQUIRED_TOOLS
		.iter()
		.copied()
		.filter(|tool| !on_path(path, tool))
		.collect()
}

fn on_path(path: &str, tool: &str) -> bool {
	path.split(':').filter(|d| !d.is_empty()).any(|dir| {
		let candidate = std::path::Path::new(dir).join(tool);
		// Existence rather than the executable bit: a file of that name on PATH that cannot be
		// run is a broken install, and saying "not found" about it would send the user looking
		// in the wrong place.
		candidate.is_file()
	})
}
