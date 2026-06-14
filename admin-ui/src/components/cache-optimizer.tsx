import { useState, useEffect, useMemo } from 'react'
import { toast } from 'sonner'
import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useCacheOptimizer, useSetCacheOptimizer } from '@/hooks/use-cache-optimizer'
import { useClientKeys } from '@/hooks/use-client-keys'
import type { CacheOptimizerConfig, CacheSegment, InputScaleSegment } from '@/types/api'

const DEFAULT_CONFIG: CacheOptimizerConfig = {
  enabled: false,
  clientKeyIds: [],
  enabledStream: true,
  enabledNonStream: true,
  enabledBuffered: true,
  mode: 'weighted',
  readMin: 300,
  readMax: 1200,
  writeMin: 0,
  writeMax: 500,
  weightReadOnly: 55,
  weightWriteOnly: 15,
  weightReadWrite: 30,
  weightNone: 0,
  useSegmentWeights: false,
  readSegments: [
    { min: 90000, max: 110000, weight: 35 },
    { min: 110001, max: 130000, weight: 45 },
    { min: 130001, max: 145000, weight: 20 },
  ],
  writeSegments: [
    { min: 20, max: 200, weight: 55 },
    { min: 201, max: 800, weight: 35 },
    { min: 801, max: 3000, weight: 10 },
  ],
  rewriteOnlyWhenPresent: true,
  keepRawBreakdown: true,
  inputRandomMax: 0,
  inputOnlyRandomEnabled: false,
  inputOnlyRandomMax: 0,
  probeBypassMaxInputTokens: null,
  probeBypassInputTokenValues: [],
  probeBypassStream: false,
  probeBypassNonStream: false,
  probeBypassBuffered: false,
  inputScaleEnabled: false,
  inputScaleMaxRead: null,
  inputScaleMaxWrite: null,
  inputScaleSegments: [],
}

function simulatePreview(config: CacheOptimizerConfig): { cacheRead: number; cacheWrite: number } {
  const rawRead = 16511
  const rawWrite = 4800

  switch (config.mode) {
    case 'passthrough':
      return { cacheRead: rawRead, cacheWrite: rawWrite }
    case 'zero':
      return { cacheRead: 0, cacheWrite: 0 }
    case 'cap':
      return { cacheRead: Math.min(rawRead, config.readMax), cacheWrite: Math.min(rawWrite, config.writeMax) }
    case 'random':
      return {
        cacheRead: Math.floor((config.readMin + config.readMax) / 2),
        cacheWrite: Math.floor((config.writeMin + config.writeMax) / 2),
      }
    case 'weighted': {
      const total = config.weightReadOnly + config.weightWriteOnly + config.weightReadWrite + config.weightNone
      if (total === 0) return { cacheRead: 0, cacheWrite: 0 }
      const readAvg = config.useSegmentWeights
        ? weightedSegmentAvg(config.readSegments)
        : Math.floor((config.readMin + config.readMax) / 2)
      const writeAvg = config.useSegmentWeights
        ? weightedSegmentAvg(config.writeSegments)
        : Math.floor((config.writeMin + config.writeMax) / 2)
      const pRead = (config.weightReadOnly + config.weightReadWrite) / total
      const pWrite = (config.weightWriteOnly + config.weightReadWrite) / total
      return {
        cacheRead: Math.floor(readAvg * pRead),
        cacheWrite: Math.floor(writeAvg * pWrite),
      }
    }
    default:
      return { cacheRead: rawRead, cacheWrite: rawWrite }
  }
}

function weightedSegmentAvg(segments: CacheSegment[]): number {
  let totalWeight = 0
  let weightedSum = 0
  for (const seg of segments) {
    totalWeight += seg.weight
    weightedSum += ((seg.min + seg.max) / 2) * seg.weight
  }
  return totalWeight > 0 ? Math.floor(weightedSum / totalWeight) : 0
}

export function CacheOptimizer() {
  const { data, isLoading, refetch } = useCacheOptimizer()
  const { data: clientKeysData, isLoading: isClientKeysLoading } = useClientKeys()
  const { mutate: save, isPending: isSaving } = useSetCacheOptimizer()
  const [form, setForm] = useState<CacheOptimizerConfig>(DEFAULT_CONFIG)
  const [probeBypassExactInput, setProbeBypassExactInput] = useState('')

  useEffect(() => {
    // 合并默认值兜底：老配置可能缺少新增字段（探活豁免/输入放大）
    if (data) setForm({ ...DEFAULT_CONFIG, ...data })
  }, [data])

  const preview = useMemo(() => simulatePreview(form), [form])

  const handleSave = () => {
    save(form, {
      onSuccess: () => toast.success('模拟缓存配置已保存，下次请求生效'),
      onError: (err) => toast.error(`保存失败: ${(err as Error).message}`),
    })
  }

  const updateField = <K extends keyof CacheOptimizerConfig>(key: K, value: CacheOptimizerConfig[K]) => {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  const addProbeBypassExactValue = () => {
    const value = Number(probeBypassExactInput.trim())
    if (!Number.isInteger(value) || value < 0) {
      toast.error('请输入非负整数 Token')
      return
    }
    setForm(prev => {
      if (prev.probeBypassInputTokenValues.includes(value)) return prev
      return {
        ...prev,
        probeBypassInputTokenValues: [...prev.probeBypassInputTokenValues, value].sort((a, b) => a - b),
      }
    })
    setProbeBypassExactInput('')
  }

  const removeProbeBypassExactValue = (value: number) => {
    setForm(prev => ({
      ...prev,
      probeBypassInputTokenValues: prev.probeBypassInputTokenValues.filter(item => item !== value),
    }))
  }

  const toggleClientKey = (id: number) => {
    setForm(prev => {
      const selected = prev.clientKeyIds.includes(id)
      return {
        ...prev,
        clientKeyIds: selected
          ? prev.clientKeyIds.filter(item => item !== id)
          : [...prev.clientKeyIds, id].sort((a, b) => a - b),
      }
    })
  }

  const clearClientKeyScope = () => updateField('clientKeyIds', [])

  const updateSegment = (type: 'readSegments' | 'writeSegments', index: number, field: keyof CacheSegment, value: number) => {
    setForm(prev => {
      const segments = [...prev[type]] as [CacheSegment, CacheSegment, CacheSegment]
      segments[index] = { ...segments[index], [field]: value }
      return { ...prev, [type]: segments }
    })
  }

  const addScaleSegment = () => {
    setForm(prev => ({
      ...prev,
      inputScaleSegments: [
        ...prev.inputScaleSegments,
        { min: 0, max: 0, readMultiplier: 1, writeMultiplier: 1 },
      ],
    }))
  }
  const removeScaleSegment = (index: number) => {
    setForm(prev => ({
      ...prev,
      inputScaleSegments: prev.inputScaleSegments.filter((_, i) => i !== index),
    }))
  }
  const updateScaleSegment = (index: number, field: keyof InputScaleSegment, value: number) => {
    setForm(prev => {
      const segments = [...prev.inputScaleSegments]
      segments[index] = { ...segments[index], [field]: value }
      return { ...prev, inputScaleSegments: segments }
    })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <>
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold">模拟缓存</h1>
          <p className="text-sm text-muted-foreground">只改写返回给下游的 usage 缓存读写字段，上游请求逻辑保持不变</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" />
            刷新
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving}>
            {isSaving ? '保存中...' : '保存'}
          </Button>
        </div>
      </div>

      {/* 总开关 */}
      <Card className="mb-6">
        <CardContent className="py-4">
          <label className="flex items-center justify-between">
            <div>
              <div className="font-medium">启用模拟缓存</div>
              <div className="text-sm text-muted-foreground">
                关闭时按原有真实缓存追踪逻辑返回，开启时用下方配置替换缓存字段
              </div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={form.enabled}
              onClick={() => updateField('enabled', !form.enabled)}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                form.enabled ? 'bg-primary' : 'bg-muted'
              }`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                form.enabled ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </label>
        </CardContent>
      </Card>

      {/* 适用客户端 Key */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">适用客户端 Key</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              未选择时全部客户端 Key 的请求都生效；选择一个或多个后，只对这些 Key 的请求生效。
            </p>
            {form.clientKeyIds.length > 0 && (
              <Button type="button" variant="outline" size="sm" onClick={clearClientKeyScope}>
                全部 Key
              </Button>
            )}
          </div>
          {isClientKeysLoading ? (
            <div className="text-xs text-muted-foreground">正在加载客户端 Key...</div>
          ) : clientKeysData?.keys.length ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {clientKeysData.keys.map(key => (
                <label
                  key={key.id}
                  className={`flex items-center gap-3 rounded-md border p-3 text-sm ${
                    form.clientKeyIds.includes(key.id) ? 'border-primary bg-primary/5' : 'border-border bg-background'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={form.clientKeyIds.includes(key.id)}
                    onChange={() => toggleClientKey(key.id)}
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{key.name}</span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">#{key.id}</span>
                      {key.disabled && <span className="shrink-0 rounded bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive">已禁用</span>}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{key.maskedKey}</div>
                  </div>
                </label>
              ))}
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">暂无客户端 Key</div>
          )}
        </CardContent>
      </Card>

      {/* 按响应路径分别控制 */}
      {form.enabled && (
        <Card className="mb-6">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">响应路径开关</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {([
              { key: 'enabledStream' as const, label: '流式响应', desc: 'POST /v1/messages (stream=true)' },
              { key: 'enabledNonStream' as const, label: '非流式响应', desc: 'POST /v1/messages (stream=false)' },
              { key: 'enabledBuffered' as const, label: '缓冲流式响应', desc: 'POST /cc/v1/messages (stream=true)' },
            ]).map(item => (
              <label key={item.key} className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-xs text-muted-foreground">{item.desc}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={form[item.key]}
                  onClick={() => updateField(item.key, !form[item.key])}
                  className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                    form[item.key] ? 'bg-primary' : 'bg-muted'
                  }`}
                >
                  <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow-lg ring-0 transition-transform ${
                    form[item.key] ? 'translate-x-4' : 'translate-x-0'
                  }`} />
                </button>
              </label>
            ))}
          </CardContent>
        </Card>
      )}

      {/* 使用说明 */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">怎么使用</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
            <div className="p-3 bg-muted rounded-md">
              <div className="font-medium mb-1">推荐配置</div>
              <div className="text-muted-foreground leading-relaxed">
                模式选 <code className="text-xs bg-background px-1 rounded">weighted</code><br/>
                缓存读：90000 ~ 145000<br/>
                缓存写：20 ~ 800<br/>
                权重：只读 60、只写 15、读写 25、都无 0
              </div>
            </div>
            <div className="p-3 bg-muted rounded-md">
              <div className="font-medium mb-1">模式说明</div>
              <div className="text-muted-foreground leading-relaxed">
                <code className="text-xs bg-background px-1 rounded">passthrough</code>：不处理<br/>
                <code className="text-xs bg-background px-1 rounded">zero</code>：缓存读写都返回 0<br/>
                <code className="text-xs bg-background px-1 rounded">cap</code>：超过最大值就压低<br/>
                <code className="text-xs bg-background px-1 rounded">random</code>：按范围随机<br/>
                <code className="text-xs bg-background px-1 rounded">weighted</code>：按权重随机形态
              </div>
            </div>
            <div className="p-3 bg-muted rounded-md">
              <div className="font-medium mb-1">确认生效</div>
              <div className="text-muted-foreground leading-relaxed">
                保存后发一次请求，看返回的 usage 中 cache_read_input_tokens 和 cache_creation_input_tokens 是否符合预期。
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* 改写模式配置 */}
      <Card className="mb-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">改写模式</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 模式和范围 */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">模式</span>
              <select
                value={form.mode}
                onChange={e => updateField('mode', e.target.value as CacheOptimizerConfig['mode'])}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="passthrough">passthrough - 原样返回</option>
                <option value="zero">zero - 缓存读写清零</option>
                <option value="cap">cap - 超过上限就压低</option>
                <option value="random">random - 随机缓存读写</option>
                <option value="weighted">weighted - 按权重随机形态</option>
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">缓存读最小值</span>
              <input type="number" min={0} value={form.readMin}
                onChange={e => updateField('readMin', Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">缓存读最大值</span>
              <input type="number" min={0} value={form.readMax}
                onChange={e => updateField('readMax', Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">缓存写最小值</span>
              <input type="number" min={0} value={form.writeMin}
                onChange={e => updateField('writeMin', Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">缓存写最大值</span>
              <input type="number" min={0} value={form.writeMax}
                onChange={e => updateField('writeMax', Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
          </div>

          {/* input_tokens 随机上限 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">输入 token 随机上限</span>
              <input type="number" min={0} value={form.inputRandomMax}
                onChange={e => updateField('inputRandomMax', Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <div className="flex items-end text-xs text-muted-foreground pb-1.5">
              填 0 表示不替换（按真实逻辑返回）；填 N（如 20）则返回给下游的 input_tokens 替换为随机 1~N。仅在模拟缓存开启且未启用“仅随机输入 Token”时生效。
            </div>
          </div>

          <div className="rounded-md border border-border bg-muted/60 p-3 space-y-3">
            <label className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={form.inputOnlyRandomEnabled}
                onClick={() => updateField('inputOnlyRandomEnabled', !form.inputOnlyRandomEnabled)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  form.inputOnlyRandomEnabled ? 'bg-primary' : 'bg-background border-input'
                }`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow ring-0 transition-transform ${
                  form.inputOnlyRandomEnabled ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
              <div>
                <span className="text-sm font-medium">仅随机输入 Token</span>
                <p className="text-xs text-muted-foreground">
                  开启后优先级最高，只把返回给下游的 input_tokens 替换为随机 1~上限；输出、缓存创建、缓存读取都保持原值，其它模拟缓存规则失效。
                </p>
              </div>
            </label>
            <label className="block max-w-xs space-y-1.5">
              <span className="text-sm font-medium">仅随机输入上限</span>
              <input
                type="number"
                min={0}
                value={form.inputOnlyRandomMax}
                onChange={e => updateField('inputOnlyRandomMax', Number(e.target.value))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              />
            </label>
          </div>

          {/* 权重 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <label className="space-y-1.5">
              <span className="text-sm font-medium">只读权重</span>
              <input type="number" min={0} value={form.weightReadOnly}
                onChange={e => updateField('weightReadOnly', Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">只写权重</span>
              <input type="number" min={0} value={form.weightWriteOnly}
                onChange={e => updateField('weightWriteOnly', Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">读写都有权重</span>
              <input type="number" min={0} value={form.weightReadWrite}
                onChange={e => updateField('weightReadWrite', Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
            <label className="space-y-1.5">
              <span className="text-sm font-medium">都不显示权重</span>
              <input type="number" min={0} value={form.weightNone}
                onChange={e => updateField('weightNone', Number(e.target.value))}
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </label>
          </div>

          {/* 分段权重 */}
          <div className="p-4 bg-muted rounded-md space-y-4">
            <label className="flex items-center gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={form.useSegmentWeights}
                onClick={() => updateField('useSegmentWeights', !form.useSegmentWeights)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  form.useSegmentWeights ? 'bg-primary' : 'bg-background border-input'
                }`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow ring-0 transition-transform ${
                  form.useSegmentWeights ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
              <div>
                <span className="text-sm font-medium">启用读写数值分段权重</span>
                <p className="text-xs text-muted-foreground">开启后按下面每个区间的权重抽数值，不再直接用总范围随机</p>
              </div>
            </label>

            {form.useSegmentWeights && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <div className="text-sm font-medium">缓存读分段</div>
                  {form.readSegments.map((seg, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2">
                      <input type="number" placeholder="最小值" value={seg.min}
                        onChange={e => updateSegment('readSegments', i, 'min', Number(e.target.value))}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
                      <input type="number" placeholder="最大值" value={seg.max}
                        onChange={e => updateSegment('readSegments', i, 'max', Number(e.target.value))}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
                      <input type="number" placeholder="权重" value={seg.weight}
                        onChange={e => updateSegment('readSegments', i, 'weight', Number(e.target.value))}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
                    </div>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">缓存写分段</div>
                  {form.writeSegments.map((seg, i) => (
                    <div key={i} className="grid grid-cols-3 gap-2">
                      <input type="number" placeholder="最小值" value={seg.min}
                        onChange={e => updateSegment('writeSegments', i, 'min', Number(e.target.value))}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
                      <input type="number" placeholder="最大值" value={seg.max}
                        onChange={e => updateSegment('writeSegments', i, 'max', Number(e.target.value))}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
                      <input type="number" placeholder="权重" value={seg.weight}
                        onChange={e => updateSegment('writeSegments', i, 'weight', Number(e.target.value))}
                        className="h-8 rounded-md border border-input bg-background px-2 text-xs" />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 其他选项 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="flex items-center gap-3 p-3 bg-muted rounded-md">
              <button
                type="button"
                role="switch"
                aria-checked={form.rewriteOnlyWhenPresent}
                onClick={() => updateField('rewriteOnlyWhenPresent', !form.rewriteOnlyWhenPresent)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  form.rewriteOnlyWhenPresent ? 'bg-primary' : 'bg-background border-input'
                }`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow ring-0 transition-transform ${
                  form.rewriteOnlyWhenPresent ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
              <div>
                <span className="text-sm font-medium">只在上游有缓存字段时改写</span>
                <p className="text-xs text-muted-foreground">避免把原本没有缓存的请求伪造成缓存请求</p>
              </div>
            </label>
            <label className="flex items-center gap-3 p-3 bg-muted rounded-md">
              <button
                type="button"
                role="switch"
                aria-checked={form.keepRawBreakdown}
                onClick={() => updateField('keepRawBreakdown', !form.keepRawBreakdown)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                  form.keepRawBreakdown ? 'bg-primary' : 'bg-background border-input'
                }`}
              >
                <span className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-background shadow ring-0 transition-transform ${
                  form.keepRawBreakdown ? 'translate-x-4' : 'translate-x-0'
                }`} />
              </button>
              <div>
                <span className="text-sm font-medium">保留原始缓存值</span>
                <p className="text-xs text-muted-foreground">写到响应中方便排查</p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* 探活豁免 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">探活豁免</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            渠道探活等小请求：当「请求输入 token」≤ 阈值，或等于下方任一指定值时，该请求完全不改写、原样真实返回（相当于这条请求关闭模拟缓存）。判断用请求进来的输入，不是上游返回。
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium">输入阈值(≤)</span>
            <input
              type="number"
              min={0}
              placeholder="留空=不启用"
              value={form.probeBypassMaxInputTokens ?? ''}
              onChange={e => updateField('probeBypassMaxInputTokens', e.target.value === '' ? null : Number(e.target.value))}
              className="w-40 h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-sm font-medium">输入等于(=)</span>
              <input
                type="number"
                min={0}
                placeholder="输入后按回车"
                value={probeBypassExactInput}
                onChange={e => setProbeBypassExactInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addProbeBypassExactValue()
                  }
                }}
                className="w-40 h-9 rounded-md border border-input bg-background px-3 text-sm"
              />
              <Button type="button" variant="outline" size="sm" onClick={addProbeBypassExactValue}>
                添加
              </Button>
            </div>
            <div className="flex flex-wrap gap-2">
              {form.probeBypassInputTokenValues.length === 0 ? (
                <span className="text-xs text-muted-foreground">未配置等值豁免</span>
              ) : (
                form.probeBypassInputTokenValues.map(value => (
                  <button
                    type="button"
                    key={value}
                    onClick={() => removeProbeBypassExactValue(value)}
                    className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-xs font-mono hover:bg-muted"
                    title="点击删除"
                  >
                    ={value}
                    <span className="text-muted-foreground">x</span>
                  </button>
                ))
              )}
            </div>
          </div>
          <div className="flex items-center gap-4 flex-wrap text-sm">
            <span className="text-muted-foreground">对以下请求类型生效：</span>
            {([
              ['probeBypassNonStream', '非流式'],
              ['probeBypassStream', '流式'],
              ['probeBypassBuffered', '缓冲流式(/cc)'],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={form[key]}
                  onChange={e => updateField(key, e.target.checked)}
                />
                {label}
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* 输入放大 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">输入放大（按真实输入分档，对读/写缓存乘倍率）</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            开启后：按「上游返回的真实输入 token」落档，对模拟改写后的读/写缓存分别乘倍率（保护大输入成本）。倍率支持 1 位小数；放大上限留空=不封顶；只对非零值生效（不破坏只读/只写）。仅在模拟缓存开启时生效。
          </p>
          <div className="flex items-center gap-4 flex-wrap">
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={form.inputScaleEnabled}
                onChange={e => updateField('inputScaleEnabled', e.target.checked)}
              />
              启用输入放大
            </label>
            <span className="text-sm font-medium ml-2">放大后最大读</span>
            <input
              type="number" min={0} placeholder="留空=不封顶"
              value={form.inputScaleMaxRead ?? ''}
              onChange={e => updateField('inputScaleMaxRead', e.target.value === '' ? null : Number(e.target.value))}
              className="w-32 h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
            <span className="text-sm font-medium">放大后最大写</span>
            <input
              type="number" min={0} placeholder="留空=不封顶"
              value={form.inputScaleMaxWrite ?? ''}
              onChange={e => updateField('inputScaleMaxWrite', e.target.value === '' ? null : Number(e.target.value))}
              className="w-32 h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          {/* 分段表 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="w-28">输入≥</span>
              <span className="w-28">输入≤</span>
              <span className="w-24">读倍率</span>
              <span className="w-24">写倍率</span>
            </div>
            {form.inputScaleSegments.map((seg, i) => (
              <div key={i} className="flex items-center gap-2">
                <input type="number" min={0} value={seg.min}
                  onChange={e => updateScaleSegment(i, 'min', Number(e.target.value))}
                  className="w-28 h-8 rounded-md border border-input bg-background px-2 text-sm" />
                <input type="number" min={0} value={seg.max}
                  onChange={e => updateScaleSegment(i, 'max', Number(e.target.value))}
                  className="w-28 h-8 rounded-md border border-input bg-background px-2 text-sm" />
                <input type="number" min={0} step={0.1} value={seg.readMultiplier}
                  onChange={e => updateScaleSegment(i, 'readMultiplier', Number(e.target.value))}
                  className="w-24 h-8 rounded-md border border-input bg-background px-2 text-sm" />
                <input type="number" min={0} step={0.1} value={seg.writeMultiplier}
                  onChange={e => updateScaleSegment(i, 'writeMultiplier', Number(e.target.value))}
                  className="w-24 h-8 rounded-md border border-input bg-background px-2 text-sm" />
                <Button variant="ghost" size="sm" className="text-destructive"
                  onClick={() => removeScaleSegment(i)}>删除</Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addScaleSegment}>+ 添加分档</Button>
          </div>
        </CardContent>
      </Card>

      {/* 实时预览 */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">预览（假设上游返回 cacheRead=16511, cacheWrite=4800）</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="p-3 bg-muted rounded-md text-xs font-mono leading-relaxed overflow-x-auto">
{JSON.stringify({
  usage: {
    input_tokens: 1,
    output_tokens: 128,
    cache_read_input_tokens: preview.cacheRead,
    cache_creation_input_tokens: preview.cacheWrite,
  }
}, null, 2)}
          </pre>
        </CardContent>
      </Card>
    </>
  )
}




