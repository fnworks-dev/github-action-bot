import { config } from '../config.js';
import type { Lead, DiscordEmbed } from '../types.js';

// Discord message character limit
const DISCORD_CHAR_LIMIT = 1900; // Leave buffer under 2000

// Color codes for Discord embeds
const COLORS = {
    hot: 0xff4500,
    warm: 0xffa500,
    maybe: 0x3498db,
    cold: 0x808080,
};

function getScoreEmoji(score: number): string {
    if (score >= 8) return '🔥';
    if (score >= 6) return '🎯';
    if (score >= 4) return '📋';
    return '❌';
}

function getColor(score: number): number {
    if (score >= 8) return COLORS.hot;
    if (score >= 6) return COLORS.warm;
    if (score >= 4) return COLORS.maybe;
    return COLORS.cold;
}

function formatTimeAgo(dateStr: string | null): string {
    if (!dateStr) return '?';
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d`;
}

// Send Discord message helper
async function sendMessage(content: string): Promise<boolean> {
    try {
        const response = await fetch(config.discord.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

// Send notification for a hot lead (score 6+)
export async function sendDiscordNotification(lead: Lead): Promise<boolean> {
    if (!config.discord.webhookUrl) {
        console.error('Discord webhook URL not configured');
        return false;
    }

    const embed: DiscordEmbed = {
        title: `${getScoreEmoji(lead.score || 5)} HOT LEAD (Score: ${lead.score}/10)`,
        description: lead.title,
        color: getColor(lead.score || 5),
        fields: [
            {
                name: '💡 Summary',
                value: lead.summary || 'No summary available',
                inline: false,
            },
            {
                name: '📝 Suggested Reply',
                value: lead.suggestedReply
                    ? `\`\`\`${lead.suggestedReply.slice(0, 700)}\`\`\``
                    : 'No reply suggestion',
                inline: false,
            },
            {
                name: '📍 Source',
                value: lead.subreddit ? `r/${lead.subreddit}` : lead.source,
                inline: true,
            },
            {
                name: '⏰ Posted',
                value: formatTimeAgo(lead.postedAt),
                inline: true,
            },
        ],
        url: lead.sourceUrl,
        timestamp: new Date().toISOString(),
    };

    try {
        const response = await fetch(config.discord.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [embed],
                content: `🔗 **[View Post](${lead.sourceUrl})**`,
            }),
        });

        if (!response.ok) {
            throw new Error(`Discord API error: ${response.status}`);
        }
        console.log(`📨 Sent Discord notification for lead: ${lead.title.slice(0, 50)}...`);
        return true;
    } catch (error) {
        console.error('Failed to send Discord notification:', error);
        return false;
    }
}

// Format a single lead line
function formatLeadLine(lead: Lead): string {
    const source = lead.subreddit ? `r/${lead.subreddit}` : lead.source;
    const score = lead.score || 0;
    const emoji = getScoreEmoji(score);
    const time = formatTimeAgo(lead.postedAt);
    const title = lead.title.slice(0, 50) + (lead.title.length > 50 ? '...' : '');
    return `${emoji} **[${score}]** \`${source}\` [${title}](${lead.sourceUrl}) (${time})`;
}

// Send summary with ALL leads, split into multiple messages if needed
export async function sendSummaryNotification(
    totalFetched: number,
    newLeads: number,
    notified: number,
    allLeads: Lead[] = []
): Promise<void> {
    if (!config.discord.webhookUrl) return;

    // Categorize leads
    const hotLeads = allLeads.filter(l => (l.score || 0) >= 6);
    const maybeLeads = allLeads.filter(l => (l.score || 0) >= 4 && (l.score || 0) < 6);
    const trashLeads = allLeads.filter(l => (l.score || 0) < 4);

    // Build header
    const header = hotLeads.length > 0
        ? `✅ **Lead Bot** - Found ${hotLeads.length} hot lead(s)!`
        : maybeLeads.length > 0
            ? `📊 **Lead Bot** - ${maybeLeads.length} potential lead(s)`
            : `📊 **Lead Bot** - No quality leads this cycle`;

    const stats = `\n📈 Checked: ${totalFetched} | New: ${newLeads} | Hot: ${hotLeads.length} | Maybe: ${maybeLeads.length} | Skipped: ${trashLeads.length}`;

    // Send header first
    await sendMessage(header + stats);

    // Small delay between messages
    await new Promise(r => setTimeout(r, 500));

    // Build and send lead messages
    const leadsToShow = [...hotLeads, ...maybeLeads]; // Show hot + maybe, skip trash

    if (leadsToShow.length === 0) {
        return; // No leads to show
    }

    let currentMessage = '';
    let messageCount = 1;
    const maxMessages = 5; // Don't spam too many messages

    for (let i = 0; i < leadsToShow.length; i++) {
        const lead = leadsToShow[i];
        const line = formatLeadLine(lead) + '\n';

        // Check if adding this line would exceed limit
        if (currentMessage.length + line.length > DISCORD_CHAR_LIMIT) {
            // Send current message
            if (currentMessage) {
                await sendMessage(currentMessage);
                await new Promise(r => setTimeout(r, 500));
                messageCount++;
            }

            // Start new message
            currentMessage = line;

            // Check if we've hit max messages
            if (messageCount >= maxMessages && i < leadsToShow.length - 1) {
                const remaining = leadsToShow.length - i - 1;
                currentMessage += `\n_...and ${remaining} more leads in database_`;
                break;
            }
        } else {
            currentMessage += line;
        }
    }

    // Send final message
    if (currentMessage) {
        await sendMessage(currentMessage);
    }
}
