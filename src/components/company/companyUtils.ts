import { chainNodes } from "../../data/policy";
import type { ChainNode, Company } from "../../data/policy";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function clampScore(value: number | null | undefined) {
  return Number.isFinite(value) ? clamp(Number(value), 0, 100) : 0;
}

export function getCompanyById(id: string | null | undefined, items: Company[] = []) {
  if (!id) return undefined;
  return items.find((company) => company.id === id);
}

export function getNodeById(id: string, items: ChainNode[] = chainNodes) {
  return items.find((node) => node.id === id);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}
