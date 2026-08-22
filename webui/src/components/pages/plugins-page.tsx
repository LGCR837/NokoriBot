import { useCallback, useEffect, useState } from 'react';
import { RefreshCw, Power, PowerOff, Puzzle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/api';
import { useActionFeedback } from '@/contexts/ActionFeedbackContext';
import type { PluginInfo } from '@/types';

export function PluginsPage() {
  const api = useApi();
  const { startAction } = useActionFeedback();
  const [plugins, setPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const loadPlugins = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.plugins.list();
      setPlugins(list);
    } catch (e) {
      console.error('Failed to load plugins', e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void loadPlugins(); }, [loadPlugins]);

  const handleToggle = async (name: string) => {
    const handle = startAction({ title: '切换插件状态', detail: name });
    try {
      const enabled = await api.plugins.toggle(name);
      setPlugins(prev => prev.map(p => p.name === name ? { ...p, enabled } : p));
      handle.succeed({ title: enabled ? '已启用' : '已禁用', detail: name });
    } catch (e: any) {
      handle.fail(e.message || '操作失败', { title: '操作失败' });
    }
  };

  const handleReload = async (name: string) => {
    const handle = startAction({ title: '重载插件', detail: name });
    try {
      await api.plugins.reload(name);
      handle.succeed({ title: '已重载', detail: name });
    } catch (e: any) {
      handle.fail(e.message || '重载失败', { title: '重载失败' });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">插件管理</h1>
          <p className="text-sm text-muted-foreground">查看和管理已安装的插件</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadPlugins()}>
          <RefreshCw className="size-4" />
          刷新
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          加载中…
        </div>
      ) : plugins.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Puzzle className="size-10 mb-3 opacity-50" />
            <p className="text-sm">暂无已安装的插件</p>
            <p className="text-xs mt-1">将插件放入 plugins/ 目录并重启</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {plugins.map(plugin => (
            <Card key={plugin.name} className="relative overflow-hidden">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Puzzle className="size-4 text-muted-foreground" />
                  {plugin.name}
                  {plugin.version && (
                    <span className="text-xs font-normal text-muted-foreground">v{plugin.version}</span>
                  )}
                </CardTitle>
                {plugin.description && (
                  <CardDescription className="line-clamp-2">{plugin.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between">
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${plugin.enabled ? 'text-green-600' : 'text-muted-foreground'}`}>
                    <span className={`size-1.5 rounded-full ${plugin.enabled ? 'bg-green-500' : 'bg-muted-foreground/40'}`} />
                    {plugin.enabled ? '已启用' : '已禁用'}
                  </span>
                  <div className="flex gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void handleReload(plugin.name)}
                      title="重载"
                    >
                      <RefreshCw className="size-3.5" />
                    </Button>
                    <Button
                      variant={plugin.enabled ? 'destructive' : 'default'}
                      size="sm"
                      onClick={() => void handleToggle(plugin.name)}
                    >
                      {plugin.enabled ? <PowerOff className="size-3.5" /> : <Power className="size-3.5" />}
                      {plugin.enabled ? '禁用' : '启用'}
                    </Button>
                  </div>
                </div>
                {plugin.author && (
                  <p className="mt-2 text-xs text-muted-foreground">作者: {plugin.author}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
