import { createContext, useContext, type ReactNode } from 'react';
import type {
  AccountConnections,
  HookProcessInfo,
  PluginInfo,
  QQInfo,
  SystemInfo,
  NokoriBotStatusResponse,
  UpdateInfo,
} from '@/types';

export interface ResourceLoadState {
  ready: boolean;
  error: string | null;
}

export interface AppResourceState {
  plugins: ResourceLoadState;
  status: ResourceLoadState;
  qqList: ResourceLoadState;
  processList: ResourceLoadState;
  systemInfo: ResourceLoadState;
  connections: ResourceLoadState;
  updateInfo: ResourceLoadState;
}

export interface AppStateValue {
  plugins: PluginInfo[];
  status: NokoriBotStatusResponse | null;
  resources: AppResourceState;
  refreshPlugins: () => void;
  refreshStatus: () => void;
  onLogout: () => void;

  // SL-compat stubs for pages that still reference old types
  qqList: QQInfo[];
  processList: HookProcessInfo[];
  systemInfo: SystemInfo | null;
  connections: AccountConnections[];
  updateInfo: UpdateInfo | null;
  selectedUin: string | null;
  setSelectedUin: (uin: string | null) => void;
  refreshQqList: () => void;
  refreshProcesses: () => void;
  refreshSystem: () => void;
  refreshConnections: () => void;
  refreshUpdate: (force?: boolean) => Promise<UpdateInfo | null>;
}

const AppStateContext = createContext<AppStateValue | null>(null);

export function AppStateProvider({
  value,
  children,
}: {
  value: AppStateValue;
  children: ReactNode;
}) {
  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateValue {
  const v = useContext(AppStateContext);
  if (!v) throw new Error('useAppState must be used inside <AppStateProvider>');
  return v;
}
