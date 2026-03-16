/**
 * SDLC Discovery Engine — Walkthrough Recorder
 * Loads the most recent saved analysis from history so we can demo:
 *   - How It Works avatar gallery + agent detail modals
 *   - Full completed analysis report
 *   - Meeting Room (boardroom debate)
 *   - Voice/speech synthesis (shown via speaker panel UI)
 *   - Q&A chat
 * Output: /home/user/SDLC_2.0_POC/walkthrough.webm
 *
 * Run:
 *   PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright node record_walkthrough.cjs
 */
process.env.PLAYWRIGHT_BROWSERS_PATH = '/root/.cache/ms-playwright';

const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { execSync }  = require('child_process');

const APP_URL  = 'http://localhost:8000';
const OUT_DIR  = '/home/user/SDLC_2.0_POC';

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Inject a JS helper into the page to simulate a completed analysis
// by loading a saved report from Supabase history
async function loadSavedReport(page, reportId) {
    // Navigate to the app root first
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(2000);

    // Trigger loadHistoryReport(reportId) which the app already has
    await page.evaluate((id) => {
        // Call the app's own loadHistoryReport function
        // It's defined inside DOMContentLoaded — we trigger it via the history view
        window.__playbackReportId = id;
    }, reportId);

    // Go to history view, click the report
    await page.click('.nav-btn[data-target="history"]');
    await sleep(2000);

    // Find and click the report entry
    const reportBtns = await page.$$('[data-id]');
    let clicked = false;
    for (const btn of reportBtns) {
        const id = await btn.getAttribute('data-id');
        if (parseInt(id) === reportId) {
            await btn.click();
            clicked = true;
            break;
        }
    }
    if (!clicked) {
        // Fallback: click the first (most recent) report button
        const allBtns = await page.$$('.history-item button, [data-id]');
        if (allBtns.length) await allBtns[0].click();
    }
    await sleep(3000);
    return clicked;
}

(async () => {
    console.log('🎬 Launching Chromium...');

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    });

    const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        recordVideo: { dir: OUT_DIR, size: { width: 1440, height: 900 } },
        // Fake media permissions so speechSynthesis UI is visible
        permissions: [],
    });

    const page = await context.newPage();

    // ── 1. Landing page ──────────────────────────────────────────
    console.log('[1/10] Landing page');
    await page.goto(APP_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(2500);

    // ── 2. How It Works — avatar gallery ─────────────────────────
    console.log('[2/10] How It Works — avatar gallery');
    await page.click('.nav-btn[data-target="how-it-works"]');
    await sleep(1800);

    for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollBy({ top: 360, behavior: 'smooth' }));
        await sleep(900);
    }
    await sleep(600);

    // Open Architect card
    console.log('[2a] Agent detail — Architect');
    const cards = await page.$$('.hiw-avatar-card');
    console.log(`   ${cards.length} avatar cards rendered`);
    if (cards.length > 0) {
        await cards[0].scrollIntoViewIfNeeded();
        await sleep(500);
        await cards[0].click();
        await sleep(2000);
        for (let s = 0; s < 2; s++) {
            await page.evaluate(() => {
                const m = document.querySelector('.agent-detail-modal');
                if (m) m.scrollBy({ top: 300, behavior: 'smooth' });
            });
            await sleep(1000);
        }
        await page.keyboard.press('Escape');
        await sleep(700);
    }

    // Open Security card (~index 3)
    console.log('[2b] Agent detail — Security');
    const cards2 = await page.$$('.hiw-avatar-card');
    const secCard = cards2[3] || cards2[1];
    if (secCard) {
        await secCard.scrollIntoViewIfNeeded();
        await sleep(500);
        await secCard.click();
        await sleep(2000);
        await page.keyboard.press('Escape');
        await sleep(700);
    }

    // Open Synthesis (last card)
    console.log('[2c] Agent detail — Synthesis');
    const allCards = await page.$$('.hiw-avatar-card');
    const synthCard = allCards[allCards.length - 1];
    if (synthCard) {
        await synthCard.scrollIntoViewIfNeeded();
        await sleep(500);
        await synthCard.click();
        await sleep(2000);
        await page.keyboard.press('Escape');
        await sleep(700);
    }

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(800);

    // ── 3. Load saved report from history ────────────────────────
    console.log('[3/10] Loading saved analysis from history...');
    await page.click('.nav-btn[data-target="history"]');
    await sleep(2000);

    // Show the history list on screen, then click most recent entry
    const historyBtns = await page.$$('[data-id], .history-load-btn, .load-report-btn');
    console.log(`   Found ${historyBtns.length} history buttons`);
    if (historyBtns.length > 0) {
        await historyBtns[0].scrollIntoViewIfNeeded();
        await sleep(600);
        await historyBtns[0].click();
        await sleep(3500);
    } else {
        console.warn('   ⚠️  No history entries visible — navigating to report view directly');
        await page.click('.nav-btn[data-target="report"]');
        await sleep(2000);
    }

    // ── 4. Scroll through completed report cards ──────────────────
    console.log('[4/10] Touring completed agent reports...');
    // Ensure we are on the report view
    try { await page.click('.nav-btn[data-target="report"]'); } catch(_) {}
    await sleep(1500);

    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(1200);

    const reportHeight = await page.evaluate(() => document.body.scrollHeight);
    const scrollSteps = Math.min(Math.ceil(reportHeight / 480), 30);
    for (let i = 0; i < scrollSteps; i++) {
        await page.evaluate(() => window.scrollBy({ top: 480, behavior: 'smooth' }));
        await sleep(520);
    }
    await sleep(800);

    // ── 5. Q&A chat demo ─────────────────────────────────────────
    console.log('[5/10] Q&A chat demo');
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
    await sleep(1000);

    try {
        const askBtn = await page.$('.ask-btn');
        if (askBtn && await askBtn.isVisible()) {
            await askBtn.scrollIntoViewIfNeeded();
            await sleep(600);
            await askBtn.click();
            await sleep(1800);
            const chatInput = await page.$('#chat-input');
            if (chatInput) {
                await chatInput.type('What are the top 3 security risks you found?', { delay: 48 });
                await sleep(1200);
            }
            // Close chat
            await page.keyboard.press('Escape');
            await sleep(800);
        } else {
            console.log('   ℹ️  Ask button not visible — skipping');
        }
    } catch(e) { console.log('   ℹ️  Q&A skipped:', e.message.slice(0, 60)); }

    // ── 6. Navigate to Meeting Room ───────────────────────────────
    console.log('[6/10] Entering Meeting Room...');
    // Reveal the meeting room nav btn if hidden
    await page.evaluate(() => {
        const btn = document.getElementById('nav-meeting-btn');
        if (btn) { btn.style.display = ''; btn.removeAttribute('hidden'); }
        const enterBtn = document.getElementById('enter-meeting-btn');
        if (enterBtn) { enterBtn.style.display = ''; enterBtn.removeAttribute('hidden'); }
    });
    await sleep(600);

    // Click the nav button to enter meeting room
    const meetingNav = await page.$('#nav-meeting-btn');
    if (meetingNav) {
        await meetingNav.click();
        await sleep(2000);
    } else {
        await page.evaluate(() => {
            // Force navigation to meeting view
            document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
            const mv = document.getElementById('view-meeting');
            if (mv) mv.classList.remove('hidden');
        });
        await sleep(1500);
    }

    // ── 7. Show Meeting Room layout ───────────────────────────────
    console.log('[7/10] Meeting Room — overview');
    await sleep(1500);
    // Scroll to see the agent seats ring
    await page.evaluate(() => {
        const ring = document.getElementById('mr-agents-ring') || document.querySelector('.mr-table-wrap');
        if (ring) ring.scrollIntoView({ behavior: 'smooth' });
    });
    await sleep(1500);

    // ── 8. Begin the meeting ──────────────────────────────────────
    console.log('[8/10] Beginning the debate...');
    const beginBtn = await page.$('#mr-begin-btn');
    if (beginBtn && await beginBtn.isVisible()) {
        await beginBtn.click();
        await sleep(2000);
        console.log('   Debate started — watching opening statements + debate turns...');
        // Headless has no speechSynthesis so speak() falls into the reading-delay path
        // (3-12s per turn). Wait long enough to show several full turns.
        await sleep(60000);
    } else {
        console.log('   ℹ️  Begin button not available');
        await sleep(2000);
    }

    // ── 9. Scroll through transcript ──────────────────────────────
    console.log('[9/10] Scrolling transcript...');
    try {
        const transcript = await page.$('#mr-transcript');
        if (transcript && await transcript.isVisible()) {
            await page.evaluate(() => {
                const t = document.getElementById('mr-transcript');
                if (t) t.scrollTo({ top: t.scrollHeight, behavior: 'smooth' });
            });
            await sleep(2000);
        }
    } catch(e) {}

    // ── 10. Ask a question in the meeting room ─────────────────────
    console.log('[10/10] Meeting Room Q&A');
    try {
        const mrInput = await page.$('#mr-question-input, #mr-q-input, input[placeholder*="question"]');
        const mrAskBtn = await page.$('#mr-ask-btn');
        if (mrAskBtn && await mrAskBtn.isVisible()) {
            if (mrInput) {
                await mrInput.click();
                await mrInput.type('Which agent had the most critical findings?', { delay: 50 });
                await sleep(1000);
            }
            await mrAskBtn.click();
            await sleep(3000);
        }
    } catch(e) { console.log('   ℹ️  Meeting Q&A skipped'); }

    // Final pause
    await sleep(3000);

    // ── Wrap up ───────────────────────────────────────────────────
    console.log('🎞️  Finalising recording...');
    const videoPath = await page.video()?.path();
    await context.close();
    await browser.close();

    // Rename to walkthrough.webm
    try {
        const target = `${OUT_DIR}/walkthrough.webm`;
        const src = videoPath || execSync(
            `find "${OUT_DIR}" -maxdepth 1 -name "*.webm" -not -name "walkthrough.webm" 2>/dev/null | head -1`
        ).toString().trim();

        if (src) {
            execSync(`mv "${src}" "${target}"`);
            console.log(`✅  Saved: ${target}`);
            const size = execSync(`du -sh "${target}"`).toString().trim();
            console.log(`📦  Size: ${size}`);
            console.log(`🔗  Download via: ${APP_URL}/download/walkthrough.webm`);
        }
    } catch(e) { console.log('ℹ️  Check', OUT_DIR, 'for .webm'); }
})();
