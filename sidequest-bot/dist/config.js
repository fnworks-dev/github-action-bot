export const config = {
    // Turso Database
    turso: {
        url: process.env.TURSO_DATABASE_URL || '',
        authToken: process.env.TURSO_AUTH_TOKEN || '',
    },
    // AI (Gemini primary, NVIDIA NIM fallback)
    ai: {
        geminiKey: process.env.GEMINI_API_KEY || '',
        geminiUrl: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
        nvidiaNimKey: process.env.NVIDIA_NIM_API_KEY || '',
        nvidiaNimUrl: 'https://integrate.api.nvidia.com/v1/chat/completions',
        nvidiaNimModel: process.env.NVIDIA_NIM_MODEL || 'minimaxai/minimax-m2.5',
    },
    // Max post age (24 hours)
    maxPostAgeMs: 24 * 60 * 60 * 1000,
    // Cleanup settings
    cleanup: {
        deleteAfterDays: 30,
    },
};
// Profession definitions with keywords and subreddits
export const professions = {
    developer: {
        name: 'Developer',
        keywords: [
            // Direct terms
            'developer', 'programmer', 'software engineer',
            'frontend', 'backend', 'fullstack', 'full stack',
            'web developer', 'web dev', 'app developer',
            'mobile developer', 'ios developer', 'android developer',
            // Tech stack specific
            'react developer', 'vue developer', 'angular developer',
            'nodejs developer', 'python developer', 'java developer',
            'typescript developer', 'javascript developer',
            'php developer', 'laravel developer', 'django developer',
            // Specializations
            'fullstack developer', 'full-stack developer',
            'software engineer', 'software development',
            'ui engineer', 'ux engineer',
            // Hiring patterns
            'looking for developer', 'need developer',
            'hiring developer', 'developer needed',
            'looking for programmer', 'need programmer',
        ],
        subreddits: [
            // Hiring-focused (primary)
            'forhire',
            'freelance_forhire',
            'webdev',
            'gamedev', // 🎮 Major game dev hiring hub
            'gameDevClassifieds',
            // Tech-specific communities
            'reactjs',
            'javascript',
            'python',
            'rust', // 🦀 Growing Rust community
            'golang', // 🐹 Go developers
            'node', // 🟢 Node.js
            'coding',
            'Frontend', // 💻 Frontend focus
            'androiddev', // 📱 Android
            'iOSProgramming', // 🍎 iOS
            'PHP', // 🐘 WordPress/PHP
        ],
    },
    artist: {
        name: 'Artist/Designer',
        keywords: [
            // Direct terms
            'illustrator', 'concept artist', 'graphic designer',
            'ui designer', 'ux designer', 'product designer',
            'logo designer', 'brand designer',
            // Art styles
            'digital artist', 'traditional artist',
            '2d artist', '3d artist',
            'character designer', 'environment artist',
            // Game art
            'game artist', 'sprite artist', 'pixel artist',
            'texture artist', 'asset artist',
            // Hiring patterns
            'looking for artist', 'need artist',
            'hiring artist', 'artist needed',
            'looking for designer', 'need designer',
            'art commission', 'commission artist',
        ],
        subreddits: [
            // Hiring-focused (primary)
            'HungryArtists',
            'artcommissions',
            'drawforhire',
            'forhire',
            'freelance_forhire',
            'design',
            'DesignJobs',
            'logo_requests',
            'gameDevClassifieds',
            'INAT', // 🎮 "I Need A Team" - game dev collab
            // Art communities (secondary - may have hiring posts)
            'graphic_design',
            'illustration',
            'UIUCDesign',
            'ArtistLounge',
            'DigitalPainting',
            'fantasyartists',
            'characterdrawing',
            'GameArtHQ',
            'imadeathing',
            'UnitLost',
            'conceptart',
            'specart',
            'pixelart', // 🎮 Pixel artists
            '3Dmodeling', // 🎨 3D artists
            'Blender', // 🎨 Blender community
        ],
    },
    'voice-actor': {
        name: 'Voice Actor',
        keywords: [
            // Direct terms
            'voice actor', 'voice actress', 'voice talent',
            'voice over', 'voiceover', 'voice artist',
            'va needed', 'voice work',
            // Context specific
            'audiobook narrator', 'audio book narrator',
            'character voice', 'narrator',
            'voice for animation', 'voice for game',
            // Hiring patterns
            'looking for voice actor', 'need voice actor',
            'hiring voice actor', 'voice actor needed',
            'looking for va', 'need va',
            'voice audition', 'voice casting',
        ],
        subreddits: [
            // Hiring-focused (primary)
            'forhire',
            'VAforhire',
            'VoiceActing',
            'recordthis',
            'audiobookcreation',
            'freelance_forhire',
            'gameDevClassifieds', // 🎮 Game VA hiring
            // Voice communities (secondary - may have hiring posts)
            'audiobooks',
            'vo',
            'voiceover',
            'talent',
            'casting',
            'AudiobookBillingual',
            'audiobook',
            'voiceacting101',
            'indiegames', // 🎮 Indie game VA needs
            'gamedev', // 🎮 Game dev VA
        ],
    },
    'video-editor': {
        name: 'Video Editor',
        keywords: [
            // Direct terms
            'video editor', 'video editing',
            'motion graphics', 'motion graphics artist',
            'vfx artist', 'visual effects',
            // Specializations
            'youtube editor', 'content editor',
            'final cut', 'premiere pro', 'after effects',
            'da vinci resolve', 'video production',
            // Related
            'video post production', 'color grading',
            'sound design for video',
            // Hiring patterns
            'looking for video editor', 'need video editor',
            'hiring video editor', 'video editor needed',
            'looking for editor', 'need editor',
        ],
        subreddits: [
            // Hiring-focused (primary)
            'forhire',
            'VideoEditing',
            'editors',
            'freelance_forhire',
            'creatorservices',
            'PostProduction',
            'VideoProduction',
            'VideoServices',
            'gameDevClassifieds',
            // Video communities (secondary - may have hiring posts)
            'NewTubers',
            'youtube',
            'filmmakers',
            'MotionDesign',
            'vfx',
            'youtubers', // 📺 YouTube editor demand
            'SmallYTChannel',
            'youtubeviews',
            'youtube_startups',
            'ContentCreators', // 📺 Creator economy
            'Premiere', // 🎬 Adobe Premiere editors
            'AfterEffects', // ✨ Motion graphics
        ],
    },
    writer: {
        name: 'Writer',
        keywords: [
            // Direct terms
            'writer', 'copywriter', 'content writer',
            'technical writer', 'ghostwriter',
            'blog writer', 'article writer',
            // Specializations
            'script writer', 'screenwriter',
            'dialogue writer', 'story writer',
            'game writer', 'narrative designer',
            // Marketing
            'copywriting', 'content creator',
            'seo writer', 'blog post writer',
            // Hiring patterns
            'looking for writer', 'need writer',
            'hiring writer', 'writer needed',
            'looking for copywriter', 'need copywriter',
        ],
        subreddits: [
            // Hiring-focused (primary)
            'forhire',
            'freelanceWriters',
            'copywriting',
            'freelance_forhire',
            'gameDevClassifieds',
            'freelance', // ✍️ General freelance writing
            // Writing communities (secondary - may have hiring posts)
            'writing',
            'screenwriting',
            'writers',
            'WritersGroup',
            'ContentMarketing', // 📢 Marketing copy
            'scriptwriting',
            'ghostwriting',
            'technicalwriting',
            'blogwriting',
            'editmywriting',
            'writingclub',
            'selfpublish', // 📚 Book editing/formatting
            'marketing', // 📢 Copywriting gigs
        ],
    },
    audio: {
        name: 'Audio/Music',
        keywords: [
            // Direct terms
            'sound designer', 'audio engineer',
            'music composer', 'music producer',
            'sound effects', 'sfx',
            // Specializations
            'game audio', 'audio for games',
            'music for video', 'background music',
            ' Foley artist', 'sound mixing',
            // Tools
            'ableton', 'fl studio', 'logic pro',
            'pro tools', 'audio production',
            // Hiring patterns
            'looking for sound designer', 'need sound designer',
            'looking for composer', 'need composer',
            'hiring composer', 'composer needed',
        ],
        subreddits: [
            // Hiring-focused (primary)
            'forhire',
            'audioengineering',
            'SoundDesign',
            'GameAudio',
            'composers',
            'thisismycomposer',
            'freelance_forhire',
            'gameDevClassifieds',
            'indiegames', // 🎮 Indie game audio
            // Audio communities (secondary - may have hiring posts)
            'audio',
            'musicproduction',
            'mixing',
            'mastering',
            'EDMproduction',
            'beatmaker',
            'producers',
            'WeAreTheMusicMakers', // 🎵 Active music community
            'synthrecipes',
            'gamedev', // 🎮 Game dev audio needs
        ],
    },
    qa: {
        name: 'QA/Tester',
        keywords: [
            // Direct terms
            'qa tester', 'qa engineer', 'quality assurance',
            'game tester', 'beta tester',
            'playtester', 'game testing',
            // Specializations
            'qa testing', 'manual testing',
            'automation testing', 'test case',
            // Hiring patterns
            'looking for qa', 'need qa',
            'looking for tester', 'need tester',
            'hiring qa', 'qa needed',
        ],
        subreddits: [
            // Hiring-focused (primary)
            'forhire',
            'qa',
            'testing',
            'gameDevClassifieds',
            'freelance_forhire',
            // QA communities (secondary - may have hiring posts)
            'QualityAssurance',
            'testautomation',
            'manualtesting',
            'gamedevtesting',
            'softwaretesting', // 🐛 General QA
            'gamedev', // 🎮 Game QA/Playtesters
        ],
    },
    'virtual-assistant': {
        name: 'Virtual Assistant',
        keywords: [
            // Direct terms
            'virtual assistant', 'va', 'virtual assistant',
            'personal assistant', 'administrative assistant',
            // Tasks
            'data entry', 'email management',
            'schedule management', 'calendar management',
            'customer support', 'customer service',
            // Skills
            'project management', 'research assistant',
            'social media management', 'admin support',
            // Hiring patterns
            'looking for virtual assistant', 'need virtual assistant',
            'looking for va', 'need va',
            'hiring virtual assistant', 'va needed',
        ],
        subreddits: [
            // Hiring-focused (primary)
            'forhire',
            'virtualassistant',
            'freelance_forhire',
            'admin',
            'gameDevClassifieds',
            // VA communities (secondary - may have hiring posts)
            'virtual_assistant',
            'administrative',
            'remotework', // 💼 Remote VA work
            'hireme',
            'jobsbit4',
            'workonline', // 💻 Online work
            'digitalnomad', // 🌏 DN-friendly VA
        ],
    },
};
// Negative filters - posts containing these will be skipped
export const negativeFilters = [
    // Self-promotion / For Hire posts
    '[For Hire]',
    '[FOR HIRE]',
    'I am a',
    "I'm a",
    'I am an',
    "I'm an",
    'offering my services',
    'available for hire',
    'my portfolio',
    'hire me',
    // Listicle spam
    'Top 10',
    'Top 5',
    'Best of',
    'Niche ideas',
    'ideas for',
    // Non-job posts
    'just launched',
    'I built',
    'I created',
    'check out my',
    'feedback on my',
    'roast my',
    // Surveys and studies
    'survey',
    'study participant',
    'research participant',
    // Simple microtasks (not real jobs)
    'simple tasks',
    'microtasks',
    // Watching content (not jobs)
    'watch basketball',
    'watch videos',
    'like and subscribe',
    // Social media manipulation
    'reddit post',
    'reddit comment',
    'reddit account',
    'upvote',
    // ========== TIGHTENED FILTERS ==========
    // Advice seeking (not hiring)
    'need advise',
    'need advice',
    'looking for advice',
    'looking for advise',
    'recommendations for',
    'recommendations pls',
    'recommendations please',
    'struggling with',
    'help me decide',
    'what do you recommend',
    'any recommendations',
    'any advice',
    'guide me',
    'suggestions for',
    // Vague "looking for" without clear job context
    'looking for packaging',
    'looking for tips',
    'looking for guidance',
    // Sales/Commission spam (MLM, referrals) - TIGHTENED to avoid art "commission" false positives
    'earn ₹',
    'earn rs',
    '% commission', // NOT just "commission" - art world uses "commission" for custom work
    'percent commission',
    'referral program',
    'affiliate program',
    'for every business you close',
    'for every sale',
    'for every referral',
    'earn between',
    'make money online',
    'side hustle',
    'passive income',
    // Empty/low effort posts
    '[hiring] ->',
    '[hiring] -',
    'go to ',
    'check out r/',
    'try r/',
    'post this in',
    'wrong sub',
    'wrong subreddit',
    // Handover/Selling (not job hiring)
    'handover my',
    'hand over my',
    'sell my',
    'selling my',
    'transfer my',
    'looking for buyer',
    'looking for someone to buy',
    // Navigation spam
    'r/smallbusiness',
    'r/entrepreneur',
    'r/startups',
];
// Get all unique subreddits across all professions
export function getAllSubreddits() {
    const subredditSet = new Set();
    for (const profession of Object.values(professions)) {
        profession.subreddits.forEach(sub => subredditSet.add(sub));
    }
    return Array.from(subredditSet);
}
// Validate required config
export function validateConfig() {
    const required = [
        ['TURSO_DATABASE_URL', config.turso.url],
        ['TURSO_AUTH_TOKEN', config.turso.authToken],
    ];
    const missing = required.filter(([_, value]) => !value);
    if (!config.ai.geminiKey && !config.ai.nvidiaNimKey) {
        missing.push(['GEMINI_API_KEY or NVIDIA_NIM_API_KEY', '']);
    }
    if (missing.length > 0) {
        throw new Error(`Missing required environment variables: ${missing.map(([name]) => name).join(', ')}`);
    }
}
// Check if post should be filtered out
export function shouldFilterPost(title, content) {
    const text = `${title} ${content || ''}`.toLowerCase();
    return negativeFilters.some(filter => text.includes(filter.toLowerCase()));
}
