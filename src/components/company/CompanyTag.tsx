import type { RelationType } from "../../data/policy";
import { companyRelationClass } from "./companyConstants";
import { cx } from "./companyUtils";

export function CompanyTag({ value, small }: { value: string; small?: boolean }) {
  return <span className={cx("tag", small && "small", companyRelationClass[value as RelationType] || "")}>{value}</span>;
}
