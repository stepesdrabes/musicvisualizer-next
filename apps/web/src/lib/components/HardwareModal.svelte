<script lang="ts">
	import { drivesStrips, faultsIn, type HardwareStatus } from '$lib/hardware.ts';
	import { uptime } from '$lib/hardware.svelte.ts';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import PicoBoard from './PicoBoard.svelte';
	import StatusDot from './StatusDot.svelte';

	let {
		open = false,
		status,
		canStream = false,
		onclose,
		onhost,
		onprobe,
		ontoggleOutput
	}: {
		open?: boolean;
		status: HardwareStatus;
		/** A show has to be loaded before there is anything to send. */
		canStream?: boolean;
		onclose: () => void;
		onhost: (host: string) => void;
		onprobe: (host: string) => void;
		ontoggleOutput: () => void;
	} = $props();

	let draft = $state('');
	let touched = $state(false);

	// The field follows the server until it is typed in, so a host set from another tab shows
	// up here without overwriting something half-typed.
	$effect(() => {
		if (!touched) draft = status.host;
	});
	$effect(() => {
		if (open) touched = false;
	});

	const identity = $derived(status.identity);
	const telemetry = $derived(status.telemetry);
	const faults = $derived(telemetry ? faultsIn(telemetry) : []);
	const dark = $derived(identity !== null && !drivesStrips(identity));
	const dirty = $derived(draft.trim() !== status.host);

	function apply() {
		const host = draft.trim();
		if (!host) return;
		onhost(host);
		touched = false;
	}

	const HEADLINE: Record<HardwareStatus['state'], string> = {
		unconfigured: 'No device',
		searching: 'Looking',
		offline: 'Not answering',
		online: 'Ready',
		streaming: 'Streaming',
		degraded: 'Dropping frames'
	};
</script>

<Dialog {open} {onclose} labelledBy="hardware-title">
	<header>
		<StatusDot state={status.state} size={9} />
		<h2 id="hardware-title">{identity?.name ?? 'room-node'}</h2>
		<span class="state" class:bad={status.state === 'offline'} class:warn={status.state === 'degraded'}>
			{#if status.state === 'searching'}<Spinner size={12} />{/if}
			{HEADLINE[status.state]}
		</span>
	</header>

	<div class="address">
		<div class="field">
			<Icon name="radio" size={15} />
			<input
				type="text"
				placeholder="192.168.0.106"
				spellcheck="false"
				autocomplete="off"
				bind:value={draft}
				oninput={() => (touched = true)}
				onkeydown={(e) => e.key === 'Enter' && apply()} />
		</div>
		{#if dirty}
			<Button variant="secondary" onclick={apply} disabled={!draft.trim()}>Use</Button>
		{:else}
			<Button variant="outline" onclick={() => onprobe(draft.trim())} disabled={!draft.trim()}>
				Test
			</Button>
		{/if}
		<Button
			variant={status.streaming ? 'danger' : 'primary'}
			onclick={ontoggleOutput}
			disabled={!status.streaming && (!canStream || !status.host)}>
			{status.streaming ? 'Stop' : 'Send show'}
		</Button>
	</div>

	<div class="body">
		<div class="device">
			<PicoBoard state={status.state} />

			{#if identity}
				<dl class="facts">
					<dt>Address</dt>
					<dd class="mono">{status.host}</dd>
					<dt>Firmware</dt>
					<dd><span class="mono">{identity.firmware}</span></dd>
					<dt>Ports</dt>
					<dd>
						<span class="mono">{identity.ddpPort}</span> in
						<span class="sep">·</span>
						<span class="mono">{identity.statsPort}</span> out
					</dd>
					<dt>Capacity</dt>
					<dd><span class="mono">{identity.pixels}</span> pixels</dd>
					<dt>Output</dt>
					<dd>
						{#if identity.leds === 'stub'}
							<span class="warn">Not wired</span>
						{:else if identity.leds === 'monitor'}
							<span class="warn">One LED</span>
						{:else}
							<span class="mono">{identity.leds}</span>
						{/if}
					</dd>
					<dt>Awake</dt>
					<dd>{uptime(identity.uptimeS)}</dd>
					{#if status.latencyMs !== null}
						<dt>Round trip</dt>
						<dd><span class="mono">{status.latencyMs}</span> ms</dd>
					{/if}
				</dl>
			{:else}
				<p class="advice">
					{#if status.state === 'offline'}
						{status.message} Check it is powered and on this network; its console prints the
						address DHCP gave it.
					{:else if status.state === 'searching'}
						Asking that address who it is.
					{:else}
						Flash <span class="mono">firmware/</span>, then paste the address from its console.
						It offers the hostname <span class="mono">room-node</span> over DHCP.
					{/if}
				</p>
			{/if}
		</div>

		{#if telemetry}
			<div class="figures">
				<div class="figure">
					<span class="value mono">{telemetry.fps.toFixed(1)}</span>
					<span class="label muted">fps</span>
				</div>
				<div class="figure">
					<span class="value mono">{telemetry.packetsPerSecond}</span>
					<span class="label muted">packets/s</span>
				</div>
				<div class="figure">
					<span class="value mono">{telemetry.kbPerSecond.toFixed(0)}</span>
					<span class="label muted">KB/s</span>
				</div>
				<div class="figure">
					<span class="value mono" class:bad={telemetry.torn > 0}>{telemetry.torn}</span>
					<span class="label muted">torn frames</span>
				</div>
			</div>

			<dl class="stream">
				<dt>Frame gap</dt>
				<dd>
					<span class="mono">{telemetry.gapMinMs.toFixed(1)}</span> to
					<span class="mono">{telemetry.gapMaxMs.toFixed(1)}</span> ms
				</dd>
				<dt>Late frames</dt>
				<dd>
					<span class="mono">{telemetry.late.join(' / ')}</span>
					<span class="subtle">past 20 / 50 / 100 ms</span>
				</dd>
				<dt>Assembly</dt>
				<dd><span class="mono">{telemetry.assemblyMaxMs.toFixed(1)}</span> ms worst</dd>
				<dt>Rejected</dt>
				<dd>
					<span class="mono">{telemetry.bad}</span> bad
					<span class="sep">·</span>
					<span class="mono">{telemetry.outOfRange}</span> out of range
				</dd>
				<dt>Fed</dt>
				<dd>
					<span class="mono">{telemetry.pixels}</span> of
					<span class="mono">{identity?.pixels ?? telemetry.pixels}</span> pixels
				</dd>
			</dl>

			{#if faults.length > 0}
				<p class="note">
					<Icon name="alert" size={14} />
					{faults.join(', ')} in the last second.
				</p>
			{/if}
		{/if}
	</div>

	{#if dark}
		<footer>
			<Icon name="alert" size={13} />
			This build receives and scores the stream but does not drive the strips, so the room
			stays dark whatever these numbers say.
		</footer>
	{/if}
</Dialog>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px;
		flex: none;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
		flex: 1;
		min-width: 0;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		flex: none;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.state.warn {
		color: var(--warn);
	}
	.state.bad {
		color: var(--bad);
	}
	.sep {
		opacity: 0.4;
	}
	.warn {
		color: var(--warn);
	}

	.address {
		display: flex;
		gap: 8px;
		padding: 14px 16px;
		flex: none;
		border-bottom: 1px solid var(--border);
	}
	.field {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
	}
	.field :global(svg) {
		position: absolute;
		left: 11px;
		color: var(--subtle-foreground);
		pointer-events: none;
	}
	.field input {
		width: 100%;
		height: var(--h);
		padding: 0 12px 0 35px;
		background: var(--card-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--foreground);
		font-size: 13.5px;
		font-family: var(--mono);
	}
	.field input:focus {
		outline: none;
		border-color: var(--ring);
	}

	.body {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
		padding: 16px;
	}

	.device {
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 16px;
		border-radius: var(--radius-md);
		background: var(--card-raised);
		border: 1px solid var(--border-soft);
	}
	.advice {
		flex: 1;
		font-size: 13px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}

	dl {
		display: grid;
		gap: 8px 14px;
		margin: 0;
		font-size: 13px;
	}
	.facts {
		flex: 1;
		grid-template-columns: auto 1fr;
		gap: 6px 14px;
	}
	.stream {
		grid-template-columns: 108px 1fr;
		margin-top: 16px;
	}
	dt {
		color: var(--subtle-foreground);
	}
	dd {
		margin: 0;
		color: var(--muted-foreground);
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex-wrap: wrap;
	}

	.figures {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
		margin-top: 16px;
	}
	.figure {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px;
		border-radius: var(--radius-md);
		background: var(--card-raised);
		border: 1px solid var(--border-soft);
	}
	.value {
		font-size: 21px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.value.bad {
		color: var(--bad);
	}
	.label {
		font-size: 11.5px;
	}

	.note {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 16px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: #fbbf2414;
		color: var(--warn);
		font-size: 12.5px;
	}

	footer {
		display: flex;
		align-items: center;
		gap: 9px;
		flex: none;
		padding: 11px 16px;
		border-top: 1px solid var(--border);
		background: var(--card);
		font-size: 12px;
		line-height: 1.5;
		color: var(--subtle-foreground);
	}
</style>
