import "@tanstack/react-start/server-only";

import Stripe from "stripe";
import { getServerEnv } from "#/server/env.server";

export const stripeClient = new Stripe(getServerEnv().STRIPE_SECRET_KEY);
