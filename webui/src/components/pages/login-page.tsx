import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, KeyRound, Sparkles } from 'lucide-react';
import { Modal } from '@/components/interior/modal';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { PasswordVisibilityIcon } from '@/components/ui/password-visibility-icon';
import { ThemeToggle } from '@/components/theme-toggle';
import { LoginWaves } from '@/components/login-waves';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/lib/utils';
import { APP_NAME, APP_VERSION } from '@/types';

interface LoginPageProps {
  onLogin: (password: string) => Promise<{ success: boolean; error?: string }>;
  isFirstTime?: boolean;
}

const LOGIN_FX_KEY = 'nokoribot_login_fx';
function readLoginFx(): boolean {
  try {
    const v = localStorage.getItem(LOGIN_FX_KEY);
    if (v === '0') return false;
    if (v === '1') return true;
  } catch { /* ignore */ }
  try { return !window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return true; }
}

export function LoginPage({ onLogin, isFirstTime = false }: LoginPageProps) {
  const { appearance } = useTheme();
  const customBg = appearance.background.type !== 'none';
  const reduce = appearance.reduceMotion || appearance.disableMotion;

  useEffect(() => { document.getElementById('snowluma-custom-css')?.remove(); }, []);

  const [password, setPassword] = useState('');
  const [showPwd, setShowPwd] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [shake, setShake] = useState(0);
  const [fxOn, setFxOn] = useState(readLoginFx);
  const [helpOpen, setHelpOpen] = useState(false);

  const toggleFx = (v: boolean) => {
    setFxOn(v);
    try { localStorage.setItem(LOGIN_FX_KEY, v ? '1' : '0'); } catch { /* ignore */ }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const result = await onLogin(password);
    setLoading(false);
    if (!result.success) {
      setError(result.error || '登录失败');
      setShake((k) => k + 1);
    }
  };

  const subtitle = isFirstTime
    ? '首次访问，请设置管理密码'
    : 'NokoriBot 控制台 · 安全登录';

  const buttonText = isFirstTime ? '设置密码并进入' : '进入控制台';

  return (
    <LoginShell customBg={customBg} reduce={reduce} fxOn={fxOn} helpOpen={helpOpen} onHelpOpen={setHelpOpen} onToggleFx={toggleFx}>
      <LoginBrand subtitle={subtitle} />
      <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3.5">
        <motion.div
          key={shake}
          animate={shake > 0 ? { x: [0, -8, 8, -6, 6, -3, 3, 0] } : {}}
          transition={{ duration: 0.4 }}
          className="relative"
        >
          <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type={showPwd ? 'text' : 'password'}
            placeholder={isFirstTime ? '设置管理密码' : '输入访问密码'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
            autoComplete="current-password"
            className="h-12 rounded-xl bg-background/40 pl-10 pr-11 text-sm"
          />
          <button
            type="button"
            onClick={() => setShowPwd((v) => !v)}
            className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground cursor-pointer"
            tabIndex={-1}
            aria-label={showPwd ? '隐藏密码' : '显示密码'}
          >
            <PasswordVisibilityIcon visible={showPwd} reduceMotion={reduce} />
          </button>
        </motion.div>

        {error && (
          <motion.p
            initial={reduce ? false : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-lg bg-destructive/10 px-3 py-2 text-center text-xs text-destructive"
          >
            {error}
          </motion.p>
        )}

        <Button type="submit" disabled={loading || !password} className="h-12 rounded-xl text-[15px]">
          {loading ? '验证中…' : (
            <>
              {buttonText} <ArrowRight className="optical-forward size-4" />
            </>
          )}
        </Button>
      </form>
    </LoginShell>
  );
}

function LoginBrand({ subtitle }: { subtitle: string }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 shadow-sm ring-1 ring-primary/20">
        <img src="/logo.png" alt="NokoriBot" className="size-10 object-contain" />
      </div>
      <div>
        <div className="flex items-center justify-center gap-2">
          <span className="text-2xl font-semibold tracking-tight">{APP_NAME}</span>
          <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-mono text-micro text-primary tabular-nums">v{APP_VERSION}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  );
}

function LoginShell({
  customBg,
  reduce,
  fxOn,
  helpOpen,
  onHelpOpen,
  onToggleFx,
  children,
}: {
  customBg: boolean;
  reduce: boolean;
  fxOn: boolean;
  helpOpen: boolean;
  onHelpOpen: (open: boolean) => void;
  onToggleFx: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div className={cn('relative flex min-h-screen items-center justify-center overflow-hidden px-4 py-8', customBg ? 'bg-transparent' : 'bg-background')}>
      {fxOn && <LoginWaves />}

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(75% 55% at 50% 0%, color-mix(in oklab, var(--primary) 20%, transparent) 0%, transparent 68%)',
        }}
      />

      <div className="absolute right-4 top-4 z-20">
        <ThemeToggle />
      </div>

      <motion.div
        initial={reduce ? false : { opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={reduce ? { duration: 0 } : { duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 flex w-full max-w-md flex-col items-center"
      >
        <Card className="w-full overflow-hidden border-border/50 bg-card/75 shadow-2xl shadow-primary/5 backdrop-blur-2xl supports-[backdrop-filter]:bg-card/65">
          <CardContent className="px-7 py-9 sm:px-10">
            {children}
            <p className="mt-7 text-center text-meta text-muted-foreground">
              © {new Date().getFullYear()} NokoriBot
            </p>
          </CardContent>
        </Card>

        <motion.button
          type="button"
          onClick={() => onHelpOpen(true)}
          whileHover={reduce ? undefined : { scale: 1.04 }}
          whileTap={reduce ? undefined : { scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 420, damping: 26 }}
          className="mt-5 inline-flex items-center gap-2 rounded-full border border-border/50 bg-background/45 px-4 py-2 text-[12px] font-medium text-muted-foreground shadow-lg shadow-black/5 backdrop-blur-xl transition-colors hover:text-foreground supports-[backdrop-filter]:bg-background/35 cursor-pointer outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          <Sparkles className="size-3.5 text-primary" />
          界面卡顿？关闭动态背景
        </motion.button>
      </motion.div>

      <Modal
        open={helpOpen}
        onClose={() => onHelpOpen(false)}
        title="界面有点卡顿？"
        description="登录页背景是一个跟随鼠标的动态线条效果，在部分设备上可能比较吃性能。可以在这里关掉它——该开关仅作用于本设备的登录页，与系统的动效设置相互独立。"
        closeLabel="关闭性能设置弹窗"
        maxWidth={384}
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-4 rounded-xl border bg-muted/30 px-4 py-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">登录页动态背景</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{fxOn ? '已开启 · 关闭后背景为静态' : '已关闭 · 背景为静态'}</p>
            </div>
            <ToggleSwitch value={fxOn} onChange={onToggleFx} ariaLabel="登录页动态背景" />
          </div>

          <p className="text-xs leading-relaxed text-muted-foreground">
            登录后，你还可以在「系统设置 → 无障碍」里进一步「减弱动效」或「关闭全部动效」。
          </p>
        </div>
      </Modal>
    </div>
  );
}
