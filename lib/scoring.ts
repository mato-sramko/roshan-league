import { SCORING } from '@/season.config';

export type Breakdown = Record<string, { value: number; points: number }>;

// Turns one player's stats from an OpenDota match into fantasy points.
export function scorePlayer(p: Record<string, any>): { points: number; breakdown: Breakdown } {
  const breakdown: Breakdown = {};
  let total = 0;
  for (const [field, weight] of Object.entries(SCORING)) {
    const value = Number(p[field] ?? 0) || 0;
    const points = value * weight;
    breakdown[field] = { value: round2(value), points: round2(points) };
    total += points;
  }
  return { points: round2(total), breakdown };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
