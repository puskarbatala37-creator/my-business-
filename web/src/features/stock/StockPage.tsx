import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { HeaderActions } from '../../components/Layout';
import { useCatalog } from '../../components/VariantPicker';
import { Empty, Sheet, Spinner, StockBadge, Thumb, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';
import { npr } from '../../lib/format';
import type { Product, Variant } from '../../lib/types';

export function StockPage() {
  const { data, isLoading } = useCatalog();
  const [search, setSearch] = useState('');
  const [adjust, setAdjust] = useState<{ v: Variant; p: Product } | null>(null);
  const [newCat, setNewCat] = useState(false);
  const s = search.trim().toLowerCase();

  const categories = (data?.categories ?? []).map((c) => ({
    ...c,
    products: c.products.filter((p) => !s || `${c.name} ${p.name} ${p.variants.map((v) => v.color).join(' ')}`.toLowerCase().includes(s)),
  }));
  const totalUnits = categories.reduce((n, c) => n + c.products.reduce((m, p) => m + p.variants.reduce((k, v) => k + v.stock, 0), 0), 0);

  return (
    <>
      <TopBar title="Stock" actions={<HeaderActions />} />
      <main className="page">
        <div className="stack" style={{ margin: '12px 0' }}>
          <div className="search">
            <Icon name="search" size={20} />
            <input className="input" type="search" placeholder="Search products or colours" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="btn-row">
            <Link to="/stock/new" className="btn primary">
              <Icon name="plus" size={18} /> Product
            </Link>
            <button className="btn" onClick={() => setNewCat(true)}>
              <Icon name="plus" size={18} /> Category
            </button>
          </div>
          {!!data && <div className="small muted">{totalUnits} pieces in stock</div>}
        </div>
        {isLoading && <Spinner />}
        {!isLoading && !data?.categories.length && <Empty>Start by adding a category, e.g. “Sari”, then add products with their colours.</Empty>}
        {categories.map((c) => (
          <section key={c.id} className="section">
            <div className="section-title">
              <h2>{c.name}</h2>
              <Link className="small" to={`/stock/new?category=${c.id}`}>
                + Add {c.name.toLowerCase()}
              </Link>
            </div>
            {!c.products.length ? (
              <div className="small muted">No products yet.</div>
            ) : (
              <div className="stack">
                {c.products.map((p) => (
                  <div key={p.id} className="card tight">
                    <Link to={`/stock/${p.id}`} className="row between" style={{ color: 'inherit', marginBottom: 6 }}>
                      <span className="strong">{p.name}</span>
                      <span className="small muted">
                        Edit <Icon name="edit" size={14} />
                      </span>
                    </Link>
                    <div className="list" style={{ border: 0, boxShadow: 'none' }}>
                      {p.variants.map((v) => (
                        <button key={v.id} type="button" className="list-item" style={{ width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '8px 0', minHeight: 0 }} onClick={() => setAdjust({ v, p })}>
                          <Thumb src={v.photo} />
                          <div className="grow">
                            <div className="strong">{v.color}</div>
                            <div className="tiny muted num">
                              Sell {npr(v.price)} · Cost {npr(v.cost)}
                            </div>
                          </div>
                          <StockBadge stock={v.stock} />
                        </button>
                      ))}
                      {!p.variants.length && <div className="small muted">No colours yet – tap Edit to add.</div>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        ))}
      </main>
      {adjust && <AdjustSheet v={adjust.v} p={adjust.p} onClose={() => setAdjust(null)} />}
      {newCat && <CategorySheet onClose={() => setNewCat(false)} />}
    </>
  );
}

function AdjustSheet({ v, p, onClose }: { v: Variant; p: Product; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [count, setCount] = useState<number | ''>(v.stock);
  const [busy, setBusy] = useState(false);
  const save = async (body: object) => {
    setBusy(true);
    try {
      await api.post(`/api/catalog/variants/${v.id}/stock`, body);
      await qc.invalidateQueries({ queryKey: ['catalog'] });
      toast('Stock updated');
      onClose();
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet title={`${p.name} – ${v.color}`} onClose={onClose}>
      <div className="stack">
        <div className="row">
          <Thumb src={v.photo} size="lg" />
          <div>
            <div className="strong" style={{ fontSize: 22 }}>
              {v.stock} in stock
            </div>
            <div className="small muted">Sales reduce this automatically.</div>
          </div>
        </div>
        <div className="grid-3">
          {[1, 5, 10].map((n) => (
            <button key={n} className="btn" disabled={busy} onClick={() => save({ delta: n, reason: 'restock', note: 'Restocked' })}>
              +{n}
            </button>
          ))}
        </div>
        <label className="field">
          Set exact count (after counting)
          <input className="input num" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value === '' ? '' : Number(e.target.value.replace(/\D/g, '')))} />
        </label>
        <button className="btn primary block" disabled={busy || count === '' || count === v.stock} onClick={() => save({ set: count, reason: 'manual', note: 'Stock count' })}>
          Save count
        </button>
        <Link to={`/stock/${p.id}`} className="btn ghost block">
          Edit photo, price &amp; cost
        </Link>
      </div>
    </Sheet>
  );
}

function CategorySheet({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  return (
    <Sheet title="New category" onClose={onClose}>
      <form
        className="stack"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api.post('/api/catalog/categories', { name, voice_aliases: aliases });
            await qc.invalidateQueries({ queryKey: ['catalog'] });
            onClose();
          } catch (err) {
            toast((err as Error).message, true);
          }
        }}
      >
        <label className="field">
          Name (e.g. Sari, Kurta, Lehenga)
          <input className="input" autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          Voice words (optional, comma separated – e.g. साडी)
          <input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} />
        </label>
        <button className="btn primary block">Add category</button>
      </form>
    </Sheet>
  );
}
