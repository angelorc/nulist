import { format, formatDistanceStrict } from 'date-fns'

const numberFmt = new Intl.NumberFormat('en-US')
const compactFmt = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 })
const percentFmt = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 1 })

/** Deliverability rates keep two decimals: a 0.08% complaint rate must not round to 0.1%. */
const precisePercentFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
})

const shortPercentFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 2
})

/** Period-over-period changes: "+12.4%", "-3.0%", "0.0%". */
const signedPercentFmt = new Intl.NumberFormat('en-US', {
  style: 'percent',
  signDisplay: 'exceptZero',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})

/** Consistent number/date formatting (DESIGN.md §9). */
export function useFormat() {
  return {
    number: (value: number | null | undefined) => numberFmt.format(value ?? 0),
    compact: (value: number | null | undefined) => compactFmt.format(value ?? 0),
    percent: (value: number | null | undefined) => percentFmt.format(value ?? 0),
    precisePercent: (value: number | null | undefined) => precisePercentFmt.format(value ?? 0),
    shortPercent: (value: number | null | undefined) => shortPercentFmt.format(value ?? 0),
    /** A change ratio with its sign (`0.124` → "+12.4%"). */
    signedPercent: (value: number | null | undefined) => signedPercentFmt.format(value ?? 0),
    bytes: (value: number) =>
      value < 1024
        ? `${value} B`
        : value < 1048576
          ? `${(value / 1024).toFixed(1)} KB`
          : `${(value / 1048576).toFixed(1)} MB`,
    date: (value: string | Date) => format(new Date(value), 'd MMM yyyy'),
    dateTime: (value: string | Date) => format(new Date(value), 'd MMM yyyy, HH:mm:ss'),
    /** "5 minutes ago" / "in 2 hours", relative to `now` (defaults to the current time). */
    relative: (value: string | Date, now: number | Date = Date.now()) => {
      const date = new Date(value)
      const distance = formatDistanceStrict(date, now)

      return date.getTime() > new Date(now).getTime() ? `in ${distance}` : `${distance} ago`
    }
  }
}
