import { useCallback, useEffect, useMemo, useState } from 'react';
import { RouterProvider } from '@tanstack/react-router';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { SessionProvider } from '@/contexts/SessionContext';
import { LoginPage } from '@/components/pages/login-page';
import { ApiProvider, createApiClient, useApi, type ApiClient } from '@/lib/api';
import {
  ActionFeedbackProvider,
  ActionFeedbackViewport,
  useActionFeedback,
} from '@/contexts/ActionFeedbackContext';
import { appRouter } from '@/router';

export default function App() {
  return (
    <ActionFeedbackProvider>
      <ThemeProvider>
        <ActionFeedbackViewport />
        <AuthBoundary />
      </ThemeProvider>
    </ActionFeedbackProvider>
  );
}

function AuthBoundary() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authed, setAuthed] = useState(false);
  const [status, setStatus] = useState('未连接');

  const client = useMemo<ApiClient>(
    () => createApiClient({
      onUnauthorized: () => { setAuthed(false); setStatus('未授权'); },
    }),
    [],
  );

  useEffect(() => {
    (async () => {
      const ok = await client.status();
      if (ok) { setAuthed(true); setStatus('已连接'); }
      setAuthChecked(true);
    })();
  }, [client]);

  const handleLoggedOut = useCallback(() => {
    window.history.replaceState({}, '', '/');
    setAuthed(false);
    setStatus('未连接');
  }, []);

  let view: React.ReactNode;
  if (!authChecked) {
    view = (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        初始化中…
      </div>
    );
  } else if (!authed) {
    view = (
      <LoginGate onAuthed={() => { setAuthed(true); setStatus('已连接'); }} />
    );
  } else {
    view = (
      <SessionProvider value={{ status, onLogoutComplete: handleLoggedOut, restartOnboarding: () => {} }}>
        <RouterProvider router={appRouter} />
      </SessionProvider>
    );
  }

  return (
    <ApiProvider client={client}>
      <TooltipProvider delayDuration={150}>{view}</TooltipProvider>
    </ApiProvider>
  );
}

function LoginGate({ onAuthed }: { onAuthed: () => void }) {
  const api = useApi();
  const { startAction, dismiss } = useActionFeedback();
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);

  useEffect(() => {
    fetch('/api/auth/has-password')
      .then(r => r.json())
      .then((d: { hasPassword: boolean }) => setHasPassword(d.hasPassword))
      .catch(() => setHasPassword(true));
  }, []);

  const handleLogin = useCallback(
    async (password: string) => {
      const handle = startAction({ title: '正在登录', detail: '正在验证密码' });
      const result = await api.login(password);
      if (result.ok) {
        handle.succeed({ title: '登录成功', detail: '正在进入控制台' });
        onAuthed();
        return { success: true };
      }
      const errMsg = 'message' in result ? result.message : '登录失败';
      handle.fail(errMsg, { title: '登录失败' });
      return { success: false, error: errMsg };
    },
    [api, dismiss, onAuthed, startAction],
  );

  if (hasPassword === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        加载中…
      </div>
    );
  }

  return (
    <LoginPage
      onLogin={handleLogin}
      isFirstTime={!hasPassword}
    />
  );
}
