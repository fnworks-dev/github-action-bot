/**
 * Discord Alert System for Twitter Bot Monitoring
 *
 * Sends formatted Discord embeds for alerts with throttling to prevent spam.
 * Alert types:
 * - twitter_error (red) - Critical errors
 * - twitter_empty_session (orange) - Missing/invalid session
 * - twitter_zero_results (yellow) - No results returned
 */

import { config } from "../config.js";

// Alert type definitions
export type AlertType =
  | "twitter_error"
  | "twitter_empty_session"
  | "twitter_zero_results";

// Alert color codes
const ALERT_COLORS: Record<AlertType, number> = {
  twitter_error: 0xff0000, // Red
  twitter_empty_session: 0xff6600, // Orange
  twitter_zero_results: 0xffff00, // Yellow
};

// Alert titles and descriptions
const ALERT_TEMPLATES: Record<
  AlertType,
  { title: string; defaultDesc: string }
> = {
  twitter_error: {
    title: "🚨 Twitter Bot Error",
    defaultDesc: "A critical error occurred in the Twitter bot",
  },
  twitter_empty_session: {
    title: "⚠️ Twitter Session Issue",
    defaultDesc: "Twitter session is missing or invalid",
  },
  twitter_zero_results: {
    title: "📊 Twitter Zero Results",
    defaultDesc: "No tweets were returned from the search",
  },
};

// Alert tracking for throttling (1 alert per type per hour)
const lastAlertTime: Record<AlertType, number> = {
  twitter_error: 0,
  twitter_empty_session: 0,
  twitter_zero_results: 0,
};
const ALERT_THROTTLE_MS = 60 * 60 * 1000; // 1 hour

/**
 * Send a Discord alert embed
 */
async function sendAlertEmbed(
  alertType: AlertType,
  description: string,
  fields?: Array<{ name: string; value: string; inline?: boolean }>,
): Promise<boolean> {
  if (!config.discord.twitterHealthWebhookUrl) {
    console.error("[Alerts] Discord webhook URL not configured");
    return false;
  }

  const template = ALERT_TEMPLATES[alertType];

  const embed = {
    title: template.title,
    description: description || template.defaultDesc,
    color: ALERT_COLORS[alertType],
    fields: fields || [],
    timestamp: new Date().toISOString(),
    footer: {
      text: "Twitter Bot Health Monitor",
    },
  };

  try {
    const response = await fetch(config.discord.twitterHealthWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Twitter Bot Monitor",
        avatar_url: "https://abs.twimg.com/icons/apple-touch-icon-192x192.png",
        embeds: [embed],
      }),
    });

    if (!response.ok) {
      throw new Error(`Discord API error: ${response.status}`);
    }

    console.log(`[Alerts] Sent ${alertType} alert to Discord`);
    return true;
  } catch (error) {
    console.error(`[Alerts] Failed to send ${alertType} alert:`, error);
    return false;
  }
}

/**
 * Send an alert with throttling (1 per type per hour)
 */
export async function sendAlert(
  alertType: AlertType,
  message?: string,
  fields?: Array<{ name: string; value: string; inline?: boolean }>,
): Promise<boolean> {
  const now = Date.now();
  const lastTime = lastAlertTime[alertType] || 0;

  // Check if alert should be throttled
  if (now - lastTime < ALERT_THROTTLE_MS) {
    console.log(
      `[Alerts] Throttling ${alertType} alert (last sent ${Math.round((now - lastTime) / 1000 / 60)} minutes ago)`,
    );
    return false;
  }

  // Send the alert
  const success = await sendAlertEmbed(alertType, message || "", fields);

  // Update last sent time if successful
  if (success) {
    lastAlertTime[alertType] = now;
  }

  return success;
}

/**
 * Send a Twitter error alert
 */
export async function alertTwitterError(
  error: string,
  context?: Record<string, string>,
): Promise<boolean> {
  const fields = [
    {
      name: "🔍 Error Details",
      value: `\`\`\`${error.slice(0, 500)}\`\`\``,
      inline: false,
    },
  ];

  if (context) {
    Object.entries(context).forEach(([key, value]) => {
      fields.push({
        name: key,
        value: value,
        inline: true,
      });
    });
  }

  return sendAlert(
    "twitter_error",
    "The Twitter bot encountered a critical error",
    fields,
  );
}

/**
 * Send a Twitter empty session alert
 */
export async function alertTwitterEmptySession(
  reason: string,
): Promise<boolean> {
  const fields = [
    {
      name: "🔑 Session Issue",
      value: reason,
      inline: false,
    },
    {
      name: "📋 Action Required",
      value:
        "Please update TWITTER_SESSION environment variable with valid cookies",
      inline: false,
    },
  ];

  return sendAlert("twitter_empty_session", reason, fields);
}

/**
 * Send a Twitter zero results alert
 */
export async function alertTwitterZeroResults(
  query: string,
  hoursSearched: number,
): Promise<boolean> {
  const fields = [
    {
      name: "🔍 Search Query",
      value: query,
      inline: true,
    },
    {
      name: "⏰ Time Range",
      value: `Last ${hoursSearched} hours`,
      inline: true,
    },
    {
      name: "💡 Possible Causes",
      value:
        "• Session expired\n• No matching tweets in timeframe\n• Rate limiting\n• Search query too specific",
      inline: false,
    },
  ];

  return sendAlert(
    "twitter_zero_results",
    `No results found for query: ${query}`,
    fields,
  );
}

/**
 * Reset alert throttle (for testing or manual override)
 */
export function resetAlertThrottle(alertType?: AlertType): void {
  if (alertType) {
    lastAlertTime[alertType] = 0;
    console.log(`[Alerts] Reset throttle for ${alertType}`);
  } else {
    Object.keys(lastAlertTime).forEach((key) => {
      lastAlertTime[key as AlertType] = 0;
    });
    console.log("[Alerts] Reset all alert throttles");
  }
}

/**
 * Get time until next alert can be sent (for monitoring)
 */
export function getTimeUntilNextAlert(alertType: AlertType): number {
  const now = Date.now();
  const lastTime = lastAlertTime[alertType] || 0;
  const timeSince = now - lastTime;

  if (timeSince >= ALERT_THROTTLE_MS) {
    return 0; // Can send now
  }

  return ALERT_THROTTLE_MS - timeSince; // Milliseconds until next allowed
}
