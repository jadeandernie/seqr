const SORT_DELIMITER = ','

export const splitSorts = (sort: string | undefined | null): string[] => (
  (sort || '').split(SORT_DELIMITER).filter(val => val)
)

export const joinSorts = (sorts: string[] | undefined | null, defaultSort: string): string => (
  (sorts || []).filter(sort => sort !== defaultSort).join(SORT_DELIMITER) || defaultSort
)
