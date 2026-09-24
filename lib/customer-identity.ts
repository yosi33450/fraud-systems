const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export const isSharedServiceEmail = (value?: string | null) => {
  const email = value?.trim().toLowerCase() ?? "";
  if (!email) return false;
  return email === "general-customer@payplus.co.il"
    || email.endsWith("@payplus.co.il")
    || /^(general|guest|anonymous|unknown|no-?reply|donotreply)[+._-]/i.test(email);
};

export const selectCustomerEmail = (input: {
  orderEmail?: string | null;
  customerEmail?: string | null;
  customAttributes?: Array<{ key: string; value: string }>;
}) => {
  const attributeEmails = (input.customAttributes ?? [])
    .filter((attribute) => /e-?mail|דוא["״']?ל|מייל/i.test(attribute.key))
    .map((attribute) => attribute.value.trim());
  const candidates = [...attributeEmails, input.customerEmail ?? "", input.orderEmail ?? ""];
  return candidates.find((email) => emailPattern.test(email) && !isSharedServiceEmail(email)) ?? "";
};
