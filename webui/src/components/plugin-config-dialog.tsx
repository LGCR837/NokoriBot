import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw, Code2, FormInput } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { Modal } from '@/components/interior/modal';
import { useApi } from '@/lib/api';
import { useActionFeedback } from '@/contexts/ActionFeedbackContext';
import { cn } from '@/lib/utils';

interface PluginConfigDialogProps {
  open: boolean;
  onClose: () => void;
  pluginName: string;
  onSaved: () => void;
}

type EditMode = 'gui' | 'raw';

export function PluginConfigDialog({ open, onClose, pluginName, onSaved }: PluginConfigDialogProps) {
  const api = useApi();
  const feedback = useActionFeedback();
  const [mode, setMode] = useState<EditMode>('gui');
  const [rawJson, setRawJson] = useState('');
  const [parsedConfig, setParsedConfig] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    setJsonError(null);
    try {
      const config = await api.plugins.getConfig(pluginName);
      setParsedConfig(config);
      setRawJson(JSON.stringify(config, null, 2));
    } catch (e) {
      const handle = feedback.startAction({ title: '加载配置失败', detail: pluginName });
      handle.fail(e instanceof Error ? e.message : '未知错误');
    } finally {
      setLoading(false);
    }
  }, [api, pluginName, open]);

  useEffect(() => {
    if (open) {
      setMode('gui');
      loadConfig();
    }
  }, [open, loadConfig]);

  const handleRawChange = (value: string) => {
    setRawJson(value);
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        setParsedConfig(parsed);
        setJsonError(null);
      } else {
        setJsonError('配置必须是 JSON 对象');
      }
    } catch {
      setJsonError('JSON 格式错误');
    }
  };

  const handleGuiChange = (key: string, value: unknown) => {
    setParsedConfig(prev => ({ ...prev, [key]: value }));
    setRawJson(JSON.stringify({ ...parsedConfig, [key]: value }, null, 2));
  };

  const handleSave = async () => {
    if (jsonError) return;
    setSaving(true);
    const handle = feedback.startAction({ title: '保存配置', detail: pluginName });
    try {
      await api.plugins.saveConfig(pluginName, parsedConfig);
      await api.plugins.reload(pluginName);
      handle.succeed({ title: '配置已保存并重载', detail: pluginName });
      onSaved();
      onClose();
    } catch (e) {
      handle.fail(e instanceof Error ? e.message : '未知错误', { title: '保存失败' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${pluginName} 配置`}
      description="修改后保存并重载插件"
      closeOnBackdrop={false}
      closeOnEscape={true}
      maxWidth={560}
      maxHeight="min(80vh, 680px)"
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={saving || !!jsonError || loading}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}
            保存并重载
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin mr-2" /> 加载中…
        </div>
      ) : (
        <>
          {/* Mode toggle */}
          <div className="mb-4 flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-0.5">
            <button
              type="button"
              onClick={() => setMode('gui')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                mode === 'gui' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <FormInput className="size-3.5" /> 表单
            </button>
            <button
              type="button"
              onClick={() => setMode('raw')}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                mode === 'raw' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Code2 className="size-3.5" /> JSON
            </button>
          </div>

          {mode === 'gui' ? (
            <GuiEditor config={parsedConfig} onChange={handleGuiChange} />
          ) : (
            <RawEditor value={rawJson} onChange={handleRawChange} error={jsonError} />
          )}
        </>
      )}
    </Modal>
  );
}

// ─────── GUI Editor ───────

function GuiEditor({
  config,
  onChange,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  const entries = Object.entries(config);
  if (entries.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        此插件没有可配置的选项
      </p>
    );
  }
  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => (
        <Field key={key} label={key} value={value} onChange={(v) => onChange(key, v)} />
      ))}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const prettyLabel = label
    .replace(/([A-Z])/g, ' $1')
    .replace(/[_-]/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

  if (typeof value === 'boolean') {
    return (
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
        <Label className="text-sm">{prettyLabel}</Label>
        <ToggleSwitch value={value} onChange={(v) => onChange(v)} ariaLabel={prettyLabel} />
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm">{prettyLabel}</Label>
        <Input
          type="number"
          value={value}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
        />
      </div>
    );
  }

  if (typeof value === 'string') {
    if (value.length > 80 || value.includes('\n')) {
      return (
        <div className="space-y-1.5">
          <Label className="text-sm">{prettyLabel}</Label>
          <textarea
            className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </div>
      );
    }
    return (
      <div className="space-y-1.5">
        <Label className="text-sm">{prettyLabel}</Label>
        <Input value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    );
  }

  if (Array.isArray(value)) {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm">{prettyLabel}</Label>
        <Input
          value={JSON.stringify(value)}
          onChange={(e) => {
            try { onChange(JSON.parse(e.target.value)); } catch {}
          }}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">JSON 数组</p>
      </div>
    );
  }

  if (typeof value === 'object' && value !== null) {
    return (
      <div className="space-y-1.5">
        <Label className="text-sm">{prettyLabel}</Label>
        <Input
          value={JSON.stringify(value)}
          onChange={(e) => {
            try { onChange(JSON.parse(e.target.value)); } catch {}
          }}
          className="font-mono text-xs"
        />
        <p className="text-xs text-muted-foreground">JSON 对象</p>
      </div>
    );
  }

  return null;
}

// ─────── Raw JSON Editor ───────

function RawEditor({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (v: string) => void;
  error: string | null;
}) {
  return (
    <div className="space-y-2">
      <textarea
        className={cn(
          'flex min-h-[300px] w-full rounded-md border bg-transparent px-3 py-2 font-mono text-xs leading-relaxed shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          error ? 'border-destructive' : 'border-input',
        )}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
      />
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
    </div>
  );
}
