import type { Employee } from "./types";

const normalize = (value?: string) => (value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
export function allowedEmployeeAddresses(employee: Employee): string[] {
  return [employee.address, employee.secondaryAddress].map(normalize).filter(Boolean);
}
export function employeeAddressMismatch(employee: Employee, address?: string): boolean {
  const allowed = allowedEmployeeAddresses(employee);
  return Boolean(normalize(address) && allowed.length && !allowed.includes(normalize(address)));
}
export function employeeIdentityMatches(employee: Employee, buyer: { email?: string; address?: string }): boolean {
  return Boolean((normalize(buyer.email) && [employee.email, employee.privateEmail].some((email) => normalize(email) === normalize(buyer.email)))
    || (normalize(buyer.address) && allowedEmployeeAddresses(employee).includes(normalize(buyer.address))));
}
export function identifyEmployee(employees: Employee[], buyer: { email?: string; address?: string }): Employee | undefined {
  // Email is stronger than a shared home/work address. Ambiguous identities stay unassigned.
  const emails = employees.filter((employee) => employeeIdentityMatches(employee, { email: buyer.email }));
  const matches = emails.length ? emails : employees.filter((employee) => employeeIdentityMatches(employee, { address: buyer.address }));
  return matches.length === 1 ? matches[0] : undefined;
}
export function isEmployeeCode(code: string, prefix: string): boolean {
  return Boolean(normalize(prefix) && normalize(code).startsWith(normalize(prefix)));
}
