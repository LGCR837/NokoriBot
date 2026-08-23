import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Store, User, ArrowDownToLine, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/lib/api';
import { useActionFeedback } from '@/contexts/ActionFeedbackContext';
import type { MarketplacePlugin, PluginInfo } from '@/types';

function formatSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

export function MarketplacePage() {
  const api = useApi();
  const { startAction } = useActionFeedback();
  const [marketPlugins, setMarketPlugins] = useState<MarketplacePlugin[]>([]);
  const [localPlugins, setLocalPlugins] = useState<PluginInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [installing, setInstalling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [market, local] = await Promise.all([
        api.marketplace.list().catch(e => { console.error('marketplace list failed', e); return []; }),
        api.plugins.list().catch(e => { console.error('plugins list failed', e); return []; }),
      ]);
      console.log('[Marketplace] market:', market.map((p: any) => p.name));
      console.log('[Marketplace] local:', local.map((p: any) => p.name));
      setMarketPlugins(market);
      setLocalPlugins(local);
    } catch (e) {
      console.error('Failed to load marketplace', e);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => { void load(); }, [load]);

  const handleInstall = async (name: string) => {
    const handle = startAction({ title: '安装插件', detail: name });
    setInstalling(name);
    try {
      const result = await api.marketplace.install(name);
      if (result.success) {
        handle.succeed({ title: '安装成功', detail: `${result.name} v${result.version}` });
        // 刷新本地插件列表
        const local = await api.plugins.list();
        setLocalPlugins(local);
      } else {
        handle.fail(result.error || '安装失败', { title: '安装失败' });
      }
    } catch (e: any) {
      handle.fail(e.message || '安装失败', { title: '安装失败' });
    } finally {
      setInstalling(null);
    }
  };

  const isInstalled = (name: string) => localPlugins.some(p => p.name === name);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">插件广场</h1>
          <p className="text-sm text-muted-foreground">浏览和安装社区插件</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCw className="size-4" />
          刷新
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
          加载中…
        </div>
      ) : marketPlugins.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Store className="size-10 mb-3 opacity-50" />
            <p className="text-sm">广场暂无插件</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {marketPlugins.map(plugin => {
            const installed = isInstalled(plugin.name);
            return (
              <Card key={plugin.name} className="relative overflow-hidden">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Store className="size-4 text-muted-foreground" />
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
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {plugin.author && (
                        <span className="flex items-center gap-1">
                          <User className="size-3" />
                          {plugin.author}
                        </span>
                      )}
                      <span>{formatSize(plugin.size)}</span>
                      <span>{plugin.downloads} 次下载</span>
                    </div>
                    <Button
                      variant={installed ? 'outline' : 'default'}
                      size="sm"
                      onClick={() => void handleInstall(plugin.name)}
                      disabled={installing === plugin.name}
                    >
                      {installing === plugin.name ? (
                        <RefreshCw className="size-3.5 animate-spin" />
                      ) : installed ? (
                        <Check className="size-3.5" />
                      ) : (
                        <ArrowDownToLine className="size-3.5" />
                      )}
                      {installing === plugin.name ? '安装中' : installed ? '更新' : '安装'}
                    </Button>
                  </div>
                  {plugin.uploaded_by && (
                    <p className="mt-2 text-xs text-muted-foreground">上传者: {plugin.uploaded_by}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
