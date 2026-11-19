'use client';
// Shows a time in the visitor's own time zone. The server does not know it, so this runs in the browser;
// until then the UTC time is shown.
import { useEffect, useState } from 'react';

function label(ts: number, exact: boolean, nowMs: number): string {
  const d = new Date(ts * 1000);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(new Date(nowMs))) / 86400000);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const date =
    diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  return exact ? `${date} ${time}` : date;
}

export default function LocalTime({ ts, exact = true, rel = false }: { ts: number; exact?: boolean; rel?: boolean }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const i = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(i);
  }, []);
  const iso = new Date(ts * 1000).toISOString();
  if (now == null) return <time dateTime={iso}>{iso.slice(0, 16).replace('T', ' ')} UTC</time>;
  const mins = Math.round((ts * 1000 - now) / 60000);
  const soon = rel && exact && mins > 0 && mins < 12 * 60 ? `in ${mins >= 60 ? `${Math.floor(mins / 60)} h ` : ''}${mins % 60} min` : null;
  return <time dateTime={iso} title={new Date(ts * 1000).toLocaleString()}>{soon ?? label(ts, exact, now)}</time>;
}
