import { resetDemo } from './boot';

export function DemoBanner() {
  return (
    <div className="demo-banner no-print">
      <span>
        <strong>Demo preview</strong> – sample data, saved only in this browser.
      </span>
      <button type="button" onClick={() => confirm('Reset the demo to the original sample data?') && resetDemo()}>
        Reset
      </button>
    </div>
  );
}
