import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { InstallPrompt } from './components/InstallPrompt';
import { OfflineBar } from './components/OfflineBar';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { CompleteAccountPage } from './features/auth/CompleteAccountPage';
import { LoginPage } from './features/auth/LoginPage';
import { CustomerPage, CustomersPage } from './features/customers/CustomersPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { MorePage } from './features/more/MorePage';
import { SecurityPage } from './features/more/SecurityPage';
import { TeamPage } from './features/more/TeamPage';
import { InvoicePage } from './features/orders/InvoicePage';
import { OrderDetailPage } from './features/orders/OrderDetailPage';
import { OrderFormPage } from './features/orders/OrderFormPage';
import { OrdersPage } from './features/orders/OrdersPage';
import { PayPage } from './features/pay/PayPage';
import { ReceiptsPage } from './features/receipts/ReceiptsPage';
import { ProductFormPage } from './features/stock/ProductFormPage';
import { StockPage } from './features/stock/StockPage';
import { useAuth } from './lib/auth';
import { hideSplash } from './lib/pwa';

/**
 * Screens of the app. A new feature = a folder in src/features + a route here
 * (and usually a link on the More screen).
 */
export function App() {
  const { me, loading } = useAuth();
  const loc = useLocation();
  const isPay = loc.pathname.startsWith('/pay/');
  // The launch screen stays up until the first real screen is ready – no blank flash.
  useEffect(() => {
    if (!loading || isPay) requestAnimationFrame(() => hideSplash());
  }, [loading, isPay]);

  if (isPay) {
    return (
      <Routes>
        <Route path="/pay/:token" element={<PayPage />} />
      </Routes>
    );
  }
  if (loading) return <Spinner />;
  if (!me)
    return (
      <>
        <OfflineBar floating />
        <LoginPage />
        <InstallPrompt />
      </>
    );
  if (me.user.missing.length) return <CompleteAccountPage profile={me.user} />;

  return (
    <>
    <InstallPrompt />
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="orders" element={<OrdersPage />} />
        <Route path="orders/new" element={<OrderFormPage />} />
        <Route path="orders/:id" element={<OrderDetailPage />} />
        <Route path="orders/:id/edit" element={<OrderFormPage />} />
        <Route path="orders/:id/invoice" element={<InvoicePage />} />
        <Route path="stock" element={<StockPage />} />
        <Route path="stock/new" element={<ProductFormPage />} />
        <Route path="stock/:id" element={<ProductFormPage />} />
        <Route path="customers" element={<CustomersPage />} />
        <Route path="customers/:id" element={<CustomerPage />} />
        <Route path="receipts" element={<ReceiptsPage />} />
        <Route path="more" element={<MorePage />} />
        <Route path="more/security" element={<SecurityPage />} />
        <Route path="more/team" element={<TeamPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </>
  );
}
