import { config } from '../config.js';
import type { TopProblemCluster, DiscordEmbed } from '../types.js';

// Color codes
const COLORS = {
    success: 0x22c55e,  // Green
    info: 0x3b82f6,     // Blue
    warning: 0xf59e0b,  // Amber
};

// Send Discord message helper
async function sendMessage(content: string): Promise<boolean> {
    if (!config.discord.webhookUrl) return false;
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

// Send embed
async function sendEmbed(embed: DiscordEmbed): Promise<boolean> {
    if (!config.discord.webhookUrl) return false;
    try {
        const response = await fetch(config.discord.webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
        });
        return response.ok;
    } catch {
        return false;
    }
}

// Send DAILY summary (not per-post)
export async function sendDailySummary(
    date: string,
    totalScanned: number,
    problemsFound: number,
    topProblems: TopProblemCluster[]
): Promise<boolean> {
    if (!config.discord.webhookUrl) {
        console.log('Discord webhook not configured, skipping notification');
        return false;
    }

    // Build fields from top problems
    const problemFields = topProblems.slice(0, 5).map((p, i) => ({
        name: `${i + 1}. ${p.category}`,
        value: `📊 ${p.count} mentions | Dev Score: **${p.avgDevScore}**/10\n${p.topIndustries.length > 0 ? `🏢 ${p.topIndustries.join(', ')}` : ''}${p.bestQuote ? `\n💬 _"${p.bestQuote.slice(0, 100)}..."_` : ''}`,
        inline: false,
    }));

    const embed: DiscordEmbed = {
        title: `📊 Daily Problem Research Summary`,
        description: `**${date}**\n\n🔍 Scanned **${totalScanned}** posts\n✅ Found **${problemsFound}** problems worth tracking`,
        color: problemsFound > 0 ? COLORS.success : COLORS.info,
        fields: problemFields.length > 0 ? problemFields : [{
            name: 'No significant problems found',
            value: 'Check tomorrow or adjust subreddits',
            inline: false,
        }],
        timestamp: new Date().toISOString(),
    };

    const sent = await sendEmbed(embed);

    if (sent) {
        // Add link to dashboard
        await sendMessage('👀 View details: https://idea.fnworks.dev');
        console.log('📨 Daily summary sent to Discord');
    }

    return sent;
}

// Send WEEKLY summary
export async function sendWeeklySummary(
    weekStart: string,
    weekEnd: string,
    summary: {
        topOpportunities: Array<{
            category: string;
            totalMentions: number;
            avgDevScore: number;
            whyWorthBuilding: string;
        }>;
        emergingTrends: string[];
        quickWins: string[];
        weeklyInsight: string;
    }
): Promise<boolean> {
    if (!config.discord.webhookUrl) return false;

    const opportunityFields = summary.topOpportunities.slice(0, 3).map((opp, i) => ({
        name: `🏆 #${i + 1}: ${opp.category}`,
        value: `Mentions: ${opp.totalMentions} | Score: **${opp.avgDevScore}**/10\n${opp.whyWorthBuilding}`,
        inline: false,
    }));

    const embed: DiscordEmbed = {
        title: `📈 Weekly Research Summary`,
        description: `**${weekStart} → ${weekEnd}**\n\n${summary.weeklyInsight}`,
        color: COLORS.warning,
        fields: [
            ...opportunityFields,
            {
                name: '🌱 Emerging Trends',
                value: summary.emergingTrends.length > 0
                    ? summary.emergingTrends.join(', ')
                    : 'None detected',
                inline: true,
            },
            {
                name: '⚡ Quick Wins',
                value: summary.quickWins.length > 0
                    ? summary.quickWins.join(', ')
                    : 'None identified',
                inline: true,
            },
        ],
        timestamp: new Date().toISOString(),
    };

    const sent = await sendEmbed(embed);
    if (sent) {
        console.log('📨 Weekly summary sent to Discord');
    }
    return sent;
}
