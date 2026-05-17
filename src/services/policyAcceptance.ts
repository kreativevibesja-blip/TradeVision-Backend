import { Request } from 'express';
import { createPolicyAcceptanceRecord, getLatestAcceptedPolicyAcceptance } from '../lib/supabase';

export const NO_REFUND_POLICY_TYPE = 'NO_REFUND';
export const NO_REFUND_POLICY_VERSION = 'v1.0';

export class PolicyAcceptanceRequiredError extends Error {
  constructor() {
    super('Policy acceptance required.');
    this.name = 'PolicyAcceptanceRequiredError';
  }
}

const getRequestIp = (req: Request) =>
  (typeof req.headers['x-forwarded-for'] === 'string' ? req.headers['x-forwarded-for'].split(',')[0]?.trim() : null)
  ?? req.socket.remoteAddress
  ?? null;

const getRequestUserAgent = (req: Request) =>
  typeof req.headers['user-agent'] === 'string'
    ? req.headers['user-agent'].slice(0, 500)
    : null;

export const recordNoRefundPolicyAcceptance = async (params: {
  userId: string;
  planId: string;
  req: Request;
}) => createPolicyAcceptanceRecord({
  user_id: params.userId,
  plan_id: params.planId,
  policy_type: NO_REFUND_POLICY_TYPE,
  policy_version: NO_REFUND_POLICY_VERSION,
  accepted: true,
  accepted_at: new Date().toISOString(),
  ip_address: getRequestIp(params.req),
  user_agent: getRequestUserAgent(params.req),
});

export const assertNoRefundPolicyAccepted = async (params: {
  userId: string;
  planId: string;
  policyAccepted: boolean;
  req: Request;
  persistAcceptance: boolean;
}) => {
  if (!params.policyAccepted) {
    throw new PolicyAcceptanceRequiredError();
  }

  if (params.persistAcceptance) {
    await recordNoRefundPolicyAcceptance({
      userId: params.userId,
      planId: params.planId,
      req: params.req,
    });
    return;
  }

  const acceptance = await getLatestAcceptedPolicyAcceptance(
    params.userId,
    params.planId,
    NO_REFUND_POLICY_TYPE,
    NO_REFUND_POLICY_VERSION,
  );

  if (!acceptance?.accepted) {
    throw new PolicyAcceptanceRequiredError();
  }
};
