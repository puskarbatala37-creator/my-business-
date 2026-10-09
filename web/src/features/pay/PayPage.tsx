import { BrandMark } from '../../components/BrandMark';
import { useQuery } from '@tanstack/react-query';
import { useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { npr } from '../../lib/format';

interface PublicPay {
  provider: string;
  invoice_no: string;
  customer_first_name: string;
  amount: number;
  status: 'pending' | 'complete' | 'failed' | 'expired';
  checkout: { action: string; method: 'POST'; fields: Record<string, string> } | null;
}

/** Public page the customer opens from the payment link. Posts a signed form to eSewa. */
export function PayPage() {
  const { token } = useParams();
  const [params] = useSearchParams();
  const result = params.get('result');
  const formRef = useRef<HTMLFormElement>(null);
  const q = useQuery({ queryKey: ['pay', token], queryFn: () => api.get<PublicPay>(`/api/pay/${token}`), retry: false });
  const p = q.data;

  return (
    <div className="login-wrap">
      <div className="card stack center" style={{ width: '100%', maxWidth: 400, padding: 24 }}>
        <div className="brand"><BrandMark width={128} /></div>
        {q.isLoading && <Spinner />}
        {q.isError && <div>This payment link is not valid.</div>}
        {p && (
          <>
            <div className="muted">
              Hi {p.customer_first_name}, order {p.invoice_no}
            </div>
            <div style={{ fontSize: 32, fontWeight: 700 }}>{npr(p.amount)}</div>
            {p.status === 'complete' || result === 'success' ? (
              <div className="alert-banner info" style={{ justifyContent: 'center', background: 'var(--good-soft)', color: 'var(--good)' }}>
                ✓ Payment received – thank you!
              </div>
            ) : p.status === 'expired' ? (
              <div className="alert-banner warning">This link has expired. Please ask us for a new one.</div>
            ) : (
              <>
                {result === 'failed' && <div className="alert-banner">The payment did not go through. You can try again.</div>}
                {result === 'pending' && <div className="alert-banner warning">We are confirming your payment with eSewa. This page will update shortly.</div>}
                {p.checkout && (
                  <form ref={formRef} method="POST" action={p.checkout.action}>
                    {Object.entries(p.checkout.fields).map(([k, v]) => (
                      <input key={k} type="hidden" name={k} value={v} />
                    ))}
                    <button className="btn block" style={{ background: '#60bb46', borderColor: '#60bb46', color: '#fff', minHeight: 54, fontSize: 17 }}>
                      Pay with eSewa
                    </button>
                  </form>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
