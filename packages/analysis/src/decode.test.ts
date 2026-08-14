import { describe, expect, it } from 'vitest';
import { isTransientFetchError } from './decode.ts';

/**
 * The cost of the two mistakes is not symmetric. Calling a permanent refusal transient spends
 * five more fetches and a minute of the queue on a video that will never arrive; calling a
 * transient one permanent drops a track the next attempt would have got. Both lists are here
 * as the real strings yt-dlp emits.
 */
describe('which fetch failures are worth asking again', () => {
	const transient = [
		'yt-dlp exited 1: ERROR: unable to download video data: HTTP Error 403: Forbidden',
		'ERROR: HTTP Error 429: Too Many Requests',
		'ERROR: HTTP Error 503: Service Unavailable',
		'ERROR: Unable to download webpage: <urlopen error timed out>',
		'ERROR: Unable to download API page',
		'ERROR: [Errno 54] Connection reset by peer',
		'ERROR: Remote end closed connection without response',
		'ERROR: [Errno 8] nodename nor servname provided: getaddrinfo failed'
	];
	for (const message of transient) {
		it(`retries: ${message.slice(0, 52)}`, () => {
			expect(isTransientFetchError(message)).toBe(true);
		});
	}

	const permanent = [
		'ERROR: Video unavailable',
		'ERROR: Private video. Sign in if you have been granted access to this video',
		'ERROR: This video has been removed by the uploader',
		'ERROR: Join this channel to get access to members-only content',
		'ERROR: Sign in to confirm your age. This video may be inappropriate for some users.',
		'ERROR: The uploader has not made this video available in your country',
		'ERROR: requested format is not available'
	];
	for (const message of permanent) {
		it(`gives up on: ${message.slice(0, 52)}`, () => {
			expect(isTransientFetchError(message)).toBe(false);
		});
	}

	it('gives up on a takedown even though it arrives as a 403', () => {
		expect(
			isTransientFetchError(
				'ERROR: HTTP Error 403: Forbidden. This video is no longer available due to a copyright claim'
			)
		).toBe(false);
	});

	it('does not retry something it simply does not recognise', () => {
		expect(isTransientFetchError('ERROR: something nobody has seen before')).toBe(false);
	});
});
