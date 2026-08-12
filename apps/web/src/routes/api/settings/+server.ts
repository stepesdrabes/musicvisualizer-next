import { error, json } from '@sveltejs/kit';
import { OFFSET_MAX_MS, OFFSET_MIN_MS } from '$lib/hardware.ts';
import {
	BRIGHTNESS_MAX,
	BRIGHTNESS_MIN,
	DRIFT_MAX,
	DRIFT_MIN,
	DWELL_MAX,
	DWELL_MIN,
	SAT_MAX,
	SAT_MIN,
	clamp,
	isColourSource,
	wrapDegrees
} from '$lib/ambient.ts';
import { isLocal } from '$lib/server/access.ts';
import { settings } from '$lib/server/settings.ts';
import type { ColourSource } from '@mv/core';
import type { BackendId } from '@mv/author-ai';
import type { RequestHandler } from './$types';

/**
 * Loopback only, both ways.
 *
 * Reading says whether a key is stored and never what it is, but knowing the machine has one is
 * still a fact about the person running the night, and writing spends their money. This sits
 * behind the same boundary as the hardware and the queue.
 */
export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'settings belong to the machine running the show');
	return json(await settings.read());
};

export const PUT: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'settings belong to the machine running the show');

	const body = (await event.request.json()) as Writable;

	const patch: Writable = {};
	if (typeof body.deepseekApiKey === 'string') patch.deepseekApiKey = body.deepseekApiKey.trim();
	if (typeof body.autopilot === 'boolean') patch.autopilot = body.autopilot;
	if (typeof body.lounge === 'boolean') patch.lounge = body.lounge;
	if (typeof body.rest === 'boolean') patch.rest = body.rest;
	if (body.authorBackend === 'claude' || body.authorBackend === 'deepseek') {
		patch.authorBackend = body.authorBackend;
	}
	if (isColourSource(body.ambientColour)) patch.ambientColour = body.ambientColour;
	// Clamped rather than rejected: every one of these is a slider, and the bound is what the
	// control is for rather than a validity rule worth failing a request over. The hue wraps
	// instead, because it is a wheel and 370 means 10 rather than "too far".
	if (number(body.ambientHue)) patch.ambientHue = wrapDegrees(body.ambientHue);
	if (number(body.ambientSat)) patch.ambientSat = clamp(body.ambientSat, SAT_MIN, SAT_MAX);
	if (number(body.ambientDrift)) patch.ambientDrift = clamp(body.ambientDrift, DRIFT_MIN, DRIFT_MAX);
	if (number(body.ambientBrightness)) {
		patch.ambientBrightness = clamp(body.ambientBrightness, BRIGHTNESS_MIN, BRIGHTNESS_MAX);
	}
	if (number(body.ambientDwell)) {
		patch.ambientDwell = Math.round(clamp(body.ambientDwell, DWELL_MIN, DWELL_MAX));
	}
	if (number(body.outputOffsetMs)) {
		patch.outputOffsetMs = clamp(body.outputOffsetMs, OFFSET_MIN_MS, OFFSET_MAX_MS);
	}
	if (Object.keys(patch).length === 0) error(400, 'nothing to change');

	return json(await settings.update(patch));
};

interface Writable {
	deepseekApiKey?: string;
	authorBackend?: BackendId;
	outputOffsetMs?: number;
	autopilot?: boolean;
	lounge?: boolean;
	rest?: boolean;
	ambientColour?: ColourSource;
	ambientHue?: number;
	ambientSat?: number;
	ambientBrightness?: number;
	ambientDrift?: number;
	ambientDwell?: number;
}

function number(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}
