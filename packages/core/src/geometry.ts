import type { Geometry, RoomSpec, StripSpec, Vec3 } from './contracts/room.ts';

/** 5x4 m, wall strips at the wall/ceiling junction, one ceiling beam, 60 LED/m. */
export const DEFAULT_ROOM: RoomSpec = {
	name: 'Room 5x4',
	width: 5,
	depth: 4,
	height: 2.6,
	density: 60,
	wallStripHeight: 2.4,
	// Same height as the walls. All five runs on one plane is what lets a sweep cross the
	// room as a single wavefront instead of reading as a separate fixture.
	beamHeight: 2.4,
	beamAxis: 'y',
	beamOffset: 0
};

export function ledCountFor(spec: RoomSpec): number {
	const perimeter = 2 * (spec.width + spec.depth);
	const beamLen = spec.beamAxis === 'y' ? spec.depth : spec.width;
	return Math.round(perimeter * spec.density) + Math.round(beamLen * spec.density);
}

function segLength(s: { start: Vec3; end: Vec3 }): number {
	return Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1], s.end[2] - s.start[2]);
}

function stripSpecs(spec: RoomSpec): StripSpec[] {
	const hw = spec.width / 2;
	const hd = spec.depth / 2;
	const zw = spec.wallStripHeight;
	const d = spec.density;
	const nWall = Math.round(spec.width * d);
	const eWall = Math.round(spec.depth * d);

	// Walked as one counter-clockwise ring so concatenating the walls yields a closed
	// perimeter with no seam.
	const raw: Omit<StripSpec, 'offset'>[] = [
		{
			id: 0,
			name: 'Wall N',
			count: nWall,
			start: [-hw, hd, zw],
			end: [hw, hd, zw],
			normal: [0, -1, 0],
			inPerimeter: true
		},
		{
			id: 1,
			name: 'Wall E',
			count: eWall,
			start: [hw, hd, zw],
			end: [hw, -hd, zw],
			normal: [-1, 0, 0],
			inPerimeter: true
		},
		{
			id: 2,
			name: 'Wall S',
			count: nWall,
			start: [hw, -hd, zw],
			end: [-hw, -hd, zw],
			normal: [0, 1, 0],
			inPerimeter: true
		},
		{
			id: 3,
			name: 'Wall W',
			count: eWall,
			start: [-hw, -hd, zw],
			end: [-hw, hd, zw],
			normal: [1, 0, 0],
			inPerimeter: true
		}
	];

	const zb = spec.beamHeight;
	raw.push(
		spec.beamAxis === 'y'
			? {
					id: 4,
					name: 'Beam',
					count: Math.round(spec.depth * d),
					start: [spec.beamOffset, -hd, zb],
					end: [spec.beamOffset, hd, zb],
					normal: [0, 0, -1],
					inPerimeter: false
				}
			: {
					id: 4,
					name: 'Beam',
					count: Math.round(spec.width * d),
					start: [-hw, spec.beamOffset, zb],
					end: [hw, spec.beamOffset, zb],
					normal: [0, 0, -1],
					inPerimeter: false
				}
	);

	let offset = 0;
	return raw.map((s) => {
		const withOffset: StripSpec = { ...s, offset };
		offset += s.count;
		return withOffset;
	});
}

export function buildGeometry(spec: RoomSpec = DEFAULT_ROOM): Geometry {
	const strips = stripSpecs(spec);
	const count = strips.reduce((n, s) => n + s.count, 0);

	const x = new Float32Array(count);
	const y = new Float32Array(count);
	const z = new Float32Array(count);
	const nx = new Float32Array(count);
	const ny = new Float32Array(count);
	const nz = new Float32Array(count);
	const r = new Float32Array(count);
	const theta = new Float32Array(count);
	const dist = new Float32Array(count);
	const strip = new Uint8Array(count);
	const local = new Float32Array(count);
	const perim = new Float32Array(count).fill(-1);
	const normal = new Float32Array(count * 3);

	const extent = Math.max(spec.width, spec.depth, spec.height);
	const halfDiag = Math.hypot(spec.width / 2, spec.depth / 2);
	const centreZ = spec.wallStripHeight / 2;
	const maxDist3 = Math.hypot(halfDiag, Math.max(centreZ, spec.beamHeight - centreZ));

	const perimeterLength = strips
		.filter((s) => s.inPerimeter)
		.reduce((sum, s) => sum + segLength(s), 0);

	let perimWalked = 0;

	for (const s of strips) {
		const len = segLength(s);
		const [sx, sy, sz] = s.start;
		const [ex, ey, ez] = s.end;

		for (let k = 0; k < s.count; k++) {
			const i = s.offset + k;
			// Sample at LED centres so the corner LED where two walls meet is not
			// duplicated into a visible double-bright dot.
			const u = (k + 0.5) / s.count;

			const px = sx + (ex - sx) * u;
			const py = sy + (ey - sy) * u;
			const pz = sz + (ez - sz) * u;

			x[i] = px;
			y[i] = py;
			z[i] = pz;

			nx[i] = (px + spec.width / 2) / extent;
			ny[i] = (py + spec.depth / 2) / extent;
			nz[i] = pz / extent;

			const rad = Math.hypot(px, py);
			r[i] = Math.min(rad / halfDiag, 1);

			let th = Math.atan2(py, px) / (Math.PI * 2);
			if (th < 0) th += 1;
			theta[i] = th;

			dist[i] = Math.min(Math.hypot(rad, pz - centreZ) / maxDist3, 1);

			strip[i] = s.id;
			local[i] = u;
			if (s.inPerimeter) perim[i] = (perimWalked + u * len) / perimeterLength;

			normal[i * 3 + 0] = s.normal[0];
			normal[i * 3 + 1] = s.normal[1];
			normal[i * 3 + 2] = s.normal[2];
		}

		if (s.inPerimeter) perimWalked += len;
	}

	return {
		count,
		strips,
		x,
		y,
		z,
		nx,
		ny,
		nz,
		r,
		theta,
		dist,
		strip,
		local,
		perim,
		normal,
		pitch: 1 / spec.density,
		extent,
		perimeterLength
	};
}
