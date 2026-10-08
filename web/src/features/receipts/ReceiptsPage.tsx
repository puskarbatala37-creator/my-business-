import { addDays, todayInBusinessTz } from '@slay/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
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
    queryFn: () => api.get<{ receipts: Receipt[]; total: number; count: number; categories: string[] }>(`/api/receipts${qs({ q, from: rangeFrom(range) })}`),
  });

  return (
    <>
      <TopBar title="Supplier bills" actions={<HeaderActions />} />
      <main className="page stack" style={{ paddingTop: 12 }}>
        <label className="btn primary block" style={{ minHeight: 56, position: 'relative', overflow: 'hidden' }}>
          <Icon name="camera" /> {uploading ? 'Uploading…' : 'Snap a supplier bill'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            style={{ position: 'absolute', inset: 0, opacity: 0 }}
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              // Timestamp = the moment the photo was taken (camera) or chosen.
              const capturedAt = new Date(Math.min(Date.now(), file.lastModified || Date.now())).toISOString();
              setUploading(true);
              try {
                setDraft({ photo: await uploadPhoto(file), captured_at: capturedAt });
              } catch (err) {
                toast((err as Error).message, true);
              } finally {
                setUploading(false);
              }
            }}
          />
        </label>

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
                  <div className="small num">{npr(r.amount)}</div>
                  <div className="tiny muted">{dateTime(r.captured_at)}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>
      {draft && <ReceiptForm draft={draft} categories={list.data?.categories ?? []} onClose={() => setDraft(null)} />}
      {view && <ReceiptView r={view} onClose={() => setView(null)} />}
    </>
  );
}

function ReceiptForm({ draft, categories, onClose }: { draft: { photo: string; captured_at: string }; categories: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [supplier, setSupplier] = useState('');
  const [amount, setAmount] = useState<number | ''>('');
  const [category, setCategory] = useState('');
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
            await api.post('/api/receipts', { ...draft, supplier, amount: Number(amount) || 0, category, notes });
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
          Supplier / shop
          <input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </label>
        <label className="field">
          Total amount
          <MoneyInput value={amount} onChange={setAmount} />
        </label>
        <label className="field">
          Type (fabric, thread, ready stock…)
          <input className="input" list="receipt-cats" value={category} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="receipt-cats">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </label>
        <label className="field">
          Notes
          <textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What was bought" />
        </label>
        <button className="btn primary block" disabled={busy}>
          Save bill
        </button>
      </form>
    </Sheet>
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
