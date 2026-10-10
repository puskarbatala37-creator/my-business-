import { addDays, todayInBusinessTz } from '@slay/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { FieldHead, MicButton } from '../../components/FieldVoice';
import { Icon } from '../../components/Icon';
import { HeaderActions } from '../../components/Layout';
import { Empty, MoneyInput, Sheet, Spinner, TopBar, useToast } from '../../components/ui';
import { api, qs } from '../../lib/api';
import { dateTime, npr } from '../../lib/format';
import { uploadPhoto } from '../../lib/image';
import type { Receipt } from '../../lib/types';
import { useDebounced } from '../orders/OrdersPage';

const RANGES = [
  { key: 'all', label: 'All time', from: undefined as string | undefined },
  { key: '7', label: '7 days', days: 6 },
  { key: '30', label: '30 days', days: 29 },
  { key: 'month', label: 'This month' },
  { key: '180', label: '6 months', days: 179 },
  { key: '365', label: '12 months', days: 364 },
];

function rangeFrom(key: string) {
  const today = todayInBusinessTz();
  if (key === 'month') return today.slice(0, 8) + '01';
  const r = RANGES.find((x) => x.key === key);
  return r && 'days' in r && r.days !== undefined ? addDays(today, -r.days) : undefined;
}

/** Supplier bills for raw materials / stock: photo + automatic timestamp, searchable for profit calculations. */
export function ReceiptsPage() {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [range, setRange] = useState('month');
  const [draft, setDraft] = useState<{ photo: string; captured_at: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [view, setView] = useState<Receipt | null>(null);
  const q = useDebounced(search);
  const list = useQuery({
    queryKey: ['receipts', q, range],
    queryFn: () => api.get<{ receipts: Receipt[]; total: number; count: number }>(`/api/receipts${qs({ q, from: rangeFrom(range) })}`),
  });

  async function pickBill(input: HTMLInputElement) {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    // Timestamp = the moment the photo was taken (camera) or the photo's own date (gallery).
    const capturedAt = new Date(Math.min(Date.now(), file.lastModified || Date.now())).toISOString();
    setUploading(true);
    try {
      setDraft({ photo: await uploadPhoto(file), captured_at: capturedAt });
    } catch (err) {
      toast((err as Error).message, true);
    } finally {
      setUploading(false);
    }
  }

  return (
    <>
      <TopBar title="Supplier bills" actions={<HeaderActions />} />
      <main className="page stack" style={{ paddingTop: 12 }}>
        {/* A new photo of the bill, or one already on the phone (e.g. a bill the supplier sent on WhatsApp). */}
        <div className="row" style={{ gap: 8 }}>
          <label className="btn primary grow" style={{ minHeight: 56 }}>
            <Icon name="camera" /> {uploading ? 'Uploading…' : 'Snap a supplier bill'}
            <input type="file" accept="image/*" capture="environment" className="file-picker" disabled={uploading} onChange={(e) => pickBill(e.target)} />
          </label>
          <label className="btn" style={{ minHeight: 56 }}>
            <Icon name="image" /> Choose a photo
            <input type="file" accept="image/*" className="file-picker" disabled={uploading} onChange={(e) => pickBill(e.target)} />
          </label>
        </div>

        <div className="search">
          <Icon name="search" size={20} />
          <input className="input" type="search" placeholder="Search supplier, item or note" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="chips">
          {RANGES.map((r) => (
            <button key={r.key} className={`chip ${range === r.key ? 'on' : ''}`} onClick={() => setRange(r.key)}>
              {r.label}
            </button>
          ))}
        </div>
        {list.data && (
          <div className="card tight row between">
            <span className="small muted">
              {list.data.count} bill{list.data.count === 1 ? '' : 's'}
            </span>
            <span className="strong num">{npr(list.data.total)} spent</span>
          </div>
        )}
        {list.isLoading ? (
          <Spinner />
        ) : !list.data?.receipts.length ? (
          <Empty>No bills saved for this period.</Empty>
        ) : (
          <div className="receipt-grid">
            {list.data.receipts.map((r) => (
              <button key={r.id} className="receipt-card" onClick={() => setView(r)}>
                <img src={r.photo} alt="" loading="lazy" />
                <div className="meta">
                  <div className="strong small ellipsis">{r.supplier || 'Supplier bill'}</div>
                  <div className="small num">
                    {npr(r.amount)}
                    {r.category && <span className="muted"> · {r.category}</span>}
                  </div>
                  <div className="tiny muted">{dateTime(r.captured_at)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
      {draft && <ReceiptForm draft={draft} onClose={() => setDraft(null)} />}
      {view && <ReceiptView r={view} onClose={() => setView(null)} />}
    </>
  );
}

function ReceiptForm({ draft, onClose }: { draft: { photo: string; captured_at: string }; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [category, setCategory] = useState('');
  const [newType, setNewType] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title="Save bill" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            // A new type typed here is added to everyone's choices when the bill is saved.
            const type = newType !== null ? newType.trim() : category;
            await api.post('/api/receipts', { ...draft, supplier, amount: Number(amount) || 0, category: type, notes });
            qc.invalidateQueries({ queryKey: ['receipts'] });
            toast('Bill saved');
            onClose();
          } catch (err) {
            toast((err as Error).message, true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <img src={draft.photo} alt="Supplier bill" style={{ maxHeight: 260, objectFit: 'contain', borderRadius: 12, background: 'var(--surface-2)', width: '100%' }} />
        <div className="small muted">Captured {dateTime(draft.captured_at)}</div>
        <label className="field">
          <FieldHead text="Supplier / shop">
            <MicButton label="Supplier" kind="name" onValue={setSupplier} />
          </FieldHead>
          <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </label>
        <label className="field">
          <FieldHead text="Total amount">
            <MicButton label="Bill amount" kind="money" onValue={setAmount} />
          </FieldHead>
          <MoneyInput value={amount} onChange={setAmount} />
        </label>
        <TypePicker value={category} onChange={setCategory} newType={newType} onNewType={setNewType} />
        <label className="field">
          <FieldHead text="Notes">
            <MicButton label="Note" kind="text" onValue={(t) => setNotes((n) => (n ? `${n} ${t}` : t))} />
          </FieldHead>
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Details, e.g. 12 m Banarasi silk, 2 colours" />
        </label>
        <button className="btn primary block" disabled={busy}>
          Save bill
        </button>
      </form>
    </Sheet>
  );
}

interface BillTypes {
  presets: string[];
  custom: { id: number; name: string }[];
}

/**
 * What the bill was for: the four usual types as one-tap buttons, any types the team added
 * themselves, and "+ New type" to type a new one (saved for everyone with the bill).
 */
function TypePicker({ value, onChange, newType, onNewType }: { value: string; onChange: (v: string) => void; newType: string | null; onNewType: (v: string | null) => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const types = useQuery({ queryKey: ['receipts', 'types'], queryFn: () => api.get<BillTypes>('/api/receipts/types') });
  const all = [...(types.data?.presets ?? []), ...(types.data?.custom.map((t) => t.name) ?? [])];
  const selectedCustom = types.data?.custom.find((t) => t.name === value);
  const pick = (name: string) => {
    onNewType(null);
    onChange(value === name ? '' : name); // tap again to clear
  };
  return (
    <div className="field-group">
      <FieldHead text={<span id="bill-type-label">What was bought</span>}>
        <MicButton label="Bill type" kind="option" options={all.map((n) => ({ value: n, label: n }))} onValue={(n) => { onNewType(null); onChange(n); }} />
      </FieldHead>
      <div className="chips" role="radiogroup" aria-labelledby="bill-type-label" style={{ flexWrap: 'wrap' }}>
        {all.map((name) => (
          <button type="button" key={name} role="radio" aria-checked={newType === null && value === name} className={`chip ${newType === null && value === name ? 'on' : ''}`} onClick={() => pick(name)}>
            {name}
          </button>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={newType !== null}
          className={`chip ${newType !== null ? 'on' : ''}`}
          onClick={() => onNewType(newType === null ? '' : null)}
        >
          + New type
        </button>
      </div>
      {newType !== null && (
        <label className="field" style={{ marginTop: 8 }}>
          New type name
          <input
            className="input"
            autoFocus
            value={newType}
            onChange={(e) => onNewType(e.target.value)}
            placeholder="e.g. Buttons & lace, Packaging, Embroidery"
            maxLength={40}
          />
          <span className="tiny muted">It's added to the list for the whole team when you save this bill.</span>
        </label>
      )}
      {newType === null && selectedCustom && (
        <button
          type="button"
          className="btn ghost sm"
          style={{ alignSelf: 'flex-start', marginTop: 4, color: 'var(--text-2)' }}
          onClick={async () => {
            if (!confirm(`Remove “${selectedCustom.name}” from the list? Bills already saved with it keep it.`)) return;
            try {
              qc.setQueryData(['receipts', 'types'], await api.del<BillTypes>(`/api/receipts/types/${selectedCustom.id}`));
              onChange('');
            } catch (e) {
              toast((e as Error).message, true);
            }
          }}
        >
          Remove “{selectedCustom.name}” from the list
        </button>
      )}
    </div>
  );
}

function ReceiptView({ r, onClose }: { r: Receipt; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  return (
    <Sheet title={r.supplier || 'Supplier bill'} onClose={onClose}>
      <div className="stack">
        <a href={r.photo} target="_blank" rel="noreferrer">
          <img src={r.photo} alt="Supplier bill" style={{ width: '100%', borderRadius: 12 }} />
        </a>
        <div className="totals">
          <span className="muted">Amount</span>
          <span className="right strong">{npr(r.amount)}</span>
          <span className="muted">Captured</span>
          <span className="right">{dateTime(r.captured_at)}</span>
          {r.category && (
            <>
              <span className="muted">Type</span>
              <span className="right">{r.category}</span>
            </>
          )}
          <span className="muted">Saved by</span>
          <span className="right">{r.created_by_name ?? '—'}</span>
        </div>
        {r.notes && <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{r.notes}</div>}
        <button
          className="btn danger block"
          onClick={async () => {
            if (!confirm('Delete this bill? The team will be notified.')) return;
            try {
              await api.del(`/api/receipts/${r.id}`);
              qc.invalidateQueries({ queryKey: ['receipts'] });
              onClose();
            } catch (e) {
              toast((e as Error).message, true);
            }
          }}
        >
          Delete
        </button>
      </div>
    </Sheet>
  );
}
