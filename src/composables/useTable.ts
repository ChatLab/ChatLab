import { ref, shallowRef, watch, type Ref } from 'vue'

export type TableSortDirection = 'asc' | 'desc'

export interface TableSortState<TField extends string> {
  field: TField | null
  direction: TableSortDirection | null
}

export interface TableSortOptions<TField extends string> {
  initialState?: TableSortState<TField>
}

export function useTableSort<TField extends string>(options: TableSortOptions<TField> = {}) {
  const initialState: TableSortState<TField> = options.initialState ?? { field: null, direction: null }
  const sortState = shallowRef<TableSortState<TField>>({ ...initialState })

  function toggleSort(field: TField) {
    if (sortState.value.field !== field) {
      sortState.value = { field, direction: 'asc' }
      return
    }

    if (sortState.value.direction === 'asc') {
      sortState.value = { field, direction: 'desc' }
      return
    }

    if (sortState.value.direction === 'desc') {
      sortState.value = { field: null, direction: null }
      return
    }

    sortState.value = { field, direction: 'asc' }
  }

  function setSort(field: TField, direction: TableSortDirection) {
    sortState.value = { field, direction }
  }

  function resetSort() {
    sortState.value = { ...initialState }
  }

  function getSortDirection(field: TField): TableSortDirection | null {
    return sortState.value.field === field ? sortState.value.direction : null
  }

  function isSortActive(field: TField, direction: TableSortDirection): boolean {
    return getSortDirection(field) === direction
  }

  return {
    sortState,
    toggleSort,
    setSort,
    resetSort,
    getSortDirection,
    isSortActive,
  }
}

type TableRowId = string | number

export interface TableRowSelectionOptions<TRow, TId extends TableRowId> {
  rows: Readonly<Ref<readonly TRow[]>>
  getRowId: (row: TRow) => TId
}

export function useTableRowSelection<TRow, TId extends TableRowId>(options: TableRowSelectionOptions<TRow, TId>) {
  const selectedIds = shallowRef<Set<TId>>(new Set())
  const lastClickedIndex = ref<number | null>(null)

  watch(options.rows, () => {
    lastClickedIndex.value = null
  })

  function setSelection(ids: Iterable<TId>) {
    selectedIds.value = new Set(ids)
  }

  function clearSelection() {
    setSelection([])
    lastClickedIndex.value = null
  }

  function toggleSelection(id: TId) {
    const next = new Set(selectedIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.value = next
  }

  function isSelected(id: TId): boolean {
    return selectedIds.value.has(id)
  }

  function handleRowClick(index: number, id: TId, event: Pick<MouseEvent, 'shiftKey'>) {
    if (event.shiftKey && lastClickedIndex.value !== null) {
      const start = Math.min(lastClickedIndex.value, index)
      const end = Math.max(lastClickedIndex.value, index)
      const next = new Set(selectedIds.value)

      for (let rowIndex = start; rowIndex <= end; rowIndex += 1) {
        const row = options.rows.value[rowIndex]
        if (row) next.add(options.getRowId(row))
      }

      selectedIds.value = next
    } else {
      toggleSelection(id)
    }

    lastClickedIndex.value = index
  }

  function handleRowMouseDown(event: MouseEvent) {
    if (!event.shiftKey) return

    const target = event.target as { closest?: (selectors: string) => Element | null } | null
    if (target?.closest?.('input, textarea, [contenteditable="true"]')) return

    event.preventDefault()
  }

  return {
    selectedIds,
    setSelection,
    clearSelection,
    toggleSelection,
    isSelected,
    handleRowClick,
    handleRowMouseDown,
  }
}
