/**
 * avatars.js — Professional SVG avatar system for the SDLC Discovery Engine meeting room.
 *
 * Each of the 19 agents gets a unique, diverse character avatar built from
 * composable SVG primitives (hair, clothing, accessories). The mouth element
 * carries the class `avatar-mouth` so CSS can animate it when `.mr-speaking`
 * is active on the parent seat.
 *
 * Usage:
 *   import { getAvatarSVG } from './avatars.js';
 *   container.innerHTML = getAvatarSVG('architect');
 */

// ─── Shared Dimensions (viewBox 0 0 100 100) ────────────────────────────────
const HEAD  = { cx: 50, cy: 38, r: 18 };
const BODY  = { cx: 50, cy: 95, rx: 38, ry: 28 };
const NECK  = { x: 43, y: 54, w: 14, h: 14, rx: 5 };
const EYE_Y = 36;
const EYE_L = 42;
const EYE_R = 58;
const EYE_R_SIZE = 2.4;
const MOUTH = { cx: 50, cy: 46, rx: 4, ry: 1.5 };

// ─── Skin Palette ────────────────────────────────────────────────────────────
const SKIN = {
    light:      '#f5d0b0',
    lightWarm:  '#f0c4a0',
    medium:     '#d4a574',
    mediumWarm: '#c8956e',
    mediumOlive:'#c9a87c',
    tan:        '#b07d56',
    brown:      '#8d5e3c',
    dark:       '#6b4226',
    deep:       '#4a2e1a',
};

// ─── Hair Styles ─────────────────────────────────────────────────────────────

function hairShortNeat(color) {
    return `<path d="M32 38 C32 20, 42 12, 50 11 C58 12, 68 20, 68 38
                      L66 32 C64 22, 36 22, 34 32 Z" fill="${color}"/>`;
}

function hairBuzzCut(color) {
    return `<path d="M33 36 C33 24, 42 17, 50 16 C58 17, 67 24, 67 36
                      L65 31 C63 24, 37 24, 35 31 Z" fill="${color}"/>`;
}

function hairCurlyShort(color) {
    return `
        <path d="M30 40 C30 18, 42 10, 50 9 C58 10, 70 18, 70 40
                  L67 34 C64 20, 36 20, 33 34 Z" fill="${color}"/>
        <circle cx="33" cy="28" r="5" fill="${color}"/>
        <circle cx="41" cy="20" r="5.5" fill="${color}"/>
        <circle cx="50" cy="17" r="5" fill="${color}"/>
        <circle cx="59" cy="20" r="5.5" fill="${color}"/>
        <circle cx="67" cy="28" r="5" fill="${color}"/>`;
}

function hairMediumWavy(color) {
    return `<path d="M30 40 C30 18, 42 10, 50 9 C58 10, 70 18, 70 40
                      C70 50, 68 54, 66 52 C64 50, 65 44, 66 38
                      L64 32 C62 22, 38 22, 36 32
                      L34 38 C35 44, 36 50, 34 52 C32 54, 30 50, 30 40 Z"
                fill="${color}"/>`;
}

function hairLongStraight(color) {
    return `<path d="M28 40 C28 16, 42 8, 50 7 C58 8, 72 16, 72 40
                      L72 62 C70 60, 68 58, 67 55
                      L66 38 C64 22, 36 22, 34 38
                      L33 55 C32 58, 30 60, 28 62 Z"
                fill="${color}"/>`;
}

function hairBun(color) {
    return `
        <circle cx="50" cy="13" r="9" fill="${color}"/>
        <path d="M32 38 C32 20, 42 12, 50 11 C58 12, 68 20, 68 38
                  L66 32 C64 22, 36 22, 34 32 Z" fill="${color}"/>`;
}

function hairBob(color) {
    return `<path d="M29 38 C29 17, 42 10, 50 9 C58 10, 71 17, 71 38
                      L71 50 Q68 52, 66 48 L66 38
                      C64 22, 36 22, 34 38
                      L34 48 Q32 52, 29 50 Z"
                fill="${color}"/>`;
}

function hairAsymmetric(color) {
    return `
        <path d="M32 38 C32 20, 42 12, 50 11 C58 12, 68 20, 68 38
                  L66 32 C64 22, 36 22, 34 32 Z" fill="${color}"/>
        <path d="M32 38 L28 56 C30 54, 33 48, 34 38 Z" fill="${color}"/>`;
}

function hairSaltPepper(colorDark, colorGray) {
    return `
        <path d="M32 38 C32 20, 42 12, 50 11 C58 12, 68 20, 68 38
                  L66 32 C64 22, 36 22, 34 32 Z" fill="${colorDark}"/>
        <path d="M32 38 C32 28, 35 22, 38 20 L36 22 C34 26, 33 32, 33 38 Z"
              fill="${colorGray}" opacity="0.8"/>
        <path d="M68 38 C68 28, 65 22, 62 20 L64 22 C66 26, 67 32, 67 38 Z"
              fill="${colorGray}" opacity="0.8"/>`;
}

function hairSlickedBack(color) {
    return `<path d="M33 40 C33 22, 44 14, 50 13 C56 14, 67 22, 67 40
                      C67 36, 65 28, 60 24 L50 21 L40 24
                      C35 28, 33 36, 33 40 Z" fill="${color}"/>`;
}

function hairBraids(color) {
    return `
        <path d="M32 38 C32 20, 42 12, 50 11 C58 12, 68 20, 68 38
                  L66 32 C64 22, 36 22, 34 32 Z" fill="${color}"/>
        <rect x="30" y="38" width="4.5" height="26" rx="2.2" fill="${color}"/>
        <rect x="37" y="40" width="3.5" height="22" rx="1.8" fill="${color}"/>
        <rect x="59" y="40" width="3.5" height="22" rx="1.8" fill="${color}"/>
        <rect x="65" y="38" width="4.5" height="26" rx="2.2" fill="${color}"/>`;
}

function hairPonytail(color) {
    return `
        <path d="M32 38 C32 20, 42 12, 50 11 C58 12, 68 20, 68 38
                  L66 32 C64 22, 36 22, 34 32 Z" fill="${color}"/>
        <ellipse cx="66" cy="50" rx="6" ry="14" fill="${color}" transform="rotate(15,66,50)"/>`;
}

function hairSpikyModern(color) {
    return `
        <path d="M33 36 C33 24, 42 17, 50 16 C58 17, 67 24, 67 36
                  L65 31 C63 24, 37 24, 35 31 Z" fill="${color}"/>
        <polygon points="38,20 40,8 44,18" fill="${color}"/>
        <polygon points="46,17 49,5 52,16" fill="${color}"/>
        <polygon points="55,18 58,7 61,19" fill="${color}"/>`;
}

// ─── Accessories ─────────────────────────────────────────────────────────────

function glassesSquare(color = 'rgba(255,255,255,0.5)') {
    return `
        <rect x="35" y="33" width="12" height="8" rx="2" fill="none" stroke="${color}" stroke-width="1.6"/>
        <rect x="53" y="33" width="12" height="8" rx="2" fill="none" stroke="${color}" stroke-width="1.6"/>
        <line x1="47" y1="37" x2="53" y2="37" stroke="${color}" stroke-width="1.2"/>
        <line x1="35" y1="37" x2="32" y2="36" stroke="${color}" stroke-width="1"/>
        <line x1="65" y1="37" x2="68" y2="36" stroke="${color}" stroke-width="1"/>`;
}

function glassesRound(color = 'rgba(255,255,255,0.5)') {
    return `
        <circle cx="42" cy="37" r="6.5" fill="none" stroke="${color}" stroke-width="1.6"/>
        <circle cx="58" cy="37" r="6.5" fill="none" stroke="${color}" stroke-width="1.6"/>
        <line x1="48.5" y1="37" x2="51.5" y2="37" stroke="${color}" stroke-width="1.2"/>
        <line x1="35.5" y1="37" x2="32" y2="35" stroke="${color}" stroke-width="1"/>
        <line x1="64.5" y1="37" x2="68" y2="35" stroke="${color}" stroke-width="1"/>`;
}

function headset(bandColor = '#555', padColor = '#333') {
    return `
        <path d="M29 36 C29 20, 38 12, 50 12 C62 12, 71 20, 71 36"
              fill="none" stroke="${bandColor}" stroke-width="3" stroke-linecap="round"/>
        <rect x="25" y="33" width="7" height="12" rx="3.5" fill="${padColor}"/>
        <rect x="68" y="33" width="7" height="12" rx="3.5" fill="${padColor}"/>`;
}

function visor(color = 'rgba(0,200,255,0.35)', stroke = 'rgba(0,200,255,0.7)') {
    return `<path d="M34 34 L66 34 L64 39 L36 39 Z"
                  fill="${color}" stroke="${stroke}" stroke-width="1"/>`;
}

function tie(color) {
    return `
        <rect x="46" y="60" width="8" height="4" rx="1" fill="${color}"/>
        <path d="M47 64 L50 60 L53 64 L50 80 Z" fill="${color}"/>`;
}

function earrings(color = '#ffd700') {
    return `
        <circle cx="32" cy="42" r="2" fill="${color}"/>
        <circle cx="68" cy="42" r="2" fill="${color}"/>`;
}

function micBoom(color = '#666') {
    return `
        <path d="M27 39 L22 48" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
        <circle cx="21" cy="49" r="2.5" fill="${color}"/>`;
}

// ─── Clothing Necklines ──────────────────────────────────────────────────────

function clothingSuit(color, shirtColor = '#ffffff') {
    return `
        <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}" fill="${color}"/>
        <path d="M50 62 L42 72 L36 95 L50 82 L64 95 L58 72 Z" fill="${shirtColor}" opacity="0.9"/>
        <path d="M42 72 L50 62 L58 72 L56 74 L50 66 L44 74 Z" fill="${shirtColor}"/>`;
}

function clothingBlazer(color, shirtColor = '#e8e8e8') {
    return `
        <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}" fill="${color}"/>
        <path d="M44 62 Q50 70 56 62 L54 66 Q50 72 46 66 Z" fill="${shirtColor}"/>`;
}

function clothingHoodie(color) {
    const darker = shadeColor(color, -25);
    return `
        <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}" fill="${color}"/>
        <path d="M40 58 Q50 68 60 58" fill="none" stroke="${darker}" stroke-width="2.5" stroke-linecap="round"/>
        <line x1="50" y1="65" x2="50" y2="80" stroke="${darker}" stroke-width="1.2"/>`;
}

function clothingTurtleneck(color) {
    return `
        <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}" fill="${color}"/>
        <rect x="42" y="54" width="16" height="10" rx="4" fill="${color}"/>
        <path d="M43 56 Q50 58 57 56" fill="none" stroke="${shadeColor(color, -20)}" stroke-width="0.8"/>
        <path d="M43 59 Q50 61 57 59" fill="none" stroke="${shadeColor(color, -20)}" stroke-width="0.8"/>`;
}

function clothingBlouse(color) {
    return `
        <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}" fill="${color}"/>
        <path d="M38 60 Q50 55 62 60" fill="${color}" stroke="${shadeColor(color, 20)}" stroke-width="1"/>`;
}

function clothingCasual(color) {
    return `
        <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}" fill="${color}"/>
        <ellipse cx="50" cy="62" rx="9" ry="3.5" fill="${shadeColor(color, -15)}"/>`;
}

function clothingLabcoat(innerColor) {
    return `
        <ellipse cx="${BODY.cx}" cy="${BODY.cy}" rx="${BODY.rx}" ry="${BODY.ry}" fill="#f0f0f0"/>
        <path d="M34 70 L34 100 L66 100 L66 70" fill="#f0f0f0"/>
        <line x1="50" y1="66" x2="50" y2="100" stroke="#ddd" stroke-width="1"/>
        <ellipse cx="50" cy="63" rx="8" ry="3" fill="${innerColor}"/>`;
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function shadeColor(hex, percent) {
    const num = parseInt(hex.replace('#', ''), 16);
    const amt = Math.round(2.55 * percent);
    const R = Math.min(255, Math.max(0, (num >> 16) + amt));
    const G = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + amt));
    const B = Math.min(255, Math.max(0, (num & 0x0000FF) + amt));
    return '#' + (0x1000000 + R * 0x10000 + G * 0x100 + B).toString(16).slice(1);
}

function skinShadow(skinHex) {
    return shadeColor(skinHex, -20);
}

// ─── Base Face Generator ─────────────────────────────────────────────────────

function baseFace(skin, eyeColor = '#2d2d3f', mouthColor = '#c27b6e') {
    const shadow = skinShadow(skin);
    return `
        <!-- Neck -->
        <rect x="${NECK.x}" y="${NECK.y}" width="${NECK.w}" height="${NECK.h}"
              rx="${NECK.rx}" fill="${shadow}"/>
        <!-- Head -->
        <circle cx="${HEAD.cx}" cy="${HEAD.cy}" r="${HEAD.r}" fill="${skin}"/>
        <!-- Ears -->
        <ellipse cx="32" cy="40" rx="3" ry="4.5" fill="${shadow}"/>
        <ellipse cx="68" cy="40" rx="3" ry="4.5" fill="${shadow}"/>
        <!-- Eyebrows -->
        <line x1="38" y1="31" x2="45" y2="31" stroke="${eyeColor}" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
        <line x1="55" y1="31" x2="62" y2="31" stroke="${eyeColor}" stroke-width="1.6" stroke-linecap="round" opacity="0.7"/>
        <!-- Eyes -->
        <circle class="avatar-eye avatar-eye-l" cx="${EYE_L}" cy="${EYE_Y}" r="${EYE_R_SIZE}" fill="${eyeColor}"/>
        <circle class="avatar-eye avatar-eye-r" cx="${EYE_R}" cy="${EYE_Y}" r="${EYE_R_SIZE}" fill="${eyeColor}"/>
        <circle cx="${EYE_L + 0.8}" cy="${EYE_Y - 0.8}" r="0.9" fill="white"/>
        <circle cx="${EYE_R + 0.8}" cy="${EYE_Y - 0.8}" r="0.9" fill="white"/>
        <!-- Nose -->
        <path d="M49 41 Q50 43.5 51 41" stroke="${shadow}" fill="none" stroke-width="1.2" stroke-linecap="round"/>
        <!-- Mouth -->
        <ellipse class="avatar-mouth" cx="${MOUTH.cx}" cy="${MOUTH.cy}"
                 rx="${MOUTH.rx}" ry="${MOUTH.ry}" fill="${mouthColor}"/>`;
}

// ─── Avatar Configs ──────────────────────────────────────────────────────────

const AVATAR_CONFIGS = {

    architect: {
        bg: ['#0f2744', '#1a3a5f'],
        skin: SKIN.mediumWarm,
        hair: (c) => hairShortNeat(c),
        hairColor: '#1a1a2e',
        clothing: (c) => clothingSuit('#1e40af', '#e8eaf0'),
        accessory: () => glassesSquare('rgba(200,220,255,0.6)'),
    },

    ba: {
        bg: ['#1a3324', '#264d36'],
        skin: SKIN.lightWarm,
        hair: (c) => hairMediumWavy(c),
        hairColor: '#8b3a1a',
        clothing: (c) => clothingBlouse('#16a34a'),
        accessory: () => '',
    },

    qa: {
        bg: ['#134040', '#1a5252'],
        skin: SKIN.dark,
        hair: (c) => hairBuzzCut(c),
        hairColor: '#111111',
        clothing: (c) => clothingCasual('#0d9488'),
        accessory: () => '',
    },

    security: {
        bg: ['#1a1a2e', '#16213e'],
        skin: SKIN.light,
        hair: (c) => hairBuzzCut(c),
        hairColor: '#2c2c3a',
        clothing: (c) => clothingHoodie('#1f1f33'),
        accessory: () => glassesSquare('rgba(180,180,220,0.5)'),
    },

    tech_docs: {
        bg: ['#3b2417', '#5c3a28'],
        skin: SKIN.medium,
        hair: (c) => hairBun(c),
        hairColor: '#1a0e08',
        clothing: (c) => clothingBlazer('#92400e'),
        accessory: () => glassesRound('rgba(255,220,180,0.6)'),
    },

    data_engineering: {
        bg: ['#1a1a40', '#252560'],
        skin: SKIN.brown,
        hair: (c) => hairCurlyShort(c),
        hairColor: '#0a0a0a',
        clothing: (c) => clothingCasual('#1e3a8a'),
        accessory: () => '',
    },

    devops: {
        bg: ['#2d2d2d', '#3d3d3d'],
        skin: SKIN.lightWarm,
        hair: (c) => hairSpikyModern(c),
        hairColor: '#8b4513',
        clothing: (c) => clothingHoodie('#4b5563'),
        accessory: () => headset('#666', '#444'),
    },

    product_management: {
        bg: ['#3b1464', '#4c1d95'],
        skin: SKIN.deep,
        hair: (c) => hairLongStraight(c),
        hairColor: '#0a0a0a',
        clothing: (c) => clothingBlazer('#7c3aed'),
        accessory: () => earrings('#e0c060'),
    },

    ui_ux: {
        bg: ['#4c1130', '#6b1d43'],
        skin: SKIN.light,
        hair: (c) => hairAsymmetric(c),
        hairColor: '#d946a8',
        clothing: (c) => clothingBlouse('#e11d48'),
        accessory: () => earrings('#ff6b9d'),
    },

    compliance: {
        bg: ['#1c1c1c', '#2a2a2a'],
        skin: SKIN.mediumOlive,
        hair: (c) => hairSaltPepper(c, '#9ca3af'),
        hairColor: '#2d2d3a',
        clothing: (c) => clothingSuit('#1f2937', '#f0f0f0'),
        accessory: () => tie('#991b1b'),
    },

    secops: {
        bg: ['#0a0a1a', '#151528'],
        skin: SKIN.brown,
        hair: (c) => hairBuzzCut(c),
        hairColor: '#0a0a0a',
        clothing: (c) => clothingTurtleneck('#111827'),
        accessory: () => '',
    },

    performance_engineer: {
        bg: ['#451a03', '#6b2c05'],
        skin: SKIN.mediumWarm,
        hair: (c) => hairShortNeat(c),
        hairColor: '#0f0f1a',
        clothing: (c) => clothingCasual('#c2410c'),
        accessory: () => '',
    },

    cost_analyst: {
        bg: ['#052e16', '#064e22'],
        skin: SKIN.medium,
        hair: (c) => hairBob(c),
        hairColor: '#1a0e08',
        clothing: (c) => clothingBlazer('#15803d'),
        accessory: () => glassesSquare('rgba(180,220,180,0.5)'),
    },

    api_designer: {
        bg: ['#1e293b', '#334155'],
        skin: SKIN.lightWarm,
        hair: (c) => hairCurlyShort(c),
        hairColor: '#5c3317',
        clothing: (c) => clothingCasual('#475569'),
        accessory: () => '',
    },

    tech_lead: {
        bg: ['#0c1929', '#162d50'],
        skin: SKIN.mediumOlive,
        hair: (c) => hairSaltPepper(c, '#a8a8b0'),
        hairColor: '#1a1a28',
        clothing: (c) => clothingSuit('#0f172a', '#dce0e8'),
        accessory: () => '',
    },

    ai_innovation_scout: {
        bg: ['#002244', '#003366'],
        skin: SKIN.lightWarm,
        hair: (c) => hairAsymmetric(c),
        hairColor: '#0ea5e9',
        clothing: (c) => clothingBlazer('#0369a1'),
        accessory: () => visor(),
    },

    outsystems_architect: {
        bg: ['#2d1458', '#3d1c72'],
        skin: SKIN.mediumOlive,
        hair: (c) => hairSlickedBack(c),
        hairColor: '#1a1a28',
        clothing: (c) => clothingSuit('#6d28d9', '#e8e0f0'),
        accessory: () => '',
    },

    outsystems_migration: {
        bg: ['#3b1764', '#4c1d95'],
        skin: SKIN.dark,
        hair: (c) => hairBraids(c),
        hairColor: '#0a0a0a',
        clothing: (c) => clothingBlouse('#7c3aed'),
        accessory: () => earrings('#c084fc'),
    },

    synthesis: {
        bg: ['#3d2e0a', '#5c4517'],
        skin: SKIN.mediumWarm,
        hair: (c) => hairSlickedBack(c),
        hairColor: '#b0b0b8',
        clothing: (c) => clothingSuit('#854d0e', '#f5f0e0'),
        accessory: () => glassesRound('rgba(255,215,100,0.5)'),
    },
};

// ─── Main SVG Generator ─────────────────────────────────────────────────────

export function getAvatarSVG(key) {
    const cfg = AVATAR_CONFIGS[key];
    if (!cfg) {
        // Fallback — generic avatar
        return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">
            <circle cx="50" cy="50" r="48" fill="#1a1a2e"/>
            <circle cx="50" cy="38" r="16" fill="#888"/>
            <ellipse cx="50" cy="90" rx="30" ry="22" fill="#555"/>
        </svg>`;
    }

    const clipId = `av-clip-${key}`;
    const bgGrad = `av-bg-${key}`;
    const blinkDelay = (hashCode(key) % 40) / 10; // 0–4s stagger

    const hairSvg = typeof cfg.hair === 'function' ? cfg.hair(cfg.hairColor) : '';
    const clothingSvg = typeof cfg.clothing === 'function' ? cfg.clothing() : '';
    const accessorySvg = typeof cfg.accessory === 'function' ? cfg.accessory() : '';

    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" class="agent-avatar-svg">
    <defs>
        <clipPath id="${clipId}">
            <circle cx="50" cy="50" r="48"/>
        </clipPath>
        <linearGradient id="${bgGrad}" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stop-color="${cfg.bg[0]}"/>
            <stop offset="100%" stop-color="${cfg.bg[1]}"/>
        </linearGradient>
    </defs>
    <g clip-path="url(#${clipId})">
        <!-- Background -->
        <rect width="100" height="100" fill="url(#${bgGrad})"/>
        <!-- Clothing -->
        ${clothingSvg}
        <!-- Face, neck, features -->
        ${baseFace(cfg.skin)}
        <!-- Hair (on top of head) -->
        ${hairSvg}
        <!-- Accessories (on top of everything) -->
        ${accessorySvg}
    </g>
    <!-- Idle blink via CSS — staggered per agent -->
    <style>
        #${clipId} ~ g .avatar-eye {
            animation: avatar-blink 5s ease-in-out ${blinkDelay}s infinite;
            transform-origin: center;
            transform-box: fill-box;
        }
    </style>
</svg>`;
}

// Simple hash for staggering animations
function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

// Convenience: get all avatar keys
export function getAvatarKeys() {
    return Object.keys(AVATAR_CONFIGS);
}
