import { chainNodes, companies } from "../../data/policy";

export function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getCompanyById(id: string) {
  return companies.find((company) => company.id === id);
}

export function getNodeById(id: string) {
  return chainNodes.find((node) => node.id === id);
}

export function isDefined<T>(value: T | null | undefined): value is T {
  return value != null;
}
