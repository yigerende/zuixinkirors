import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { DatabaseZap, RefreshCw, Save, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  useCacheMetering,
  useClearCacheMetering,
  useClearCacheMeteringExpired,
  useSetCacheMetering,
} from '@/hooks/use-cache-metering'
import type { CacheMeteringConfig, CacheMeteringStatsCounters } from '@/types/api'

const DEFAULT_CONFIG: CacheMeteringConfig = {
  enabled: true,
  maxEntries: 200000,
  defaultTtlSeconds: 300,
  maxSessionEntries: 2048,
  persistEnabled: true,
  persistIntervalSeconds: 60,
  cleanupIntervalSeconds: 30,
  evictExpiredFirst: true,
  session: {
    enableJsonMetadata: true,
    enableLegacyMetadata: true,
    fallbackToKeyId: true,
    strictUuid: true,
  },
  singleflight: {
    enabled: true,
    waitMs: 50,
    inflightTtlSeconds: 10,
    maxInflight: 10000,
  },
  debug: {
    sampleRate: 0.01,
    logMissReason: true,
    logSeedSource: true,
    logPrefixStats: true,
  },
}

export function CacheMeteringPage() {
  const { data, isLoading, refetch } = useCacheMetering()
  const { mutate: save, isPending: isSaving } = useSetCacheMetering()
  const { mutate: clearAll, isPending: isClearingAll } = useClearCacheMetering()
  const { mutate: clearExpired, isPending: isClearingExpired } = useClearCacheMeteringExpired()
  const [form, setForm] = useState<CacheMeteringConfig>(DEFAULT_CONFIG)

  useEffect(() => {
    if (data?.config) {
      setForm(mergeConfig(data.config))
    }
  }, [data])

  const hitRate = useMemo(() => {
    const stats = data?.stats
    if (!stats) return 0
    const total = stats.lookupHit + stats.lookupMiss
    return total > 0 ? (stats.lookupHit / total) * 100 : 0
  }, [data?.stats])

  const saveConfig = () => {
    save(form, {
      onSuccess: () => toast.success('真实缓存配置已保存'),
      onError: (err) => toast.error(`保存失败: ${(err as Error).message}`),
    })
  }

  const handleClearAll = () => {
    clearAll(undefined, {
      onSuccess: (res) => toast.success(`已清空 ${res.removed} 条真实缓存`),
      onError: (err) => toast.error(`清空失败: ${(err as Error).message}`),
    })
  }

  const handleClearExpired = () => {
    clearExpired(undefined, {
      onSuccess: (res) => toast.success(`已清理 ${res.removed} 条过期真实缓存`),
      onError: (err) => toast.error(`清理失败: ${(err as Error).message}`),
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <DatabaseZap className="h-6 w-6" />
            真实缓存
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            这里显示真实缓存计量状态，不显示模拟缓存改写后的字段。
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4" />
            刷新
          </Button>
          <Button onClick={saveConfig} disabled={isSaving}>
            <Save className="h-4 w-4" />
            保存
          </Button>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        <Metric title="条目" value={data?.runtime?.entriesTotal ?? 0} />
        <Metric title="会话" value={data?.runtime?.sessionsTotal ?? 0} />
        <Metric title="命中率" value={`${hitRate.toFixed(1)}%`} />
        <Metric title="等待中" value={data?.runtime?.inflightTotal ?? 0} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>基础配置</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Toggle label="启用真实缓存计量" checked={form.enabled} onChange={(v) => setForm({ ...form, enabled: v })} />
            <Toggle label="落盘持久化" checked={form.persistEnabled} onChange={(v) => setForm({ ...form, persistEnabled: v })} />
            <NumberField label="全局最大条目" value={form.maxEntries} onChange={(v) => setForm({ ...form, maxEntries: v })} />
            <NumberField label="默认 TTL 秒" value={form.defaultTtlSeconds} onChange={(v) => setForm({ ...form, defaultTtlSeconds: v })} />
            <NumberField label="单会话最大段数" value={form.maxSessionEntries} onChange={(v) => setForm({ ...form, maxSessionEntries: v })} />
            <NumberField label="清理间隔秒" value={form.cleanupIntervalSeconds} onChange={(v) => setForm({ ...form, cleanupIntervalSeconds: v })} />
            <NumberField label="持久化间隔秒" value={form.persistIntervalSeconds} onChange={(v) => setForm({ ...form, persistIntervalSeconds: v })} />
            <Toggle label="优先淘汰过期项" checked={form.evictExpiredFirst} onChange={(v) => setForm({ ...form, evictExpiredFirst: v })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Session 识别</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Toggle label="JSON metadata" checked={form.session.enableJsonMetadata} onChange={(v) => setForm({ ...form, session: { ...form.session, enableJsonMetadata: v } })} />
            <Toggle label="老格式 metadata" checked={form.session.enableLegacyMetadata} onChange={(v) => setForm({ ...form, session: { ...form.session, enableLegacyMetadata: v } })} />
            <Toggle label="兜底客户端 Key" checked={form.session.fallbackToKeyId} onChange={(v) => setForm({ ...form, session: { ...form.session, fallbackToKeyId: v } })} />
            <Toggle label="严格 UUID" checked={form.session.strictUuid} onChange={(v) => setForm({ ...form, session: { ...form.session, strictUuid: v } })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>并发去重</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Toggle label="启用 singleflight" checked={form.singleflight.enabled} onChange={(v) => setForm({ ...form, singleflight: { ...form.singleflight, enabled: v } })} />
            <NumberField label="等待窗口毫秒" value={form.singleflight.waitMs} onChange={(v) => setForm({ ...form, singleflight: { ...form.singleflight, waitMs: v } })} />
            <NumberField label="标记 TTL 秒" value={form.singleflight.inflightTtlSeconds} onChange={(v) => setForm({ ...form, singleflight: { ...form.singleflight, inflightTtlSeconds: v } })} />
            <NumberField label="最大 in-flight" value={form.singleflight.maxInflight} onChange={(v) => setForm({ ...form, singleflight: { ...form.singleflight, maxInflight: v } })} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>运行统计</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <StatsGrid stats={data?.stats ?? null} />
            <div className="flex flex-wrap gap-2 pt-2">
              <Button variant="outline" onClick={handleClearExpired} disabled={isClearingExpired}>
                <Trash2 className="h-4 w-4" />
                清理过期
              </Button>
              <Button variant="destructive" onClick={handleClearAll} disabled={isClearingAll}>
                <Trash2 className="h-4 w-4" />
                清空全部
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

function mergeConfig(config: CacheMeteringConfig): CacheMeteringConfig {
  return {
    ...DEFAULT_CONFIG,
    ...config,
    session: { ...DEFAULT_CONFIG.session, ...config.session },
    singleflight: { ...DEFAULT_CONFIG.singleflight, ...config.singleflight },
    debug: { ...DEFAULT_CONFIG.debug, ...config.debug },
  }
}

function Metric({ title, value }: { title: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className="mt-1 text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  )
}

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  )
}

function StatsGrid({ stats }: { stats: CacheMeteringStatsCounters | null }) {
  const rows = [
    ['metadata JSON', stats?.seedMetadataJson ?? 0],
    ['metadata 老格式', stats?.seedMetadataLegacy ?? 0],
    ['key 兜底', stats?.seedKeyId ?? 0],
    ['命中请求', stats?.lookupHit ?? 0],
    ['未命中请求', stats?.lookupMiss ?? 0],
    ['LRU 淘汰', stats?.evictedLru ?? 0],
    ['过期淘汰', stats?.evictedExpired ?? 0],
    ['会话超限淘汰', stats?.evictedSessionLimit ?? 0],
    ['并发等待', stats?.inflightWait ?? 0],
    ['等待后命中', stats?.inflightHitAfterWait ?? 0],
    ['等待超时', stats?.inflightTimeout ?? 0],
  ]
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-medium">{value}</span>
        </div>
      ))}
    </div>
  )
}
