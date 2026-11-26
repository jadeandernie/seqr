import React from 'react'
import { mount, shallow, configure } from 'enzyme'
import Adapter from '@wojtekmaj/enzyme-adapter-react-17'
import DataTable from './DataTable'

configure({ adapter: new Adapter() })

test('shallow-render without crashing', () => {
  shallow(<DataTable
    data={[{ id: 1, a: 'apple', b: 'banana', c: 'cat' }, { id: 2 }]}
    columns={[{ name: 'a' }, { name: 'b' }, { name: 'c' }]}
    idField="id"
    defaultSortColumn="a"
  />)
})

const COLUMNS = [{ name: 'name', content: 'Name' }]
const FRUIT = ['cherry', 'apple', 'banana', 'apricot', 'avocado', 'blueberry']
const rows = names => names.map(name => ({ id: name, name }))
const getRowFilterVal = row => row.name

const mountTable = props => mount(
  <DataTable data={rows(FRUIT)} columns={COLUMNS} idField="id" getRowFilterVal={getRowFilterVal} {...props} />,
)

const shownNames = wrapper => wrapper.find('tbody tr').map(row => row.find('td').last().text())

const setFilter = (wrapper, value) => {
  wrapper.find('input[type="text"]').simulate('change', { target: { value } })
  wrapper.update()
}

const goToPage = (wrapper, activePage) => {
  wrapper.find('Pagination').prop('onPageChange')({}, { activePage })
  wrapper.update()
}

describe('sorting', () => {
  test('sorts the displayed rows without reordering the data prop', () => {
    const data = rows(FRUIT)
    const wrapper = mountTable({ data, defaultSortColumn: 'name' })

    expect(shownNames(wrapper)).toEqual(['apple', 'apricot', 'avocado', 'banana', 'blueberry', 'cherry'])
    expect(data.map(({ name }) => name)).toEqual(FRUIT)

    wrapper.find('th').simulate('click')
    wrapper.find('th').simulate('click')

    expect(shownNames(wrapper)).toEqual(['cherry', 'blueberry', 'banana', 'avocado', 'apricot', 'apple'])
    expect(data.map(({ name }) => name)).toEqual(FRUIT)
  })

  test('accepts read-only data', () => {
    const wrapper = mountTable({ data: Object.freeze(rows(FRUIT)), defaultSortColumn: 'name', defaultSortDescending: true })

    expect(shownNames(wrapper)).toEqual(['cherry', 'blueberry', 'banana', 'avocado', 'apricot', 'apple'])
  })
})

describe('pagination', () => {
  test('returns to the first page when a filter is applied', () => {
    const wrapper = mountTable({ defaultSortColumn: 'name', rowsPerPage: 2 })
    goToPage(wrapper, 3)
    expect(shownNames(wrapper)).toEqual(['blueberry', 'cherry'])

    setFilter(wrapper, 'A')

    expect(shownNames(wrapper)).toEqual(['apple', 'apricot'])
    expect(wrapper.find('Pagination').prop('activePage')).toEqual(1)
    expect(wrapper.find('Pagination').prop('totalPages')).toEqual(2)
    expect(wrapper.text()).toContain('Showing rows 1-2')
  })

  test('shows the last page when the data shrinks below the active page', () => {
    const wrapper = mountTable({ defaultSortColumn: 'name', rowsPerPage: 2 })
    goToPage(wrapper, 3)

    wrapper.setProps({ data: rows(['apple', 'banana', 'cherry']) })
    wrapper.update()

    expect(shownNames(wrapper)).toEqual(['cherry'])
    expect(wrapper.find('Pagination').prop('activePage')).toEqual(2)
    expect(wrapper.text()).toContain('Showing rows 3-3')
  })
})

describe('select all', () => {
  const headerCheckbox = wrapper => wrapper.find('thead').find('Checkbox')

  test('selects and deselects every row when there is no filter', () => {
    const selectRows = jest.fn()
    const wrapper = mountTable({ data: rows(['apple', 'banana']), selectRows })
    expect(headerCheckbox(wrapper).prop('checked')).toBe(false)

    headerCheckbox(wrapper).simulate('click')
    expect(selectRows).toHaveBeenLastCalledWith({ apple: true, banana: true })

    wrapper.setProps({ selectedRows: { apple: true, banana: true } })
    wrapper.update()
    expect(headerCheckbox(wrapper).prop('checked')).toBe(true)
    expect(headerCheckbox(wrapper).prop('indeterminate')).toBe(false)

    headerCheckbox(wrapper).simulate('click')
    expect(selectRows).toHaveBeenLastCalledWith({ apple: false, banana: false })
  })

  test('only selects the rows matching the active filter', () => {
    const selectRows = jest.fn()
    const wrapper = mountTable({ selectRows })
    setFilter(wrapper, 'berry')
    expect(shownNames(wrapper)).toEqual(['blueberry'])

    headerCheckbox(wrapper).simulate('click')

    expect(selectRows).toHaveBeenCalledTimes(1)
    expect(selectRows).toHaveBeenLastCalledWith({ blueberry: true })
  })

  test('selects filtered rows on every page', () => {
    const selectRows = jest.fn()
    const wrapper = mountTable({ selectRows, rowsPerPage: 2, defaultSortColumn: 'name' })
    setFilter(wrapper, 'a')
    expect(shownNames(wrapper)).toEqual(['apple', 'apricot'])

    headerCheckbox(wrapper).simulate('click')

    expect(selectRows).toHaveBeenLastCalledWith({ apple: true, apricot: true, avocado: true, banana: true })
  })

  test('reflects only the filtered rows and keeps the selection of hidden rows', () => {
    const selectRows = jest.fn()
    const wrapper = mountTable({ selectRows, selectedRows: { cherry: true, blueberry: true } })
    expect(headerCheckbox(wrapper).prop('checked')).toBe(false)
    expect(headerCheckbox(wrapper).prop('indeterminate')).toBe(true)

    setFilter(wrapper, 'berry')
    expect(headerCheckbox(wrapper).prop('checked')).toBe(true)
    expect(headerCheckbox(wrapper).prop('indeterminate')).toBe(false)

    headerCheckbox(wrapper).simulate('click')
    expect(selectRows).toHaveBeenLastCalledWith({ cherry: true, blueberry: false })

    setFilter(wrapper, 'ap')
    expect(headerCheckbox(wrapper).prop('checked')).toBe(false)
    expect(headerCheckbox(wrapper).prop('indeterminate')).toBe(false)

    headerCheckbox(wrapper).simulate('click')
    expect(selectRows).toHaveBeenLastCalledWith({ cherry: true, blueberry: true, apple: true, apricot: true })
  })

  test('includes the row data for filtered rows when requested', () => {
    const selectRows = jest.fn()
    const wrapper = mountTable({ selectRows, includeSelectedRowData: true })
    setFilter(wrapper, 'berry')

    headerCheckbox(wrapper).simulate('click')

    expect(selectRows).toHaveBeenLastCalledWith({ blueberry: { id: 'blueberry', name: 'blueberry' } })
  })
})
