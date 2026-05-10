import type { EntityId } from "../types";

export interface Identifiable {
  id: EntityId;
}

export function indexById<T extends Identifiable>(items: readonly T[]): Record<EntityId, T> {
  return items.reduce<Record<EntityId, T>>((index, item) => {
    index[item.id] = item;
    return index;
  }, {});
}

export function uniqueValues(values: readonly string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function groupBy<T>(
  items: readonly T[],
  getKey: (item: T) => string
): Record<string, T[]> {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = getKey(item);
    groups[key] = groups[key] ?? [];
    groups[key].push(item);
    return groups;
  }, {});
}

export function compact<T>(values: readonly (T | null | undefined)[]): T[] {
  return values.filter((value): value is T => value !== null && value !== undefined);
}
