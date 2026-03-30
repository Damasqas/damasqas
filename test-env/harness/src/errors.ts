// Each error type has a weight (probability) and an exact error message + stack.
// Multiple jobs failing with the same error MUST produce identical strings
// so Damasqas's error grouper can group them correctly.

export const ERRORS: Record<string, { weight: number; message: string; stack: string }[]> = {
  "email-send": [
    { weight: 60, message: "TypeError: Cannot read property 'email' of undefined",
      stack: "at processEmail (workers/email.ts:47:23)\n    at Worker.processJob (bullmq/worker.js:386:28)" },
    { weight: 25, message: "Error: SMTP connection timeout after 30000ms",
      stack: "at SMTPConnection._onTimeout (nodemailer/smtp-connection/index.js:762:34)" },
    { weight: 10, message: "Error: 550 5.1.1 The email account does not exist",
      stack: "at SMTPConnection._onData (nodemailer/smtp-connection/index.js:556:18)" },
    { weight: 5,  message: "Error: getaddrinfo ENOTFOUND smtp.sendgrid.net",
      stack: "at GetAddrInfoReqWrap.onlookup (node:dns:107:26)" },
  ],
  "webhook-deliver": [
    { weight: 50, message: "Error: Request failed with status code 503",
      stack: "at createError (axios/lib/core/createError.js:16:15)" },
    { weight: 30, message: "Error: connect ECONNREFUSED 10.0.1.50:443",
      stack: "at TCPConnectWrap.afterConnect (node:net:1595:16)" },
    { weight: 20, message: "Error: timeout of 10000ms exceeded",
      stack: "at RedirectableRequest.emit (follow-redirects/index.js:74:13)" },
  ],
  "data-enrich": [
    { weight: 70, message: "Error: Rate limit exceeded. Retry after 60 seconds",
      stack: "at ClearbitClient.request (lib/clearbit.ts:89:11)" },
    { weight: 30, message: "Error: Company not found for domain unknown-domain.com",
      stack: "at enrichCompany (workers/enrich.ts:34:15)" },
  ],
  "pdf-generate": [
    { weight: 80, message: "Error: PDF generation failed - puppeteer timeout",
      stack: "at Page.waitForSelector (puppeteer/common/Page.js:2156:17)" },
    { weight: 20, message: "Error: Protocol error (Target.createTarget): Target closed",
      stack: "at Connection._onClose (puppeteer/common/Connection.js:225:15)" },
  ],
  "image-resize": [
    { weight: 90, message: "Error: Input buffer contains unsupported image format",
      stack: "at Sharp.toBuffer (sharp/lib/output.js:76:19)" },
    { weight: 10, message: "Error: ENOMEM: not enough memory, allocate 67108864",
      stack: "at Object.allocUnsafe (node:buffer:337:13)" },
  ],
  "payment-process": [
    { weight: 60, message: "Error: Your card was declined. (card_declined)",
      stack: "at StripeClient.charge (lib/stripe.ts:112:9)" },
    { weight: 30, message: "Error: Idempotency key has already been used",
      stack: "at StripeClient.charge (lib/stripe.ts:98:11)" },
    { weight: 10, message: "Error: connect ETIMEDOUT 52.4.128.93:443",
      stack: "at TCPConnectWrap.afterConnect (node:net:1595:16)" },
  ],
};

export function pickError(queue: string): { message: string; stack: string } {
  const errors = ERRORS[queue];
  if (!errors || errors.length === 0) {
    return { message: "Error: Unknown failure", stack: "at unknown" };
  }
  const totalWeight = errors.reduce((sum, e) => sum + e.weight, 0);
  let rand = Math.random() * totalWeight;
  for (const e of errors) {
    rand -= e.weight;
    if (rand <= 0) return { message: e.message, stack: e.stack };
  }
  return errors[0];
}
