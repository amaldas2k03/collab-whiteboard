/**
 * identity.ts — generates a stable-per-tab identity (id, display name, color).
 *
 * No auth in this project, so each browser tab just makes up a random identity
 * on load. The clientId is also the deterministic tie-breaker in the merge
 * module, so it must be unique per participant — a random UUID gives that.
 */

const ADJECTIVES = [
  'Swift', 'Calm', 'Bright', 'Bold', 'Keen', 'Lucky', 'Brave', 'Quiet',
  'Merry', 'Nimble', 'Clever', 'Sunny', 'Cosmic', 'Vivid', 'Gentle',
];
const ANIMALS = [
  'Otter', 'Falcon', 'Panda', 'Fox', 'Heron', 'Lynx', 'Koala', 'Wren',
  'Tiger', 'Moose', 'Robin', 'Seal', 'Hawk', 'Bison', 'Crane',
];

// Distinct, readable cursor colors.
const COLORS = [
  '#e11d48', '#ea580c', '#ca8a04', '#16a34a', '#0891b2',
  '#2563eb', '#7c3aed', '#c026d3', '#db2777', '#0d9488',
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export interface Identity {
  clientId: string;
  name: string;
  color: string;
}

export function createIdentity(): Identity {
  return {
    clientId: crypto.randomUUID(),
    name: `${pick(ADJECTIVES)} ${pick(ANIMALS)}`,
    color: pick(COLORS),
  };
}
