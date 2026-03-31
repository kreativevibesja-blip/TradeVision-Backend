import webpush from 'web-push';
import { supabase } from '../lib/supabase';
import { config } from '../config';

const PUSH_SUB_TABLE = 'PushSubscription';

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_MAILTO = process.env.VAPID_MAILTO || `mailto:${config.email.replyTo}`;

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_MAILTO, VAPID_PUBLIC, VAPID_PRIVATE);
}

// ── Store push subscription ──

export async function savePushSubscription(
  userId: string,
  endpoint: string,
  p256dh: string,
  auth: string,
): Promise<void> {
  const { error } = await supabase.from(PUSH_SUB_TABLE).upsert(
    { userId, endpoint, p256dh, auth },
    { onConflict: 'userId,endpoint' },
  );

  if (error) throw new Error(error.message);
}

// ── Remove push subscription ──

export async function removePushSubscription(userId: string, endpoint: string): Promise<void> {
  const { error } = await supabase
    .from(PUSH_SUB_TABLE)
    .delete()
    .eq('userId', userId)
    .eq('endpoint', endpoint);

  if (error) throw new Error(error.message);
}

// ── Get all subscriptions for a user ──

export async function getSubscriptionsForUser(
  userId: string,
): Promise<Array<{ endpoint: string; p256dh: string; auth: string }>> {
  const { data, error } = await supabase
    .from(PUSH_SUB_TABLE)
    .select('endpoint, p256dh, auth')
    .eq('userId', userId);

  if (error) throw new Error(error.message);
  return (data ?? []) as Array<{ endpoint: string; p256dh: string; auth: string }>;
}

// ── Send push notification to a single subscription ──

async function sendToSubscription(
  sub: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; tag?: string; url?: string },
  userId?: string,
): Promise<boolean> {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    console.warn('[Push] VAPID keys not configured — skipping send');
    return false;
  }

  try {
    await webpush.sendNotification(
      {
        endpoint: sub.endpoint,
        keys: { p256dh: sub.p256dh, auth: sub.auth },
      },
      JSON.stringify(payload),
    );
    return true;
  } catch (err: any) {
    // 410 Gone or 404 means subscription expired — clean up
    if (err.statusCode === 410 || err.statusCode === 404) {
      console.log('[Push] Subscription expired, removing:', sub.endpoint.slice(0, 60));
      if (userId) {
        await supabase
          .from(PUSH_SUB_TABLE)
          .delete()
          .eq('userId', userId)
          .eq('endpoint', sub.endpoint)
          .then(() => {});
      }
    } else {
      console.error('[Push] Send failed:', err.statusCode, err.body);
    }
    return false;
  }
}

// ── Send notification to all of a user's devices ──

export async function sendPushToUser(
  userId: string,
  payload: { title: string; body: string; tag?: string; url?: string },
): Promise<number> {
  const subscriptions = await getSubscriptionsForUser(userId);
  if (subscriptions.length === 0) return 0;

  let sent = 0;
  for (const sub of subscriptions) {
    const ok = await sendToSubscription(sub, payload, userId);
    if (ok) sent++;
  }
  return sent;
}
