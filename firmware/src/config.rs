pub const WIFI_SSID: &str = env!("WIFI_SSID");
pub const WIFI_PASSWORD: &str = env!("WIFI_PASSWORD");

/// Offered to DHCP so the router lists the board by name instead of only by lease.
pub const HOSTNAME: &str = "room-node";

/// The whole fixture rather than this board's share of it. DDP offsets are device-local and
/// always start at zero, so sizing for the maximum lets one binary receive any host-side split.
pub const MAX_PIXELS: usize = 1320;
pub const FRAME_BYTES: usize = MAX_PIXELS * 3;

/// What WLED listens on, and therefore what the host sends to with no configuration.
pub const DDP_PORT: u16 = 4048;

/// Where the once-a-second stats line is mirrored, for watching a board that is already on a
/// wall: `nc -lu 4049`.
pub const STATS_PORT: u16 = 4049;
