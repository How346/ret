export const inr = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }).format(n || 0);

export const num = (n: number, d = 2) =>
  new Intl.NumberFormat("en-IN", { maximumFractionDigits: d }).format(n || 0);
