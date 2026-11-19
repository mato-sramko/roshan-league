'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

type Role = 'core' | 'mid' | 'support';
type Mode = 'casual' | 'grind';
type P = { id: string; name: string; team: string | null; teamId: string | null; role: Role; price: number; avg: number | null; inactive: boolean };
type Owned = { sell: number; buy: number | null; pts: number };
type Props = {
  mode: Mode;
  players: P[];
  starters: string[];
  bench: string[];
  owned: Record<string, Owned>;
  coins: number; // grind: coins in hand (or the starting amount for a new squad)
  edit: 'new' | 'free' | 'window' | 'locked';
  freeLeft: number;
  rules: {
    budget: number;
    slots: Record<Role, number>;
    bench: Record<Role, number>;
    maxPerTeam: number;
    penalty: number;
    freePerWindow: number;
  };
  liveName: string | null;
  liveUntil: string | null;
  nextName: string | null;
  nextStart: string | null;
};

const ROLE_LABEL: Record<Role, string> = { core: 'Core', mid: 'Mid', support: 'Support' };
const ROLE_TAB: Record<Role, string> = { core: 'Cores', mid: 'Mids', support: 'Supports' };
const ORDER: Role[] = ['core', 'mid', 'support'];

export default function TeamBuilder(p: Props) {
  const router = useRouter();
  const byId = useMemo(() => new Map(p.players.map((x) => [x.id, x])), [p.players]);
  const [starters, setStarters] = useState<string[]>(p.starters);
  const [bench, setBench] = useState<string[]>(p.bench);
  const [tab, setTab] = useState<Role>('core');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const grind = p.mode === 'grind';
  const locked = p.edit === 'locked';

  const all = [...starters, ...bench];
  const get = (id: string) => byId.get(id)!;
  const inRole = (list: string[], r: Role) => list.filter((id) => get(id)?.role === r);
  const perTeam = (teamId: string | null) => (teamId ? all.filter((id) => get(id)?.teamId === teamId).length : 0);
  const needStart = ORDER.reduce((a, r) => a + p.rules.slots[r], 0);
  const needBench = ORDER.reduce((a, r) => a + p.rules.bench[r], 0);

  const current = [...p.starters, ...p.bench];
  const outs = current.filter((id) => !all.includes(id));
  const ins = all.filter((id) => !current.includes(id));
  const moved = all.filter((id) => current.includes(id) && p.bench.includes(id) !== bench.includes(id));
  const changed = outs.length + ins.length + moved.length > 0;

  // Money
  const cost = all.reduce((a, id) => a + (get(id)?.price ?? 0), 0);
  const wallet = p.coins + outs.reduce((a, id) => a + (p.owned[id]?.sell ?? get(id).price), 0) - ins.reduce((a, id) => a + get(id).price, 0);
  const squadValue = all.reduce((a, id) => a + (p.owned[id] ? p.owned[id].sell : get(id).price), 0);
  const left = grind ? wallet : p.rules.budget - cost;

  const paidOuts = outs.filter((id) => !get(id)?.inactive).length;
  const penalty = !grind && p.edit === 'window' ? Math.max(0, paidOuts - p.freeLeft) * p.rules.penalty : 0;

  const canRemove = (id: string) => !locked || !current.includes(id) || !!get(id)?.inactive;

  function whyNot(x: P): string | null {
    if (all.includes(x.id)) return null;
    if (x.inactive) return 'Not playing recently';
    const startFree = inRole(starters, x.role).length < p.rules.slots[x.role];
    const benchFree = inRole(bench, x.role).length < p.rules.bench[x.role];
    if (!startFree && !benchFree) return `No free ${ROLE_LABEL[x.role].toLowerCase()} slot`;
    if (locked && ins.length >= outs.length) return 'Squads are locked';
    if (perTeam(x.teamId) >= p.rules.maxPerTeam) return `Already ${p.rules.maxPerTeam} from ${x.team}`;
    if (grind && x.price > wallet) return `${x.price - wallet} coins short`;
    return null;
  }
  function add(x: P) {
    setMsg(null);
    if (inRole(starters, x.role).length < p.rules.slots[x.role]) setStarters((s) => [...s, x.id]);
    else setBench((b) => [...b, x.id]);
  }
  function remove(id: string) {
    setMsg(null);
    setStarters((s) => s.filter((i) => i !== id));
    setBench((b) => b.filter((i) => i !== id));
  }
  // Starter <-> bench: swaps with the bench player of the same role, or just moves if the bench slot is empty.
  function swap(id: string) {
    setMsg(null);
    const role = get(id).role;
    if (starters.includes(id)) {
      const b = inRole(bench, role)[0];
      setStarters((s) => [...s.filter((i) => i !== id), ...(b ? [b] : [])]);
      setBench((bn) => [...bn.filter((i) => i !== b), id]);
    } else {
      if (inRole(starters, role).length >= p.rules.slots[role]) return;
      setBench((bn) => bn.filter((i) => i !== id));
      setStarters((s) => [...s, id]);
    }
  }

  let problem: string | null = null;
  const missing = needStart - starters.length;
  if (missing > 0) problem = `Pick ${missing} more ${missing === 1 ? 'starter' : 'starters'}.`;
  else if (!grind && left < 0) problem = `${-left} coins over budget.`;
  else if (grind && wallet < 0) problem = `${-wallet} coins short.`;

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/roster', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode: p.mode, starters, bench }),
      });
      const data = await res.json();
      if (data.ok) {
        const parts = ['Squad saved.'];
        if (data.penalty) parts.push(`${data.penalty} points taken off for extra transfers.`);
        if (grind && data.coins != null) parts.push(`${data.coins} coins left.`);
        setMsg({ ok: true, text: parts.join(' ') });
        router.push(`/team?mode=${p.mode}`);
        router.refresh();
      } else setMsg({ ok: false, text: data.error || 'The squad was not saved. Try again.' });
    } catch {
      setMsg({ ok: false, text: 'The squad was not saved: no connection. Try again.' });
    }
    setBusy(false);
  }

  const roleFull =
    inRole(starters, tab).length >= p.rules.slots[tab] && inRole(bench, tab).length >= p.rules.bench[tab];
  const list = p.players
    .filter((x) => x.role === tab && (!x.inactive || all.includes(x.id) || !!search))
    .filter((x) => !search || `${x.name} ${x.team ?? ''}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => Number(a.inactive) - Number(b.inactive) || b.price - a.price || a.name.localeCompare(b.name));

  const card = (id: string, isBench: boolean) => {
    const x = get(id);
    const own = p.owned[id];
    return (
      <li key={id} className={`slot ${x.role}${isBench ? ' benchslot' : ''}`}>
        <span className="role">{isBench ? `Bench ${ROLE_LABEL[x.role].toLowerCase()}` : ROLE_LABEL[x.role]}</span>
        <span className="pname">{x.name}</span>
        <span className="small muted">{x.team ?? 'No team'}</span>
        {x.inactive && <span className="small warn">Not playing. Free to replace.</span>}
        <span className="foot">
          <span className="coin" title={grind && own ? `Bought for ${own.buy ?? x.price}. Sells for ${own.sell}.` : undefined}>
            {grind && own ? `sell ${own.sell}` : x.price}
          </span>
          {own && <span className="small num">{own.pts.toFixed(1)} pts</span>}
        </span>
        <span className="row" style={{ gap: 12, marginTop: 4 }}>
          {!locked && (
            <button className="linkbtn small" onClick={() => swap(id)}>
              {isBench ? 'Start' : 'To bench'}
            </button>
          )}
          {canRemove(id) && (
            <button className="linkbtn small" onClick={() => remove(id)}>
              {grind && own ? 'Sell' : 'Remove'}
            </button>
          )}
        </span>
      </li>
    );
  };
  const empty = (role: Role, isBench: boolean, i: number) => (
    <li key={`${isBench ? 'b' : 's'}-${role}-${i}`} className={`slot empty ${role}${isBench ? ' benchslot' : ''}`}>
      <span className="role">{isBench ? `Bench ${ROLE_LABEL[role].toLowerCase()}` : ROLE_LABEL[role]}</span>
      <button className="linkbtn" onClick={() => setTab(role)}>
        Pick a {ROLE_LABEL[role].toLowerCase()}
      </button>
    </li>
  );
  const group = (ids: string[], counts: Record<Role, number>, isBench: boolean) =>
    ORDER.flatMap((role) => {
      const mine = inRole(ids, role);
      const cells = mine.map((id) => card(id, isBench));
      for (let i = mine.length; i < counts[role]; i++) cells.push(empty(role, isBench, i));
      return cells;
    });

  return (
    <div>
      {p.edit === 'new' && (
        <p className="note">
          {grind
            ? `You start with ${p.coins} coins. Pick ${needStart} starters, and up to ${needBench} bench players if you like, then earn coins after every tournament and trade up.`
            : `Pick ${needStart} starters, and up to ${needBench} bench players if you like, for ${p.rules.budget.toLocaleString('en')} coins, with at most ${p.rules.maxPerTeam} from one team.`}{' '}
          {p.liveName ? `${p.liveName} is already under way, so your squad scores from the next match on.` : p.nextName ? `Change it freely until ${p.nextName} starts on ${p.nextStart}.` : ''}
        </p>
      )}
      {p.edit === 'free' && (
        <p className="note good">
          Nothing has been played since you saved this squad, so {grind ? 'buying and selling is at today’s prices' : 'every change is free'}
          {p.nextName ? ` until ${p.nextName} starts on ${p.nextStart}` : ''}.
        </p>
      )}
      {p.edit === 'window' && (
        <p className="note good">
          The transfer window is open{p.nextName ? ` until ${p.nextName} starts on ${p.nextStart}` : ''}.{' '}
          {grind
            ? 'Buy and sell as much as your coins allow.'
            : `You have ${p.freeLeft} of ${p.rules.freePerWindow} free transfers left. Each one after that costs ${p.rules.penalty} points.`}
        </p>
      )}
      {locked && (
        <p className="note bad">
          Squads are locked while {p.liveName} is being played. Transfers open again after {p.liveUntil}. A player who has stopped playing can still be replaced.
        </p>
      )}

      <div className="budget" aria-label={grind ? `${wallet} coins in hand` : `Budget: ${cost} of ${p.rules.budget} coins used`}>
        <div className="bar">
          {all
            .slice()
            .sort((a, b) => ORDER.indexOf(get(a).role) - ORDER.indexOf(get(b).role))
            .map((id) => (
              <i
                key={id}
                className={get(id).role}
                style={{ width: `${(get(id).price / Math.max(grind ? squadValue + Math.max(wallet, 0) : cost, grind ? 1 : p.rules.budget)) * 100}%` }}
                title={`${get(id).name}: ${get(id).price}`}
              />
            ))}
        </div>
        <div className="legend num">
          {grind ? (
            <>
              <span>Squad worth {squadValue}</span>
              <span className={wallet < 0 ? 'over' : ''}>{wallet < 0 ? `${-wallet} coins short` : `${wallet} coins in hand`}</span>
            </>
          ) : (
            <>
              <span>{cost} coins used</span>
              <span className={left < 0 ? 'over' : ''}>{left < 0 ? `${-left} over budget` : `${left} left`}</span>
            </>
          )}
        </div>
      </div>

      <h2 className="sub">Starting five</h2>
      <ul className="slots">{group(starters, p.rules.slots, false)}</ul>
      <h2 className="sub">Bench</h2>
      <p className="small muted" style={{ marginTop: -6 }}>
        Optional. A bench player scores only in a tournament where one of your starters in the same role does not play at all. Filling an empty
        bench slot is not a transfer.
      </p>
      <ul className="slots">{group(bench, p.rules.bench, true)}</ul>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 24 }}>
        <div className="tabs" style={{ margin: 0 }} role="tablist">
          {ORDER.map((r) => (
            <button key={r} role="tab" aria-selected={tab === r} className={tab === r ? 'on' : ''} onClick={() => setTab(r)}>
              {ROLE_TAB[r]} {inRole(all, r).length}/{p.rules.slots[r] + p.rules.bench[r]}
            </button>
          ))}
        </div>
        <input type="search" placeholder="Search player or team" aria-label="Search player or team" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {roleFull && (
        <p className="small muted" style={{ margin: '10px 0 0' }}>
          All your {ROLE_TAB[tab].toLowerCase()} slots are filled. {grind ? 'Sell' : 'Remove'} one to make room.
        </p>
      )}
      <div className="tablewrap" style={{ marginTop: 12 }}>
        <table className="table pool">
          <thead>
            <tr>
              <th>Player</th>
              <th className="r" title="Average points per match last season">Pts/match</th>
              <th className="r">Price</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <td colSpan={4} className="muted">
                  No {ROLE_TAB[tab].toLowerCase()} match that search.
                </td>
              </tr>
            )}
            {list.map((x) => {
              const inSquad = all.includes(x.id);
              const why = whyNot(x);
              return (
                <tr key={x.id} className={inSquad ? 'me' : x.inactive ? 'dim' : ''}>
                  <td>
                    {x.name}
                    <span className="t">{x.team ?? 'No team'}</span>
                  </td>
                  <td className="r num">{x.avg != null ? x.avg.toFixed(1) : '–'}</td>
                  <td className="r">
                    <span className="coin">{x.price}</span>
                  </td>
                  <td className="r">
                    {inSquad ? (
                      canRemove(x.id) ? (
                        <button className="btn plain sm" onClick={() => remove(x.id)}>
                          {grind && p.owned[x.id] ? 'Sell' : 'Remove'}
                        </button>
                      ) : (
                        <span className="small muted">Locked</span>
                      )
                    ) : (
                      <button className="btn sm" disabled={!!why} title={why ?? undefined} onClick={() => add(x)}>
                        {grind ? 'Buy' : 'Add'}
                      </button>
                    )}
                    {why && !roleFull && <span className="t">{why}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="savebar">
        <span aria-live="polite">
          {msg ? (
            <span className={msg.ok ? '' : 'warn'}>{msg.text}</span>
          ) : problem ? (
            <span className="warn">{problem}</span>
          ) : !changed ? (
            <span className="muted">No changes to save.</span>
          ) : p.edit === 'window' && !grind && outs.length ? (
            <span>
              {outs.length} {outs.length === 1 ? 'transfer' : 'transfers'}
              {penalty > 0 ? <b className="warn">, costs {penalty} points</b> : ', free'}
            </span>
          ) : grind && outs.length + ins.length ? (
            <span>
              {outs.length ? `Sell ${outs.length}` : ''}
              {outs.length && ins.length ? ', ' : ''}
              {ins.length ? `buy ${ins.length}` : ''}. {wallet} coins left after.
            </span>
          ) : (
            <span>Ready to save.</span>
          )}
        </span>
        <button className="btn" disabled={busy || !!problem || !changed} onClick={save}>
          {busy ? 'Saving…' : p.edit === 'new' ? 'Save squad' : grind ? 'Confirm trades' : p.edit === 'window' || locked ? 'Confirm transfers' : 'Save squad'}
        </button>
      </div>
    </div>
  );
}
