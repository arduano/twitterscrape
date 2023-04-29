export function isTruthy<T>(value: T | null | undefined): value is T {
  return !!value;
}
