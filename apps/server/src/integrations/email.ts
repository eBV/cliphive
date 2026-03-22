/**
 * Transactional email via Resend.
 */
import axios from "axios";
import { config } from "../config.js";

const RESEND_API_KEY = config.RESEND_API_KEY;
const EMAIL_FROM = config.EMAIL_FROM;

interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

async function sendEmail(params: SendEmailParams): Promise<void> {
  const apiKey = RESEND_API_KEY;
  if (!apiKey) {
    console.warn("[email] RESEND_API_KEY not set, skipping email send");
    return;
  }

  await axios.post(
    "https://api.resend.com/emails",
    {
      from: EMAIL_FROM,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    },
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    }
  );
}

export async function sendRenderComplete(
  to: string,
  clipTitle: string,
  platforms: string[]
): Promise<void> {
  await sendEmail({
    to,
    subject: `🎬 Your clip "${clipTitle}" is ready`,
    html: `
      <h2>Your clip is rendered and ready to publish!</h2>
      <p><strong>${clipTitle}</strong> has been rendered for ${platforms.join(", ")}.</p>
      <p>Log in to <a href="${process.env["NEXT_PUBLIC_APP_URL"]}">ClipHive</a> to review and publish.</p>
    `,
  });
}

export async function sendPublishSuccess(
  to: string,
  clipTitle: string,
  platform: string,
  postUrl?: string
): Promise<void> {
  await sendEmail({
    to,
    subject: `✅ Published to ${platform}!`,
    html: `
      <h2>Your clip was published to ${platform}!</h2>
      <p><strong>${clipTitle}</strong> is now live.${postUrl ? ` <a href="${postUrl}">View post →</a>` : ""}</p>
    `,
  });
}

export async function sendWeeklyDigest(
  to: string,
  stats: { totalViews: number; topClip: string; clipsPublished: number }
): Promise<void> {
  await sendEmail({
    to,
    subject: "📊 Your ClipHive weekly report",
    html: `
      <h2>Your weekly ClipHive report</h2>
      <ul>
        <li>Total views this week: <strong>${stats.totalViews.toLocaleString()}</strong></li>
        <li>Clips published: <strong>${stats.clipsPublished}</strong></li>
        <li>Top clip: <strong>${stats.topClip}</strong></li>
      </ul>
      <p><a href="${process.env["NEXT_PUBLIC_APP_URL"]}/analytics">View full analytics →</a></p>
    `,
  });
}
