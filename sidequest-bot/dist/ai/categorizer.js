import { config } from '../config.js';
import { professions } from '../config.js';
/**
 * AI-based profession categorization using Gemini or GLM API.
 * Falls back to keyword matching if AI is unavailable.
 */
// Profession descriptions for AI context
const professionDescriptions = {
    'developer': 'Software development, programming, web/mobile app development, frontend/backend engineering',
    'artist': 'Visual art, illustration, graphic design, UI/UX design, concept art, game art',
    'voice-actor': 'Voice acting, voice-over work, narration, character voices, audiobooks',
    'video-editor': 'Video editing, motion graphics, VFX, post-production, color grading',
    'writer': 'Writing, copywriting, content writing, technical writing, scriptwriting',
    'audio': 'Sound design, music composition, audio engineering, game audio, Foley',
    'qa': 'Quality assurance, testing, QA engineering, game testing, beta testing',
    'virtual-assistant': 'Virtual assistance, administrative support, project management, data entry'
};
/**
 * Call Gemini API for categorization
 */
async function categorizeWithGemini(text) {
    const professionList = Object.values(professions).map(p => ({
        id: Object.keys(professions)[Object.values(professions).indexOf(p)],
        name: p.name,
        description: professionDescriptions[Object.keys(professions)[Object.values(professions).indexOf(p)]]
    }));
    const prompt = `You are a job posting classifier. Analyze this job post and determine which professions it matches.

JOB POST:
${text}

PROFESSION OPTIONS:
${professionList.map(p => `- ${p.id}: ${p.name} (${p.description})`).join('\n')}

TASK:
1. Identify which profession(s) this job post is hiring for
2. A job can match MULTIPLE professions (e.g., "React developer who can design UI" matches both developer and artist)
3. Return ONLY a JSON array with format: {"matches": [{"profession": "profession-id", "confidence": 0.0-1.0}]}
4. Only include professions with confidence >= 0.5
5. Confidence > 0.8 means the job is clearly for this profession
6. Confidence 0.5-0.8 means the job might involve this profession

Return ONLY the JSON, no explanation.`;
    const response = await fetch(`${config.ai.geminiUrl}?key=${config.ai.geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                    parts: [{ text: prompt }]
                }],
            generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 500,
            }
        })
    });
    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
    }
    const data = await response.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    // Parse AI response
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
        professions: parsed.matches.map(m => m.profession),
        confidence: parsed.matches.reduce((min, m) => Math.min(min, m.confidence), 1)
    };
}
/**
 * Call GLM API for categorization (Anthropic-compatible format)
 */
async function categorizeWithGLM(text) {
    const professionList = Object.values(professions).map(p => ({
        id: Object.keys(professions)[Object.values(professions).indexOf(p)],
        name: p.name,
        description: professionDescriptions[Object.keys(professions)[Object.values(professions).indexOf(p)]]
    }));
    const prompt = `You are a job posting classifier. Analyze this job post and determine which professions it matches.

JOB POST:
${text}

PROFESSION OPTIONS:
${professionList.map(p => `- ${p.id}: ${p.name} (${p.description})`).join('\n')}

TASK:
1. Identify which profession(s) this job post is hiring for
2. A job can match MULTIPLE professions (e.g., "React developer who can design UI" matches both developer and artist)
3. Return ONLY a JSON array with format: {"matches": [{"profession": "profession-id", "confidence": 0.0-1.0}]}
4. Only include professions with confidence >= 0.5
5. Confidence > 0.8 means the job is clearly for this profession
6. Confidence 0.5-0.8 means the job might involve this profession

Return ONLY the JSON, no explanation.`;
    const response = await fetch(config.ai.glmUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.ai.glmKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', // Maps to GLM-4 via Z.ai proxy
            max_tokens: 500,
            messages: [{
                    role: 'user',
                    content: prompt
                }]
        })
    });
    if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        console.log(`   GLM error ${response.status}: ${errorText.slice(0, 100)}`);
        throw new Error(`GLM API error: ${response.status}`);
    }
    const data = await response.json();
    const content = data.content?.[0]?.text || '{}';
    // Parse AI response
    const cleaned = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed = JSON.parse(cleaned);
    return {
        professions: parsed.matches.map(m => m.profession),
        confidence: parsed.matches.reduce((min, m) => Math.min(min, m.confidence), 1)
    };
}
/**
 * Fallback keyword-based categorization
 */
function categorizeWithKeywords(title, content) {
    const text = `${title} ${content || ''}`.toLowerCase();
    const matchedProfessions = [];
    const professionKeys = Object.keys(professions);
    for (const professionKey of professionKeys) {
        const profession = professions[professionKey];
        const hasMatch = profession.keywords.some(keyword => text.includes(keyword.toLowerCase()));
        if (hasMatch) {
            matchedProfessions.push(professionKey);
        }
    }
    // Default to developer if no matches found (but with low confidence)
    if (matchedProfessions.length === 0) {
        return { professions: [], confidence: 0 };
    }
    return { professions: matchedProfessions, confidence: 0.6 };
}
/**
 * Main categorization function - tries AI first, falls back to keywords
 */
export async function categorizePost(title, content) {
    const text = `${title}\n\n${content || ''}`.trim();
    // If text is too short, use keyword matching
    if (text.length < 50) {
        console.log('📝 Post too short, using keyword matching');
        return categorizeWithKeywords(title, content);
    }
    // Try Gemini first
    if (config.ai.geminiKey) {
        try {
            console.log('🤖 Using Gemini AI for categorization');
            return await categorizeWithGemini(text);
        }
        catch (error) {
            console.warn('⚠️ Gemini failed, falling back to keywords:', error);
        }
    }
    // Try GLM as fallback
    if (config.ai.glmKey) {
        try {
            console.log('🤖 Using GLM AI for categorization');
            return await categorizeWithGLM(text);
        }
        catch (error) {
            console.warn('⚠️ GLM failed, falling back to keywords:', error);
        }
    }
    // Final fallback to keyword matching
    console.log('🔍 Using keyword-based categorization');
    return categorizeWithKeywords(title, content);
}
/**
 * Generate a summary of the job post using AI
 */
export async function generateSummary(title, content) {
    const text = `${title}\n\n${content || ''}`.trim();
    if (text.length < 50) {
        return title;
    }
    const prompt = `Summarize this job post in 1-2 sentences (max 100 words). Focus on:
1. What profession is needed
2. Key requirements/skills
3. Any notable details (pay, timeline, etc.)

JOB POST:
${text}

Summary:`;
    // Try Gemini first
    if (config.ai.geminiKey) {
        try {
            const response = await fetch(`${config.ai.geminiUrl}?key=${config.ai.geminiKey}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                            parts: [{ text: prompt }]
                        }],
                    generationConfig: {
                        temperature: 0.3,
                        maxOutputTokens: 200,
                    }
                })
            });
            if (response.ok) {
                const data = await response.json();
                return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || title;
            }
        }
        catch {
            // Fall through
        }
    }
    return title;
}
