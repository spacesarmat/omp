export const ICON: { [status: string]: string };
export function clipText(s: string | undefined, n: number): string;
export function moscowTime(iso: string | undefined): string;
export function ago(iso: string | undefined, now?: number): string;
export function when(iso: string | undefined, now?: number): string;
export interface TableRow {
  name: string;
  status: string;
  detail?: string;
}
export function monitorTable(rows: TableRow[], opts?: { title?: string; at?: string; runUrl?: string; now?: number }): string;
