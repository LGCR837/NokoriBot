import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { Outlet, useNavigate, useRouterState } from '@tanstack/react-router';
import { MainLayout } from '@/components/layout/main-layout';
import { NAV_ITEMS } from '@/components/layout/sidebar';
import { AppStateProvider, type AppResourceState } from '@/contexts/AppStateContext';
import { KioskProvider } from '@/contexts/KioskContext';
import { LayoutProvider, useLayout } from '@/contexts/LayoutContext';
import { useSession } from '@/contexts/SessionContext';
import { useApi } from '@/lib/api';
import type { AppPath } from '@/router';
import type { PluginInfo, NokoriBotStatusResponse } from '@/types';

function createInitialResources(): AppResourceState {
  return {
    plugins: { ready: false, error: null },
    status: { ready: false, error: null },
    qqList: { ready: false, error: null },
    processList: { ready: false, error: null },
    systemInfo: { ready: false, error: null },
    connections: { ready: false, error: null },
    updateInfo: { ready: false, error: null },
  };
}

type AppResourceKey = keyof AppResourceState;

function createResourceCounters(): Record<AppResourceKey, number> {
  return { plugins: 0, status: 0, qqList: 0, processList: 0, systemInfo: 0, connections: 0, updateInfo: 0 };
}

interface ResourceRequestTicket {
  generation: number;
}

function DefaultRouteRedirect() {
  const { pages, ready } = useLayout();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const target = pages.defaultRoute;
    if (target && target !== '/' && pathname === '/' && NAV_ITEMS.some((n) => n.to === target)) {
      void navigate({ to: target as AppPath });
    }
  }, [ready, pages.defaultRoute, pathname, navigate]);

  return null;
}

export function AppLayout() {
  const api = useApi();
  const session = useSession();

  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [status, setStatus] = useState<NokoriBotStatusResponse | null>(null);
  const [resources, setResources] = useState<AppResourceState>(createInitialResources);
  const requestGenerationRef = useRef(createResourceCounters());

  const settleResource = useCallback((resource: AppResourceKey, error: string | null) => {
    setResources(current => ({ ...current, [resource]: { ready: true, error } }));
  }, []);

  const beginResourceRequest = useCallback((resource: AppResourceKey): ResourceRequestTicket => ({
    generation: ++requestGenerationRef.current[resource],
  }), []);

  const isCurrentResourceRequest = useCallback((resource: AppResourceKey, ticket: ResourceRequestTicket): boolean => (
    requestGenerationRef.current[resource] === ticket.generation
  ), []);

  const refreshPlugins = useCallback(async () => {
    const ticket = beginResourceRequest('plugins');
    try {
      const next = await api.plugins.list();
      if (!isCurrentResourceRequest('plugins', ticket)) return;
      setPlugins(next);
      settleResource('plugins', null);
    } catch (e) {
      if (!isCurrentResourceRequest('plugins', ticket)) return;
      settleResource('plugins', e instanceof Error ? e.message : '加载插件列表失败');
    }
  }, [api, beginResourceRequest, isCurrentResourceRequest, settleResource]);

  const refreshStatus = useCallback(async () => {
    const ticket = beginResourceRequest('status');
    try {
      const next = await api.botStatus();
      if (!isCurrentResourceRequest('status', ticket)) return;
      setStatus(next);
      settleResource('status', null);
    } catch (e) {
      if (!isCurrentResourceRequest('status', ticket)) return;
      settleResource('status', e instanceof Error ? e.message : '加载状态失败');
    }
  }, [api, beginResourceRequest, isCurrentResourceRequest, settleResource]);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      if (cancelled || document.hidden) return;
      await Promise.all([refreshPlugins(), refreshStatus()]);
    };
    tick();
    const interval = setInterval(tick, 10_000);
    const onVisible = () => { if (!document.hidden) void tick(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refreshPlugins, refreshStatus]);

  const handleLogout = useCallback(async () => {
    for (const resource of Object.keys(requestGenerationRef.current) as AppResourceKey[]) {
      requestGenerationRef.current[resource] += 1;
    }
    await api.logout();
    setPlugins([]);
    setStatus(null);
    setResources(createInitialResources());
    session.onLogoutComplete();
  }, [api, session]);

  return (
    <AppStateProvider
      value={{
        plugins,
        status,
        resources,
        refreshPlugins,
        refreshStatus,
        onLogout: handleLogout,
        // SL-compat stubs
        qqList: [],
        processList: [],
        systemInfo: null,
        connections: [],
        updateInfo: null,
        selectedUin: null,
        setSelectedUin: () => {},
        refreshQqList: () => {},
        refreshProcesses: () => {},
        refreshSystem: () => {},
        refreshConnections: () => {},
        refreshUpdate: async () => null,
      }}
    >
      <LayoutProvider>
        <KioskProvider>
          <DefaultRouteRedirect />
          <MainLayout status={session.status} onLogout={handleLogout}>
            <Suspense fallback={<div className="flex items-center justify-center py-20 text-sm text-muted-foreground">加载中…</div>}>
              <Outlet />
            </Suspense>
          </MainLayout>
        </KioskProvider>
      </LayoutProvider>
    </AppStateProvider>
  );
}
