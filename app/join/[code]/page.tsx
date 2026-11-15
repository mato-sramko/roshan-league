import { getUser } from '@/lib/auth';
import { q } from '@/lib/db';
import { joinLeague } from '../../actions';

export const metadata = { title: 'Join a league' };

export default async function Join({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const league = (await q(`SELECT l.name, u.name AS owner FROM leagues l JOIN users u ON u.id = l.owner_id WHERE l.code = $1`, [code]))[0];
  const user = await getUser();
  if (!league) {
    return (
      <section className="hero">
        <h1 className="page">This invite link does not work</h1>
        <p>The league may have been removed. Ask your friend for a new link.</p>
      </section>
    );
  }
  return (
    <section className="hero">
      <h1 className="page">Join {league.name}</h1>
      <p>{league.owner} invited you to their Roshan League table.</p>
      {user ? (
        <form action={joinLeague}>
          <input type="hidden" name="code" value={code} />
          <button className="btn">Join league</button>
        </form>
      ) : (
        <>
          <p>Sign in first, then open this link again.</p>
          <a href="/api/auth/steam" className="btn">
            Sign in with Steam
          </a>
        </>
      )}
    </section>
  );
}
