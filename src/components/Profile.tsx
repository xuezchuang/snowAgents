import { useMemo, useState } from 'react'
import type { AgentTask, ChatMessage } from '../types/task'
import type { ToolTraceEvent } from '../types/trace'

type ProfileTab = 'overview' | 'models'
type ProfileRange = 'all' | '30d' | '7d'

interface ProfileProps {
  tasks: AgentTask[]
}

interface RunRecord {
  date: Date
  model: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

interface ActivityDay {
  key: string
  date: Date
  tokens: number
  active: boolean
}

const modelColors = ['#5b8def', '#8bb9ff', '#7ee0b8', '#f0b86e', '#d18cff']

function Profile({ tasks }: ProfileProps) {
  const [tab, setTab] = useState<ProfileTab>('overview')
  const [range, setRange] = useState<ProfileRange>('all')
  const stats = useMemo(() => createProfileStats(tasks, range), [tasks, range])

  return (
    <section className="profile-page" aria-label="Profile">
      <div className="profile-card">
        <div className="profile-card-header">
          <div className="profile-tabs" role="tablist" aria-label="Profile sections">
            <button
              type="button"
              className={tab === 'overview' ? 'profile-tab active' : 'profile-tab'}
              onClick={() => setTab('overview')}
            >
              Overview
            </button>
            <button
              type="button"
              className={tab === 'models' ? 'profile-tab active' : 'profile-tab'}
              onClick={() => setTab('models')}
            >
              Models
            </button>
          </div>
          <RangeTabs range={range} onChange={setRange} />
        </div>

        {tab === 'overview' ? <Overview stats={stats} /> : <Models stats={stats} />}
      </div>
    </section>
  )
}

function RangeTabs({
  range,
  onChange,
}: {
  range: ProfileRange
  onChange: (range: ProfileRange) => void
}) {
  return (
    <div className="profile-range-tabs" aria-label="Stats range">
      {(['all', '30d', '7d'] as const).map((value) => (
        <button
          type="button"
          key={value}
          className={range === value ? 'profile-range-tab active' : 'profile-range-tab'}
          onClick={() => onChange(value)}
        >
          {value === 'all' ? 'All' : value}
        </button>
      ))}
    </div>
  )
}

function Overview({ stats }: { stats: ProfileStats }) {
  return (
    <>
      <div className="profile-metric-grid">
        <Metric label="Sessions" value={formatNumber(stats.sessions)} />
        <Metric label="Messages" value={formatNumber(stats.messages)} />
        <Metric label="Total tokens" value={formatCompactNumber(stats.totalTokens)} />
        <Metric label="Active days" value={formatNumber(stats.activeDays)} />
        <Metric label="Current streak" value={formatDays(stats.currentStreak)} />
        <Metric label="Longest streak" value={formatDays(stats.longestStreak)} />
        <Metric label="Peak hour" value={stats.peakHourLabel} />
        <Metric label="Favorite model" value={stats.favoriteModel} />
      </div>
      <ActivityGrid days={stats.activityDays} />
      <p className="profile-token-note">
        You've used ~{formatCompactNumber(stats.localTokens)} tokens locally.
      </p>
    </>
  )
}

function Models({ stats }: { stats: ProfileStats }) {
  const maxTokens = Math.max(1, ...stats.modelBuckets.map((bucket) => bucket.totalTokens))
  const yLabels = createYAxisLabels(maxTokens)

  return (
    <div className="profile-models-view">
      <div className="profile-model-chart">
        <div className="profile-y-axis">
          {yLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>
        <div className="profile-bars">
          {stats.modelBuckets.map((bucket) => (
            <div className="profile-bar-column" key={bucket.label}>
              <div className="profile-bar-stack" aria-label={`${bucket.label} tokens`}>
                {bucket.models.map((model, index) => (
                  <span
                    key={model.model}
                    className="profile-bar-segment"
                    style={{
                      height: `${Math.max(4, (model.tokens / maxTokens) * 126)}px`,
                      background: modelColors[index % modelColors.length],
                    }}
                  />
                ))}
              </div>
              <span>{bucket.label}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="profile-model-legend">
        {stats.modelTotals.map((model, index) => (
          <div className="profile-model-row" key={model.model}>
            <span
              className="profile-model-color"
              style={{ background: modelColors[index % modelColors.length] }}
            />
            <span>{model.model}</span>
            <strong>{formatCompactNumber(model.tokens)}</strong>
            <small>{formatPercent(model.tokens, stats.localTokens)}</small>
          </div>
        ))}
      </div>
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function ActivityGrid({ days }: { days: ActivityDay[] }) {
  const maxTokens = Math.max(1, ...days.map((day) => day.tokens))
  return (
    <div className="profile-activity-grid" aria-label="Token activity">
      {days.map((day) => (
        <span
          key={day.key}
          className="profile-activity-cell"
          title={`${day.key}: ${formatNumber(day.tokens)} tokens`}
          style={{ opacity: day.active ? 0.35 + (day.tokens / maxTokens) * 0.65 : 1 }}
          data-active={day.active ? 'true' : 'false'}
        />
      ))}
    </div>
  )
}

interface ProfileStats {
  sessions: number
  messages: number
  totalTokens: number
  activeDays: number
  currentStreak: number
  longestStreak: number
  peakHourLabel: string
  favoriteModel: string
  localTokens: number
  activityDays: ActivityDay[]
  modelBuckets: Array<{
    label: string
    totalTokens: number
    models: Array<{ model: string; tokens: number }>
  }>
  modelTotals: Array<{ model: string; tokens: number }>
}

function createProfileStats(tasks: AgentTask[], range: ProfileRange): ProfileStats {
  const now = new Date()
  const filteredTasks = tasks.filter((task) => isInRange(taskDate(task), now, range))
  const messages = filteredTasks.flatMap((task) =>
    task.messages.filter((message) => isInRange(parseDate(message.createdAt), now, range)),
  )
  const runs = filteredTasks.flatMap((task) => runRecordsForTask(task, now, range))
  const allRuns = tasks.flatMap((task) => runRecordsForTask(task, now, 'all'))
  const totalTokens = runs.reduce((sum, run) => sum + run.totalTokens, 0)
  const localTokens = allRuns.reduce((sum, run) => sum + run.totalTokens, 0)
  const filteredTokensByDay = sumTokensByDay(runs)
  const allTokensByDay = sumTokensByDay(allRuns)
  const activityDays = createActivityDays(allTokensByDay, now, 'all')
  const activeDayKeys = new Set(
    [...filteredTokensByDay.entries()].filter((entry) => entry[1] > 0).map((entry) => entry[0]),
  )
  const hourCounts = messages.reduce((counts, message) => {
    const date = parseDate(message.createdAt)
    if (date) {
      counts[date.getHours()] += 1
    }
    return counts
  }, Array.from({ length: 24 }, () => 0))
  const peakHour = hourCounts.reduce(
    (bestHour, count, hour) => (count > hourCounts[bestHour] ? hour : bestHour),
    0,
  )
  const filteredModelTotals = sumByModel(runs)
  const modelTotals = sumByModel(allRuns)

  return {
    sessions: filteredTasks.length,
    messages: messages.length,
    totalTokens,
    activeDays: activeDayKeys.size,
    currentStreak: calculateCurrentStreak(activeDayKeys, now),
    longestStreak: calculateLongestStreak(activeDayKeys),
    peakHourLabel: formatHour(peakHour),
    favoriteModel: filteredModelTotals[0]?.model ?? 'None',
    localTokens,
    activityDays,
    modelBuckets: createModelBuckets(allRuns, 'all'),
    modelTotals,
  }
}

function runRecordsForTask(task: AgentTask, now: Date, range: ProfileRange): RunRecord[] {
  const records: RunRecord[] = []
  for (const message of task.messages) {
    if (message.role !== 'assistant') {
      continue
    }
    const date = parseDate(message.createdAt)
    if (!date || !isInRange(date, now, range)) {
      continue
    }
    const traces = message.traceEvents?.length ? message.traceEvents : task.traceEvents
    records.push(createRunRecord(date, message, traces))
  }
  return records
}

function createRunRecord(
  date: Date,
  message: ChatMessage,
  traces: ToolTraceEvent[],
): RunRecord {
  const chatCompletion = traces.find((event) => event.title === 'chat_completion')
  const input = asRecord(chatCompletion?.input)
  const output = asRecord(chatCompletion?.output)
  const request = asRecord(input.request)
  const response = asRecord(output.response)
  const usage = asRecord(response.usage)
  const model =
    stringValue(output.model) ||
    stringValue(request.model) ||
    stringValue(response.model) ||
    'Unknown'
  const inputTokens =
    numberValue(output.inputTokens) ||
    numberValue(usage.prompt_tokens) ||
    numberValue(usage.input_tokens)
  const outputTokens =
    numberValue(output.outputTokens) ||
    numberValue(usage.completion_tokens) ||
    numberValue(usage.output_tokens)
  const totalTokens =
    numberValue(output.totalTokens) ||
    numberValue(usage.total_tokens) ||
    inputTokens + outputTokens ||
    estimateTokensFromMessage(message)

  return {
    date,
    model,
    inputTokens,
    outputTokens,
    totalTokens,
  }
}

function createActivityDays(
  tokensByDay: Map<string, number>,
  now: Date,
  range: ProfileRange,
): ActivityDay[] {
  const dayCount = range === '7d' ? 28 : range === '30d' ? 70 : 189
  const today = startOfDay(now)
  return Array.from({ length: dayCount }, (_, index) => {
    const date = addDays(today, index - dayCount + 1)
    const key = dateKey(date)
    const tokens = tokensByDay.get(key) ?? 0
    return {
      key,
      date,
      tokens,
      active: tokens > 0,
    }
  })
}

function createModelBuckets(runs: RunRecord[], range: ProfileRange) {
  const bucketCount = range === '7d' ? 7 : range === '30d' ? 8 : 8
  const sortedRuns = [...runs].sort((left, right) => left.date.getTime() - right.date.getTime())
  const buckets = new Map<string, Map<string, number>>()
  const recentRuns = sortedRuns.slice(-Math.max(bucketCount, sortedRuns.length))

  for (const run of recentRuns) {
    const label = formatDateLabel(run.date)
    const modelMap = buckets.get(label) ?? new Map<string, number>()
    modelMap.set(run.model, (modelMap.get(run.model) ?? 0) + run.totalTokens)
    buckets.set(label, modelMap)
  }

  return [...buckets.entries()].slice(-bucketCount).map(([label, modelMap]) => {
    const models = [...modelMap.entries()]
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((left, right) => right.tokens - left.tokens)
    return {
      label,
      totalTokens: models.reduce((sum, model) => sum + model.tokens, 0),
      models,
    }
  })
}

function sumTokensByDay(runs: RunRecord[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const run of runs) {
    const key = dateKey(run.date)
    totals.set(key, (totals.get(key) ?? 0) + run.totalTokens)
  }
  return totals
}

function sumByModel(runs: RunRecord[]): Array<{ model: string; tokens: number }> {
  const totals = new Map<string, number>()
  for (const run of runs) {
    totals.set(run.model, (totals.get(run.model) ?? 0) + run.totalTokens)
  }
  return [...totals.entries()]
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((left, right) => right.tokens - left.tokens)
}

function calculateCurrentStreak(activeDayKeys: Set<string>, now: Date): number {
  let streak = 0
  let date = startOfDay(now)
  while (activeDayKeys.has(dateKey(date))) {
    streak += 1
    date = addDays(date, -1)
  }
  return streak
}

function calculateLongestStreak(activeDayKeys: Set<string>): number {
  let longest = 0
  let current = 0
  const keys = [...activeDayKeys].sort()
  let previous: Date | null = null
  for (const key of keys) {
    const date = parseDate(key)
    if (!date) {
      continue
    }
    current =
      previous && dateKey(addDays(previous, 1)) === key ? current + 1 : 1
    longest = Math.max(longest, current)
    previous = date
  }
  return longest
}

function isInRange(date: Date | null, now: Date, range: ProfileRange): boolean {
  if (!date) {
    return false
  }
  if (range === 'all') {
    return true
  }
  const days = range === '7d' ? 7 : 30
  return date.getTime() >= addDays(startOfDay(now), -days + 1).getTime()
}

function taskDate(task: AgentTask): Date | null {
  return parseDate(task.messages[0]?.createdAt)
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null
  }
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : ''
}

function numberValue(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function estimateTokensFromMessage(message: ChatMessage): number {
  return Math.max(1, Math.ceil(message.content.length / 4))
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value)
}

function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) {
    return `${trimDecimal(value / 1_000_000)}M`
  }
  if (value >= 1_000) {
    return `${trimDecimal(value / 1_000)}K`
  }
  return formatNumber(value)
}

function trimDecimal(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.?0+$/, '')
}

function formatDays(value: number): string {
  return `${value}d`
}

function formatHour(hour: number): string {
  const suffix = hour >= 12 ? 'PM' : 'AM'
  const display = hour % 12 === 0 ? 12 : hour % 12
  return `${display} ${suffix}`
}

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatPercent(value: number, total: number): string {
  if (total <= 0) {
    return '0%'
  }
  return `${((value / total) * 100).toFixed(1)}%`
}

function createYAxisLabels(maxTokens: number): string[] {
  return [maxTokens, maxTokens * 0.75, maxTokens * 0.5, maxTokens * 0.25, 0].map(
    (value) => formatCompactNumber(Math.round(value)),
  )
}

export default Profile
