/**
 * Deep Job Analysis - Extract structured data from job posts
 * Analyzes: project type, tech stack, scope, timeline, budget, red/green flags
 */
import { config } from '../config.js';
const ANALYSIS_PROMPT = `You are a job post analyzer. Extract structured information from this job post.

JOB POST:
Title: {title}
Content: {content}

Extract and return ONLY a JSON object with this exact structure:
{
  "project_type": "brief description of what they're building (e.g., 'E-commerce website', 'Mobile app', 'Admin dashboard')",
  "tech_stack": ["React", "Node.js", "PostgreSQL"],
  "scope": "small|medium|large",
  "timeline_signal": "what they mention about timeline (e.g., 'ASAP', '2-3 weeks', 'flexible', 'not mentioned')",
  "budget_signal": "budget info or 'not mentioned'",
  "red_flags": ["any concerning patterns like 'vague requirements', 'unrealistic timeline', 'no budget mentioned', 'spec work']",
  "green_flags": ["positive signals like 'clear requirements', 'reasonable budget', 'flexible timeline', 'long-term potential']"
}

Guidelines:
- scope: small (< 1 week), medium (1-4 weeks), large (1+ months), or null if unclear
- tech_stack: extract specific technologies mentioned, max 5 items
- red_flags: warning signs that suggest this might be a problematic client/project
- green_flags: positive indicators of a good opportunity
- Return empty arrays [] if no flags detected
- Return null for fields that aren't mentioned or unclear

Return ONLY valid JSON, no markdown, no explanation.`;
/**
 * Call Gemini API for deep job analysis
 */
async function analyzeWithGemini(title, content) {
    const prompt = ANALYSIS_PROMPT
        .replace('{title}', title)
        .replace('{content}', content || '(no content)');
    const response = await fetch(`${config.ai.geminiUrl}?key=${config.ai.geminiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            contents: [{
                    parts: [{ text: prompt }]
                }],
            generationConfig: {
                temperature: 0.2,
                maxOutputTokens: 800,
            }
        })
    });
    if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`);
    }
    const data = await response.json();
    const content_text = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    // Parse AI response
    const cleaned = content_text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
        const parsed = JSON.parse(cleaned);
        return {
            project_type: parsed.project_type || null,
            tech_stack: Array.isArray(parsed.tech_stack) ? parsed.tech_stack.slice(0, 5) : null,
            scope: ['small', 'medium', 'large'].includes(parsed.scope) ? parsed.scope : null,
            timeline_signal: parsed.timeline_signal || null,
            budget_signal: parsed.budget_signal || null,
            red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags : [],
            green_flags: Array.isArray(parsed.green_flags) ? parsed.green_flags : [],
        };
    }
    catch (error) {
        console.warn('Failed to parse analysis JSON:', error);
        return getEmptyAnalysis();
    }
}
/**
 * Call GLM API for job analysis (Anthropic-compatible format)
 */
async function analyzeWithGLM(title, content) {
    const prompt = ANALYSIS_PROMPT
        .replace('{title}', title)
        .replace('{content}', content || '(no content)');
    const response = await fetch(config.ai.glmUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': config.ai.glmKey,
            'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
            model: 'claude-sonnet-4-20250514', // Maps to GLM-4 via Z.ai proxy
            max_tokens: 800,
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
    const content_text = data.content?.[0]?.text || '{}';
    const cleaned = content_text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    try {
        const parsed = JSON.parse(cleaned);
        return {
            project_type: parsed.project_type || null,
            tech_stack: Array.isArray(parsed.tech_stack) ? parsed.tech_stack.slice(0, 5) : null,
            scope: ['small', 'medium', 'large'].includes(parsed.scope) ? parsed.scope : null,
            timeline_signal: parsed.timeline_signal || null,
            budget_signal: parsed.budget_signal || null,
            red_flags: Array.isArray(parsed.red_flags) ? parsed.red_flags : [],
            green_flags: Array.isArray(parsed.green_flags) ? parsed.green_flags : [],
        };
    }
    catch (error) {
        console.warn('Failed to parse GLM analysis JSON:', error);
        return getEmptyAnalysis();
    }
}
/**
 * Return empty analysis structure
 */
function getEmptyAnalysis() {
    return {
        project_type: null,
        tech_stack: null,
        scope: null,
        timeline_signal: null,
        budget_signal: null,
        red_flags: [],
        green_flags: [],
    };
}
/**
 * Main analysis function - tries AI, falls back to empty
 */
export async function analyzeJob(title, content) {
    const text = `${title}\n\n${content || ''}`.trim();
    // Skip analysis for very short posts
    if (text.length < 100) {
        console.log('📝 Post too short for deep analysis');
        return getEmptyAnalysis();
    }
    // Try Gemini first
    if (config.ai.geminiKey) {
        try {
            console.log('🔍 Analyzing job with Gemini...');
            return await analyzeWithGemini(title, content);
        }
        catch (error) {
            console.warn('⚠️ Gemini analysis failed:', error);
        }
    }
    // Try GLM as fallback
    if (config.ai.glmKey) {
        try {
            console.log('🔍 Analyzing job with GLM...');
            return await analyzeWithGLM(title, content);
        }
        catch (error) {
            console.warn('⚠️ GLM analysis failed:', error);
        }
    }
    // Return empty if both fail
    console.log('⚠️ AI analysis unavailable, returning empty analysis');
    return getEmptyAnalysis();
}
