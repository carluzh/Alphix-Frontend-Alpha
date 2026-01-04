// Mutable type - removes readonly modifier from all properties
type Mutable<T> = {
  -readonly [P in keyof T]: T[P]
}

export function cloneReadonly<T extends object>(obj: T): Mutable<T> {
  return JSON.parse(JSON.stringify(obj))
}
