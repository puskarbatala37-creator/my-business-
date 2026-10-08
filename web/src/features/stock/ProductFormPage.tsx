import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useCatalog } from '../../components/VariantPicker';
import { MoneyInput, PhotoInput, Spinner, StockBadge, TopBar, useToast } from '../../components/ui';
import { api } from '../../lib/api';

interface VariantForm {
  key: string;
  id?: number;
  color: string;
  stock: number | '';
  cost: number | '';
  price: number | '';
  photo: string | null;
  voice_aliases: string;
  archived?: boolean;
  currentStock?: number;
}

const blankVariant = (price: number | '' = '', cost: number | '' = ''): VariantForm => ({ key: Math.random().toString(36).slice(2), color: '', stock: '', cost, price, photo: null, voice_aliases: '' });

export function ProductFormPage() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const editing = !!id;
  const nav = useNavigate();
  const qc = useQueryClient();
  const toast = useToast();
  const { data } = useCatalog();
  const [loaded, setLoaded] = useState(!editing);
  const [categoryId, setCategoryId] = useState<number | ''>(Number(params.get('category')) || '');
  const [name, setName] = useState('');
  const [sizes, setSizes] = useState('');
  const [description, setDescription] = useState('');
  const [aliases, setAliases] = useState('');
  const [variants, setVariants] = useState<VariantForm[]>([blankVariant()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    if (!categoryId && data.categories.length === 1) setCategoryId(data.categories[0].id);
    if (editing && !loaded) {
      const p = data.categories.flatMap((c) => c.products).find((x) => x.id === Number(id));
      if (!p) return;
      setCategoryId(p.category_id);
      setName(p.name);
      setSizes(p.sizes);
      setDescription(p.description);
      setAliases(p.voice_aliases);
      setVariants(p.variants.map((v) => ({ key: String(v.id), id: v.id, color: v.color, stock: v.stock, currentStock: v.stock, cost: v.cost, price: v.price, photo: v.photo, voice_aliases: v.voice_aliases })));
      setLoaded(true);
    }
  }, [data, editing, loaded, id, categoryId]);

  const setV = (key: string, patch: Partial<VariantForm>) => setVariants((vs) => vs.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  async function save() {
    if (!categoryId) return toast('Choose a category', true);
    if (!name.trim()) return toast('Enter a product name', true);
    const live = variants.filter((v) => !v.archived && (v.id || v.color.trim()));
    if (live.some((v) => !v.color.trim())) return toast('Every colour needs a name', true);
    setSaving(true);
    const variantBody = (v: VariantForm) => ({ color: v.color.trim(), cost: Number(v.cost) || 0, price: Number(v.price) || 0, photo: v.photo, voice_aliases: v.voice_aliases });
    try {
      if (!editing) {
        const r = await api.post<{ id: number }>('/api/catalog/products', {
          category_id: categoryId,
          name,
          sizes,
          description,
          voice_aliases: aliases,
          variants: live.map((v) => ({ ...variantBody(v), stock: Number(v.stock) || 0 })),
        });
        toast('Product added');
        nav(`/stock`, { replace: true, state: { highlight: r.id } });
      } else {
        await api.patch(`/api/catalog/products/${id}`, { category_id: categoryId, name, sizes, description, voice_aliases: aliases });
        for (const v of variants) {
          if (v.id) await api.patch(`/api/catalog/variants/${v.id}`, { ...variantBody(v), archived: !!v.archived });
          else if (v.color.trim() && !v.archived) await api.post(`/api/catalog/products/${id}/variants`, { ...variantBody(v), stock: Number(v.stock) || 0 });
        }
        toast('Saved');
        nav('/stock', { replace: true });
      }
      qc.invalidateQueries({ queryKey: ['catalog'] });
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setSaving(false);
    }
  }

  if (!data || !loaded) return <Spinner />;

  return (
    <>
      <TopBar title={editing ? 'Edit product' : 'New product'} back="/stock" />
      <main className="page stack" style={{ paddingTop: 12, paddingBottom: 90 }}>
        <section className="card stack">
          <label className="field">
            Category
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(Number(e.target.value))}>
              <option value="">Choose…</option>
              {data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Product / design name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Banarasi Silk" />
          </label>
          <label className="field">
            Sizes (comma separated, optional)
            <input className="input" value={sizes} onChange={(e) => setSizes(e.target.value)} placeholder="e.g. S, M, L, XL or Free" />
          </label>
          <label className="field">
            Voice words (optional – how you say it, e.g. बनारसी)
            <input className="input" value={aliases} onChange={(e) => setAliases(e.target.value)} />
          </label>
          <label className="field">
            Description (optional)
            <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </label>
        </section>

        <div className="section-title" style={{ marginTop: 8 }}>
          <h2>Colours</h2>
        </div>
        {variants.map((v) =>
          v.archived ? (
            <div key={v.key} className="card tight row between small muted">
              <span>{v.color} – hidden</span>
              <button className="btn sm" onClick={() => setV(v.key, { archived: false })}>
                Undo
              </button>
            </div>
          ) : (
            <section key={v.key} className="card stack">
              <div className="row" style={{ alignItems: 'flex-start' }}>
                <PhotoInput value={v.photo} onChange={(p) => setV(v.key, { photo: p })} width={96} height={96} label="Photo" />
                <div className="grow stack" style={{ gap: 8 }}>
                  <label className="field">
                    Colour
                    <input className="input" value={v.color} onChange={(e) => setV(v.key, { color: e.target.value })} placeholder="e.g. Red" />
                  </label>
                  {v.id ? (
                    <div className="row between">
                      <StockBadge stock={v.currentStock ?? 0} />
                      <span className="tiny muted">Change stock from the Stock list</span>
                    </div>
                  ) : (
                    <label className="field">
                      Pieces in stock
                      <input className="input num" inputMode="numeric" value={v.stock} onChange={(e) => setV(v.key, { stock: e.target.value === '' ? '' : Number(e.target.value.replace(/\D/g, '')) })} />
                    </label>
                  )}
                </div>
              </div>
              <div className="grid-2">
                <label className="field">
                  Selling price
                  <MoneyInput value={v.price} onChange={(n) => setV(v.key, { price: n })} />
                </label>
                <label className="field">
                  Cost (to make / buy)
                  <MoneyInput value={v.cost} onChange={(n) => setV(v.key, { cost: n })} />
                </label>
              </div>
              <label className="field">
                Voice words for this colour (optional)
                <input className="input" value={v.voice_aliases} onChange={(e) => setV(v.key, { voice_aliases: e.target.value })} placeholder="e.g. रानी रङ" />
              </label>
              <button
                className="btn ghost sm danger"
                onClick={() => (v.id ? setV(v.key, { archived: true }) : setVariants((vs) => vs.filter((x) => x.key !== v.key)))}
              >
                {v.id ? 'Hide this colour' : 'Remove'}
              </button>
            </section>
          ),
        )}
        <button className="btn block" onClick={() => setVariants((vs) => [...vs, blankVariant(vs[vs.length - 1]?.price ?? '', vs[vs.length - 1]?.cost ?? '')])}>
          <Icon name="plus" size={18} /> Add colour
        </button>
        <div style={{ position: 'sticky', bottom: 'calc(var(--nav-h) + env(safe-area-inset-bottom) + 8px)' }}>
          <button className="btn primary block" onClick={save} disabled={saving} style={{ minHeight: 52 }}>
            {saving ? 'Saving…' : 'Save product'}
          </button>
        </div>
      </main>
    </>
  );
}
