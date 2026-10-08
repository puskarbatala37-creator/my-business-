import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { Spinner } from './components/ui';
import { LoginPage } from './features/auth/LoginPage';
import { CustomerPage, CustomersPage } from './features/customers/CustomersPage';
import { DashboardPage } from './features/dashboard/DashboardPage';
import { MorePage } from './features/more/MorePage';
import { SecurityPage } from './features/more/SecurityPage';
import { InvoicePage } from './features/orders/InvoicePage';
import { OrderDetailPage } from './features/orders/OrderDetailPage';
import { OrderFormPage } from './features/orders/OrderFormPage';
import { OrdersPage } from './features/orders/OrdersPage';
import { PayPage } from './features/pay/PayPage';
import { ReceiptsPage } from './features/receipts/ReceiptsPage';
import { ProductFormPage } from './features/stock/ProductFormPage';
import { StockPage } from './features/stock/StockPage';
import { useAuth } from './lib/auth';

/**
 * Screens of the app. A new feature = a folder in src/features + a route here
 * (and usually a link on the More screen).
 */
export function App() {
  const { me, loading } = useAuth();
  const loc = useLocation();

  if (loc.pathname.startsWith('/pay/')) {
    return (
      <Routes>
        <Route path="/pay/:token" element={<PayPage />} />
      </Routes>
    );
  }
  if (loading) return <Spinner />;
  if (!me) return <LoginPage />;

  return (
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
