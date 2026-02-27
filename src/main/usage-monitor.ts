import { EventEmitter } from 'events'
import https from 'https'
import type { UsageBucket, UsageSnapshot } from '../shared/usage-types'

const OAUTH_URL = 'https://api.anthropic.com/api/oauth/usage'
const POLL_INTERVAL_MS = 60_000

function formatCountdown(resetsAt: string): string {
  const diff = new Date(resetsAt).getTime() - Date.now()
  if (diff <= 0) return 'now'
  const hours = Math.floor(diff / 3_600_000)
  const minutes = Math.floor((diff % 3_600_000) / 60_000)
  if (hours > 24) {
    const days = Math.floor(hours / 24)
    const remHours = hours % 24
    return `${days}d ${remHours}h`
  }
  return `${hours}h ${minutes}m`
}

function parseBucket(raw: any): UsageBucket | null {
  if (!raw || typeof raw.utilization !== 'number') return null
  return { utilization: raw.utilization, resetsAt: raw.resets_at ?? '' }
}

function formatBucket(bucket: UsageBucket | null): { utilization: number; countdown: string } | null {
  if (!bucket) return null
  return { utilization: bucket.utilization, countdown: formatCountdown(bucket.resetsAt) }
}

export class UsageMonitor extends EventEmitter {
  private token: string | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private threshold: number
  private lastSnapshot: UsageSnapshot = {
    connected: false, error: null,
    fiveHour: null, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null
  }

  constructor(threshold: number = 95) {
    super()
    this.threshold = threshold
  }

  async start(): Promise<void> {
    await this.loadToken()
    if (!this.token) {
      this.lastSnapshot = { connected: false, error: 'No OAuth token found', fiveHour: null, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null }
      this.emit('snapshot', this.lastSnapshot)
      return
    }
    await this.poll()
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  getSnapshot(): UsageSnapshot {
    return this.lastSnapshot
  }

  private async loadToken(): Promise<void> {
    try {
      const keytar = await import('keytar')
      this.token = await keytar.default.getPassword('claude-code', 'oauth_token')
    } catch {
      this.token = null
    }
  }

  private async poll(): Promise<void> {
    if (!this.token) return

    try {
      const raw = await this.fetchUsage()
      const fiveHour = parseBucket(raw.five_hour)
      const sevenDay = parseBucket(raw.seven_day)
      const sevenDayOpus = parseBucket(raw.seven_day_opus)
      const sevenDaySonnet = parseBucket(raw.seven_day_sonnet)

      this.lastSnapshot = {
        connected: true,
        error: null,
        fiveHour: formatBucket(fiveHour),
        sevenDay: formatBucket(sevenDay),
        sevenDayOpus: formatBucket(sevenDayOpus),
        sevenDaySonnet: formatBucket(sevenDaySonnet)
      }

      this.emit('snapshot', this.lastSnapshot)

      if (fiveHour && fiveHour.utilization >= this.threshold) {
        this.emit('limit-approaching', {
          utilization: fiveHour.utilization,
          resetsAt: fiveHour.resetsAt,
          countdown: formatCountdown(fiveHour.resetsAt)
        })
      }
    } catch (err: any) {
      this.lastSnapshot = {
        connected: false,
        error: err.message ?? 'Unknown error',
        fiveHour: null, sevenDay: null, sevenDayOpus: null, sevenDaySonnet: null
      }
      this.emit('snapshot', this.lastSnapshot)
    }
  }

  private fetchUsage(): Promise<any> {
    return new Promise((resolve, reject) => {
      const url = new URL(OAUTH_URL)
      const req = https.request({
        hostname: url.hostname,
        path: url.pathname,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'anthropic-beta': 'oauth-2025-04-20'
        },
        timeout: 15_000
      }, (res) => {
        let body = ''
        res.on('data', (chunk: string) => { body += chunk })
        res.on('end', () => {
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(body)) }
            catch { reject(new Error('Invalid JSON response')) }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`))
          }
        })
      })
      req.on('error', reject)
      req.on('timeout', () => { req.destroy(); reject(new Error('Request timed out')) })
      req.end()
    })
  }
}
