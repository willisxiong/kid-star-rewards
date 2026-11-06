import { escapeHtml } from './http';

export type Delivery =
  | { channel: 'resend' | 'mailchannels' }
  | { channel: 'log'; devLink?: string };

export async function deliverMagicLink(env: Env, to: string, url: string): Promise<Delivery> {
  const subject = '儿童星级奖励系统 · 家长登录链接';
  const text = `点击链接登录家长端（15 分钟内有效，仅可使用一次）：\n${url}\n`;

  if (env.RESEND_API_KEY) {
    const from = env.EMAIL_FROM || 'Kid Star Rewards <onboarding@resend.dev>';
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html: `<p>点击链接登录家长端（15 分钟内有效，仅可使用一次）：</p><p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>`,
        text,
      }),
    });
    if (response.ok) return { channel: 'resend' };
    console.error('[kid-star] Resend failed', response.status, await response.text());
  }

  if (env.MAILCHANNELS === '1') {
    const from = env.EMAIL_FROM || 'noreply@kid-star-rewards.workers.dev';
    const response = await fetch('https://api.mailchannels.net/tx/v1/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: from, name: 'Kid Star Rewards' },
        subject,
        content: [{ type: 'text/plain', value: text }],
      }),
    });
    if (response.ok) return { channel: 'mailchannels' };
    console.error('[kid-star] Mailchannels failed', response.status, await response.text());
  }

  console.log(`[kid-star] magic link for ${to}: ${url}`);
  return {
    channel: 'log',
    devLink: env.MAGIC_LINK_DEV_ECHO === '1' ? url : undefined,
  };
}
