import { initializePaddle, type Paddle } from "@paddle/paddle-js";

let paddle: Promise<Paddle | undefined> | undefined;

/** Paddle.js, loaded once, in the sandbox or in production as the build's env says. */
export function loadPaddle(): Promise<Paddle | undefined> {
  paddle ??= initializePaddle({
    environment: process.env.NEXT_PUBLIC_PADDLE_ENVIRONMENT as "sandbox" | "production",
    token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN as string,
  });
  return paddle;
}

export type Plan = "monthly" | "yearly";

/** Each plan's Paddle price. */
export const PRICE: Record<Plan, string> = {
  monthly: process.env.NEXT_PUBLIC_PADDLE_PRICE_MONTHLY as string,
  yearly: process.env.NEXT_PUBLIC_PADDLE_PRICE_YEARLY as string,
};

/** Whether this build has Paddle's values for the plan: without them there is no checkout. */
export function sells(plan: Plan): boolean {
  return Boolean(process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN && PRICE[plan]);
}
