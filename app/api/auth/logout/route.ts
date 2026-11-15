import { NextResponse } from 'next/server';
import { endSession, siteUrl } from '@/lib/auth';

export async function POST(req: Request) {
  await endSession();
  return NextResponse.redirect(`${siteUrl(req)}/`, 303);
}
