const logs: string[] = []
let enabled = false
let autoDisableTimer: number | null = null
let startTime = 0

export function debugLog (msg: string): void {
  if (!enabled) return
  logs.push(`[${new Date().toISOString()}] ${msg}`)
}

export function enableDebugLog (durationMs = 300000): void {
  enabled = true
  startTime = Date.now()
  logs.length = 0
  debugLog(`Debug logging started (${durationMs / 1000}s)`)
  if (autoDisableTimer) window.clearTimeout(autoDisableTimer)
  autoDisableTimer = window.setTimeout(() => disableDebugLog(), durationMs)
}

export function disableDebugLog (): void {
  if (enabled) debugLog('Debug logging stopped')
  enabled = false
  if (autoDisableTimer) {
    window.clearTimeout(autoDisableTimer)
    autoDisableTimer = null
  }
}

export function getDebugLogs (): string {
  return logs.join('\n')
}

export function getDebugLogCount (): number {
  return logs.length
}

export function clearDebugLogs (): void {
  logs.length = 0
}

export function isDebugEnabled (): boolean {
  return enabled
}

export function getTimeRemaining (): number {
  if (!enabled || !autoDisableTimer) return 0
  return Math.max(0, Math.round((startTime + 300000 - Date.now()) / 1000))
}
