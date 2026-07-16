import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { computed, nextTick, ref } from 'vue'

import { useTableRowSelection, useTableSort } from './useTable'

type SortField = 'name' | 'messageCount'

describe('useTableSort', () => {
  it('cycles one field through ascending, descending, and unsorted', () => {
    const { sortState, toggleSort } = useTableSort<SortField>()

    toggleSort('name')
    assert.deepEqual(sortState.value, { field: 'name', direction: 'asc' })

    toggleSort('name')
    assert.deepEqual(sortState.value, { field: 'name', direction: 'desc' })

    toggleSort('name')
    assert.deepEqual(sortState.value, { field: null, direction: null })
  })

  it('starts a different field from ascending order', () => {
    const { sortState, toggleSort } = useTableSort<SortField>({
      initialState: { field: 'messageCount', direction: 'desc' },
    })

    toggleSort('name')

    assert.deepEqual(sortState.value, { field: 'name', direction: 'asc' })
  })

  it('reports the active direction and supports explicit sort changes', () => {
    const { sortState, setSort, getSortDirection, isSortActive } = useTableSort<SortField>()

    setSort('messageCount', 'desc')

    assert.deepEqual(sortState.value, { field: 'messageCount', direction: 'desc' })
    assert.equal(getSortDirection('messageCount'), 'desc')
    assert.equal(getSortDirection('name'), null)
    assert.equal(isSortActive('messageCount', 'desc'), true)
    assert.equal(isSortActive('messageCount', 'asc'), false)
  })

  it('restores the configured initial state', () => {
    const { sortState, toggleSort, resetSort } = useTableSort<SortField>({
      initialState: { field: 'messageCount', direction: 'desc' },
    })

    toggleSort('name')
    resetSort()

    assert.deepEqual(sortState.value, { field: 'messageCount', direction: 'desc' })
  })
})

interface Row {
  id: string
}

function createSelection() {
  const rows = ref<Row[]>([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }])
  const selection = useTableRowSelection({
    rows: computed(() => rows.value),
    getRowId: (row) => row.id,
  })
  return { rows, ...selection }
}

function clickEvent(shiftKey = false): MouseEvent {
  return { shiftKey } as MouseEvent
}

describe('useTableRowSelection', () => {
  it('toggles a row with a normal click', () => {
    const { handleRowClick, selectedIds } = createSelection()

    handleRowClick(1, 'b', clickEvent())
    assert.deepEqual([...selectedIds.value], ['b'])

    handleRowClick(1, 'b', clickEvent())
    assert.deepEqual([...selectedIds.value], [])
  })

  it('adds the full visible range on Shift+Click', () => {
    const { handleRowClick, selectedIds } = createSelection()

    handleRowClick(1, 'b', clickEvent())
    handleRowClick(3, 'd', clickEvent(true))

    assert.deepEqual([...selectedIds.value], ['b', 'c', 'd'])
  })

  it('resets the Shift anchor when the visible row order changes', async () => {
    const { rows, handleRowClick, selectedIds } = createSelection()

    handleRowClick(1, 'b', clickEvent())
    rows.value = [{ id: 'd' }, { id: 'c' }, { id: 'a' }]
    await nextTick()
    handleRowClick(2, 'a', clickEvent(true))

    assert.deepEqual([...selectedIds.value], ['b', 'a'])
  })

  it('prevents Shift text selection outside editable controls', () => {
    const { handleRowMouseDown } = createSelection()
    let prevented = false

    handleRowMouseDown({
      shiftKey: true,
      target: { closest: () => null },
      preventDefault: () => {
        prevented = true
      },
    } as unknown as MouseEvent)

    assert.equal(prevented, true)

    prevented = false
    handleRowMouseDown({
      shiftKey: true,
      target: { closest: () => ({}) },
      preventDefault: () => {
        prevented = true
      },
    } as unknown as MouseEvent)

    assert.equal(prevented, false)
  })
})
