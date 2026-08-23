import { useCallback, useEffect, useState } from 'react';
import { Loader2, Power, PowerOff, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { useApi } from '@/lib/api';
import { useActionFeedback } from '@/contexts/ActionFeedbackContext';

interface BotConfig {
  backendOrigin: string;
  mediaOrigin: string;
  deviceId: string;
  logLevel: string;
  webuiPort: number;
  webuiHost: string;
}

export function ConfigPage() {
  const api = useApi();
  const feedback = useActionFeedback();
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<'restart' | 'stop' | 'relogin' | null>(null);
  const { runAction } = useActionFeedback();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.config.get();
      setConfig(data as unknown as BotConfig);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载配置失败');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    try {
      await api.config.save(config);
      feedback.success({ title: '配置已保存', description: '重启后端以使部分配置生效' });
    } catch (e) {
      feedback.error({ title: '保存失败', description: e instanceof Error ? e.message : '未知错误' });
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof BotConfig, value: string | number) => {
    if (!config) return;
    setConfig({ ...config, [key]: value });
  };

  const handleRestart = async () => {
    await runAction(
      { title: '正在重启 Bot…', successTitle: 'Bot 已重启', errorTitle: '重启失败' },
      () => api.bot.restart(),
    );
    setConfirmAction(null);
  };

  const handleStop = async () => {
    await runAction(
      { title: '正在关闭 Bot…', successTitle: 'Bot 已关闭', errorTitle: '关闭失败' },
      () => api.bot.stop(),
    );
    setConfirmAction(null);
  };

  const handleRelogin = async () => {
    await runAction(
      { title: '正在重新登录…', successTitle: '已重新登录', errorTitle: '重新登录失败' },
      () => api.bot.login(),
    );
    setConfirmAction(null);
  };

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">NokoriBot 配置</h1>
          <p className="text-sm text-muted-foreground">修改后需要重启后端才能生效</p>
        </div>
        <Button onClick={handleSave} disabled={saving || !config}>
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
          保存配置
        </Button>
      </div>

      <div className="flex gap-3">
        <Button variant="outline" size="sm" onClick={() => setConfirmAction('relogin')}>
          <RefreshCw className="size-4" />
          重新登录
        </Button>
        <Button variant="outline" size="sm" onClick={() => setConfirmAction('restart')}>
          <Power className="size-4" />
          重启 Bot
        </Button>
        <Button variant="destructive" size="sm" onClick={() => setConfirmAction('stop')}>
          <PowerOff className="size-4" />
          关闭 Bot
        </Button>
      </div>

      <ConfirmDialog
        open={confirmAction === 'relogin'}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="重新登录？"
        description="将断开当前连接并重新登录账号"
        confirmText="重新登录"
        onConfirm={handleRelogin}
      />
      <ConfirmDialog
        open={confirmAction === 'restart'}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="重启 Bot？"
        description="将断开并重新启动 Bot 进程"
        confirmText="重启"
        onConfirm={handleRestart}
      />
      <ConfirmDialog
        open={confirmAction === 'stop'}
        onOpenChange={(o) => !o && setConfirmAction(null)}
        title="关闭 Bot？"
        description="将停止 Bot 进程，需要手动重新启动"
        confirmText="关闭"
        destructive
        onConfirm={handleStop}
      />

      {loading ? (
        <Card>
          <CardContent className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            配置加载中…
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-8 text-center text-destructive">{error}</CardContent>
        </Card>
      ) : config ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>后端连接</CardTitle>
                <CardDescription>NokoriBot 后端 API 地址</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>后端地址 (backendOrigin)</Label>
                  <Input
                    value={config.backendOrigin}
                    onChange={(e) => update('backendOrigin', e.target.value)}
                    placeholder="http://127.0.0.1:3000"
                  />
                  <p className="text-xs text-muted-foreground">OneBot v11 HTTP API 地址</p>
                </div>
                <div className="space-y-2">
                  <Label>媒体地址 (mediaOrigin)</Label>
                  <Input
                    value={config.mediaOrigin}
                    onChange={(e) => update('mediaOrigin', e.target.value)}
                    placeholder="http://127.0.0.1:3000"
                  />
                  <p className="text-xs text-muted-foreground">留空则使用后端地址</p>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>WebUI 设置</CardTitle>
                <CardDescription>WebUI 服务配置</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <Label>监听端口 (webuiPort)</Label>
                  <Input
                    type="number"
                    value={config.webuiPort}
                    onChange={(e) => update('webuiPort', parseInt(e.target.value) || 4520)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>监听地址 (webuiHost)</Label>
                  <Input
                    value={config.webuiHost}
                    onChange={(e) => update('webuiHost', e.target.value)}
                    placeholder="127.0.0.1"
                  />
                </div>
                <div className="space-y-2">
                  <Label>日志级别 (logLevel)</Label>
                  <select
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={config.logLevel}
                    onChange={(e) => update('logLevel', e.target.value)}
                  >
                    <option value="trace">Trace</option>
                    <option value="debug">Debug</option>
                    <option value="info">Info</option>
                    <option value="warn">Warn</option>
                    <option value="error">Error</option>
                  </select>
                </div>
              </CardContent>
            </Card>

            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>设备信息</CardTitle>
                <CardDescription>自动生成，一般不需要修改</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label>Device ID</Label>
                  <Input value={config.deviceId} readOnly className="font-mono text-muted-foreground" />
                </div>
              </CardContent>
            </Card>
          </div>
        ) : null}
    </div>
  );
}
