'use server';
import crypto from 'node:crypto';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { getUser } from '@/lib/auth';
import { q, now } from '@/lib/db';
import { allow } from '@/lib/limit';

export async function createLeague(form: FormData) {
  const user = await getUser();
  if (!user) redirect('/');
  const name = String(form.get('name') || '').trim().slice(0, 40);
  if (!name) return;
  if (!(await allow(`league-new:${user.id}`, 5, 3600))) redirect('/leagues?slow=1');
  const code = crypto.randomBytes(5).toString('base64url').replace(/[-_]/g, 'x').slice(0, 7).toLowerCase();
  const id = (await q(`INSERT INTO leagues (name, code, owner_id, created_at) VALUES ($1, $2, $3, $4) RETURNING id`, [name, code, user.id, now()]))[0].id;
  await q(`INSERT INTO league_members (league_id, user_id) VALUES ($1, $2)`, [id, user.id]);
  revalidatePath('/leagues');
}

export async function joinLeague(form: FormData) {
  const user = await getUser();
  const code = String(form.get('code') || '');
  if (!user) redirect('/');
  if (!(await allow(`league-join:${user.id}`, 30, 3600))) redirect('/leagues?slow=1');
  const league = (await q(`SELECT id FROM leagues WHERE code = $1`, [code]))[0];
  if (!league) redirect('/leagues');
  await q(`INSERT INTO league_members (league_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [league.id, user.id]);
  redirect(`/leaderboard?league=${code}`);
}

export async function leaveLeague(form: FormData) {
  const user = await getUser();
  if (!user) redirect('/');
  await q(`DELETE FROM league_members WHERE league_id = $1 AND user_id = $2`, [Number(form.get('id')), user.id]);
  revalidatePath('/leagues');
}

export async function rename(form: FormData) {
  const user = await getUser();
  if (!user) redirect('/');
  const name = String(form.get('name') || '').trim().slice(0, 30);
  if (name.length >= 2 && (await allow(`rename:${user.id}`, 10, 3600))) await q(`UPDATE users SET name = $1 WHERE id = $2`, [name, user.id]);
  revalidatePath('/', 'layout');
}
