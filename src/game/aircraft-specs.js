/**
 * Shared 1940 aircraft definitions. Geometry, muzzle placement and combat use
 * the same local frame: x right, y toward the nose, z up, five units per metre.
 * Dimensions and armament identity are historical; port coordinates are a
 * low-resolution reconstruction, and rates/velocities are nominal game data.
 * Sources and explicit approximation boundaries: docs/AIRCRAFT_REFERENCE.md.
 */

const deepFreeze = value => {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
};

export const MODEL_UNITS_PER_METRE = 5;
export const AIRCRAFT_MODEL_SCALE = .72;

/** Exact same leading-edge reconstruction used for the Spitfire gun ports. */
export function spitfireLeadingEdge(x) {
  const halfSpan = 11.23 * MODEL_UNITS_PER_METRE / 2;
  return 2.2 - Math.abs(x) * .08 + 6.1 * Math.sqrt(Math.max(0, 1 - (x / halfSpan) ** 2));
}

/** Bf 109 E straight, tapered leading edge; excludes projecting cannon tips. */
export function bf109LeadingEdge(x) {
  return 8.1 - Math.abs(x) * .185;
}

const browningPositions = [9, 12, 17, 20.5];
const spitfireGuns = [-1, 1].flatMap(side => browningPositions.map((x, i) => ({
  id: `${side < 0 ? 'port' : 'starboard'}-browning-${i + 1}`,
  name: '.303 Browning Mk II', kind: 'machine-gun', calibreMm: 7.7,
  x: side * x, y: spitfireLeadingEdge(x) + .45, z: -.45,
  roundsPerMinute: 1150, muzzleVelocity: 744, ammo: 300,
})));

const bf109Guns = [
  ...[-1, 1].map(side => ({
    id: `${side < 0 ? 'port' : 'starboard'}-mg17`,
    name: 'MG 17', kind: 'machine-gun', calibreMm: 7.92,
    x: side * 1.25, y: 15.8, z: 1.65,
    roundsPerMinute: 1000, muzzleVelocity: 775, ammo: 1000,
  })),
  ...[-1, 1].map(side => ({
    id: `${side < 0 ? 'port' : 'starboard'}-mgffm`,
    name: 'MG FF/M', kind: 'cannon', calibreMm: 20,
    x: side * 10.5, y: bf109LeadingEdge(10.5) + 1.65, z: -.6,
    roundsPerMinute: 520, muzzleVelocity: 600, ammo: 60,
  })),
];

export const AIRCRAFT_SPECS = deepFreeze({
  spitfire: {
    id: 'spitfire', faction: 'raf', variant: 'Spitfire Mk Ia', year: 1940,
    unitsPerMetre: MODEL_UNITS_PER_METRE, modelScale: AIRCRAFT_MODEL_SCALE,
    dimensions: { wingspanMetres: 11.23, lengthMetres: 9.12 },
    wingType: 'elliptical-a-wing', engine: 'Rolls-Royce Merlin III',
    armamentLabel: '8 × .303 Browning · 每翼 4 挺',
    gunMounts: spitfireGuns,
    propeller: { x: 0, y: 20.2, z: .25, radius: 7.4, bladeCount: 3,
      hubRadius: 1.55, bladeWidth: .68, rotationSign: -1,
      bladeColor: 0xff292d2e, tipColor: 0xff65c6e6 },
  },
  bf109: {
    id: 'bf109', faction: 'luftwaffe', variant: 'Bf 109 E-4', year: 1940,
    unitsPerMetre: MODEL_UNITS_PER_METRE, modelScale: AIRCRAFT_MODEL_SCALE,
    dimensions: { wingspanMetres: 9.87, lengthMetres: 8.74 },
    wingType: 'straight-tapered-e-wing', engine: 'Daimler-Benz DB 601',
    armamentLabel: '2 × MG 17 + 2 × 20 mm MG FF/M',
    gunMounts: bf109Guns,
    propeller: { x: 0, y: 18.95, z: .15, radius: 7.75, bladeCount: 3,
      hubRadius: 1.48, bladeWidth: .62, rotationSign: -1,
      bladeColor: 0xff30372e, tipColor: 0xff30372e },
  },
});

export function getAircraftSpec(id) {
  return AIRCRAFT_SPECS[id] || AIRCRAFT_SPECS.spitfire;
}
