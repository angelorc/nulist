import Papa from 'papaparse'
import { CSV_PARSE_OPTIONS } from '../../../shared/schemas/imports'

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
  /** Rows Papa Parse could not read reliably (broken quotes), 0-based data indexes. */
  malformed: Map<number, string>
}

/** Thin wrapper around Papa Parse with the options shared with the browser preview. */
export class CsvReader {
  private static strip(csv: string): string {
    return csv.charCodeAt(0) === 0xfeff ? csv.slice(1) : csv
  }

  /** Header row only. */
  static headers(csv: string): string[] {
    const result = Papa.parse<Record<string, string>>(CsvReader.strip(csv), {
      ...CSV_PARSE_OPTIONS,
      preview: 1
    })

    return result.meta.fields ?? []
  }

  /** Number of data rows, without materializing them. */
  static countRows(csv: string): number {
    let rows = 0
    Papa.parse<Record<string, string>>(CsvReader.strip(csv), {
      ...CSV_PARSE_OPTIONS,
      step: () => {
        rows++
      }
    })

    return rows
  }

  static parse(csv: string): ParsedCsv {
    const result = Papa.parse<Record<string, string>>(CsvReader.strip(csv), {
      ...CSV_PARSE_OPTIONS
    })

    const malformed = new Map<number, string>()

    for (const error of result.errors) {
      if (error.type === 'Quotes' && error.row !== undefined)
        malformed.set(error.row, error.message)
    }

    return { headers: result.meta.fields ?? [], rows: result.data, malformed }
  }
}
