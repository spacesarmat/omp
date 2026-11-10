import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type VisibilityState,
} from '@tanstack/react-table';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function downloadCsv(name: string, rows: string[][]) {
  const body = rows
    .map((r) => r.map((c) => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(','))
    .join('\n');
  const blob = new Blob(['\uFEFF' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function DataTable<T>({
  name,
  rows,
  columns,
  search,
  bulk,
  onRow,
}: {
  name: string;
  rows: T[];
  columns: ColumnDef<T, unknown>[];
  search?: (row: T, q: string) => boolean;
  bulk?: { label: string; run: (rows: T[]) => void }[];
  onRow?: (row: T) => void;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [q, setQ] = useState('');
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [openCols, setOpenCols] = useState(false);
  const filtered = search && q.trim() ? rows.filter((r) => search(r, q.trim().toLowerCase())) : rows;
  const table = useReactTable({
    data: filtered,
    columns,
    state: { sorting, columnVisibility: visibility, rowSelection: picked },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setVisibility,
    onRowSelectionChange: setPicked,
    enableRowSelection: true,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getRowId: (row, index) => String((row as { id?: string }).id || index),
  });
  const selected = table.getSelectedRowModel().rows.map((r) => r.original);

  function exportRows(list: T[]) {
    const cols = table.getVisibleLeafColumns();
    const head = cols.map((c) => String(c.columnDef.header || c.id));
    const body = list.map((row) =>
      cols.map((c) => {
        const value = c.accessorFn ? c.accessorFn(row, 0) : '';
        return value == null ? '' : String(value);
      }),
    );
    downloadCsv(name + '.csv', [head].concat(body));
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Фильтр" className="max-w-xs" />
        <Button variant="secondary" onClick={() => setOpenCols((v) => !v)}>
          Столбцы
        </Button>
        <Button variant="secondary" onClick={() => exportRows(selected.length ? selected : filtered)}>
          CSV
        </Button>
        {(bulk || []).map((b) => (
          <Button key={b.label} variant="secondary" disabled={!selected.length} onClick={() => b.run(selected)}>
            {b.label}
          </Button>
        ))}
        <span className="text-xs text-muted-foreground">{filtered.length}</span>
      </div>
      {openCols ? (
        <div className="flex flex-wrap gap-3 text-sm">
          {table.getAllLeafColumns().map((c) => (
            <label key={c.id} className="flex items-center gap-1">
              <input type="checkbox" checked={c.getIsVisible()} onChange={() => c.toggleVisibility()} />
              {String(c.columnDef.header || c.id)}
            </label>
          ))}
        </div>
      ) : null}
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-card">
            {table.getHeaderGroups().map((g) => (
              <tr key={g.id}>
                <th className="w-8 px-2 py-2">
                  <input
                    type="checkbox"
                    checked={table.getIsAllRowsSelected()}
                    onChange={table.getToggleAllRowsSelectedHandler()}
                    aria-label="Выбрать все"
                  />
                </th>
                {g.headers.map((h) => (
                  <th key={h.id} className="px-2 py-2 text-left font-medium text-muted-foreground">
                    {h.isPlaceholder ? null : (
                      <button type="button" className="inline-flex items-center gap-1" onClick={h.column.getToggleSortingHandler()}>
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {h.column.getIsSorted() === 'asc' ? ' ↑' : h.column.getIsSorted() === 'desc' ? ' ↓' : ''}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((r) => (
              <tr
                key={r.id}
                className="cursor-pointer border-t border-border hover:bg-secondary"
                onClick={() => onRow && onRow(r.original)}
              >
                <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                  <input type="checkbox" checked={r.getIsSelected()} onChange={r.getToggleSelectedHandler()} aria-label="Выбрать строку" />
                </td>
                {r.getVisibleCells().map((c) => (
                  <td key={c.id} className="px-2 py-1 align-top">
                    {flexRender(c.column.columnDef.cell, c.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {table.getRowModel().rows.length === 0 ? (
              <tr>
                <td className="px-2 py-4 text-muted-foreground" colSpan={columns.length + 1}>
                  Пусто
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
