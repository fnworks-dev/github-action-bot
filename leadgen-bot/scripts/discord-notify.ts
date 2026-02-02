#!/usr/bin/env tsx
/**
 * Discord Notification Utility for Bot Health Monitoring
 * 
 * Usage:
 *   tsx scripts/discord-notify.ts <type> [message]
 *   
 * Types:
 *   - start: Bot started
 *   - stop: Bot stopped
 *   - error: Bot encountered error
 *   - stale: Bot hasn't fetched new data
 *   - heartbeat: Daily heartbeat
 */

import { hostname } from 'os';

const WEBHOOK_URL = 'https://discord.com/api/webhooks/1467731676376465468/v7VvJGtvNS58wsXWs9ryJdV6Gh1cnhbcbpyv5PsQdfeP9X_1950kojPqrPDscM3fw9rQ';

interface Embed {
    title: string;
    description: string;
    color: number;
    timestamp: string;
    fields?: { name: string; value: string; inline?: boolean }[];
}

const COLORS = {
    start: 0x00ff00,    // Green
    stop: 0xffa500,     // Orange
    error: 0xff0000,    // Red
    stale: 0xffff00,    // Yellow
    heartbeat: 0x0099ff, // Blue
};

const TITLES = {
    start: '🟢 Twitter Bot Started',
    stop: '🟠 Twitter Bot Stopped',
    error: '🔴 Twitter Bot Error',
    stale: '🟡 Twitter Bot Stale',
    heartbeat: '🔵 Twitter Bot Heartbeat',
};

async function sendDiscordNotification(type: keyof typeof COLORS, customMessage?: string) {
    const timestamp = new Date().toISOString();
    const host = hostname();
    
    const embed: Embed = {
        title: TITLES[type],
        description: customMessage || 'No additional details provided',
        color: COLORS[type],
        timestamp: timestamp,
        fields: [
            { name: 'Host', value: host, inline: true },
            { name: 'Time', value: new Date().toLocaleString(), inline: true },
        ],
    };

    // Add extra fields based on type
    if (type === 'stale') {
        embed.fields?.push({
            name: 'Action Required',
            value: 'Bot may have crashed. Check logs and restart if needed.',
            inline: false,
        });
    }

    try {
        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ embeds: [embed] }),
        });

        if (!response.ok) {
            console.error(`Failed to send Discord notification: ${response.status} ${response.statusText}`);
            process.exit(1);
        }
        console.log(`✅ Discord notification sent: ${type}`);
    } catch (error) {
        console.error('Failed to send Discord notification:', error);
        process.exit(1);
    }
}

// CLI usage
const type = process.argv[2] as keyof typeof COLORS;
const message = process.argv.slice(3).join(' ');

if (!type || !COLORS[type]) {
    console.error(`Usage: tsx discord-notify.ts <${Object.keys(COLORS).join('|')}> [message]`);
    process.exit(1);
}

sendDiscordNotification(type, message || undefined);
