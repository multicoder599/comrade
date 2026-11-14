export function paymentLabel(method: string): string {
  switch (method) {
    case "megapay":
      return "M-Pesa";
    case "split":
      return "Cash + M-Pesa";
    case "debt":
      return "Debt";
    default:
      return "Cash";
  }
}

export function debtStatusLabel(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "partial":
      return "Part paid";
    case "settled":
      return "Settled";
    case "cancelled":
      return "Cancelled";
    default:
      return status;
  }
}
