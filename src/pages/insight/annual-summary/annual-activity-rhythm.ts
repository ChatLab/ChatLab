export interface AnnualActivityRhythm {
  longestActiveStreak: number
  topWeekday: number | null
  weekdayMessageRate: number | null
  weekendMessageRate: number | null
}

interface DailyActivity {
  date: string
  messageCount: number
}

const DAY_MS = 24 * 60 * 60 * 1000

export function deriveAnnualActivityRhythm(dailyActivity: DailyActivity[]): AnnualActivityRhythm {
  const messagesByDay = new Map<number, number>()

  for (const item of dailyActivity) {
    if (item.messageCount <= 0) continue
    const day = parseLocalDateKey(item.date)
    if (day === null) continue
    messagesByDay.set(day, (messagesByDay.get(day) ?? 0) + item.messageCount)
  }

  const activeDays = [...messagesByDay.keys()].sort((a, b) => a - b)
  if (activeDays.length === 0) {
    return {
      longestActiveStreak: 0,
      topWeekday: null,
      weekdayMessageRate: null,
      weekendMessageRate: null,
    }
  }

  const messagesByWeekday = Array.from({ length: 7 }, () => 0)
  let longestActiveStreak = 1
  let currentStreak = 1

  activeDays.forEach((day, index) => {
    const mondayBasedWeekday = (new Date(day).getUTCDay() + 6) % 7
    messagesByWeekday[mondayBasedWeekday]! += messagesByDay.get(day) ?? 0

    if (index === 0) return
    if (day - activeDays[index - 1]! === DAY_MS) {
      currentStreak++
      longestActiveStreak = Math.max(longestActiveStreak, currentStreak)
    } else {
      currentStreak = 1
    }
  })

  const totalMessages = messagesByWeekday.reduce((sum, count) => sum + count, 0)
  const weekendMessages = messagesByWeekday[5]! + messagesByWeekday[6]!
  const weekendMessageRate = Math.round((weekendMessages / totalMessages) * 100)
  const topWeekdayIndex = messagesByWeekday.reduce(
    (peakIndex, count, index) => (count > messagesByWeekday[peakIndex]! ? index : peakIndex),
    0
  )

  return {
    longestActiveStreak,
    topWeekday: topWeekdayIndex + 1,
    weekdayMessageRate: 100 - weekendMessageRate,
    weekendMessageRate,
  }
}

function parseLocalDateKey(value: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const parsed = new Date(timestamp)
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null
  return timestamp
}
