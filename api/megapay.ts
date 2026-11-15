import { env, megapayConfigured } from "./lib/env";
import { log } from "./lib/logger";

// MegaPay (megapay.co.ke) M-Pesa STK Push integration.
// API reference: https://megapay.co.ke/documentation
//
//   POST {baseUrl}/initiatestk        { api_key, email, amount, msisdn, reference }
//   POST {baseUrl}/transactionstatus  { api_key, email, transaction_request_id }
//
// Credentials come from MEGAPAY_API_KEY / MEGAPAY_EMAIL on the server only —
// they are never exposed to the browser.

export class MegaPayError extends Error {}

export function isMegaPayReady(): boolean {
  return megapayConfigured();
}

/** Normalize a Kenyan phone number to 254XXXXXXXXX. */
export function normalizeMsisdn(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (/^0[17]\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^[17]\d{8}$/.test(digits)) return `254${digits}`;
  if (/^254[17]\d{8}$/.test(digits)) return digits;
  throw new MegaPayError(
    "Enter a valid Safaricom number e.g. 0712345678 or 254712345678",
  );
}

type InitiateResponse = {
  success?: string | number | boolean;
  status?: string | number | boolean;
  ResponseCode?: string | number;
  errorMessage?: string;
  massage?: string;
  message?: string;
  transaction_request_id?: string;
  ResponseDescription?: string;
};

export async function initiateStkPush(input: {
  amountKes: number; // whole KES (MegaPay takes a plain amount)
  phone: string;
  reference: string;
  description: string;
}): Promise<{ requestId: string; message: string }> {
  if (!megapayConfigured()) {
    throw new MegaPayError(
      "MegaPay is not configured. Set MEGAPAY_API_KEY and MEGAPAY_EMAIL on the server.",
    );
  }
  const msisdn = normalizeMsisdn(input.phone);

  let res: Response;
  try {
    res = await fetch(`${env.megapay.baseUrl}/initiatestk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.megapay.apiKey,
        email: env.megapay.email,
        amount: input.amountKes,
        msisdn,
        callback_url: env.megapay.callbackUrl,
        description: input.description,
        reference: input.reference,
      }),
      signal: AbortSignal.timeout(35_000),
    });
  } catch (err) {
    log.error("megapay initiatestk network error", {
      error: err instanceof Error ? err.message : String(err),
    });
    throw new MegaPayError("Could not reach MegaPay. Check internet and try again.");
  }

  const data = (await res.json().catch(() => ({}))) as InitiateResponse;
  // MegaPay's success shape has varied over time — only treat EXPLICIT
  // failures as rejections (mirrors the shop's proven Stallion integration).
  const rejected =
    !res.ok ||
    data.status === false ||
    data.success === false ||
    String(data.ResponseCode ?? "") === "1";
  if (rejected) {
    log.error("megapay initiatestk rejected", { status: res.status });
    throw new MegaPayError(
      data.errorMessage || data.massage || data.message ||
        data.ResponseDescription ||
        "MegaPay rejected the request. Check your API key and email.",
    );
  }
  // If MegaPay didn't hand back a request id, fall back to our own reference —
  // the webhook matches on the reference / phone + amount in that case.
  return {
    requestId: data.transaction_request_id || input.reference,
    message: data.massage || data.message || "STK push sent to customer phone.",
  };
}

export type MegaPayStatus =
  | { state: "success"; receipt?: string }
  | { state: "pending" }
  | { state: "failed"; reason: string };

const FAILURE_CODES: Record<number, string> = {
  1: "Insufficient M-Pesa balance",
  1032: "Cancelled by customer",
  1037: "Phone unreachable (timeout)",
  1025: "Failed to send push request",
  9999: "Failed to send push request",
  2001: "Invalid initiator information",
  1019: "Transaction expired",
  1001: "Another transaction is in progress for this number",
};

type StatusResponse = {
  ResponseCode?: number | string;
  ResponseDescription?: string;
  TransactionReceipt?: string;
  status?: string;
  message?: string;
};

export async function checkTransactionStatus(
  requestId: string,
): Promise<MegaPayStatus> {
  if (!megapayConfigured()) {
    throw new MegaPayError("MegaPay is not configured on the server.");
  }
  let res: Response;
  try {
    res = await fetch(`${env.megapay.baseUrl}/transactionstatus`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: env.megapay.apiKey,
        email: env.megapay.email,
        transaction_request_id: requestId,
      }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    // Network hiccup — treat as still pending so the poll continues.
    return { state: "pending" };
  }
  const data = (await res.json().catch(() => ({}))) as StatusResponse;
  const code = Number(data.ResponseCode);
  if (code === 0 || data.status === "success") {
    return { state: "success", receipt: data.TransactionReceipt };
  }
  // 500100 = Safaricom is still waiting for the customer's PIN — and any
  // unknown/absent code means we simply don't know yet. Keep polling.
  if (code === 500100 || !Number.isFinite(code)) {
    return { state: "pending" };
  }
  return {
    state: "failed",
    reason:
      FAILURE_CODES[code] || data.ResponseDescription || "Payment failed",
  };
}
