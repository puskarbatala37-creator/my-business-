import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Profile, User } from './types';

interface Me {
  user: Profile;
  team: User[];
  /** Whether text messages (recovery codes) can be sent. */
  smsReady: boolean;
}

const AuthCtx = createContext<{ me: Me | null; loading: boolean; refresh: () => void }>({ me: null, loading: true, refresh: () => {} });
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: Infinity,
    retry: 1,
  });
  useEffect(() => {
    const onOut = () => qc.setQueryData(['me'], null);
    window.addEventListener('slay:unauthenticated', onOut);
    return () => window.removeEventListener('slay:unauthenticated', onOut);
  }, [qc]);
  return <AuthCtx.Provider value={{ me: q.data ?? null, loading: q.isLoading, refresh: () => q.refetch() }}>{children}</AuthCtx.Provider>;
}
