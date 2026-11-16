// A green (Casual, Radiant) or red (Grind, Dire) frame around the whole window, so it is
// always clear which game mode a page shows. Colors are in globals.css.
export default function ModeFrame({ mode }: { mode: 'casual' | 'grind' }) {
  return (
    <div className={`modeframe ${mode}`} aria-hidden="true">
      <span>{mode === 'grind' ? 'GRIND' : 'CASUAL'}</span>
    </div>
  );
}
