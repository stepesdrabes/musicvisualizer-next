import type { HardwareStatus } from './hardware.ts';

const IDLE: HardwareStatus = {
	host: '',
	region: 'all',
	state: 'unconfigured',
	streaming: false,
	identity: null,
	telemetry: null,
	latencyMs: null,
	message: ''
};

/**
 * A view onto the board, mirroring the queue client: the server owns the socket and this
 * reacts. Nothing here is optimistic, because the only thing worth reporting is what the
 * board actually said.
 */
export class HardwareClient {
	status = $state<HardwareStatus>(IDLE);

	private source: EventSource | null = null;

	connect(): void {
		if (this.source) return;
		const es = new EventSource('/api/hardware/stream');
		es.addEventListener('hardware', (ev) => {
			this.status = JSON.parse((ev as MessageEvent).data) as HardwareStatus;
		});
		this.source = es;
	}

	dispose(): void {
		this.source?.close();
		this.source = null;
	}

	private post(body: Record<string, unknown>): Promise<Response> {
		return fetch('/api/hardware', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	setHost(host: string): Promise<Response> {
		return this.post({ action: 'set', host });
	}

	/** Which part of the room the board is fed. Read by output the next time it starts. */
	setRegion(region: string): Promise<Response> {
		return this.post({ action: 'set', host: this.status.host, region });
	}
}

/** What the status chip says, short enough for a top bar. */
export function linkLabel(status: HardwareStatus): string {
	switch (status.state) {
		case 'unconfigured':
			return 'No device';
		case 'searching':
			return 'Looking';
		case 'offline':
			return 'Offline';
		case 'online':
			return 'Ready';
		case 'degraded':
			return 'Dropping';
		case 'streaming':
			return `${(status.telemetry?.fps ?? 0).toFixed(0)} fps`;
	}
}

export function uptime(seconds: number): string {
	if (seconds < 60) return `${Math.floor(seconds)}s`;
	const m = Math.floor(seconds / 60);
	if (m < 60) return `${m}m ${Math.floor(seconds % 60)}s`;
	return `${Math.floor(m / 60)}h ${m % 60}m`;
}
