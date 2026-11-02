import { cleanMeasurements, MEASUREMENTS, type MeasurementKey, type Measurements } from '@slay/shared';
import { useState } from 'react';
import { FieldHead, MicButton } from '../../components/FieldVoice';
import { Icon } from '../../components/Icon';

/**
 * Optional stitching measurements for one order item. Tick only the measurements needed – each gets
 * its own box (never combined), always typed freely, never locked to preset sizes – or skip it all.
 */
export function MeasurementsEditor({ value, onChange, itemName }: { value: Measurements | null; onChange: (m: Measurements | null) => void; itemName: string }) {
  const [chosen, setChosen] = useState<MeasurementKey[]>(() => MEASUREMENTS.filter((m) => value?.[m.key] !== undefined).map((m) => m.key));
  const [open, setOpen] = useState(chosen.length > 0);

  if (!open)
    return (
      <button type="button" className="btn ghost sm meas-add" onClick={() => setOpen(true)}>
        <Icon name="plus" size={16} /> Measurements (optional)
      </button>
    );

  const toggle = (key: MeasurementKey) => {
    if (chosen.includes(key)) {
      setChosen(chosen.filter((k) => k !== key));
      const next = { ...(value ?? {}) };
      delete next[key];
      onChange(cleanMeasurements(next));
    } else setChosen(MEASUREMENTS.map((m) => m.key).filter((k) => k === key || chosen.includes(k)));
  };
  const set = (key: MeasurementKey, v: string) => onChange({ ...(value ?? {}), [key]: v });

  return (
    <div className="meas" role="group" aria-label={`Measurements for ${itemName}`}>
      <div className="row between">
        <span className="strong small">Measurements</span>
        <button
          type="button"
          className="btn ghost sm"
          style={{ padding: 0, minHeight: 28 }}
          onClick={() => {
            setChosen([]);
            onChange(null);
            setOpen(false);
          }}
        >
          Remove
        </button>
      </div>
      <div className="tiny muted">Tick the ones the tailor needs:</div>
      <div className="chips meas-checks">
        {MEASUREMENTS.map((m) => (
          <button key={m.key} type="button" role="checkbox" aria-checked={chosen.includes(m.key)} className={`chip ${chosen.includes(m.key) ? 'on' : ''}`} onClick={() => toggle(m.key)}>
            {chosen.includes(m.key) ? '✓ ' : ''}
            {m.label}
          </button>
        ))}
      </div>
      {chosen.length > 0 && (
        <div className="meas-fields">
          {MEASUREMENTS.filter((m) => chosen.includes(m.key)).map((m) => (
            <label key={m.key} className="field">
              <FieldHead text={m.label}>
                <MicButton label={m.label} kind="number" onValue={(n) => set(m.key, String(n))} />
              </FieldHead>
              <input className="input num" inputMode="decimal" autoComplete="off" placeholder="e.g. 34" maxLength={30} value={value?.[m.key] ?? ''} onChange={(e) => set(m.key, e.target.value)} />
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/** The measurements of an item, easy for the tailor to read: "Bust 34", "Waist 28"… */
export function MeasurementsView({ value }: { value: Measurements | null | undefined }) {
  const m = cleanMeasurements(value);
  if (!m) return null;
  return (
    <div className="meas-view" aria-label="Measurements">
      {MEASUREMENTS.filter(({ key }) => m[key]).map(({ key, label }) => (
        <div key={key} className="meas-cell">
          <span className="tiny muted">{label}</span>
          <span className="strong num">{m[key]}</span>
        </div>
      ))}
    </div>
  );
}
