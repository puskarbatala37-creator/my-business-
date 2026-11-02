import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../lib/api';
import { npr } from '../lib/format';
import type { Category, Product, Variant } from '../lib/types';
import { Icon } from './Icon';
import { openPhoto } from './PhotoViewer';
import { Empty, SafeImg, Sheet, Spinner, useToast } from './ui';

export interface PickedVariant {
  variant: Variant;
  product: Product;
  category: Category;
}

export function useCatalog() {
  return useQuery({ queryKey: ['catalog'], queryFn: () => api.get<{ categories: Category[] }>('/api/catalog') });
}

/** Flattens the catalog tree into a lookup by variant id. */
export function useVariantIndex() {
  const q = useCatalog();
  const index = useMemo(() => {
    const m = new Map<number, PickedVariant>();
    for (const category of q.data?.categories ?? []) for (const product of category.products) for (const variant of product.variants) m.set(variant.id, { variant, product, category });
    return m;
  }, [q.data]);
  return { ...q, index };
}

/**
 * Bottom sheet to pick a product colour. Shows live stock; out-of-stock colours
 * can't be picked (stock updates instantly when a teammate sells).
 */
export function VariantPicker({
  onPick,
  onClose,
  only,
  title = 'Add item',
  reserved = {},
}: {
  onPick: (p: PickedVariant) => void;
  onClose: () => void;
  /** Restrict to these variant ids (e.g. voice matches). */
  only?: number[];
  title?: string;
  /** Units of a variant already on this order (edit mode) – they count as available. */
  reserved?: Record<number, number>;
}) {
  const { data, isLoading } = useCatalog();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<number | 'all'>('all');
  const s = search.trim().toLowerCase();

  const groups = (data?.categories ?? [])
    .filter((c) => cat === 'all' || c.id === cat)
    .flatMap((c) =>
      c.products.map((p) => ({
        category: c,
        product: p,
        variants: p.variants.filter(
          (v) =>
            (!only || only.includes(v.id)) &&
            (!s || `${c.name} ${p.name} ${v.color} ${v.sku ?? ''} ${v.voice_aliases} ${p.voice_aliases}`.toLowerCase().includes(s)),
        ),
      })),
    )
    .filter((g) => g.variants.length);

  return (
    <Sheet title={title} onClose={onClose}>
      <div className="stack">
        {!only && (
          <>
            <div className="search">
              <Icon name="search" size={20} />
              <input className="input" type="search" placeholder="Search product or colour" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="chips">
              <button className={`chip ${cat === 'all' ? 'on' : ''}`} onClick={() => setCat('all')}>
                All
              </button>
              {data?.categories.map((c) => (
                <button key={c.id} className={`chip ${cat === c.id ? 'on' : ''}`} onClick={() => setCat(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          </>
        )}
        {isLoading && <Spinner />}
        {!isLoading && !groups.length && <Empty>No matching products. Add products under Stock.</Empty>}
        {groups.map((g) => (
          <div key={g.product.id}>
            <div className="small strong" style={{ margin: '4px 0 6px' }}>
              {g.product.name} <span className="muted">· {g.category.name}</span>
            </div>
            <div className="variant-grid">
              {g.variants.map((v) => {
                const available = v.stock + (reserved[v.id] ?? 0);
                const out = available <= 0;
                return (
                  <button
                    key={v.id}
                    type="button"
                    className={`variant-tile ${out ? 'out' : ''}`}
                    aria-disabled={out || undefined}
                    aria-label={`${v.color} – ${out ? 'out of stock' : `${available} left, ${npr(v.price)}`}`}
                    onClick={() => {
                      // Out of stock: say so, instead of a tap that seems to do nothing.
                      if (out) return toast(`${g.product.name} – ${v.color} is out of stock. Add stock under Stock first (tap the colour → +1).`, true);
                      try {
                        onPick({ variant: v, product: g.product, category: g.category });
                      } catch (e) {
                        toast(`Couldn’t add ${g.product.name} – ${v.color}: ${(e as Error).message}`, true);
                      }
                    }}
                  >
                    <div className="ph">
                      {v.photo ? <SafeImg src={v.photo} iconSize={24} /> : <Icon name="image" />}
                      {v.photo && (
                        // Tapping the tile picks the colour; this small button only shows the photo large.
                        <span
                          role="button"
                          tabIndex={0}
                          className="zoom-badge"
                          aria-label={`View ${g.product.name} ${v.color} photo larger`}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            openPhoto(v.photo!, `${g.product.name} – ${v.color}`);
                          }}
                        />
                      )}
                    </div>
                    <div className="small strong ellipsis">{v.color}</div>
                    <div className="tiny muted">{out ? 'Out of stock' : `${available} left · ${npr(v.price)}`}</div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Sheet>
  );
}
