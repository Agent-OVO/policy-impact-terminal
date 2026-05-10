import { chainNodes, companies } from "../../data/policy";
import type { ChainNode, Company } from "../../data/policy";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getCompanyById(id: string, items: Company[] = companies) {
  return items.find((company) => company.id === id);
}

export function getNodeById(id: string, items: ChainNode[] = chainNodes) {
  return items.find((node) => node.id === id);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}
