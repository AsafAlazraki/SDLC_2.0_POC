/**
 * SDLC Discovery Engine — Walkthrough Recorder
 * Output: /home/user/SDLC_2.0_POC/walkthrough.webm
 */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { execSync }  = require('child_process');
const path          = require('path');

// Ensure playwright finds the right chromium build
process.env.PLAYWRIGHT_BROWSERS_PATH = '/root/.cache/ms-playwright';

const REPO_URL = 'https://github.com/AsafAlazraki/yamaha-diagnostics-app';
const APP_URL  = 'http://localhost:8000';
const OUT_DIR  = '/home/user/SDLC_2.0_POC';
const ANALYSIS_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
    console.log('🎬 Launching Chromium...');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
    });

    const page = await context.newPage();

    // ── 1. Landing page ──────────────────────────
    console.log('[1/9] Landing page');
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(2500);

    // ── 2. How It Works — avatar gallery ─────────
    console.log('[2/9] How It Works');
    await page.click('.nav-btn[data-target="how-it-works"]');
    await sleep(2000);

    // Scroll through How It Works slowly
    for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy({ top: 380, behavior: 'smooth' }));
        await sleep(900);
    }
    await sleep(800);

    // ── 3. Open architect avatar modal ───────────
    console.log('[3/9] Avatar detail — Architect');
    const cards = await page.$$('.hiw-avatar-card');
    console.log(`   Found ${cards.length} avatar cards`);
    if (cards.length > 0) {
        await cards[0].scrollIntoViewIfNeeded();
        await sleep(700);
        await cards[0].click();
        await sleep(2200);
        // Scroll inside modal
        for (let s = 0; s < 2; s++) {
            await page.evaluate(() => {
                const m = document.querySelector('.agent-detail-modal');
                if (m) m.scrollBy({ top: 320, behavior: 'smooth' });
            });
            await sleep(1100);
        }
        await page.keyboard.press('Escape');
        await sleep(900);
    }

    // Open The Verdict (synthesis) card — last one
    console.log('[3b/9] Avatar detail — Synthesis');
    const allCards = await page.$$('.hiw-avatar-card');
    if (allCards.length > 0) {
        const last = allCards[allCards.length - 1];
        await last.scrollIntoViewIfNeeded();
        await sleep(600);
        await last.click();
        await sleep(2200);
        await page.keyboard.press('Escape');
        await sleep(900);
    }

    // ── 4. Analysis view ──────────────────────────
    console.log('[4/9] Analysis view');
    await page.evaluate(() => window.scrollTo({ top: 0 }));
    await sleep(500);
    await page.click('.nav-btn[data-target="ingestion"]');
    await sleep(1800);

    // ── 5. Enter GitHub URL ───────────────────────
    console.log('[5/9] Entering repo URL');
    const urlInput = await page.$('#github-url');
    if (!urlInput) { console.error('No #github-url'); await browser.close(); process.exit(1); }
    await urlInput.click({ clickCount: 3 });
    await sleep(300);
    await urlInput.type(REPO_URL, { delay: 42 });
    await sleep(1200);

    // ── 6. Start analysis ─────────────────────────
    console.log('[6/9] Launching analysis');
    await page.click('#analyze-btn');
    await sleep(4000);

    // Switch to report view if needed
    try {
        await page.waitForSelector('#fleet-status-message, .agent-card', { timeout: 10000 });
    } catch (_) {
        await page.click('.nav-btn[data-target="report"]');
        await sleep(2000);
    }

    // ── 7. Watch fleet progress ───────────────────
    console.log('[7/9] Watching fleet (up to 6 min)...');
    const start = Date.now();
    let done = false;

    while (Date.now() - start < ANALYSIS_TIMEOUT_MS) {
        const visible = await page.evaluate(() => {
            const el = document.querySelector('.verdict-card');
            return el ? (el.style.display !== 'none' && el.offsetParent !== null) : false;
        });
        if (visible) { done = true; console.log('   ✅ Synthesis visible'); break; }
        await page.evaluate(() => window.scrollBy({ top: 260, behavior: 'smooth' }));
        await sleep(5000);
    }

    if (!done) console.warn('   ⚠️  Timeout — recording current state');

    // ── 8. Tour completed results ─────────────────
    console.log('[8/9] Scrolling through results');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(1300);
    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(pageHeight / 450), 35);
    for (let i = 0; i < steps; i++) {
        await page.evaluate(() => window.scrollBy({ top: 450, behavior: 'smooth' }));
        await sleep(550);
    }
    await sleep(1000);

    // ── 9. Q&A chat demo ──────────────────────────
    console.log('[9/9] Q&A chat demo');
    try {
        const askBtn = await page.$('.ask-btn');
        if (askBtn) {
            const isVisible = await askBtn.isVisible().catch(() => false);
            if (isVisible) {
                await askBtn.click({ timeout: 5000 });
                await sleep(1800);
                const chatInput = await page.$('#chat-input');
                if (chatInput) {
                    await chatInput.type('What are the top 3 issues you found?', { delay: 52 });
                    await sleep(1200);
                }
                await page.keyboard.press('Escape');
                await sleep(800);
            }
        }
    } catch(e) { console.log('   ℹ️  Q&A button not available yet'); }

    // Scroll to verdict for final shot
    try {
        const verdict = await page.$('.verdict-card');
        if (verdict) {
            const isVisible = await verdict.isVisible().catch(() => false);
            if (isVisible) {
                await verdict.scrollIntoViewIfNeeded({ timeout: 5000 });
                await sleep(3500);
            }
        }
    } catch(e) { console.log('   ℹ️  Verdict card not visible yet'); }

    // ── Finish ─────────────────────────────────────
    console.log('🎞️  Closing and saving...');
    const videoPath = await page.video()?.path();
    await context.close();
    await browser.close();

    // Rename to walkthrough.webm
    try {
        if (videoPath) {
            execSync(`mv "${videoPath}" "${OUT_DIR}/walkthrough.webm"`);
            console.log(`✅  Saved: ${OUT_DIR}/walkthrough.webm`);
        } else {
            const found = execSync(
                `find "${OUT_DIR}" -maxdepth 1 -name "*.webm" 2>/dev/null | head -1`
            ).toString().trim();
            if (found) {
                execSync(`mv "${found}" "${OUT_DIR}/walkthrough.webm"`);
                console.log(`✅  Saved: ${OUT_DIR}/walkthrough.webm`);
            }
        }
    } catch(e) { console.log('ℹ️  Check', OUT_DIR, 'for .webm file'); }
})();
