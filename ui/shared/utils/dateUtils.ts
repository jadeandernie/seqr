interface DateOffset {
  days?: number
  months?: number
}

const toDateString = (date: Date): string => date.toISOString().slice(0, 10)

export const getPastDateString = (now: Date, { days = 0, months = 0 }: DateOffset): string => {
  const date = new Date(now)
  if (months) {
    const day = date.getUTCDate()
    date.setUTCMonth(date.getUTCMonth() - months)
    if (date.getUTCDate() !== day) {
      date.setUTCDate(0)
    }
  }
  date.setUTCDate(date.getUTCDate() - days)
  return toDateString(date)
}

export const isOnOrAfterDate = (dateString: string | undefined | null, cutoffDateString: string): boolean => (
  !!dateString && dateString.slice(0, 10) >= cutoffDateString
)
