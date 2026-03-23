/**
 * SDLC Discovery Engine — Walkthrough Recorder
 * Records a full end-to-end demo of the app analysing a GitHub repo.
 * Output: /home/user/SDLC_2.0_POC/walkthrough.webm
 */

import { chromium } from 'playwright';
import { execSync } from 'child_process';
import path from 'path';

const REPO_URL = 'https://github.com/AsafAlazraki/yamaha-diagnostics-app';
const APP_URL  = 'http://localhost:8000';
const OUT_DIR  = '/home/user/SDLC_2.0_POC';
const ANALYSIS_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes max

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

(async () => {
    console.log('🎬 Launching browser...');

    const browser = await chromium.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
        ]
    });

    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        recordVideo: {
            dir: OUT_DIR,
            size: { width: 1440, height: 900 },
        },
    });

    const page = await context.newPage();

    // ── 1. Landing page ──────────────────────────────────────────
    console.log('[1/9] Landing page...');
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
    await sleep(2500);

    // ── 2. How It Works — overview ───────────────────────────────
    console.log('[2/9] Navigating to How It Works...');
    await page.click('.nav-btn[data-target="how-it-works"]');
    await sleep(1800);

    // Scroll slowly through the page
    for (let i = 0; i < 6; i++) {
        await page.evaluate(() => window.scrollBy({ top: 380, behavior: 'smooth' }));
        await sleep(900);
    }
    await sleep(800);

    // ── 3. Open an avatar detail modal ───────────────────────────
    console.log('[3/9] Opening avatar detail (Architect)...');
    const avatarCard = await page.$('.hiw-avatar-card');
    if (avatarCard) {
        await avatarCard.scrollIntoViewIfNeeded();
        await sleep(600);
        await avatarCard.click();
        await sleep(2000);

        // Scroll inside the modal to show all sections
        await page.evaluate(() => {
            const m = document.querySelector('.agent-detail-modal');
            if (m) m.scrollBy({ top: 350, behavior: 'smooth' });
        });
        await sleep(1200);
        await page.evaluate(() => {
            const m = document.querySelector('.agent-detail-modal');
            if (m) m.scrollBy({ top: 350, behavior: 'smooth' });
        });
        await sleep(1200);

        // Close modal
        await page.keyboard.press('Escape');
        await sleep(800);
    }

    // Open another card (synthesis / verdict)
    console.log('[3b/9] Opening Synthesis avatar...');
    const cards = await page.$$('.hiw-avatar-card');
    const lastCard = cards[cards.length - 1];
    if (lastCard) {
        await lastCard.scrollIntoViewIfNeeded();
        await sleep(600);
        await lastCard.click();
        await sleep(2200);
        await page.keyboard.press('Escape');
        await sleep(800);
    }

    // ── 4. Go to ingestion view ───────────────────────────────────
    console.log('[4/9] Back to Analyse view...');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(600);
    await page.click('.nav-btn[data-target="ingestion"]');
    await sleep(1500);

    // ── 5. Enter the GitHub URL ───────────────────────────────────
    console.log('[5/9] Typing GitHub URL...');
    const urlInput = await page.$('#github-url');
    if (!urlInput) {
        console.error('❌ Cannot find #github-url input');
        await browser.close();
        process.exit(1);
    }
    await urlInput.click({ clickCount: 3 });
    await sleep(300);
    await urlInput.type(REPO_URL, { delay: 45 });
    await sleep(1200);

    // ── 6. Launch analysis ────────────────────────────────────────
    console.log('[6/9] Starting analysis...');
    await page.click('#analyze-btn');
    await sleep(3000);

    // Navigate to the report view if not automatically shown
    try {
        await page.waitForSelector('.fleet-status-bar, #fleet-status-message, .agent-card', { timeout: 8000 });
        console.log('✅ Fleet status bar visible.');
    } catch (_) {
        console.log('ℹ️  Switching to report view manually...');
        await page.click('.nav-btn[data-target="report"]');
        await sleep(2000);
    }

    // ── 7. Watch fleet progress ───────────────────────────────────
    console.log('[7/9] Watching fleet progress...');
    const startTime = Date.now();
    let synthesisReady = false;

    while (Date.now() - startTime < ANALYSIS_TIMEOUT_MS) {
        const verdict = await page.$('.verdict-card[style*="block"], .verdict-card:not([style*="none"])');
        const verdictVisible = verdict
            ? await verdict.evaluate(el => el.style.display !== 'none' && !el.hidden)
            : false;

        if (verdictVisible) {
            synthesisReady = true;
            console.log('✅ Synthesis visible!');
            break;
        }

        // Gently scroll to show more agent cards loading
        await page.evaluate(() => window.scrollBy({ top: 250, behavior: 'smooth' }));
        await sleep(5000);
    }

    if (!synthesisReady) {
        console.warn('⚠️  Timeout — recording current state.');
    }

    // ── 8. Scroll through completed results ───────────────────────
    console.log('[8/9] Touring results...');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(1200);

    const pageHeight = await page.evaluate(() => document.body.scrollHeight);
    const steps = Math.min(Math.ceil(pageHeight / 450), 35);
    for (let i = 0; i < steps; i++) {
        await page.evaluate(() => window.scrollBy({ top: 450, behavior: 'smooth' }));
        await sleep(550);
    }
    await sleep(1000);

    // ── 9. Q&A chat demo on first agent card ─────────────────────
    console.log('[9/9] Q&A chat demo...');
    const askBtn = await page.$('.ask-btn');
    if (askBtn) {
        await askBtn.scrollIntoViewIfNeeded();
        await sleep(600);
        await askBtn.click();
        await sleep(1800);

        const chatInput = await page.$('#chat-input');
        if (chatInput) {
            await chatInput.type('What are the top 3 issues you found?', { delay: 50 });
            await sleep(1200);
        }

        // Close without sending
        await page.keyboard.press('Escape');
        await sleep(600);
    }

    // Final pause on the verdict card
    const verdictCard = await page.$('.verdict-card');
    if (verdictCard) {
        await verdictCard.scrollIntoViewIfNeeded();
        await sleep(3500);
    }

    // ── Wrap up ───────────────────────────────────────────────────
    console.log('🎞️  Finalising recording...');
    await context.close();   // flushes the video file
    await browser.close();

    // Rename the auto-generated UUID .webm to walkthrough.webm
    try {
        const found = execSync(
            `find "${OUT_DIR}" -maxdepth 1 -name "*.webm" -newer /tmp -not -name "walkthrough.webm" 2>/dev/null | head -1`
        ).toString().trim();

        if (found) {
            execSync(`mv "${found}" "${OUT_DIR}/walkthrough.webm"`);
            console.log(`✅  Video saved: ${OUT_DIR}/walkthrough.webm`);
        } else {
            const existing = execSync(`find "${OUT_DIR}" -maxdepth 1 -name "*.webm" 2>/dev/null`).toString().trim();
            console.log('📂  Video files found:', existing || 'none');
        }
    } catch(e) {
        console.log('ℹ️  Check directory for .webm file:', OUT_DIR);
    }
})();
