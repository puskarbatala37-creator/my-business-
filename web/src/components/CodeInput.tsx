/** A 6-digit one-time code field that phones auto-fill from the SMS where supported. */
export function CodeInput({ value, onChange, id = 'otp' }: { value: string; onChange: (v: string) => void; id?: string }) {
  return (
    <input
      id={id}
      className="input num code-input"
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="\d{6}"
      maxLength={6}
      placeholder="••••••"
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      required
    />
  );
}

/** Demo preview only: no SMS is sent, so the code is shown here instead. */
export function DemoCode({ code }: { code?: string }) {
  if (!code) return null;
  return (
    <div className="alert-banner info small">
      <span>
        Demo preview: no text message is sent. The code would be <strong className="num">{code}</strong>.
      </span>
    </div>
  );
}
