import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Icon } from '../../components/Icon';
import { useCatalog } from '../../components/VariantPicker';
import { Loading, MoneyInput, PhotoInput, Spinner, StockBadge, TopBar, useToast } from '../../components/ui';
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
  const [categoryId, setCategoryId] = useState<number | 'new' | ''>(Number(params.get('category')) || '');
  const [newCategory, setNewCategory] = useState('');
  /** New products: the total number of pieces counted, split across the colours. */
  const [totalStock, setTotalStock] = useState<number | ''>('');
  const [name, setName] = useState('');
  const [sizes, setSizes] = useState('');
  const [description, setDescription] = useState('');
  const [aliases, setAliases] = useState('');
  const [variants, setVariants] = useState<VariantForm[]>([blankVariant()]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
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

  const shown = variants.filter((v) => !v.archived);
  const splitting = !editing && shown.length > 1;
  const assigned = shown.reduce((n, v) => n + (Number(v.stock) || 0), 0);
  const left = (Number(totalStock) || 0) - assigned;

  /** Shares the total as evenly as possible; the first colours get any remainder. */
  function splitEvenly() {
    const total = Number(totalStock) || 0;
    const base = Math.floor(total / shown.length);
    let extra = total % shown.length;
    const counts = new Map(shown.map((v) => [v.key, base + (extra-- > 0 ? 1 : 0)]));
    setVariants((vs) => vs.map((v) => (counts.has(v.key) ? { ...v, stock: counts.get(v.key)! } : v)));
  }

  async function save() {
    if (!categoryId || (categoryId === 'new' && !newCategory.trim())) return toast(categoryId === 'new' ? 'Type the new category name' : 'Choose a category', true);
    if (!name.trim()) return toast('Enter a product name', true);
    const live = variants.filter((v) => !v.archived && (v.id || v.color.trim()));
    if (!editing && !live.length) return toast('Add at least one colour', true);
    if (live.some((v) => !v.color.trim())) return toast('Every colour needs a name', true);
    if (!editing && totalStock === '') return toast('Enter the total pieces in stock (0 if none yet)', true);
    if (splitting && left !== 0)
      return toast(left > 0 ? `${left} piece${left === 1 ? '' : 's'} still to assign to a colour` : `The colours add up to ${-left} more than the total`, true);
    setSaving(true);
    const variantBody = (v: VariantForm) => ({ color: v.color.trim(), cost: Number(v.cost) || 0, price: Number(v.price) || 0, photo: v.photo, voice_aliases: v.voice_aliases });
    try {
      if (!editing) {
        const r = await api.post<{ id: number }>('/api/catalog/products', {
          ...(categoryId === 'new' ? { new_category: newCategory.trim() } : { category_id: categoryId }),
          name,
          sizes,
          description,
          voice_aliases: aliases,
          total_stock: Number(totalStock),
          // One colour: the server gives it the whole total.
          variants: live.map((v) => ({ ...variantBody(v), ...(live.length > 1 ? { stock: Number(v.stock) || 0 } : {}) })),
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

  const missing = !!data && editing && !loaded && !data.categories.some((c) => c.products.some((x) => x.id === Number(id)));
  if (missing) return <Loading error={{ code: 'missing' }} what="product" />;
  if (!data || !loaded) return <Spinner />;

  return (
    <>
      <TopBar title={editing ? 'Edit product' : 'New product'} back="/stock" />
      <main className="page stack" style={{ paddingTop: 12, paddingBottom: 90 }}>
        <section className="card stack">
          <div className="field" role="radiogroup" aria-labelledby="category-label">
            <span id="category-label">Category</span>
            <div className="chips" style={{ flexWrap: 'wrap' }}>
              {data.categories.map((c) => (
                <button type="button" key={c.id} role="radio" aria-checked={categoryId === c.id} className={`chip ${categoryId === c.id ? 'on' : ''}`} onClick={() => setCategoryId(c.id)}>
                  {c.name}
                </button>
              ))}
              {!editing && (
                <button type="button" role="radio" aria-checked={categoryId === 'new'} className={`chip ${categoryId === 'new' ? 'on' : ''}`} onClick={() => setCategoryId('new')}>
                  + New category
                </button>
              )}
            </div>
          </div>
          {categoryId === 'new' && (
            <label className="field">
              New category name
              <input className="input" autoFocus value={newCategory} onChange={(e) => setNewCategory(e.target.value)} placeholder="e.g. Shawl, Dupatta, Gown" maxLength={80} />
              <span className="tiny muted">It's added to your categories when you save, ready for future products.</span>
            </label>
          )}
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

        {!editing && (
          <section className="card stack">
            <label className="field">
              Total pieces in stock
              <input
                className="input num"
                inputMode="numeric"
                placeholder="e.g. 12"
                style={{ fontSize: 22, fontWeight: 700 }}
                value={totalStock}
                onChange={(e) => setTotalStock(e.target.value === '' ? '' : Math.min(100000, Number(e.target.value.replace(/\D/g, ''))))}
              />
            </label>
            <div className="tiny muted">
              {shown.length > 1 ? 'Split this total across the colours below.' : 'All of them are in the colour below. Add more colours to split the total.'}
            </div>
          </section>
        )}

        <div className="section-title" style={{ marginTop: 8 }}>
          <h2>Colours</h2>
          {editing && (
            <span className="small muted num">
              {shown.filter((v) => v.id).reduce((n, v) => n + (v.currentStock ?? 0), 0)} pieces in stock
            </span>
          )}
        </div>
        {splitting && totalStock !== '' && (
          <div className={`alert-banner ${left === 0 ? 'info' : 'warning'}`} role="status" style={left === 0 ? { background: 'var(--good-soft)', color: 'var(--good)' } : undefined}>
            <div className="grow">
              {left === 0
                ? `All ${totalStock} pieces assigned to colours.`
                : left > 0
                  ? `Assigned ${assigned} of ${totalStock} – ${left} still to assign.`
                  : `Assigned ${assigned}, which is ${-left} more than the total of ${totalStock}.`}
            </div>
            {left !== 0 && (
              <button type="button" className="btn sm" onClick={splitEvenly}>
                Split evenly
              </button>
            )}
          </div>
        )}
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
                  ) : !editing && !splitting ? (
                    <div className="small muted">{totalStock === '' ? 'Gets the total pieces above' : `All ${totalStock} pieces`}</div>
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
