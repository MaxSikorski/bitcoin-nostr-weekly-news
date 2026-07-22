/* ============================================================
   Presenter Engine — Slide navigation, timer, QR, TOC
   ============================================================ */

(function () {
    'use strict';

    // === State ===
    let weekData = null;
    let slides = [];
    let currentSlide = 0;
    let timerInterval = null;
    let timerSeconds = 20 * 60; // countdown from 20:00
    let timerRunning = false;
    let timerStarted = false;
    let qrVisible = false;
    let tocOpen = false;
    let overviewSlideIndex = 1; // index of the overview slide

    // === DOM Elements ===
    const presentation = document.getElementById('presentation');
    const loadingState = document.getElementById('loading-state');
    const progressBar = document.getElementById('progress-bar');
    const slideCounter = document.getElementById('slide-counter');
    const prevBtn = document.getElementById('prev-btn');
    const nextBtn = document.getElementById('next-btn');
    const timerDisplay = document.getElementById('timer-display');
    const tocOverlay = document.getElementById('toc-overlay');
    const tocSidebar = document.getElementById('toc-sidebar');
    const tocList = document.getElementById('toc-list');
    const tocClose = document.getElementById('toc-close');
    const tocToggleBtn = document.getElementById('toc-toggle-btn');
    const qrOverlay = document.getElementById('qr-overlay');
    const qrCanvas = document.getElementById('qr-canvas');
    const qrLabel = document.getElementById('qr-label');
    const qrToggleBtn = document.getElementById('qr-toggle-btn');
    const presenterControls = document.getElementById('presenter-controls');
    const keyboardHints = document.getElementById('keyboard-hints');

    // === Utility: Extract YouTube embed URL ===
    function getYouTubeEmbedUrl(url) {
        if (!url) return null;
        let videoId = null;
        let startTime = '';

        // Handle youtu.be short URLs
        const shortMatch = url.match(/youtu\.be\/([a-zA-Z0-9_-]{11})/);
        if (shortMatch) {
            videoId = shortMatch[1];
        }

        // Handle youtube.com URLs
        const longMatch = url.match(/[?&]v=([a-zA-Z0-9_-]{11})/);
        if (longMatch) {
            videoId = longMatch[1];
        }

        if (!videoId) return null;

        // Extract timestamp
        const timeMatch = url.match(/[?&]t=(\d+)/);
        if (timeMatch) {
            startTime = `&start=${timeMatch[1]}`;
        }

        return `https://www.youtube.com/embed/${videoId}?rel=0&modestbranding=1${startTime}`;
    }

    // === Utility: Simple QR Code Generator ===
    // Minimal QR code generator (alphanumeric, for URLs)
    // Using a canvas-based approach with the QR algorithm
    function generateQR(text, canvas, size) {
        if (!canvas || !text) return;

        // Use a simple encoding: render as a visual code-like pattern
        // For a real QR code, we'll use a lightweight inline implementation
        const ctx = canvas.getContext('2d');
        canvas.width = size;
        canvas.height = size;

        // Generate QR matrix using the embedded micro-library
        const qr = QREncoder.encode(text);
        const modules = qr.modules;
        const moduleCount = qr.moduleCount;
        const cellSize = size / moduleCount;

        // Background
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);

        // Modules
        ctx.fillStyle = '#000000';
        for (let row = 0; row < moduleCount; row++) {
            for (let col = 0; col < moduleCount; col++) {
                if (modules[row][col]) {
                    ctx.fillRect(
                        Math.round(col * cellSize),
                        Math.round(row * cellSize),
                        Math.ceil(cellSize),
                        Math.ceil(cellSize)
                    );
                }
            }
        }
    }

    // === Minimal QR Code Encoder ===
    // Embedded lightweight QR code encoder (Mode: Byte, EC Level: L)
    const QREncoder = (function () {
        // QR Code generator adapted for minimal size
        // Supports up to ~150 chars at EC level L

        const MODE_BYTE = 4;
        const EC_LEVEL_L = 1;

        // Pre-computed for versions 1-10
        const VERSION_CAPACITY = [0, 17, 32, 53, 78, 106, 134, 154, 192, 230, 271];
        const VERSION_SIZE = [0, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57];
        const EC_CODEWORDS = [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18];
        const NUM_EC_BLOCKS = [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4];

        // Galois field tables
        const GF_EXP = new Array(256);
        const GF_LOG = new Array(256);

        (function initGF() {
            let x = 1;
            for (let i = 0; i < 255; i++) {
                GF_EXP[i] = x;
                GF_LOG[x] = i;
                x = x * 2;
                if (x >= 256) x ^= 0x11d;
            }
            GF_EXP[255] = GF_EXP[0];
        })();

        function gfMul(a, b) {
            if (a === 0 || b === 0) return 0;
            return GF_EXP[(GF_LOG[a] + GF_LOG[b]) % 255];
        }

        function polyMul(p1, p2) {
            const result = new Array(p1.length + p2.length - 1).fill(0);
            for (let i = 0; i < p1.length; i++) {
                for (let j = 0; j < p2.length; j++) {
                    result[i + j] ^= gfMul(p1[i], p2[j]);
                }
            }
            return result;
        }

        function getGeneratorPoly(degree) {
            let gen = [1];
            for (let i = 0; i < degree; i++) {
                gen = polyMul(gen, [1, GF_EXP[i]]);
            }
            return gen;
        }

        function rsEncode(data, ecLength) {
            const gen = getGeneratorPoly(ecLength);
            const padded = new Array(data.length + ecLength).fill(0);
            for (let i = 0; i < data.length; i++) padded[i] = data[i];

            for (let i = 0; i < data.length; i++) {
                const coef = padded[i];
                if (coef !== 0) {
                    for (let j = 0; j < gen.length; j++) {
                        padded[i + j] ^= gfMul(gen[j], coef);
                    }
                }
            }

            return padded.slice(data.length);
        }

        function getVersion(dataLength) {
            for (let v = 1; v <= 10; v++) {
                const capacity = VERSION_CAPACITY[v] - EC_CODEWORDS[v] * NUM_EC_BLOCKS[v];
                if (dataLength + 3 <= capacity) return v; // +3 for mode and length indicators
            }
            return 10; // max supported
        }

        function encode(text) {
            const data = [];
            for (let i = 0; i < text.length; i++) {
                data.push(text.charCodeAt(i));
            }

            const version = getVersion(data.length);
            const size = VERSION_SIZE[version];
            const ecPerBlock = EC_CODEWORDS[version];
            const numBlocks = NUM_EC_BLOCKS[version];
            const totalDataCW = VERSION_CAPACITY[version] - ecPerBlock * numBlocks;

            // Build data stream
            const bitStream = [];

            // Mode indicator (byte mode = 0100)
            bitStream.push(0, 1, 0, 0);

            // Character count (8 bits for versions 1-9, 16 for 10+)
            const countBits = version <= 9 ? 8 : 16;
            for (let i = countBits - 1; i >= 0; i--) {
                bitStream.push((data.length >> i) & 1);
            }

            // Data
            for (let i = 0; i < data.length; i++) {
                for (let b = 7; b >= 0; b--) {
                    bitStream.push((data[i] >> b) & 1);
                }
            }

            // Terminator
            const maxBits = totalDataCW * 8;
            for (let i = 0; i < 4 && bitStream.length < maxBits; i++) {
                bitStream.push(0);
            }

            // Pad to byte boundary
            while (bitStream.length % 8 !== 0 && bitStream.length < maxBits) {
                bitStream.push(0);
            }

            // Pad codewords
            const padBytes = [0xEC, 0x11];
            let padIdx = 0;
            while (bitStream.length < maxBits) {
                for (let b = 7; b >= 0; b--) {
                    bitStream.push((padBytes[padIdx] >> b) & 1);
                }
                padIdx = (padIdx + 1) % 2;
            }

            // Convert to bytes
            const dataCodewords = [];
            for (let i = 0; i < bitStream.length; i += 8) {
                let byte = 0;
                for (let b = 0; b < 8; b++) {
                    byte = (byte << 1) | (bitStream[i + b] || 0);
                }
                dataCodewords.push(byte);
            }

            // RS error correction
            const blockSize = Math.floor(totalDataCW / numBlocks);
            const allCodewords = [];

            for (let b = 0; b < numBlocks; b++) {
                const start = b * blockSize;
                const blockData = dataCodewords.slice(start, start + blockSize);
                const ec = rsEncode(blockData, ecPerBlock);
                allCodewords.push({ data: blockData, ec: ec });
            }

            // Interleave
            const finalData = [];
            const maxDataLen = Math.max(...allCodewords.map(b => b.data.length));
            for (let i = 0; i < maxDataLen; i++) {
                for (let b = 0; b < numBlocks; b++) {
                    if (i < allCodewords[b].data.length) finalData.push(allCodewords[b].data[i]);
                }
            }
            for (let i = 0; i < ecPerBlock; i++) {
                for (let b = 0; b < numBlocks; b++) {
                    finalData.push(allCodewords[b].ec[i]);
                }
            }

            // Create module matrix
            const modules = Array.from({ length: size }, () => new Array(size).fill(null));
            const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

            // Place finder patterns
            function placeFinder(row, col) {
                for (let r = -1; r <= 7; r++) {
                    for (let c = -1; c <= 7; c++) {
                        const mr = row + r, mc = col + c;
                        if (mr < 0 || mr >= size || mc < 0 || mc >= size) continue;
                        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
                            const isOuter = r === 0 || r === 6 || c === 0 || c === 6;
                            const isInner = r >= 2 && r <= 4 && c >= 2 && c <= 4;
                            modules[mr][mc] = isOuter || isInner;
                        } else {
                            modules[mr][mc] = false;
                        }
                        reserved[mr][mc] = true;
                    }
                }
            }

            placeFinder(0, 0);
            placeFinder(0, size - 7);
            placeFinder(size - 7, 0);

            // Timing patterns
            for (let i = 8; i < size - 8; i++) {
                if (!reserved[6][i]) {
                    modules[6][i] = i % 2 === 0;
                    reserved[6][i] = true;
                }
                if (!reserved[i][6]) {
                    modules[i][6] = i % 2 === 0;
                    reserved[i][6] = true;
                }
            }

            // Dark module
            modules[size - 8][8] = true;
            reserved[size - 8][8] = true;

            // Reserve format info areas
            for (let i = 0; i < 9; i++) {
                if (i < size) { reserved[8][i] = true; reserved[i][8] = true; }
            }
            for (let i = 0; i < 8; i++) {
                reserved[8][size - 1 - i] = true;
                reserved[size - 1 - i][8] = true;
            }

            // Alignment pattern (for version >= 2)
            if (version >= 2) {
                const alignPos = size - 7; // simplified for small versions
                for (let r = -2; r <= 2; r++) {
                    for (let c = -2; c <= 2; c++) {
                        const mr = alignPos + r, mc = alignPos + c;
                        if (mr >= 0 && mr < size && mc >= 0 && mc < size && !reserved[mr][mc]) {
                            const isOuter = Math.abs(r) === 2 || Math.abs(c) === 2;
                            const isCenter = r === 0 && c === 0;
                            modules[mr][mc] = isOuter || isCenter;
                            reserved[mr][mc] = true;
                        }
                    }
                }
            }

            // Place data
            const finalBits = [];
            for (let i = 0; i < finalData.length; i++) {
                for (let b = 7; b >= 0; b--) {
                    finalBits.push((finalData[i] >> b) & 1);
                }
            }

            let bitIndex = 0;
            let upward = true;

            for (let col = size - 1; col >= 0; col -= 2) {
                if (col === 6) col = 5; // skip timing column
                const rows = upward ? Array.from({ length: size }, (_, i) => size - 1 - i) : Array.from({ length: size }, (_, i) => i);

                for (const row of rows) {
                    for (let c = 0; c < 2; c++) {
                        const actualCol = col - c;
                        if (actualCol < 0 || reserved[row][actualCol]) continue;
                        modules[row][actualCol] = bitIndex < finalBits.length ? finalBits[bitIndex++] === 1 : false;
                    }
                }
                upward = !upward;
            }

            // Apply mask (pattern 0: (row + col) % 2 === 0)
            for (let r = 0; r < size; r++) {
                for (let c = 0; c < size; c++) {
                    if (!reserved[r][c]) {
                        if ((r + c) % 2 === 0) {
                            modules[r][c] = !modules[r][c];
                        }
                    }
                }
            }

            // Place format info (mask 0, EC level L)
            // Pre-computed format string for EC-L, mask 0: 111011111000100
            const formatBits = [1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 0, 0];

            // Around top-left finder
            for (let i = 0; i < 6; i++) modules[8][i] = formatBits[i] === 1;
            modules[8][7] = formatBits[6] === 1;
            modules[8][8] = formatBits[7] === 1;
            modules[7][8] = formatBits[8] === 1;
            for (let i = 0; i < 6; i++) modules[5 - i][8] = formatBits[9 + i] === 1;

            // Around other finders
            for (let i = 0; i < 7; i++) modules[size - 1 - i][8] = formatBits[i] === 1;
            for (let i = 0; i < 8; i++) modules[8][size - 8 + i] = formatBits[7 + i] === 1;

            return { modules, moduleCount: size };
        }

        return { encode };
    })();

    // === Build Slides from JSON ===
    function buildSlides(data) {
        slides = [];
        const container = presentation;
        container.innerHTML = '';

        // Slide 0: Hero
        const heroSlide = createSlide('hero');
        const dateObj = new Date(data.date + 'T12:00:00');
        const formattedDate = dateObj.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
        heroSlide.innerHTML = `
            <div class="slide-content" style="text-align: center;">
                <p class="slide-topic-badge">${formattedDate}</p>
                <h1 class="slide-heading" style="font-size: clamp(2.5rem, 5vw, 4rem); margin-bottom: 16px;">${data.title}</h1>
                <p class="slide-body" style="max-width: 480px; margin: 0 auto 40px;">${data.subtitle || 'Weekly Bitcoin & Nostr news and discussion'}</p>
                <div style="display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;">
                    <button class="btn primary-btn" id="start-btn">Start Presentation</button>
                    <span class="btn secondary-btn" style="cursor: default; opacity: 0.5; pointer-events: none;">${data.topics.length} Topics</span>
                </div>
            </div>
        `;
        container.appendChild(heroSlide);
        slides.push({ type: 'hero', el: heroSlide, topicId: null, url: null, accent: null });

        // Slide 1: Topic Overview
        const overviewSlide = createSlide('overview');
        let overviewHTML = `
            <div class="slide-content">
                <p class="slide-topic-badge">Overview</p>
                <h2 class="slide-heading" style="margin-bottom: 32px;">Today's Topics</h2>
                <div class="overview-grid">
        `;

        data.topics.forEach((topic, i) => {
            const typeIcons = {
                video: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>',
                tool: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/></svg>',
                discussion: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>'
            };

            overviewHTML += `
                <button class="topic-card" data-topic-index="${i}" onclick="window.Presenter.goToTopic(${i})">
                    <div class="topic-card-info">
                        <p class="topic-card-number">Topic ${i + 1}</p>
                        <h3 class="topic-card-title">${topic.title}</h3>
                        <p class="topic-card-desc">${topic.description}</p>
                    </div>
                    <svg class="topic-card-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M9 18l6-6-6-6"/>
                    </svg>
                </button>
            `;
        });

        overviewHTML += '</div></div>';
        overviewSlide.innerHTML = overviewHTML;
        container.appendChild(overviewSlide);
        slides.push({ type: 'overview', el: overviewSlide, topicId: null, url: null, accent: null });
        overviewSlideIndex = 1;

        // Topic slides
        data.topics.forEach((topic, topicIndex) => {
            topic.slides.forEach((slideData, slideIndex) => {
                const slide = createSlide('topic');
                let slideHTML = `<div class="slide-content">`;
                slideHTML += `<p class="slide-topic-badge">Topic ${topicIndex + 1}${topic.slides.length > 1 ? ` — ${slideIndex + 1} of ${topic.slides.length}` : ''}</p>`;
                slideHTML += `<h2 class="slide-heading">${slideData.heading}</h2>`;

                if (slideData.body) {
                    slideHTML += `<p class="slide-body">${slideData.body}</p>`;
                }

                if (slideData.widget === 'live-price') {
                    slideHTML += `
                        <div class="live-dashboard">
                            <div class="live-metric live-metric-primary">
                                <span class="live-label">BTC / USD</span>
                                <span class="live-value" id="live-price">—</span>
                            </div>
                            <div class="live-metric-row">
                                <div class="live-metric">
                                    <span class="live-label">Block Height</span>
                                    <span class="live-value-sm" id="live-height">—</span>
                                </div>
                                <div class="live-metric">
                                    <span class="live-label">Fastest Fee</span>
                                    <span class="live-value-sm" id="live-fee">—</span>
                                </div>
                            </div>
                            <span class="live-status" id="live-status">Connecting to mempool.space…</span>
                        </div>
                    `;
                }

                if (slideData.videoUrl) {
                    const embedUrl = getYouTubeEmbedUrl(slideData.videoUrl);
                    if (embedUrl) {
                        slideHTML += `
                            <div class="video-container">
                                <iframe 
                                    src="${embedUrl}" 
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                                    allowfullscreen
                                    loading="lazy"
                                    title="${slideData.videoTitle || slideData.heading}">
                                </iframe>
                            </div>
                        `;
                    }
                }

                if (slideData.imageUrl) {
                    slideHTML += `
                        <div class="slide-image-container">
                            <img src="${slideData.imageUrl}" alt="${slideData.heading}" loading="lazy">
                        </div>
                    `;
                }

                if (slideData.imageUrls && Array.isArray(slideData.imageUrls)) {
                    slideHTML += `<div class="slide-gallery-container">`;
                    slideData.imageUrls.forEach(url => {
                        slideHTML += `
                            <div class="slide-gallery-item">
                                <img src="${url}" alt="${slideData.heading}" loading="lazy">
                            </div>
                        `;
                    });
                    slideHTML += `</div>`;
                }

                if (slideData.bullets) {
                    slideHTML += '<ul class="slide-bullets">';
                    slideData.bullets.forEach(bullet => {
                        slideHTML += `<li>${bullet}</li>`;
                    });
                    slideHTML += '</ul>';
                }

                if (slideData.link) {
                    slideHTML += `
                        <a href="${slideData.link}" target="_blank" rel="noopener noreferrer" class="slide-link">
                            ${slideData.linkLabel || 'Open Link'}
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M7 17L17 7M17 7H7M17 7v10"/>
                            </svg>
                        </a>
                    `;
                }

                if (slideData.links && Array.isArray(slideData.links)) {
                    slideHTML += `<div class="slide-links-row">`;
                    slideData.links.forEach(lnk => {
                        slideHTML += `
                            <a href="${lnk.url}" target="_blank" rel="noopener noreferrer" class="slide-link">
                                ${lnk.label || 'Open Link'}
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M7 17L17 7M17 7H7M17 7v10"/>
                                </svg>
                            </a>
                        `;
                    });
                    slideHTML += `</div>`;
                }

                slideHTML += '</div>';
                slide.innerHTML = slideHTML;

                // Curtain Reveal (opt-in): hide this slide behind a glass curtain until clicked
                if (slideData.reveal) {
                    slide.classList.add('reveal-armed');
                    slide.dataset.revealConfig = JSON.stringify(slideData.reveal === true ? {} : slideData.reveal);
                    slide.insertAdjacentHTML('beforeend', revealCurtainHTML(slideData.reveal));
                }

                container.appendChild(slide);

                // Determine URL for QR code
                const qrUrl = slideData.link || slideData.videoUrl || (slideData.links && slideData.links[0] && slideData.links[0].url) || topic.url || null;
                slides.push({
                    type: 'topic',
                    el: slide,
                    topicId: topic.id,
                    topicIndex: topicIndex,
                    url: qrUrl,
                    accent: topic.accent || null
                });
            });
        });

        return slides;
    }

    function createSlide(type) {
        const slide = document.createElement('div');
        slide.className = 'slide';
        slide.dataset.type = type;
        return slide;
    }

    // === Curtain Reveal — opt-in per slide via a "reveal" key (true | {kicker, label, confetti}) ===
    // A one-shot theatrical unveil: the slide hides behind a glass curtain with a single
    // button; clicking parts the curtain and staggers the content in. Reloading re-arms it.
    // Mirrored 2026-07-16 from the 3DP site (their W29 Curve Cut spotlight); dormant here
    // until a slide opts in.
    function revealCurtainHTML(reveal) {
        const cfg = (typeof reveal === 'object' && reveal !== null) ? reveal : {};
        const kicker = cfg.kicker || 'Builder Spotlight';
        const label = cfg.label || 'Unveil';
        return `
            <div class="slide-reveal-curtain">
                <div class="slide-reveal-panel slide-reveal-panel-left"></div>
                <div class="slide-reveal-panel slide-reveal-panel-right"></div>
                <div class="slide-reveal-seam"></div>
                <div class="slide-reveal-center">
                    <p class="slide-reveal-kicker">${kicker}</p>
                    <button type="button" class="slide-reveal-btn">${label}</button>
                </div>
            </div>
        `;
    }

    function playReveal(slideEl) {
        if (!slideEl || slideEl.dataset.revealed === 'true') return;
        slideEl.dataset.revealed = 'true';
        const curtain = slideEl.querySelector('.slide-reveal-curtain');
        const content = slideEl.querySelector('.slide-content');
        if (!curtain || !content) return;

        let cfg = {};
        try { cfg = JSON.parse(slideEl.dataset.revealConfig || '{}'); } catch (e) { /* defaults */ }

        const left = curtain.querySelector('.slide-reveal-panel-left');
        const right = curtain.querySelector('.slide-reveal-panel-right');
        const seam = curtain.querySelector('.slide-reveal-seam');
        const center = curtain.querySelector('.slide-reveal-center');
        const heading = content.querySelector('.slide-heading');
        const inner = content.querySelectorAll('.slide-topic-badge, .slide-heading, .slide-body, .slide-bullets li, .slide-link, .video-container, .slide-image-container, .slide-affiliate-group');

        // Light sweep: sits under the parting panels, over the content
        const sweep = document.createElement('div');
        sweep.className = 'slide-reveal-sweep';
        slideEl.appendChild(sweep);

        gsap.set(inner, { opacity: 0, y: 26 });
        slideEl.classList.remove('reveal-armed'); // content column back; children start hidden

        const tl = gsap.timeline({
            onComplete: () => { curtain.remove(); sweep.remove(); }
        });
        tl.to(center, { opacity: 0, y: -14, duration: 0.35, ease: 'power2.in' }, 0)
          .to(seam, { opacity: 0.5, duration: 0.25, ease: 'power2.out' }, 0.1)
          .to(seam, { opacity: 0, duration: 0.6, ease: 'power2.out' }, 0.45)
          .to(left, { xPercent: -103, duration: 1.15, ease: 'power4.inOut' }, 0.3)
          .to(right, { xPercent: 103, duration: 1.15, ease: 'power4.inOut' }, 0.3)
          .fromTo(sweep, { xPercent: -120 }, { xPercent: 120, duration: 1.0, ease: 'power2.out' }, 0.85)
          .to(inner, { opacity: 1, y: 0, duration: 0.9, ease: 'power4.out', stagger: 0.1 }, 0.9);
        // The heading lands with a pop, not just a fade
        if (heading) {
            tl.fromTo(heading, { scale: 0.92 }, { scale: 1, duration: 0.8, ease: 'back.out(1.7)', clearProps: 'scale' }, 1.0);
        }
        // Settle body copy at the engine's resting opacity
        content.querySelectorAll('.slide-body, .slide-bullets li').forEach(el => {
            tl.to(el, { opacity: 0.85, duration: 0.5, ease: 'power2.out' }, 1.9);
        });
        // Celebration extra — opt-in via the reveal config
        if (cfg.confetti) tl.add(() => spawnRevealConfetti(slideEl), 1.05);
    }

    // Multicolor confetti burst — the ONE sanctioned color exception (Max's call, 2026-07-16):
    // everything else stays monochrome; the confetti alone gets party colors.
    const REVEAL_CONFETTI_COLORS = [
        '#ff3b30', // red
        '#ff9500', // orange
        '#ffcc00', // yellow
        '#34c759', // green
        '#14b8a6', // teal
        '#007aff', // blue
        '#af52de', // purple
        '#ff2d55'  // pink
    ];

    function spawnRevealConfetti(slideEl) {
        const box = document.createElement('div');
        box.className = 'slide-reveal-confetti';
        slideEl.appendChild(box);
        const W = slideEl.clientWidth, H = slideEl.clientHeight;
        const COUNT = 80;
        for (let i = 0; i < COUNT; i++) {
            const p = document.createElement('div');
            p.className = 'slide-reveal-confetti-piece';
            const strip = Math.random() < 0.5;
            const s = 5 + Math.random() * 6;
            p.style.width = s + 'px';
            p.style.height = (strip ? s * 2.4 : s) + 'px';
            p.style.background = REVEAL_CONFETTI_COLORS[Math.floor(Math.random() * REVEAL_CONFETTI_COLORS.length)];
            p.style.opacity = String(0.85 + Math.random() * 0.15); // full color, slight depth
            box.appendChild(p);
            const x0 = W / 2, y0 = H * 0.62;
            const drift = (Math.random() - 0.5) * W * 0.9;
            const rise = H * (0.25 + Math.random() * 0.45);
            const d1 = 0.55 + Math.random() * 0.35;
            const d2 = 0.9 + Math.random() * 0.6;
            gsap.set(p, { x: x0, y: y0, rotation: Math.random() * 360 });
            gsap.timeline({ onComplete: () => p.remove() })
                .to(p, { x: x0 + drift * 0.6, y: y0 - rise, rotation: '+=' + (180 + Math.random() * 360), duration: d1, ease: 'power2.out' })
                .to(p, { x: x0 + drift, y: y0 + H * 0.25, rotation: '+=' + (180 + Math.random() * 360), duration: d2, ease: 'power1.in' })
                .to(p, { opacity: 0, duration: 0.35 }, '-=0.35');
        }
        gsap.delayedCall(3.2, () => box.remove());
    }

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('.slide-reveal-btn');
        if (btn) playReveal(btn.closest('.slide'));
    });

    // === Navigation ===
    function goToSlide(index, direction) {
        if (index < 0 || index >= slides.length || index === currentSlide) return;

        const prevSlideEl = slides[currentSlide].el;
        const nextSlideEl = slides[index].el;
        const dir = direction || (index > currentSlide ? 1 : -1);

        // Start timer on first navigation away from hero
        if (!timerStarted && currentSlide === 0 && index > 0) {
            startTimer();
            timerStarted = true;
        }

        // Animate out
        gsap.to(prevSlideEl, {
            opacity: 0,
            y: dir * -30,
            duration: 0.4,
            ease: 'power4.out',
            onComplete: () => {
                prevSlideEl.classList.remove('active');
                prevSlideEl.style.transform = '';
            }
        });

        // Animate in
        gsap.set(nextSlideEl, { opacity: 0, y: dir * 30 });
        nextSlideEl.classList.add('active');
        gsap.to(nextSlideEl, {
            opacity: 1,
            y: 0,
            duration: 0.6,
            ease: 'power4.out',
            delay: 0.1
        });

        // Animate inner elements stagger
        const innerElements = nextSlideEl.querySelectorAll('.slide-topic-badge, .slide-heading, .slide-body, .slide-bullets li, .slide-link, .video-container, .topic-card');
        if (innerElements.length > 0) {
            gsap.set(innerElements, { opacity: 0, y: 15 });
            gsap.to(innerElements, {
                opacity: 1,
                y: 0,
                duration: 0.6,
                ease: 'power4.out',
                stagger: 0.06,
                delay: 0.2
            });

            // Fix opacity for specific elements after animation
            nextSlideEl.querySelectorAll('.slide-body').forEach(el => {
                gsap.to(el, { opacity: 0.85, duration: 0.6, ease: 'power4.out', delay: 0.3 });
            });
            nextSlideEl.querySelectorAll('.slide-bullets li').forEach(el => {
                gsap.to(el, { opacity: 0.85, duration: 0.6, ease: 'power4.out', delay: 0.3 });
            });
        }

        currentSlide = index;
        updateControls();
        updateQR();
        updateTOCHighlight();
    }

    function nextSlide() {
        if (currentSlide < slides.length - 1) {
            goToSlide(currentSlide + 1, 1);
        }
    }

    function prevSlide() {
        if (currentSlide > 0) {
            goToSlide(currentSlide - 1, -1);
        }
    }

    function goToOverview() {
        goToSlide(overviewSlideIndex);
    }

    function goToTopic(topicIndex) {
        // Find the first slide for this topic
        const slideIdx = slides.findIndex(s => s.topicIndex === topicIndex);
        if (slideIdx >= 0) {
            goToSlide(slideIdx, 1);
        }
    }

    function updateControls() {
        // Slide counter
        slideCounter.textContent = `${currentSlide + 1} / ${slides.length}`;

        // Nav buttons
        prevBtn.disabled = currentSlide === 0;
        nextBtn.disabled = currentSlide === slides.length - 1;

        // Progress bar
        const progress = slides.length > 1 ? (currentSlide / (slides.length - 1)) * 100 : 0;
        progressBar.style.width = `${progress}%`;

        // Topic accent (bitcoin = orange, nostr = purple, otherwise monochrome)
        const accent = slides[currentSlide].accent;
        progressBar.classList.toggle('accent-bitcoin', accent === 'bitcoin');
        progressBar.classList.toggle('accent-nostr', accent === 'nostr');
    }

    // === Timer ===
    function startTimer() {
        if (timerRunning) return;
        timerRunning = true;
        timerInterval = setInterval(() => {
            timerSeconds--;
            if (timerSeconds <= 0) {
                timerSeconds = 0;
                clearInterval(timerInterval);
                timerRunning = false;
            }
            updateTimerDisplay();
        }, 1000);
    }

    function pauseTimer() {
        clearInterval(timerInterval);
        timerRunning = false;
    }

    function resetTimer() {
        pauseTimer();
        timerSeconds = (weekData && weekData.timerMinutes ? weekData.timerMinutes : 20) * 60;
        timerStarted = false;
        updateTimerDisplay();
    }

    function updateTimerDisplay() {
        const mins = Math.floor(timerSeconds / 60);
        const secs = timerSeconds % 60;
        timerDisplay.textContent = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

        // Visual warnings
        timerDisplay.classList.remove('warning', 'critical');
        if (timerSeconds <= 0) {
            timerDisplay.classList.add('critical');
        } else if (timerSeconds <= 5 * 60) { // Last 5 minutes
            timerDisplay.classList.add('warning');
        }
    }

    // === QR Code ===
    function updateQR() {
        if (!qrVisible) return;
        const slideData = slides[currentSlide];
        if (slideData && slideData.url) {
            generateQR(slideData.url, qrCanvas, 140);
            qrLabel.textContent = 'Scan to open';
            qrOverlay.classList.add('visible');
        } else {
            qrOverlay.classList.remove('visible');
        }
    }

    function toggleQR() {
        qrVisible = !qrVisible;
        if (qrVisible) {
            qrToggleBtn.classList.add('active');
            updateQR();
        } else {
            qrToggleBtn.classList.remove('active');
            qrOverlay.classList.remove('visible');
        }
    }

    // === TOC ===
    function buildTOC(data) {
        tocList.innerHTML = '';

        // Overview item
        const overviewItem = document.createElement('button');
        overviewItem.className = 'toc-item';
        overviewItem.innerHTML = `
            <span class="toc-item-number">—</span>
            <span class="toc-item-title">Overview</span>
        `;
        overviewItem.addEventListener('click', () => {
            closeTOC();
            goToSlide(overviewSlideIndex);
        });
        tocList.appendChild(overviewItem);

        data.topics.forEach((topic, i) => {
            const item = document.createElement('button');
            item.className = 'toc-item';
            item.dataset.topicIndex = i;
            item.innerHTML = `
                <span class="toc-item-number">${String(i + 1).padStart(2, '0')}</span>
                <span class="toc-item-title">${topic.title}</span>
            `;
            item.addEventListener('click', () => {
                closeTOC();
                goToTopic(i);
            });
            tocList.appendChild(item);
        });
    }

    function openTOC() {
        tocOpen = true;
        tocOverlay.classList.add('open');
        tocSidebar.classList.add('open');
        tocToggleBtn.classList.add('active');
        updateTOCHighlight();
    }

    function closeTOC() {
        tocOpen = false;
        tocOverlay.classList.remove('open');
        tocSidebar.classList.remove('open');
        tocToggleBtn.classList.remove('active');
    }

    function toggleTOC() {
        if (tocOpen) closeTOC();
        else openTOC();
    }

    function updateTOCHighlight() {
        const items = tocList.querySelectorAll('.toc-item');
        const currentTopicIndex = slides[currentSlide]?.topicIndex;

        items.forEach(item => {
            item.classList.remove('active');
            const idx = item.dataset.topicIndex;
            if (idx !== undefined && parseInt(idx) === currentTopicIndex) {
                item.classList.add('active');
            }
            // Highlight overview
            if (idx === undefined && currentSlide === overviewSlideIndex) {
                item.classList.add('active');
            }
        });
    }

    // === Keyboard Navigation ===
    document.addEventListener('keydown', (e) => {
        // Ignore when typing in inputs
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

        switch (e.key) {
            case 'ArrowRight':
            case 'ArrowDown':
            case ' ':
                e.preventDefault();
                nextSlide();
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                prevSlide();
                break;
            case 'Escape':
                e.preventDefault();
                if (tocOpen) {
                    closeTOC();
                } else {
                    goToOverview();
                }
                break;
            case 't':
            case 'T':
                e.preventDefault();
                toggleTOC();
                break;
            case 'q':
            case 'Q':
                e.preventDefault();
                toggleQR();
                break;
            case 'r':
            case 'R':
                e.preventDefault();
                resetTimer();
                break;
        }

        // Number keys 1-9: jump to topic
        const num = parseInt(e.key);
        if (!isNaN(num) && num >= 1 && num <= 9) {
            e.preventDefault();
            goToTopic(num - 1);
        }
    });

    // === Click Handlers ===
    prevBtn.addEventListener('click', prevSlide);
    nextBtn.addEventListener('click', nextSlide);
    tocToggleBtn.addEventListener('click', toggleTOC);
    tocClose.addEventListener('click', closeTOC);
    tocOverlay.addEventListener('click', closeTOC);
    qrToggleBtn.addEventListener('click', toggleQR);

    timerDisplay.addEventListener('click', () => {
        if (timerRunning) {
            pauseTimer();
        } else {
            startTimer();
        }
    });

    timerDisplay.addEventListener('dblclick', (e) => {
        e.preventDefault();
        resetTimer();
    });

    // === Keyboard Hints ===
    function showKeyboardHints() {
        keyboardHints.classList.add('visible');
        setTimeout(() => {
            keyboardHints.classList.remove('visible');
        }, 4000);
    }

    // === Live Dashboard widget (Phase 1 — live price/height/fee from mempool.space) ===
    // Read-only public API; needs internet, degrades gracefully offline so the rest works on file://.
    function initLiveDashboard() {
        const priceEl = document.getElementById('live-price');
        if (!priceEl) return; // no dashboard slide in this week's deck
        const heightEl = document.getElementById('live-height');
        const feeEl = document.getElementById('live-fee');
        const statusEl = document.getElementById('live-status');
        const fmtUSD = (n) => '$' + Math.round(n).toLocaleString('en-US');

        async function refresh() {
            try {
                const [priceRes, heightRes, feeRes] = await Promise.all([
                    fetch('https://mempool.space/api/v1/prices'),
                    fetch('https://mempool.space/api/blocks/tip/height'),
                    fetch('https://mempool.space/api/v1/fees/recommended')
                ]);
                const price = await priceRes.json();
                const height = await heightRes.text();
                const fee = await feeRes.json();
                if (price && price.USD) priceEl.textContent = fmtUSD(price.USD);
                if (height) heightEl.textContent = parseInt(height, 10).toLocaleString('en-US');
                if (fee && fee.fastestFee) feeEl.textContent = fee.fastestFee + ' sat/vB';
                if (statusEl) statusEl.textContent = 'Live · mempool.space · refreshes every 20s';
            } catch (e) {
                if (statusEl) statusEl.textContent = 'Offline — open the dashboards below for live data';
            }
        }
        refresh();
        setInterval(refresh, 20000);
    }

    // === Inline fallback data for file:// protocol ===
    // Keep in sync with weeks/2026-W24.json
    const INLINE_WEEKS = {
        "2026-W30": {
            "week": "2026-W30",
            "date": "2026-07-22",
            "title": "Voltage Pulls the Plug on Hobby Nodes, the Streak Turns & the Two August 7ths",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market",
                    "title": "Live Dashboard & Market",
                    "description": "Where Bitcoin sits live — and six green days that answered last week's question",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Live Dashboard",
                            "body": "Before the headlines — here's where Bitcoin sits right now. Open the full dashboards below:",
                            "widget": "live-price",
                            "links": [
                                {
                                    "url": "https://bitcoin.clarkmoody.com/dashboard/",
                                    "label": "Clark Moody Dashboard"
                                },
                                {
                                    "url": "https://mempool.space",
                                    "label": "mempool.space"
                                }
                            ]
                        },
                        {
                            "heading": "The Streak Turned",
                            "body": "Last week we called the bounce 'a fragile rebound, not a confirmed recovery' and asked whether one green day meant anything. Six green days later, we have an answer.",
                            "bullets": [
                                "US spot Bitcoin ETFs have now posted six consecutive sessions of net inflows — roughly $727M over the five days through July 20, plus another $203M on July 21. Longest streak since early May",
                                "July 20 alone brought in $227M, the strongest single day since July 6 — and total ETF assets climbed back above $80 billion",
                                "Price followed: a five-week high, more than 15% off the June lows. The live number is on the dashboard behind us",
                                "The honest caveat from the coverage: this could be sellers getting tired rather than institutions coming back. But 'fragile' is no longer the right word"
                            ],
                            "link": "https://www.coindesk.com/business/2026/07/21/live-markets-bitcoin-etfs-post-a-fifth-straight-day-of-inflows-in-a-first-since-april",
                            "linkLabel": "The Five-Day Streak"
                        }
                    ]
                },
                {
                    "id": "voltage-sunset",
                    "title": "Voltage Sunsets Self-Serve Nodes",
                    "description": "The hosted hobby node is going away — if yours lives on Voltage, August 31 is your deadline",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Voltage Pulls the Plug on Self-Serve",
                            "body": "The week's biggest practical story: Voltage — the cloud host where a lot of hobbyists run their Lightning nodes — is shutting down its entire self-serve tier to go enterprise-only.",
                            "bullets": [
                                "The dates: new self-serve provisioning was already disabled July 13. On August 31, the self-serve infrastructure — LND nodes, LNbits, BTCPay instances — goes away entirely",
                                "Enterprise customers are unaffected; that side grew ~1,000% in 18 months serving exchanges, neobanks, wallets and gaming platforms. That's the business now",
                                "Their stated logic: one enterprise integration reaches more Lightning users than a thousand hobby nodes. Cold, but probably true",
                                "What the post does NOT include: any automatic migration of your node or funds. Closing channels and moving sats is on you — and channel closes take time. Don't discover this on August 30"
                            ],
                            "link": "https://voltage.cloud/blog/sunsetting-self-serve",
                            "linkLabel": "The Sunset Announcement"
                        },
                        {
                            "heading": "The End of the Hosted Hobby Node",
                            "bullets": [
                                "The bigger pattern: 'your node, our hardware' was always a halfway house — your keys, someone else's uptime, and a monthly bill that never quite covered what hobbyists cost to serve",
                                "If you're affected, the realistic paths: bring the node home (Umbrel, Start9, RaspiBolt on your own box), or admit you wanted a wallet all along and pick a good one with eyes open",
                                "Worth saying plainly: this is not a rug. Funds aren't at risk if you act — it's a shutdown with six weeks' notice. The lesson is about dependence, not danger",
                                "Discussion for the room: who here runs a hosted node — and what would it take to run it at home instead?"
                            ],
                            "link": "https://umbrel.com",
                            "linkLabel": "One Way to Bring It Home"
                        }
                    ]
                },
                {
                    "id": "bip-110-watch",
                    "title": "BIP-110 Watch: Two Weeks Out",
                    "description": "Our standing tracker — signaling at 1%, and the quietest week yet is the story itself",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "BIP-110 Watch: The Numbers",
                            "body": "A little over two weeks to the flag day, and the monitor tells the same story it's told all summer — just with less time left.",
                            "bullets": [
                                "Miner signaling: 1.07% — 17 of the 1,584 blocks so far in difficulty period 475. Ten more signaling blocks than last week's seven, but the share actually fell as the period filled out",
                                "To activate it needs 55% of one difficulty period — 1,109 of 2,016 blocks. It has 17",
                                "The countdown: block 959,183 tonight, flag day at 961,632 — about 2,449 blocks out, roughly seventeen days (~August 8). The current difficulty period closes in about three days; the next one is the last full period before the deadline",
                                "Node support stays where it's been — low single digits, carried almost entirely by Knots, and Knots' share still isn't BIP-110 endorsement. Still zero major pools"
                            ],
                            "link": "https://bip110monitor.com/",
                            "linkLabel": "Live Signaling Monitor"
                        },
                        {
                            "heading": "What a Failed UASF Looks Like From the Inside",
                            "body": "No new heavyweight statements this week — Back and Saylor said their piece last week and nobody answered. So the useful question now is: what actually happens on August 8 if nothing changes?",
                            "bullets": [
                                "For almost everyone: nothing. Core nodes keep following the most-work chain. You will not notice the flag day happened",
                                "For the handful of nodes enforcing BIP-110: they start rejecting non-signaling blocks — which, at 1% signaling, means waiting on a chain almost nobody is mining. That's not a fork; it's a very quiet room",
                                "The proponents' goal, stated fairly one more time: cap arbitrary non-financial data (34-byte scriptPubKeys, 83-byte OP_RETURN) for one year. The failure isn't the goal — it's trying to get there with a 55% UASF nobody joined",
                                "Our position is unchanged and now looks like the consensus: sound money, wrong vehicle. We stand with Super and URSF-110 — which, at these numbers, will likely never need to run. Two more weeks on the watch"
                            ],
                            "link": "https://www.coindesk.com/tech/2026/07/12/bitcoin-s-bip-110-fork-deadline-nears-with-miner-support-at-zero",
                            "linkLabel": "Miner Support at Zero"
                        }
                    ]
                },
                {
                    "id": "clarity-act",
                    "title": "The Other August 7th",
                    "description": "The Clarity Act has three weeks, three disputes, and the same deadline as the flag day",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Two Deadlines, One Week of August",
                            "body": "Here's a coincidence worth savoring: the Senate's last working day before August recess is August 7 — the same week Bitcoin's flag day lands. Washington's crypto deadline and Bitcoin's governance deadline, side by side. Only one of them has suspense left.",
                            "bullets": [
                                "The Clarity Act — the market-structure bill that would finally say which agency regulates what — cleared committee 15-9 back in May, then stalled. No floor vote, no cloture motion",
                                "Three disputes are holding back the seven-to-nine Democratic votes it needs to beat the filibuster: DeFi regulation, stablecoin oversight, and AML reporting",
                                "The window: the Senate came back July 13 and disperses for recess after August 7. Miss it, and 'crypto regulation 2026' likely becomes 'crypto regulation 2027'",
                                "This is also what moved price this week — the coverage credits Clarity Act optimism for a chunk of the ETF streak. Markets are trading a bill that hasn't been scheduled"
                            ],
                            "link": "https://news.bitcoin.com/senate-republicans-push-clarity-act-with-15-days-left-as-bitcoin-struggles-near-66k/",
                            "linkLabel": "The Senate Countdown"
                        }
                    ]
                },
                {
                    "id": "fips-watch",
                    "title": "FIPS Watch: v0.4.1 Ships",
                    "description": "Our standing tracker — a maintenance release whose notes admit exactly what it doesn't fix",
                    "type": "discussion",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "FIPS Watch: The Honest Point Release",
                            "body": "Last week we watched Johnathan Corgan quietly rebuild the internals of his Nostr-native mesh. This week that discipline produced something: v0.4.1 landed July 19.",
                            "bullets": [
                                "It's a maintenance release, and the notes say so: wire-compatible with v0.4.0, rolling upgrades supported, no coordinated restart needed. No new features, no format changes",
                                "Real fixes: nodes that re-parent no longer route through stale coordinates, and path-MTU values can't be overwritten by looser estimates anymore — both the kind of bug you only find by running a real mesh",
                                "The refreshing part: the bloom-filter headroom bump comes with the developer's own caveat — it 'buys headroom, it does not fix anything.' The structural fix is deferred to the v2 filter work. When did you last read release notes that honest?",
                                "Still pre-audit, as always — watch it, don't trust it with anything that matters yet. But three weeks on this tracker and the pattern holds: small, tested, honest steps"
                            ],
                            "link": "https://github.com/jmcorgan/fips/releases/tag/v0.4.1",
                            "linkLabel": "The v0.4.1 Release Notes"
                        }
                    ]
                },
                {
                    "id": "formal-verification",
                    "title": "Proving Bitcoin Correct",
                    "description": "From Optech: a project that wants to settle consensus arguments with mathematics",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "btc-verified: Proofs Instead of Arguments",
                            "body": "From this week's Optech: a new project called btc-verified is using the Lean4 theorem prover to mathematically verify properties of Bitcoin's consensus rules. Given the year we're having, the timing is almost poetic.",
                            "bullets": [
                                "The idea: instead of arguing about whether a protocol change breaks something, prove it — machine-checked mathematics, the same approach used to verify aircraft software and cryptographic libraries",
                                "Think about this week's other stories: BIP-110 is dying on a question of what a rule change might freeze or split. Formal verification is the long game for answering exactly that class of question with proofs",
                                "Also in Optech #414: Core 30.3 and 29.4 maintenance releases backport the chainstate-compaction fix we covered in 31.1 — less disk churn for nodes on older versions too",
                                "And a validation PR under review fetches transaction inputs in parallel, speeding initial block download 1.18x to 3x — the same 'make running a node cheaper' theme as last week's fountain codes"
                            ],
                            "link": "https://bitcoinops.org/en/newsletters/2026/07/17/",
                            "linkLabel": "Optech Newsletter #414"
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "Know where your Lightning node actually lives",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Quick Tip: Know Where Your Node Lives",
                            "body": "Tonight's homework comes straight from the Voltage story, and it takes five minutes. Open your Lightning wallet and answer one question: whose node is it talking to? If it's your own hardware at home, you're done. If it's a hosted node — Voltage self-serve or anywhere else — write down two things: where it runs, and what the shutdown procedure is. How do you close channels? How long does that take? Where do the sats land? Voltage's customers just got six weeks' notice, which is actually generous — the next provider might offer less. A hosted node isn't a mistake, but not knowing your exit is. If tonight's check turns up an answer you don't like, the fix is a weekend project, not an emergency.",
                            "link": "https://voltage.cloud/blog/sunsetting-self-serve",
                            "linkLabel": "Why This Matters This Week"
                        }
                    ]
                },
                {
                    "id": "community-news",
                    "title": "Community News & Topics",
                    "description": "Share what you're interested in talking about!",
                    "type": "text",
                    "slides": [
                        {
                            "heading": "Next Week's Meetup",
                            "body": "Find something you're interested in talking about? Share it here and we'll cover it in next week's meetup!",
                            "link": "https://github.com/MaxSikorski/bitcoin-nostr-weekly-news/issues",
                            "linkLabel": "Submit a Topic"
                        }
                    ]
                }
            ]
        },
        "2026-W29": {
            "week": "2026-W29",
            "date": "2026-07-15",
            "title": "Back and Saylor Reject BIP-110, Core 31.1's Privacy Fix & the ETF Whipsaw",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market",
                    "title": "Live Dashboard & Market",
                    "description": "Where Bitcoin sits live — a $425M flush, a $181M bounce, and a war premium",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Live Dashboard",
                            "body": "Before the headlines — here's where Bitcoin sits right now. Open the full dashboards below:",
                            "widget": "live-price",
                            "links": [
                                {
                                    "url": "https://bitcoin.clarkmoody.com/dashboard/",
                                    "label": "Clark Moody Dashboard"
                                },
                                {
                                    "url": "https://mempool.space",
                                    "label": "mempool.space"
                                }
                            ]
                        },
                        {
                            "heading": "The Whipsaw",
                            "body": "Two days told opposite stories this week, and the honest read is that neither one settles it.",
                            "bullets": [
                                "Monday: US spot Bitcoin ETFs bled -$424.7M — the biggest single-day outflow this month. Fidelity's FBTC took -$245.6M, BlackRock's IBIT -$185.5M",
                                "Tuesday: +$181.1M back in — but BlackRock alone was +$138.9M of it, over three-quarters of the day. One issuer carried the rebound",
                                "The macro overhang: resurgent US-Iran hostilities pulled price down even on the day demand showed up",
                                "Discussion: a fragile rebound, not a confirmed recovery — does a one-day bounce on one issuer's flows mean anything?"
                            ],
                            "link": "https://cryptoslate.com/bitcoin-etfs-lose-over-424m-wiping-out-last-weeks-gains-as-recovery-fails-first-test/",
                            "linkLabel": "The Flush and the Bounce"
                        }
                    ]
                },
                {
                    "id": "bip-110-watch",
                    "title": "BIP-110 Watch: Three Weeks Out",
                    "description": "Our standing tracker — Back and Saylor both say no, and the signaling still hasn't found a pulse",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "BIP-110 Watch: The Numbers",
                            "body": "Three weeks to the flag day. Signaling is at 1.19% — up from 0.86% last week, which sounds like movement until you count the blocks.",
                            "bullets": [
                                "Miner signaling: 1.19% — 7 of the 590 blocks so far in difficulty period 475. To lock in, it needs 55%: that's 1,109 of 2,016 blocks, roughly 110 a day. It has seven",
                                "Node support stays in the low single digits, carried almost entirely by Bitcoin Knots — and Knots' node share still isn't BIP-110 endorsement",
                                "The countdown: block 958,189 tonight, flag day at 961,632 — 3,443 blocks out, about 24 days (~August 8). Then BIP-110 nodes start rejecting non-signaling blocks",
                                "Still zero major pools. The arithmetic hasn't changed since May; only the deadline has moved closer"
                            ],
                            "link": "https://bip110monitor.com/",
                            "linkLabel": "Live Signaling Monitor"
                        },
                        {
                            "heading": "Back and Saylor Both Say No",
                            "body": "The story this week isn't the number — it's who lined up against it. Two of the loudest voices in Bitcoin came out swinging on the same day, from different directions.",
                            "bullets": [
                                "Michael Saylor: BIP-110 'turns a spam dispute into a consensus change that would invalidate some currently valid, fee-paying transactions.' His argument is the precedent, not the spam",
                                "Adam Back: it tries to police transactions other people choose to send — 'Bitcoin respectfully says no to what you want.' His advice to proponents is to fork away, but 'bitcoin won't be joining it'",
                                "Note they disagree with it for different reasons — Saylor on precedent, Back on permissionless design and minority-chain risk, Super Testnet on miniscript funds freezing via OP_IF in Taproot. Three separate objections, not one pile-on",
                                "The proponents' case, fairly: cap arbitrary non-financial data (34-byte scriptPubKeys, 83-byte OP_RETURN) for one year. Our position is unchanged — sound money, wrong vehicle. We stand with Super and URSF-110"
                            ],
                            "link": "https://crypto.news/adam-back-and-michael-saylor-oppose-bip-110-as-fork-risk-grows/",
                            "linkLabel": "Back and Saylor's Objections"
                        }
                    ]
                },
                {
                    "id": "core-31-1",
                    "title": "Core 31.1: The Privacy Feature That Leaked",
                    "description": "An IP leak in -privatebroadcast, patched — plus less disk churn for the rest of us",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "When the Privacy Feature Leaks",
                            "body": "Bitcoin Core 31.1 landed July 8, and the headline fix carries a certain irony: the feature built to hide where your transactions come from was leaking your IP address.",
                            "bullets": [
                                "In Core's own words: 'This release fixes an ip address leak when using the -privatebroadcast feature'",
                                "Scope check, honestly: -privatebroadcast is opt-in. If you never turned it on, this particular bug never touched you — this is not an emergency",
                                "But if you did turn it on, you turned it on precisely because you wanted that privacy. That's exactly who should update tonight",
                                "The lesson worth keeping: privacy features are software, and software has bugs. Flipping a privacy flag is not the same as having privacy"
                            ],
                            "link": "https://bitcoincore.org/en/releases/31.1/",
                            "linkLabel": "Core 31.1 Release Notes"
                        },
                        {
                            "heading": "The Quiet Win: Less Disk Churn",
                            "bullets": [
                                "The fix more of us will actually feel: Core now compacts the chainstate database regularly, cutting excessive disk reads and writes",
                                "If you've ever watched a node hammer an SSD, that's the one — node hardware lasting longer is part of how self-custody stays cheap",
                                "Also in the release: better wallet input-size estimation, proxy handling on v2-to-v1 reconnects, and MuSig2 pubkey list validation",
                                "Verdict: routine, not urgent — unless you run -privatebroadcast, in which case it's tonight's homework"
                            ],
                            "link": "https://bitcoincore.org/en/releases/",
                            "linkLabel": "All Core Releases"
                        }
                    ]
                },
                {
                    "id": "fountain-codes",
                    "title": "Making Pruned Nodes Pull Their Weight",
                    "description": "Research on letting pruned nodes help new nodes sync — without keeping the whole chain",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Fountain Codes for Initial Block Download",
                            "body": "From this week's Optech: researcher Lucas Lima is exploring fountain codes to solve an old, unglamorous problem — pruned nodes can't help anyone else sync.",
                            "bullets": [
                                "The problem: a pruned node deletes old blocks to save disk, which also means it can't serve them. Every new node syncing the chain leans on the shrinking set of archival nodes",
                                "The idea: chop the chain into fixed-length chunks and encode them, so a receiving node can reconstruct the data from pieces held by many pruned peers — verifying against block headers as it goes",
                                "Why it matters: initial block download is the single biggest barrier to running your own node. Spreading that load makes the network harder to squeeze",
                                "The honest caveats, per the discussion: slower IBD, a node-fingerprinting risk, and more DoS surface. This is research, not a release"
                            ],
                            "link": "https://bitcoinops.org/en/newsletters/2026/07/10/",
                            "linkLabel": "Optech Newsletter #413"
                        }
                    ]
                },
                {
                    "id": "lightning-updates",
                    "title": "Lightning: Safer Payments, Friendlier Closes",
                    "description": "LND tightens expiry validation and Core Lightning makes breakups less awkward",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Two Small Lightning Wins",
                            "bullets": [
                                "LND v0.20.2-beta adds stronger expiry validation on payments — a quiet class of bug where a badly-set expiry can cost you money",
                                "Core Lightning shipped experimental support for 'simple close' — a friendlier way to shut a channel when the two sides disagree about fees",
                                "Channel closes are one of Lightning's sharpest edges: historically, disagreeing on the fee at close time is how a routine exit turns into a force-close",
                                "Neither is headline material on its own. Together they're the pattern that matters — Lightning getting less sharp, one release at a time"
                            ],
                            "link": "https://bitcoinops.org/en/newsletters/2026/07/10/",
                            "linkLabel": "The Release Roundup"
                        }
                    ]
                },
                {
                    "id": "fips-watch",
                    "title": "FIPS Watch: Under the Hood",
                    "description": "Our standing tracker — no new release, but the internals are being rebuilt",
                    "type": "discussion",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "FIPS Watch: Quiet Week, Busy Repo",
                            "body": "A short one tonight. Johnathan Corgan's Nostr-native mesh — npubs as network addresses instead of IPs — shipped nothing new this week, but the commit log is anything but idle.",
                            "bullets": [
                                "Still on v0.4.0 from June 27 — the release we covered when we picked this up two weeks ago. No new tag",
                                "What's happening instead: a deep internals rebuild — per-peer connection handling and peer discovery are being pulled out into small, independently testable pieces, and the supervisor now reports Full / Degraded / Failed health states",
                                "The pattern is the tell: build the new piece with tests, wire it in without changing behavior, then move on. That's maintenance discipline, not feature-chasing",
                                "Still pre-audit — as always, interesting to watch, not something to trust with anything that matters yet"
                            ],
                            "link": "https://github.com/jmcorgan/fips",
                            "linkLabel": "The FIPS Repo"
                        }
                    ]
                },
                {
                    "id": "builder-spotlight",
                    "title": "Builder Spotlight: URSF-110",
                    "description": "Super Testnet's User Rejected Soft Fork — finished since March, and three weeks from mattering",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Builder Spotlight: URSF-110",
                            "body": "With the flag day three weeks out, the spotlight goes to the tool built for exactly this moment — Super Testnet's URSF-110, the User Rejected Soft Fork.",
                            "bullets": [
                                "What it does: if BIP-110 ever activates, URSF-110 lets your node reject blocks that signal for it — using Core's own invalidateblock, no patched software required",
                                "The name is the joke and the argument: BIP-110 is a User Activated Soft Fork, so this is the User Rejected Soft Fork. If 55% of miners can force a rule, users can decline it the same way",
                                "Why Super opposes BIP-110 — and it's worth being precise: not because he likes inscriptions, but because OP_IF in Taproot means the rule can freeze miniscript funds, and a 55% UASF risks the chain split it claims to prevent",
                                "Classic Super: it's a small script, it's public, and it's been finished since March. Nothing to update — it was done when he wrote it"
                            ],
                            "link": "https://github.com/supertestnet/URSF-110",
                            "linkLabel": "URSF-110 on GitHub"
                        },
                        {
                            "heading": "A Finished Tool Is Its Own Statement",
                            "bullets": [
                                "Nothing has been committed to URSF-110 since March 31 — and that's the point. It isn't abandoned; it's ready. The insurance policy doesn't need a changelog",
                                "It's also a good lesson in how Bitcoin actually resolves disputes: not by winning an argument, but by making the alternative cheap and available to anyone",
                                "Reality check: with signaling at 1.19% and no major pool on board, URSF-110 will probably never need to run. That's the best outcome for everyone, including Super",
                                "Super's other work is where his attention is now — most recently hedgehog. Follow the repos; something new lands most weeks"
                            ],
                            "link": "https://github.com/supertestnet?tab=repositories",
                            "linkLabel": "Super's Repositories"
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "Three weeks out, know what your own node will actually do",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Quick Tip: Know What Your Node Does on August 7",
                            "body": "Here's tonight's homework, and it takes about thirty seconds. If you run a node, find out what software it's actually running before the flag day — because that single fact decides what your node does on August 7. Run 'bitcoin-cli -netinfo' or check the About screen: it'll tell you whether you're on Core or Knots, and which version. If you're on Bitcoin Core, nothing happens — you keep following the chain with the most work, same as always. If you're on Knots with BIP-110 enforcement enabled, your node would begin rejecting blocks that don't signal, and with signaling near zero that means following a chain almost nobody is mining. Neither choice is wrong. Not knowing which one you've made is.",
                            "link": "https://bip110.org/",
                            "linkLabel": "Read the Proposal Yourself"
                        }
                    ]
                },
                {
                    "id": "community-news",
                    "title": "Community News & Topics",
                    "description": "Share what you're interested in talking about!",
                    "type": "text",
                    "slides": [
                        {
                            "heading": "Next Week's Meetup",
                            "body": "Find something you're interested in talking about? Share it here and we'll cover it in next week's meetup!",
                            "link": "https://github.com/MaxSikorski/bitcoin-nostr-weekly-news/issues",
                            "linkLabel": "Submit a Topic"
                        }
                    ]
                }
            ]
        },
        "2026-W28": {
            "week": "2026-W28",
            "date": "2026-07-08",
            "title": "Strategy Sells $216M, Trump's $1.4B Crypto Year & Getting Started on Nostr",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market",
                    "title": "Live Dashboard & Market",
                    "description": "Where Bitcoin sits live — a six-day streak, a wobble, and the ETF bleeding finally stops",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Live Dashboard",
                            "body": "Before the headlines — here's where Bitcoin sits right now. Open the full dashboards below:",
                            "widget": "live-price",
                            "links": [
                                {
                                    "url": "https://bitcoin.clarkmoody.com/dashboard/",
                                    "label": "Clark Moody Dashboard"
                                },
                                {
                                    "url": "https://mempool.space",
                                    "label": "mempool.space"
                                }
                            ]
                        },
                        {
                            "heading": "The Bounce, and the Wobble",
                            "body": "After June's historic ugliness, July opened with Bitcoin's longest winning streak since March — six green days — before pulling back into tonight around the low $60Ks.",
                            "bullets": [
                                "The streak carried Bitcoin back toward $64K before Tuesday's reversal — the strongest start to a month since May",
                                "The bigger signal: US spot Bitcoin ETFs snapped a 10-day outflow streak with +$221.7M — their largest daily haul in two months, right after the worst month on record",
                                "The caution flag: the Coinbase Premium has now been negative for 50 straight days — US spot demand still hasn't shown up",
                                "Discussion: after a -20% June, is this the turn — or a relief rally into weak hands?"
                            ],
                            "link": "https://www.coindesk.com/daybook-us/2026/07/07/bitcoin-s-july-gains-may-be-fleeting-as-u-s-demand-stays-weak",
                            "linkLabel": "The Demand Picture"
                        }
                    ]
                },
                {
                    "id": "strategy-sells",
                    "title": "Strategy Sells 3,588 BTC",
                    "description": "Last week the doctrine ended on paper — this week $216M of bitcoin actually left the stack",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "3,588 BTC, $216 Million",
                            "body": "Last week we covered Strategy formally ending 'never sell.' This week the theory became practice: Monday's disclosure showed the company sold 3,588 BTC for $216 million — a dramatic escalation from May's 32-BTC test sale.",
                            "bullets": [
                                "CEO Phong Le: 'Strategy is evolving from one-way capital issuance to active capital management' — sales now fund dividends and obligations instead of fresh capital raises",
                                "The context underneath: an $8.32 BILLION loss on digital assets in Q2 as Bitcoin traded from ~$68K down to ~$60K",
                                "This is exactly the rules-based selling framework the board adopted June 29 — replenish the cash buffer, pay the 12% STRC dividend, fund buybacks",
                                "From 32 BTC to 3,588 BTC in six weeks — the question is no longer whether Strategy sells, but on what schedule"
                            ],
                            "link": "https://www.coindesk.com/tech/2026/07/06/live-markets-bitcoin-pops-to-usd63-900-then-reverses-as-week-begins",
                            "linkLabel": "The Disclosure Coverage"
                        },
                        {
                            "heading": "The Inoculation Worked + Discussion",
                            "bullets": [
                                "Remember May: a 32-BTC sale helped panic the market from $74K to $60K. This time, 112x more bitcoin sold — and the price recovered above $63K the same day",
                                "That was Saylor's stated plan: 'inoculate' the market by preparing it for sales until they stop being news",
                                "The uncomfortable read: the largest corporate holder is now a rules-based seller sitting above the market — permanently",
                                "Discussion: does a well-telegraphed seller change your thesis — or is a boring, orderly Strategy actually the bullish outcome?"
                            ],
                            "link": "https://www.coindesk.com/markets/2026/06/29/strategy-opens-the-door-to-selling-bitcoin-under-new-capital-plan-here-s-what-it-means",
                            "linkLabel": "The Framework (Last Week)"
                        }
                    ]
                },
                {
                    "id": "trump-crypto-income",
                    "title": "Trump's $1.4B Crypto Year",
                    "description": "The disclosure is out: crypto was the President's biggest income source — and his buyers' biggest loss",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "The $1.4 Billion Disclosure",
                            "body": "The Office of Government Ethics released President Trump's 927-page financial disclosure for 2025 on Tuesday — and crypto was his single largest source of income, dwarfing real estate.",
                            "bullets": [
                                "Total income from crypto ventures: more than $1.4 BILLION for the year",
                                "The $TRUMP meme coin licensing alone brought in $635M+ (via the 'Celebration Coins' agreement)",
                                "World Liberty Financial token sales added $550M+ — the venture launched by his sons, with Trump as 'co-founder emeritus'",
                                "For scale: the President of the United States earned more from token launches last year than most public Bitcoin miners are worth"
                            ],
                            "link": "https://www.nbcnews.com/politics/donald-trump/financial-disclosure-1-billion-cryptocurrency-earnings-meme-coins-rcna352497",
                            "linkLabel": "The Disclosure Story"
                        },
                        {
                            "heading": "The Other Side of the Trade",
                            "body": "The same week the disclosure landed, the on-chain data on who funded those earnings came into focus — and it's brutal.",
                            "bullets": [
                                "Roughly 66% of the 1.48 million wallets that ever bought $TRUMP — 988,905 wallets — were underwater by end of June",
                                "Their combined losses: $3.81 BILLION. The licensor profited regardless of price",
                                "This is the meme-coin design working as intended: an issuer, a licensing deal, and a brand extract value; holders provide it",
                                "The discussion writes itself: this is exactly what Bitcoin isn't — no issuer, no insider allocation, no license. When people say 'crypto,' make them say which one"
                            ],
                            "link": "https://fortune.com/2026/07/07/donald-trump-meme-coin-world-liberty-financial-finance-politics/",
                            "linkLabel": "The Holder Data"
                        }
                    ]
                },
                {
                    "id": "mining-stress",
                    "title": "Mining: Capitulation Territory",
                    "description": "Hashprice at 2020-crash levels, a pool shutting down, and the AI escape hatch widening",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Capitulation-Grade Numbers",
                            "body": "The mining stress we've tracked for weeks is reaching the point where analysts start calling bottoms — because someone's about to get carried out.",
                            "bullets": [
                                "Hashprice sits near $29/PH/day — levels last seen after the 2020 COVID crash; JPMorgan says Bitcoin has traded below its ~$78K average production cost for five straight months, with ~20% of miners operating at a loss",
                                "Public miners have sold 15,000+ BTC off their treasuries from peak levels — and MARA's latest 10-K authorizes sales from its ENTIRE 53,822 BTC reserve",
                                "SBI Crypto is shutting its mining pool July 31 — about 20.9 EH/s, roughly 2.2% of the network, needs a new home",
                                "The next difficulty adjustment lands in ~2-3 days (period 474 ends ~July 10-11) — watch whether June's exodus resumes"
                            ],
                            "link": "https://www.tftc.io/sbi-crypto-mining-pool-shutdown-july-2026",
                            "linkLabel": "The SBI Shutdown"
                        },
                        {
                            "heading": "The AI Escape Hatch",
                            "body": "Last week we said the capacity leaving Bitcoin is defecting to AI. This week that thesis printed its biggest number yet.",
                            "bullets": [
                                "TeraWulf — a Bitcoin miner — jumped 17% in a day after announcing a reported $19B datacenter lease deal with AI lab Anthropic",
                                "The playbook: miners hold the two things AI money can't conjure — powered land and grid interconnects",
                                "The fork in the road for every stressed miner: sell bitcoin, sell hashrate... or sell your substation to AI",
                                "Discussion: is the AI pivot saving Bitcoin miners — or hollowing out the network's security budget from the inside?"
                            ],
                            "link": "https://cryptoslate.com/bitcoin-miner-bottom-signal-now-depends-on-who-survives-weak-mining-profits/",
                            "linkLabel": "Who Survives?"
                        }
                    ]
                },
                {
                    "id": "sec-policy",
                    "title": "The SEC Draws Its Lines",
                    "description": "Clear guidance on mining and staking at last — while the Strategic Reserve idles in committee",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Securities Law Gets Its Lines",
                            "body": "After more than a decade of regulation-by-enforcement, the SEC published formal guidance on how federal securities laws apply to crypto assets.",
                            "bullets": [
                                "Covered explicitly: airdrops, protocol mining, protocol staking, and wrapping of non-security assets",
                                "Chairman Paul Atkins: 'This is what regulatory agencies are supposed to do: draw clear lines in clear terms'",
                                "For this room, the mining clarity matters most — proof-of-work mining rewards treated clearly outside securities law removes a decade-old gray zone",
                                "The pattern of 2026 policy: less drama, more paperwork — which is what maturing infrastructure looks like"
                            ],
                            "link": "https://www.sec.gov/newsroom/press-releases/2026-30-sec-clarifies-application-federal-securities-laws-crypto-assets",
                            "linkLabel": "The SEC Release"
                        },
                        {
                            "heading": "Meanwhile, the Reserve Sits in Limbo",
                            "bullets": [
                                "The US Strategic Bitcoin Reserve is still a work-in-progress: agencies are reportedly fighting over whether Treasury or Commerce should house it",
                                "Congress still hasn't produced the enabling legislation the White House says the final structure needs",
                                "A year after the executive order, the reserve remains an announcement, not an institution",
                                "The contrast beat abroad: India's RBI is internally backing a lean toward a blanket crypto ban — the policy world is diverging, not converging"
                            ],
                            "link": "https://www.coindesk.com/policy/2026/07/06/bitcoin-s-u-s-reserve-still-a-work-in-progress-as-federal-agencies-hash-it-out",
                            "linkLabel": "Reserve Status Report"
                        }
                    ]
                },
                {
                    "id": "quantum-corner",
                    "title": "Core's Quiet Quantum Exit",
                    "description": "This week's Optech reads like a post-quantum design review — the escape plan is taking shape",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Designing Bitcoin's Quantum Exit",
                            "body": "Bitcoin Optech #412 was wall-to-wall post-quantum engineering. Nobody's panicking — but the reference-client developers are methodically designing for the day secp256k1 breaks.",
                            "bullets": [
                                "Pieter Wuille is working through 'Bird of Prey 2' hybrid signatures — Schnorr and post-quantum signatures bound together so neither can be stripped or swapped",
                                "STARK proof aggregation benchmarks: 512 hash-based signatures compress from 3.8 MiB raw to ~454 KiB — the math that could make quantum-safe blocks affordable",
                                "Wuille also proposed two 'kill-switch' triggers for the old curve: a tripwire (someone provably cracks a NUMS point) and a miner lockdown (hashrate-majority activation)",
                                "Also this week: Bitcoin Core 31.1rc1 fixes an IP-address leak affecting transaction-origin privacy — worth the upgrade when it ships"
                            ],
                            "link": "https://bitcoinops.org/en/newsletters/2026/07/03/",
                            "linkLabel": "Optech #412"
                        }
                    ]
                },
                {
                    "id": "zeus-cashu",
                    "title": "Zeus Puts Ecash in Your Pocket",
                    "description": "A friend of the meetup ships the first ecash integration in a major Lightning wallet",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Zeus + Cashu: Lightning Without the Channel",
                            "body": "Zeus — built by Evan Kaloudis, a good friend of this meetup — shipped an alpha integration of Cashu ecash: the first time ecash has landed in a major Bitcoin Lightning wallet.",
                            "bullets": [
                                "The problem it solves: receiving your first sats on Lightning normally means opening a channel — thousands of sats of friction before your first zap",
                                "With Cashu, Zeus can receive zaps and small payments with NO channel at all — then nudges you to upgrade to real self-custody as your balance grows",
                                "The honest caveat, on the slide where it belongs: ecash means trusting the mint that issues it — it's a privacy and onboarding tool, not a vault",
                                "This is the onboarding ramp Nostr zaps have been waiting for — hold that thought for two topics from now"
                            ],
                            "link": "https://bitcoinmagazine.com/business/how-zeus-is-redefining-bitcoin-with-cashu-ecash-integration",
                            "linkLabel": "The Zeus Story"
                        }
                    ]
                },
                {
                    "id": "nostr-getting-started",
                    "title": "Getting Started on Nostr",
                    "description": "The promised segment — keys, clients, signers, and the app universe, in ten minutes",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "What Nostr Actually Is",
                            "body": "We've been promising this segment for weeks — tonight's the night. Nostr is not another app. It's an open protocol, like email: your identity is a keypair you own, and no company can delete your account.",
                            "bullets": [
                                "Your PUBLIC key (npub) is your handle — share it everywhere. Your PRIVATE key (nsec) is your password forever — it never gets reset, so it never gets typed into websites",
                                "Your posts travel over independent relays — take your keys to any client and your identity, follows, and posts come with you",
                                "The ecosystem today: 320+ apps, 800+ relays, 140+ clients — one identity across all of them",
                                "After the GitHub and Apple stories of past weeks, the point should land: own the identity layer and there is nothing to ban"
                            ],
                            "link": "https://nostr.how/en/get-started",
                            "linkLabel": "The 10-Minute Guide"
                        },
                        {
                            "heading": "Get On in 10 Minutes — Our Recommended Stack",
                            "body": "This is the exact stack we've been recommending to members. Pick your lane and you're posting tonight — no email, no phone number.",
                            "bullets": [
                                "PHONE: Damus (iOS) or Primal (iOS/Android, built-in wallet). DESKTOP / power users: noStrudel, Coracle, or Primal on the web",
                                "When your client generates keys: back up the nsec on PAPER. It is the one unrecoverable secret in this whole ecosystem",
                                "Then protect it with a signer so apps never touch it: on desktop, the OG nos2x browser extension; on Android, Amber — one app holds your key and signs for every other app",
                                "Amber shipped v6.2.3 this week (July 1) — actively maintained, open source, on F-Droid and the Zap Store"
                            ],
                            "link": "https://github.com/greenart7c3/Amber",
                            "linkLabel": "Amber (Android Signer)"
                        },
                        {
                            "heading": "Beyond Social: The App Universe + Zaps",
                            "body": "The 'Twitter replacement' framing undersells it. One keypair unlocks a whole parallel app ecosystem — and the browsing catalog is nostrapps.com.",
                            "bullets": [
                                "On nostrapps.com right now: marketplaces (Shopstr, Plebeian Market), long-form blogging, music and video streaming, group chat, wikis, file sharing — filterable by platform",
                                "Zaps are the native economy: Lightning micropayments attached to posts — value-for-value instead of ads and engagement farming",
                                "And the Zeus news from two slides ago is the missing onramp: receive your first zaps with no channel, no setup, no friction",
                                "Homework: create keys, back up the nsec, follow five people, and zap one post before next Wednesday — report back"
                            ],
                            "link": "https://nostrapps.com",
                            "linkLabel": "Browse the App Universe"
                        }
                    ]
                },
                {
                    "id": "fips-watch",
                    "title": "FIPS Watch: Week 2",
                    "description": "Our standing tracker — a quiet bugfix week as v0.5.0 development opens",
                    "type": "discussion",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "FIPS Watch: Steady-State Week",
                            "body": "Week two of our standing tracker on the Nostr-native mesh internet. No fireworks — which for infrastructure is what progress looks like.",
                            "bullets": [
                                "Latest commits (July 2): a routing-tree bugfix — invalidating stale coordinates when a parent node drops — plus maintenance merges; the v0.5.0 development cycle is open on master",
                                "No new release since v0.4.0 (June 27, the Nym-transport release we covered at the debut); the public test mesh remains live",
                                "The standing caveat stands: still PRE-AUDIT — experiment, join the mesh, but don't bet funds or safety on it",
                                "Reminder of why we track it: Bitcoin separated money from the state; Nostr separated identity from the platform; FIPS wants to separate connectivity from the ISP"
                            ],
                            "link": "https://github.com/jmcorgan/fips",
                            "linkLabel": "FIPS on GitHub"
                        }
                    ]
                },
                {
                    "id": "bip-110-watch",
                    "title": "BIP-110 Watch: Four Weeks Out",
                    "description": "Our standing tracker — signaling ticks up to 0.86% as Adam Back predicts self-fork or failure",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "BIP-110 Watch: The Numbers",
                            "body": "Four weeks to the flag day. The signaling needle moved this week — from 0.59% to 0.86% — which at this pace gets to 55% sometime around 2031.",
                            "bullets": [
                                "Miner signaling: 0.86% of blocks — 14 of the 1,634 tracked in difficulty period 474, which ends in ~2-3 days (~July 10-11)",
                                "In hashrate terms: still roughly 5 EH/s of a ~940+ EH/s network — and still zero major pools signaling",
                                "Node support remains disputed (estimates 2-8%) — and Knots' ~22% node share still doesn't equal BIP-110 endorsement",
                                "The countdown: voluntary signaling ends at block 961,632 (~August 7), then the mandatory window begins — BIP-110 nodes would start rejecting non-signaling blocks"
                            ],
                            "link": "https://bip110monitor.com/",
                            "linkLabel": "Live Signaling Monitor"
                        },
                        {
                            "heading": "'Self-Fork or Fail' + a Spec Marked Complete",
                            "bullets": [
                                "Adam Back sharpened his warning this week: BIP-110 will either 'self-fork or fail to activate' by August 7 — and he called the proposal 'technically defective... it really doesn't work, breaks multiple things, doesn't have tech nor ecosystem consensus. Each is fatal'",
                                "Lopp's standing charge remains: 'reckless' and 'doomed to fail' — chain-split risk, Taproot edge cases that could freeze funds, and burdens on pre-signed transactions",
                                "The odd footnote: the BIPs repo formally advanced BIP-110's spec to 'Complete' status this week — the paperwork matured while the support flatlined; a complete spec is not consensus",
                                "Our position is unchanged: we stand with Super Testnet and URSF-110 — sound money, wrong vehicle. Watch the new difficulty period starting ~July 10 for any sign of life"
                            ],
                            "link": "https://cryptobriefing.com/bip-110-fork-fail-activate-adam-back/",
                            "linkLabel": "Back's Warning"
                        }
                    ]
                },
                {
                    "id": "builder-spotlight",
                    "title": "Builder Spotlight: Monero Privacy Leaks",
                    "description": "Super Testnet catalogs how the 'untraceable' coin gets traced — with receipts",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Builder Spotlight: moneroleaks.xyz",
                            "body": "The spotlight stays with Super Testnet — this time for moneroleaks.xyz, a plain-HTML catalog of every way Monero transactions leak identifying information, updated as recently as July 4.",
                            "bullets": [
                                "The core claim, with receipts: EVERY Monero transaction leaks something — organized into receiver leaks, sender leaks, and amount leaks",
                                "Examples: at least one real input revealed per transaction, 16-key rings vulnerable to decoy elimination, and fee patterns that fingerprint which wallet you're using",
                                "It documents six real prosecutions from 2024-25 where these exact techniques traced 'untraceable' money",
                                "Classic Super: CC0 public domain, pure HTML, no server, no framework — the argument IS the website"
                            ],
                            "link": "https://supertestnet.github.io/monero-privacy-leaks/",
                            "linkLabel": "Read the Catalog"
                        },
                        {
                            "heading": "Why a Bitcoiner Built This + What We Learn",
                            "bullets": [
                                "This isn't a Monero hit piece — it's privacy realism from the 'Bitcoin is money' camp: know what your privacy tech actually promises before you rely on it",
                                "The six attack methods — collusion, poisoned outputs, timing analysis, decoy elimination, spy nodes, seized-key history lookups — nearly all have Bitcoin analogues",
                                "The honest takeaway: Monero hides more by default; Bitcoin's privacy is opt-in and takes work. Neither is magic, and 'untraceable' is marketing in both cases",
                                "Follow Super's repos — between URSF-110, node_faker, and this, something new lands almost weekly"
                            ],
                            "link": "https://github.com/supertestnet?tab=repositories",
                            "linkLabel": "Super's Repositories"
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "Privacy lessons from the leaks — the same mistakes deanonymize Bitcoiners",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Quick Tip: Steal the Lessons From the Leaks",
                            "body": "Tonight's spotlight is secretly a Bitcoin privacy checklist. The same three mistakes that trace Monero users trace Bitcoiners: reuse, timing, and spy nodes. So: never reuse a receive address — every wallet generates fresh ones free. Watch your timing patterns — paying the same person at the same time weekly is a signature. And your wallet is only as private as the node it talks to: run your own, or at minimum connect to a trusted node over Tor. Privacy isn't a product you buy — it's a set of habits.",
                            "link": "https://en.bitcoin.it/wiki/Privacy",
                            "linkLabel": "The Bitcoin Privacy Wiki"
                        }
                    ]
                },
                {
                    "id": "community-news",
                    "title": "Community News & Topics",
                    "description": "Share what you're interested in talking about!",
                    "type": "text",
                    "slides": [
                        {
                            "heading": "Next Week's Meetup",
                            "body": "Find something you're interested in talking about? Share it here and we'll cover it in next week's meetup!",
                            "link": "https://github.com/MaxSikorski/bitcoin-nostr-weekly-news/issues",
                            "linkLabel": "Submit a Topic"
                        }
                    ]
                }
            ]
        },
        "2026-W27": {
            "week": "2026-W27",
            "date": "2026-07-01",
            "title": "Worst Month Since 2022, Strategy's 'Never Sell' Ends & a Nostr-Native Internet",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market",
                    "title": "Live Dashboard & Market",
                    "description": "Where Bitcoin sits live — and the worst monthly close since June 2022",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Live Dashboard",
                            "body": "Before the headlines — here's where Bitcoin sits right now. Open the full dashboards below:",
                            "widget": "live-price",
                            "links": [
                                {
                                    "url": "https://bitcoin.clarkmoody.com/dashboard/",
                                    "label": "Clark Moody Dashboard"
                                },
                                {
                                    "url": "https://mempool.space",
                                    "label": "mempool.space"
                                }
                            ]
                        },
                        {
                            "heading": "The Worst Month Since June 2022",
                            "body": "June closed down roughly 20% — Bitcoin's worst monthly performance since June 2022, and more than 50% below October's all-time high. The monthly candle tells the story better than any headline.",
                            "bullets": [
                                "The June candle is a full-bodied bearish Marubozu — open June 1, close June 30, sellers in control the entire month; chartists read it as a continuation signal, with bottom chatter clustering $48K-$55K",
                                "Fear & Greed hit 12 and sat below 20 for days — the same extreme-fear zone that preceded the 2018, COVID-2020, and FTX-2022 bottoms",
                                "Citi cut its Bitcoin target to $82,000, citing the ETF exits (next slide)",
                                "And yet, today: Bitcoin reclaimed $60,000 with Strategy and Strive both up 10%+ — the month ended ugly, the quarter starts with a bounce"
                            ],
                            "link": "https://www.coindesk.com/markets/2026/07/01/bitcoin-s-20-june-crash-looks-even-deadlier-on-the-charts-here-s-why",
                            "linkLabel": "The Chart Breakdown"
                        },
                        {
                            "heading": "The ETF Exodus, Now Historic",
                            "body": "Two structural records in one week — the institutional bid didn't just soften, it inverted.",
                            "bullets": [
                                "June was the worst month EVER for US spot Bitcoin ETFs: $4.5B in net outflows, the biggest since they launched in January 2024",
                                "K33: rolling one-year flows went NEGATIVE (-1,176 BTC as of June 18) — first time since November 2023",
                                "Global Bitcoin ETPs now hold ~1.47M BTC, down 127,774 BTC (-8%) from the peak — the largest drawdown on record",
                                "The silver lining: the pace is cooling fast — ~625 BTC/day of outflows over the past two weeks vs ~4,462 BTC/day in mid-May through early June"
                            ],
                            "link": "https://www.theblock.co/post/405989/bitcoin-etp-outflows-push-rolling-one-year-flows-negative-first-time-since-2023-k33",
                            "linkLabel": "The K33 Data"
                        }
                    ]
                },
                {
                    "id": "bip-110-watch",
                    "title": "BIP-110 Watch: Five Weeks Out",
                    "description": "Our standing tracker — signaling is still a rounding error as the August window nears",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "BIP-110 Watch: The Numbers",
                            "body": "Our standing tracker on the data-limit soft fork. Five weeks to the flag day, and the gap between the deadline and the support is becoming the story itself.",
                            "bullets": [
                                "Miner signaling: 0.59% of blocks in the current difficulty period (4 of the 681 tracked so far) — the bar is 55% of a single period; this period ends ~July 10",
                                "In hashrate terms: roughly 5 EH/s of a ~940 EH/s network (~0.31%)",
                                "Node support: estimates range 2-8% and are disputed — and note Knots itself is ~22% of reachable nodes, so running Knots clearly doesn't mean endorsing BIP-110",
                                "The countdown: voluntary signaling ends at block 961,632 (~August 7), then the mandatory window runs to block 963,647 — BIP-110 nodes would reject non-signaling blocks"
                            ],
                            "link": "https://bip110monitor.com/",
                            "linkLabel": "Live Signaling Monitor"
                        },
                        {
                            "heading": "The August Collision + Where We Stand",
                            "bullets": [
                                "Paul Sztorc's eCash hard fork targets ~block 964,000 — a few hundred blocks after the BIP-110 mandatory window ends; two protocol events, one August",
                                "Sztorc spent the week pushing back on the 'theft' framing: the fork can't move anyone's BTC — the disputed reassignment (600K to dormant addresses, ~500K to funders) happens on his NEW chain (more on the next topic)",
                                "Adam Back and Jameson Lopp keep the chain-split warnings up — 'reckless' activation parameters remain the critics' core charge",
                                "Our position is unchanged: we're with Super Testnet (URSF-110) — sound money, yes; a 55% UASF that can freeze miniscript funds and risk a split is the wrong vehicle. Watch whether signaling moves at all when the new period starts ~July 10"
                            ],
                            "link": "https://www.coindesk.com/tech/2026/04/28/bitcoiners-are-calling-ecash-a-hard-fork-theft-but-it-doesn-t-even-touch-satoshi-s-btc",
                            "linkLabel": "The 'Not a Theft' Case"
                        }
                    ]
                },
                {
                    "id": "satoshi-tributes",
                    "title": "Satoshi's Address: The Living Rebuttal",
                    "description": "People keep sending BTC to coins nobody can ever move — tribute as a statement",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Tributes to the Untouchable Address",
                            "body": "While the reassign-dormant-coins debate rages, Bitcoiners are doing the opposite: sending MORE bitcoin to Satoshi's genesis address. The latest verified send landed June 30 — right in the middle of the eCash drama.",
                            "bullets": [
                                "June 30: ~0.185 BTC sent to the genesis address; February: a ~$200K send — tributes have ranged from $7K to $1.2M (someone sent 26.9 BTC in January 2024)",
                                "The address now holds the genesis 50 BTC plus roughly 17 years of tributes — over 100 BTC total, valued in the millions (some trackers put it north of $8M at recent prices)",
                                "The genesis coinbase is hard-coded unspendable in Bitcoin itself — not even Satoshi could move it",
                                "Every tribute is provably burned value — sent anyway, on purpose"
                            ],
                            "link": "https://mempool.space/address/1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa",
                            "linkLabel": "Watch the Address Live"
                        },
                        {
                            "heading": "The Point Being Made",
                            "bullets": [
                                "Dormant does not mean abandoned, and abandoned does not mean up for grabs — nobody can take these coins: not a fork, not a vote, not a foundation",
                                "The critics' warning about eCash (Peter McCormack: 'theft and disrespectful') is about precedent: reassign Satoshi's allocation on any chain, and every dormant address becomes negotiable",
                                "The tributes read as a living counter-statement — value sent to provably frozen coins, a monument to property rights you can audit on-chain",
                                "Live demo: let's pull this address up on mempool.space right now and look at the tribute history together"
                            ]
                        }
                    ]
                },
                {
                    "id": "strategy-never-sell",
                    "title": "Strategy Ends 'Never Sell'",
                    "description": "A $2B buyback plan — funded, if needed, by selling bitcoin. Four years of doctrine, over",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "The Digital Credit Capital Framework",
                            "body": "On June 29, Strategy's board adopted a new capital framework — and with it, formally ended the absolute 'never sell the bitcoin' rule that defined the company for four years.",
                            "bullets": [
                                "Up to $2B in share buybacks (two $1B programs), aimed at the stock trading below the value of its bitcoin",
                                "Authorized: selling up to $1.25B of BTC — strictly to replenish the ~$2.55B cash buffer, pay preferred dividends, and fund the buybacks; anything beyond needs fresh board approval",
                                "The STRC preferred dividend rises to 12% effective today, July 1",
                                "The market's verdict so far: MSTR +12% on announcement day, +10% more today"
                            ],
                            "link": "https://www.coindesk.com/markets/2026/06/29/strategy-opens-the-door-to-selling-bitcoin-under-new-capital-plan-here-s-what-it-means",
                            "linkLabel": "What It Means"
                        },
                        {
                            "heading": "'Bitcoin Is Capital' + Discussion",
                            "bullets": [
                                "Saylor's reframe: the stack is no longer a sealed vault — it's working capital, managed by rules, in service of the balance sheet",
                                "The bigger trend: bitcoin-backed preferred stock has quietly become a ~$13B financing market (Strategy, Strive, and imitators)",
                                "Two honest readings: prudent maturation in a 50% drawdown — or the first crack in the strongest hands narrative",
                                "Discussion: does a rules-based seller sitting above the market change anyone's thesis here?"
                            ],
                            "link": "https://www.coindesk.com/markets/2026/06/29/saylor-s-strategy-initiates-buybacks-bitcoin-monetization-program-lifts-strc-dividend",
                            "linkLabel": "The Announcement Coverage"
                        }
                    ]
                },
                {
                    "id": "platform-gatekeeping",
                    "title": "GitHub Bans Bitcoin Devs, Apple Backs Down",
                    "description": "Rust Bitcoin's org banned with no appeal; Sparrow's account saved — platform-risk week",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "GitHub Bans the Rust Bitcoin Org",
                            "body": "Matt Corallo — one of Bitcoin's longest-serving developers — announced that GitHub permanently banned the open-source org behind rust-bitcoin and the LDK Lightning ecosystem: 'no explanation and no option to appeal.' The apparent trigger: a moderation bot wrongly flagging a brand-new contributor.",
                            "bullets": [
                                "The org lost CI overnight — testing and merge tracking froze on code that many Lightning wallets depend on",
                                "rust-bitcoin is already migrating to self-hosted infrastructure (git.rust-bitcoin.org); LDK is expected to follow, likely onto Forgejo",
                                "Corallo's conclusion: 'I guess it's time for Bitcoin projects to leave @github'",
                                "The lesson: critical Bitcoin infrastructure was one moderation bot away from the void — on a platform everyone treated as neutral ground"
                            ],
                            "link": "https://bitcoinmagazine.com/business/matt-corallo-urges-bitcoin-projects-to-exit-github-after-rust-lightning-ban",
                            "linkLabel": "Read the Story"
                        },
                        {
                            "heading": "Sparrow vs Apple: Resolved (Mostly)",
                            "body": "Closing last week's loop: Apple REVERSED the termination of Craig Raw's developer account after his appeal and a loud community response — reportedly right around the time we were presenting it.",
                            "bullets": [
                                "macOS Sparrow is safe — notarized installs and updates continue as normal",
                                "But the dozen-plus FAKE Sparrow apps that caused the whole mess are STILL on the App Store, still putting funds at risk",
                                "It took a well-known developer and a public outcry to fix — a less famous dev likely stays banned",
                                "Same story twice in one week: your stack shouldn't depend on one company's mercy (see tonight's Quick Tip — and FIPS, later)"
                            ],
                            "link": "https://sparrowwallet.com/download/",
                            "linkLabel": "Official Download + Verify"
                        }
                    ]
                },
                {
                    "id": "lnd-dos",
                    "title": "Lightning Security: LND Crash Bug",
                    "description": "A cheap remote crash in LND before v0.20.1-beta, responsibly disclosed — patch your node",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "The LND Crash Bug — Upgrade Now",
                            "body": "Bitcoin Optech #411 published the responsible disclosure: LND versions before v0.20.1-beta can be crashed remotely with malformed gossip messages.",
                            "bullets": [
                                "The bug: gossip with a zero timestamp slipped past validation — an internal bookkeeping error ends in a runtime panic that kills the node",
                                "The attack is cheap: broadcast announcements for synthetic channels — no Lightning node required, and it's repeatable",
                                "The fix: v0.20.1-beta rejects zero-timestamp messages at parse time",
                                "If you route payments or hold funds on LND: upgrade tonight, not this weekend"
                            ],
                            "link": "https://bitcoinops.org/en/newsletters/2026/06/26/",
                            "linkLabel": "Optech #411 Disclosure"
                        },
                        {
                            "heading": "Also Shipping This Week",
                            "bullets": [
                                "LDK v0.1.10 and v0.2.3 — maintenance releases fixing their own denial-of-service and channel-persistence bugs (a busy week for Lightning security)",
                                "BTCPay Server 2.4.0 — passkey login and a guided multisig wallet setup",
                                "Bitcoin Core PR #35070 — fixes validation bugs affecting pruned nodes during deep reorgs",
                                "Core is also replacing libevent with an in-house HTTP server — one less external dependency in the reference node (a fitting theme this week)"
                            ]
                        }
                    ]
                },
                {
                    "id": "mining-energy",
                    "title": "Miners, the Grid & the AI Land War",
                    "description": "Hashrate down 20%+ from peak as the DOE orders AI datacenters onto backup power",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "The Hashrate Reset",
                            "bullets": [
                                "Network hashrate sits around 900 EH/s — down roughly 12% in June and 20%+ below the October peak",
                                "June 14 brought a -10.09% difficulty adjustment (second-largest of the year) — then June 25 snapped back +7% (block 955,584, verified on mempool.space)",
                                "Hashprice recovered to ~$33/PH/day after the drop, but all-in economics remain underwater for many operators at these prices",
                                "Next adjustment lands ~July 10 — watch whether the exodus resumes or the snap-back holds"
                            ],
                            "link": "https://mempool.space/mining",
                            "linkLabel": "Live Mining Dashboard"
                        },
                        {
                            "heading": "The Energy Story Underneath",
                            "body": "The capacity leaving Bitcoin isn't dying — it's defecting to AI. And this week the grid itself became the story.",
                            "bullets": [
                                "The DOE issued an emergency directive pushing AI datacenters onto backup generators as PJM forecasts record demand (~166,000 MW)",
                                "Miners understood the energy bottleneck years before the AI industry did — that thesis is now playing out on the front page (Marty Bent: 'The AI War Is Being Fought at Every Layer')",
                                "The miner's edge in a constrained grid: flexible load — miners can curtail in seconds; AI datacenters can't",
                                "Discussion: does the grid crunch make miners the grid's best allies — or just acquisition targets for AI money?"
                            ],
                            "link": "https://www.tftc.io/",
                            "linkLabel": "Marty's Take (TFTC)"
                        }
                    ]
                },
                {
                    "id": "nostr-roundup",
                    "title": "Nostr: The Orange Web Grows Up",
                    "description": "Nutzaps land in Amethyst, Nostur goes desktop, and a wave of new apps in the pipeline",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "The Orange Web + Amethyst 1.12",
                            "body": "Bitcoin Magazine's framing this week: Nostr is 'the Orange Web' — Bitcoin's own alternative internet, where your identity is your keys and no platform can delete you. Right on cue, the flagship Android client shipped a major release.",
                            "bullets": [
                                "Amethyst's v1.12 line (now at v1.12.6) lands nutzaps — zaps that carry Cashu ecash, so value moves natively with your notes instead of bouncing through a custodial Lightning address",
                                "Also new: a CLINK driver for on-chain zaps, and a Tor 'self-heal' cluster — connectivity repairs itself when circuits die",
                                "Zaps are quietly becoming a payments primitive: ecash, on-chain, and Lightning, all behind one gesture",
                                "After tonight's GitHub and Apple stories, the Orange Web pitch lands differently — own the identity layer and the rails, and there's nothing to ban"
                            ],
                            "link": "https://github.com/vitorpamplona/amethyst",
                            "linkLabel": "Amethyst on GitHub"
                        },
                        {
                            "heading": "The Pipeline: What's Coming",
                            "bullets": [
                                "Nostur 1.29 brings the polished iOS client to the desktop — with zap-receipt replies and anonymous replies",
                                "ZapBook — Nostr-native social reading circles — shipped 17 builds in 4 days and landed multi-account switching; the ecosystem velocity is real",
                                "OpenSats' latest Nostr wave funds the next layer: 44Billion (a Nostr app launcher/store), NosCall (encrypted calls over WebRTC), Routstr (permissionless AI inference paid in sats), and Wisp (a newcomer-friendly client with built-in Lightning)",
                                "Discussion: which of these actually replaces a centralized app in your daily stack — and what's still missing?"
                            ],
                            "link": "https://opensats.org/blog/seventeenth-wave-of-nostr-grants",
                            "linkLabel": "The OpenSats Wave"
                        }
                    ]
                },
                {
                    "id": "fips-watch",
                    "title": "NEW — FIPS Watch: A Nostr-Native Internet",
                    "description": "Debut of our new standing tracker — a mesh network where your npub is your address",
                    "type": "discussion",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "FIPS: The Free Internetworking Peering System",
                            "body": "New standing segment — we'll track this weekly, like BIP-110 — because it aims at the last dependency: the ISP itself. FIPS is a self-organizing, end-to-end-encrypted mesh network where Nostr keypairs ARE the network identity.",
                            "bullets": [
                                "Your npub is your network address — no DNS registrars, no IP allocation, no routing authorities, no central anything",
                                "It runs over raw Ethernet, WiFi, Bluetooth, or serial/radio — or overlays today's internet via UDP, TCP, Tor, and the Nym mixnet; an IPv6 adapter means existing apps can use it unmodified",
                                "Nostr relays handle peer discovery and NAT traversal — the network bootstraps itself over the social layer",
                                "The builder matters: jmcorgan is Johnathan Corgan, former Chief Architect of GNU Radio — serious open-source radio/infrastructure pedigree. Rust, MIT-licensed"
                            ],
                            "link": "https://github.com/jmcorgan/fips",
                            "linkLabel": "FIPS on GitHub"
                        },
                        {
                            "heading": "State of the Mesh + How It Compares",
                            "bullets": [
                                "This week: v0.4.0 shipped June 27 — Nym mixnet transport, LAN discovery, hitless rekey — and a public test mesh is live; v0.5.0 is in development",
                                "Honesty check: it's pre-audit. Experiment with it, join the test mesh — but don't bet funds or safety on it yet. We'll report audit progress here weekly",
                                "The landscape: Meshtastic = off-grid LoRa texting · Reticulum = the sovereign network stack (closest sibling) · Pear/Keet = serverless apps on the old internet · FIPS = a new internet where your npub is your address",
                                "Why we're tracking it: Bitcoin separated money from the state; Nostr separated identity from the platform; FIPS wants to separate connectivity from the ISP"
                            ],
                            "link": "https://stacker.news/items/1441835",
                            "linkLabel": "Community Discussion"
                        }
                    ]
                },
                {
                    "id": "builder-spotlight",
                    "title": "Builder Spotlight: Super Testnet's node_faker",
                    "description": "Run bitcoind in your browser — zero-install Bitcoin node practice from Super Testnet",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Builder Spotlight: node_faker",
                            "body": "The spotlight stays with Super Testnet this week — fresh off updates to node_faker (June 28): bitcoind and bitcoin-cli, emulated entirely in your browser. Type real node commands, get real behavior, install nothing.",
                            "bullets": [
                                "The zero-setup on-ramp: practice getblockchaininfo, inspect blocks, and learn the CLI before ever touching a real node",
                                "It pairs with everything we said tonight about BIP-110 and node counts — 'verify, don't trust' starts with knowing your way around a node",
                                "Classic Super: all front-end, no server, clean and simple",
                                "Runs anywhere a browser runs — including the laptop you brought tonight"
                            ],
                            "link": "https://github.com/supertestnet/node_faker",
                            "linkLabel": "Try node_faker"
                        },
                        {
                            "heading": "Homework + Follow Super",
                            "bullets": [
                                "It lowers the scariest step in self-sovereignty — the first bitcoin-cli command — to opening a browser tab",
                                "This week's homework: open it, run three commands you've never run, and tell us next week what surprised you",
                                "He also refreshed the BitDevs SJ site this week — the tooling around meetups like ours keeps getting better",
                                "Watch the repos page — something new lands almost weekly"
                            ],
                            "link": "https://github.com/supertestnet?tab=repositories",
                            "linkLabel": "Super's Repositories"
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "Verify your wallet downloads — the fake Sparrows are still out there",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Quick Tip: Verify Your Wallet Downloads",
                            "body": "Sparrow survived Apple this week — but the dozen-plus FAKE Sparrow apps that caused the mess are still on the App Store, still draining funds. The rule: never install a wallet from an app-store search result. Go to the project's official site, download there, and verify the release signature or hash before opening it. And remember this week's other lesson — 30,000 customers of Dutch exchange Knaken are locked out of their funds right now. A license is not protection. Your keys are.",
                            "link": "https://sparrowwallet.com/download/",
                            "linkLabel": "Example: Sparrow's Verify Guide"
                        }
                    ]
                },
                {
                    "id": "community-news",
                    "title": "Community News & Topics",
                    "description": "Share what you're interested in talking about!",
                    "type": "text",
                    "slides": [
                        {
                            "heading": "Next Week's Meetup",
                            "body": "Find something you're interested in talking about? Share it here and we'll cover it in next week's meetup!",
                            "link": "https://github.com/MaxSikorski/bitcoin-nostr-weekly-news/issues",
                            "linkLabel": "Submit a Topic"
                        }
                    ]
                }
            ]
        },
        "2026-W26": {
            "week": "2026-W26",
            "date": "2026-06-24",
            "title": "Two August Forks, Bitcoin Mortgages & Illinois's Crypto Tax",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market",
                    "title": "Live Dashboard & Market",
                    "description": "Where Bitcoin sits live, and why it's a rough day near two-week lows",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Live Dashboard",
                            "body": "Before the headlines — here's where Bitcoin sits right now. Open the full dashboards below:",
                            "widget": "live-price",
                            "links": [
                                {
                                    "url": "https://bitcoin.clarkmoody.com/dashboard/",
                                    "label": "Clark Moody Dashboard"
                                },
                                {
                                    "url": "https://mempool.space",
                                    "label": "mempool.space"
                                }
                            ]
                        },
                        {
                            "heading": "A Rough Day: Near Two-Week Lows",
                            "body": "Bitcoin is back near two-week lows. After the US-Iran peace deal was formally signed June 19, the geopolitical 'safe-haven' bid faded — and a more hawkish Fed isn't helping.",
                            "bullets": [
                                "The June 19 peace signing in Switzerland reopened the Strait of Hormuz — good for the world, but it removed the risk premium that had lifted BTC",
                                "ETF demand is still soft: after one inflow day on June 12, outflows resumed — about 19 of the last 22 trading days were negative",
                                "A more hawkish Fed (rate hikes later this year) is pressuring risk assets broadly",
                                "Zoom out: Bitcoin is still down roughly $43,000 from a year ago"
                            ],
                            "link": "https://finance.yahoo.com/personal-finance/investing/article/bitcoin-and-ethereum-prices-today-wednesday-june-24-2026-opened-at-lowest-levels-in-about-two-weeks-125349040.html",
                            "linkLabel": "Read the Market Recap"
                        }
                    ]
                },
                {
                    "id": "bip-110-watch",
                    "title": "BIP-110 Watch: Signaling Begins",
                    "description": "Our standing tracker — miner signaling appears for the first time, still tiny",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "BIP-110 Watch: Signaling Has Begun",
                            "body": "Our standing tracker on the data-limit soft fork. This week it crossed from talk into action — miner signaling has appeared in the data for the first time, though it's still a rounding error.",
                            "bullets": [
                                "Miner signaling: ~0.31% of blocks (up from ~0% last week) — far below the 55% activation bar",
                                "Node support: 2.38% (583 of ~24,481 nodes); Bitcoin Knots remains the implementation",
                                "Only ~5 EH/s of the network's ~940 EH/s is signaling",
                                "Flag day approaches: block 961,632, around August 2026"
                            ],
                            "link": "https://bip110monitor.com/",
                            "linkLabel": "Live Signaling Monitor"
                        },
                        {
                            "heading": "Where We Stand",
                            "bullets": [
                                "The camps, recap: Core (raised OP_RETURN limits) vs Knots/BIP-110 (restrict data) vs Super Testnet's URSF-110 (reject the soft fork)",
                                "Our position: sound money is the reason to be wary — a 55% UASF that can freeze miniscript funds and risk a chain split is the wrong vehicle. We're with Super",
                                "And August just got crowded — Paul Sztorc's hard fork lands days after the BIP-110 flag day (next topic)"
                            ]
                        }
                    ]
                },
                {
                    "id": "sztorc-fork",
                    "title": "Paul Sztorc's August Hard Fork",
                    "description": "A 1:1 airdrop fork that would reassign Satoshi's coins — critics call it theft",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Paul Sztorc's August Hard Fork",
                            "body": "Drivechain creator Paul Sztorc (BIP-300) plans a hard fork around block 964,000 in August: a new SHA-256d chain that begins as a near-copy of Bitcoin, activates Drivechains, and airdrops 1:1 to BTC holders at the fork block. He's dubbed it 'eCash' — no relation to Cashu/Fedimint Chaumian ecash.",
                            "link": "https://unchainedcrypto.com/bitcoin-developer-paul-sztorc-plans-august-hard-fork-dubbed-ecash-with-a-plan-to-reassign-satoshi-nakamotos-coins/",
                            "linkLabel": "Read the Plan"
                        },
                        {
                            "heading": "Why It's Controversial",
                            "bullets": [
                                "The flashpoint: a plan to reassign Satoshi Nakamoto's dormant coins — critics are calling it theft",
                                "It lands right beside the BIP-110 flag day — two protocol events on nearly the same August timetable",
                                "Critics warn it could fracture consensus and set a precedent for tampering with old coins",
                                "A 1:1 airdrop sounds like 'free money' — but touching it has real risks (see this week's Quick Tip)"
                            ],
                            "link": "https://www.coindesk.com/tech/2026/04/27/a-long-time-developer-wants-to-fork-bitcoin-and-reassign-satoshi-coins-the-community-is-calling-it-a-theft",
                            "linkLabel": "The 'Theft' Debate"
                        }
                    ]
                },
                {
                    "id": "bitcoin-mortgages",
                    "title": "Bitcoin Hits the Mortgage Market",
                    "description": "First Fannie Mae-backed Bitcoin-collateral mortgages close — including a $4.2M Florida home",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Bitcoin Hits the Mortgage Market",
                            "body": "Bitcoin just entered the U.S. housing system. Better and Coinbase closed the first Fannie Mae-backed mortgages using Bitcoin as collateral — letting buyers borrow against their BTC for a down payment without selling it.",
                            "bullets": [
                                "The first close went to a Michigan couple; a $4.2M Florida home followed — and closed in just 23 days",
                                "Structure: a standard Fannie conforming mortgage plus a separate Bitcoin-collateral loan for the down payment",
                                "Collateral ratio ~2.5:1 (pledge ~$250K in BTC for a $100K down payment); routine price swings don't trigger margin calls",
                                "Enabled by the FHFA directing Fannie/Freddie to recognize crypto held on exchanges; BTC + USDC, nationwide rollout this summer"
                            ],
                            "link": "https://www.housingwire.com/articles/fannie-mae-bitcoin-mortgage/",
                            "linkLabel": "Read the Details"
                        },
                        {
                            "heading": "Why It Matters + Discussion",
                            "bullets": [
                                "This is Bitcoin plugging directly into the largest asset class on earth — U.S. housing",
                                "The pitch: keep your stack and buy the house, avoiding a taxable sale and keeping the upside",
                                "The catch: fall ~60 days behind on payments and the Bitcoin can be liquidated — leverage cuts both ways",
                                "For the legacy-finance crowd: is collateralized BTC the on-ramp that finally normalizes it?"
                            ]
                        }
                    ]
                },
                {
                    "id": "illinois-tax",
                    "title": "Illinois Taxes Crypto — A First",
                    "description": "First state to directly tax crypto transactions: a 0.2% levy on gross value",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Illinois Taxes Crypto — A First",
                            "body": "Illinois became the first state to put a direct tax on crypto transactions. Gov. Pritzker signed it into the $56B state budget on June 16 — the Digital Asset Tax Act, a 0.2% 'privilege tax' on digital-asset activity, charged on the gross value moved, not on profits.",
                            "link": "https://www.coindesk.com/policy/2026/06/17/crypto-industry-aghast-at-illinois-new-tax-on-holding-or-transferring-digital-assets-in-state-budget",
                            "linkLabel": "Read the Coverage"
                        },
                        {
                            "heading": "The Fine Print + Discussion",
                            "bullets": [
                                "It targets brokers/custodians based in Illinois or serving IL residents (with $100K+ gross receipts) — not literally your P2P self-custody sends, but costs get passed to users",
                                "Illinois doesn't tax stocks, bonds, or derivatives this way — the Crypto Council calls it 'the most punitive digital asset tax in the country'",
                                "Set to take effect in 2027; projected to raise about $60M a year",
                                "A tax on moving your own money — a precedent other states copy, or an outlier that gets challenged?"
                            ]
                        }
                    ]
                },
                {
                    "id": "sparrow-apple",
                    "title": "Sparrow Wallet vs. Apple",
                    "description": "Apple threatens to terminate Sparrow's developer account — macOS installs at risk June 30",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Sparrow Wallet vs. Apple",
                            "body": "A wallet many of us run is in trouble on macOS. Sparrow's developer, Craig Raw, said on June 22 that Apple flagged his developer account for termination by June 30 — which would break notarized installs and updates on Mac.",
                            "link": "https://cryptobriefing.com/sparrow-wallet-macos-apple-termination/",
                            "linkLabel": "Read What Happened"
                        },
                        {
                            "heading": "The Irony + What To Do",
                            "bullets": [
                                "The trigger: Raw submitted an app to warn users about a dozen-plus fake 'Sparrow' apps stealing funds — Apple labeled his warning 'dishonest activity'",
                                "If the account is terminated: new Mac users must clear Gatekeeper hurdles to install, and existing users stop getting updates",
                                "Windows and Linux are unaffected",
                                "Takeaway: only download Sparrow from sparrowwallet.com and verify the release — open-source self-custody vs platform gatekeeping in a nutshell"
                            ],
                            "link": "https://sparrowwallet.com/download/",
                            "linkLabel": "Official Download + Verify"
                        }
                    ]
                },
                {
                    "id": "nostr-zapstore",
                    "title": "Nostr: Zapstore & the OpenSats Wave",
                    "description": "A Nostr-native app store you can't de-platform, plus Amethyst's big release",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "Nostr: Zapstore & the OpenSats Wave",
                            "body": "A standout in the Nostr ecosystem: Zapstore — an app store built ON Nostr, where developers publish releases as signed Nostr events and users verify the binaries before installing. Permissionless software distribution — a pointed contrast to this week's Sparrow-vs-Apple story.",
                            "link": "https://opensats.org/projects/zapstore",
                            "linkLabel": "Zapstore (OpenSats)"
                        },
                        {
                            "heading": "Also Shipping + Discussion",
                            "bullets": [
                                "Amethyst shipped a big release: Kotlin Multiplatform migration, desktop builds for Linux and Windows, and an iOS port in development",
                                "OpenSats has now directed over $27M (~31 billion sats) to 319 free-and-open-source grantees across 32+ countries",
                                "The throughline: Nostr as an app-distribution layer no Apple or Google can de-platform",
                                "Discussion: could a Zapstore-style model have spared Sparrow's Mac users?"
                            ],
                            "link": "https://opensats.org/projects/amethyst",
                            "linkLabel": "Amethyst"
                        }
                    ]
                },
                {
                    "id": "builder-spotlight",
                    "title": "Builder Spotlight: Super Testnet's spam_tester",
                    "description": "Our first weekly Builder Spotlight — an interactive Core-vs-Knots spam experiment",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Builder Spotlight: Super Testnet's spam_tester",
                            "body": "Kicking off our new weekly Builder Spotlight with Super Testnet. His latest tool, spam_tester, is an interactive web app that gives empirical data on how Bitcoin Core vs Bitcoin Knots handle inscription 'spam' — the exact fight at the heart of the BIP-110 debate.",
                            "link": "https://github.com/supertestnet/spam_tester",
                            "linkLabel": "Try spam_tester"
                        },
                        {
                            "heading": "Why We Love It",
                            "bullets": [
                                "It targets 100-400kb data transactions — the range Core treats as standard but Knots rejects as nonstandard — and lets you see the resource difference",
                                "Empirical, not ideological: the point is you can prove that spam filters reduce strain on node resources",
                                "Intellectual honesty on display: Super publicly corrected his own RAM claim in Oct 2025 after re-reading the code (Knots' extrapool keeps the txs anyway)",
                                "Classic Super: clean, front-end, hands-on. Follow his work at github.com/supertestnet"
                            ],
                            "link": "https://github.com/supertestnet?tab=repositories",
                            "linkLabel": "Super's Repositories"
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "How to safely handle a fork airdrop without losing your real coins",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Quick Tip: Surviving a Fork Airdrop",
                            "body": "With Sztorc's hard fork promising a 1:1 'free coin' airdrop in August, here's the self-custody rule: the danger isn't the fork — it's the rush to claim. Scam 'claim' tools will ask for your seed phrase or private keys. Never paste them anywhere. Wait for replay protection, and if you ever do claim forkcoins, move your real BTC to a fresh wallet first. Free coins are never worth a drained wallet."
                        }
                    ]
                },
                {
                    "id": "community-news",
                    "title": "Community News & Topics",
                    "description": "Share what you're interested in talking about!",
                    "type": "text",
                    "slides": [
                        {
                            "heading": "Next Week's Meetup",
                            "body": "Find something you're interested in talking about? Share it here and we'll cover it in next week's meetup!",
                            "link": "https://github.com/MaxSikorski/bitcoin-nostr-weekly-news/issues",
                            "linkLabel": "Submit a Topic"
                        }
                    ]
                }
            ]
        },
        "2026-W25": {
            "week": "2026-W25",
            "date": "2026-06-17",
            "title": "BIP-110's Fork Fight, the Rebound & a Record Difficulty Drop",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market-rebound",
                    "title": "The Ceasefire Rebound",
                    "description": "BTC dipped below $60K, then snapped back above $65K on a US-Iran ceasefire",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "The Ceasefire Rebound",
                            "body": "After last week's slide, Bitcoin briefly fell below $60,000 — its lowest since November 2024 — then snapped back to around $65-66K. The trigger was geopolitical: a US-Iran ceasefire deal flipped markets risk-on, with oil falling and equities rallying.",
                            "link": "https://finance.yahoo.com/personal-finance/investing/article/bitcoin-and-ethereum-prices-today-monday-june-15-2026-prices-rising-after-us-iran-agree-to-ceasefire-deal-114616600.html",
                            "linkLabel": "Read the Market Recap"
                        },
                        {
                            "heading": "What Turned It Around",
                            "bullets": [
                                "US-Iran ceasefire deal → risk appetite returned across markets",
                                "Oil fell, equities rallied, and SpaceX debuted +19% on its first Nasdaq trading day",
                                "Resolves last week's cliffhanger — the sub-$60K low and the CPI report we flagged",
                                "Perspective: even after the bounce, BTC sits roughly $48,800 below where it traded a year ago"
                            ],
                            "link": "https://fortune.com/article/price-of-bitcoin-06-15-2026/",
                            "linkLabel": "Price Snapshot"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Was the sub-$60K print the bottom, or just a relief rally on geopolitics?",
                                "How much is Bitcoin now a macro 'risk asset' that moves on ceasefires and CPI prints?",
                                "If a war headline can move it 10%, how 'uncorrelated' is it really?"
                            ]
                        }
                    ]
                },
                {
                    "id": "etf-flip",
                    "title": "The ETF Outflows Reverse",
                    "description": "Last week's record exodus flipped to inflows — the streak finally broke",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "The ETF Outflows Reverse",
                            "body": "The sequel to last week's 'ETF Exodus': the bleeding stopped. On June 12, US spot Bitcoin ETFs took in $85.85 million — breaking a four-week outflow streak that had drained roughly $5.4 billion. BlackRock's IBIT led the turnaround with about $57.7M (~1,350 BTC).",
                            "link": "https://news.bitcoin.com/bitcoin-etf-inflows-ethereum-outflows-june-2026/",
                            "linkLabel": "Read the Flows Breakdown"
                        },
                        {
                            "heading": "Why It Matters + Discussion",
                            "bullets": [
                                "None of the 12 funds saw outflows that day — a clean break from the prior week's $1.72B exit",
                                "IBIT again drove the action, both down (last week) and up (this week)",
                                "The flip tracks the ceasefire risk-on move — ETF flows increasingly mirror macro sentiment",
                                "Real question: institutional conviction returning, or a one-day dead-cat bounce?"
                            ]
                        }
                    ]
                },
                {
                    "id": "difficulty-drop",
                    "title": "A Historic 10% Difficulty Drop",
                    "description": "Second-biggest drop of 2026 as miners power down — exactly as we predicted",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "A Historic 10% Difficulty Drop",
                            "body": "We called this one last week. On June 14 (block 953,568), mining difficulty fell 10.09% — from 138.96T to 124.93T, the lowest since July 2025. It was the second-biggest drop of 2026 and the 11th-largest in Bitcoin's history.",
                            "link": "https://cryptobriefing.com/bitcoin-mining-difficulty-drops-10-percent/",
                            "linkLabel": "Read the Coverage"
                        },
                        {
                            "heading": "The Miner Squeeze",
                            "bullets": [
                                "Miners powered off inefficient rigs as BTC fell ~15% in June, dragging hashrate down",
                                "The adjustment lifted output-per-hashrate ~11%; hashprice recovered to about $32.31/PH/s/day",
                                "But estimated average cost to mine a coin (~$84,300) sits well above the ~$63K price",
                                "Translation: many miners are underwater — the classic bear-market shakeout"
                            ],
                            "link": "https://crypto.news/bitcoin-mining-difficulty-just-had-its-11th-biggest-drop-ever/",
                            "linkLabel": "The 11th-Biggest Drop Ever"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Who survives mining at these prices — and who gets bought for pennies?",
                                "Difficulty dropping is relief for whoever keeps hashing: the strong get stronger",
                                "Does cheap-power consolidation worry anyone, or is it just healthy natural selection?"
                            ]
                        }
                    ]
                },
                {
                    "id": "bip-110-watch",
                    "title": "BIP-110 Watch: The Soft-Fork Fight",
                    "description": "Our new standing weekly tracker — the data-limit UASF dividing Bitcoin, and where we stand",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "BIP-110 Watch: The Data-Limit Soft Fork",
                            "body": "New standing segment. BIP-110 — the 'Reduced Data Temporary Softfork' (introduced December 2025 by pseudonymous dev Dathon Ohm) — would cap transaction output scriptPubKeys at 34 bytes and OP_RETURN at 83 bytes for about a year, aiming to curb Ordinals/Runes 'spam.' It's the OP_RETURN war escalated into an actual activation attempt.",
                            "link": "https://bip110.org/",
                            "linkLabel": "BIP-110 Project Site"
                        },
                        {
                            "heading": "The Three Camps",
                            "bullets": [
                                "Bitcoin Core — raised the OP_RETURN limit (83 → 100,000 bytes in v30); 'don't filter, let the fee market decide'",
                                "Knots + BIP-110 — restrict the data, 'keep Bitcoin for money' (the Luke Dashjr camp)",
                                "Super Testnet's URSF-110 ('User Rejected Soft Fork') — a tool that REJECTS BIP-110-signaling blocks via invalidateblock; he opposes BIP-110 (it can freeze miniscript funds using OP_IF in Taproot, and a forced 55% activation risks a chain split that backfires on the anti-spam goal)",
                                "ProductionReady (Jimmy Song & Samson Mow) — funding a conservative third node client to break Core's monopoly on the reference implementation"
                            ],
                            "link": "https://github.com/supertestnet/URSF-110",
                            "linkLabel": "Super Testnet's URSF-110"
                        },
                        {
                            "heading": "By the Numbers + Where We Stand",
                            "bullets": [
                                "Support is tiny: ~2.38% of nodes (583 of ~24,481) run BIP-110, and 0.00% of blocks are signaling",
                                "Context: Knots runs ~22-25% of nodes, but few enabled BIP-110 — and miners aren't signaling at all",
                                "Activation needs 55% of blocks (vs the 95% norm); flag day is block 961,632 (~Aug 2026). Adam Back warns a contested activation could split the chain by fall; Jameson Lopp doubts data filters even work",
                                "Where we stand: sound money is the REASON to be wary — BIP-110 can freeze real funds and a rushed UASF risks a fork that backfires. We're with Super's URSF-110."
                            ],
                            "link": "https://bip110monitor.com/",
                            "linkLabel": "Live Signaling Monitor"
                        }
                    ]
                },
                {
                    "id": "clarity-act",
                    "title": "CLARITY Act: The Ethics Snag",
                    "description": "The market-structure bill is on the calendar but stuck on an ethics provision",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "CLARITY Act: The Ethics Snag",
                            "body": "The Digital Asset Market CLARITY Act sits on the Senate calendar (Calendar No. 423) after clearing the Banking Committee 15-9. It would hand the CFTC exclusive jurisdiction over digital-commodity spot markets like Bitcoin's, with the SEC keeping investment contracts — but floor support is hung up on an ethics provision about government officials' crypto ties.",
                            "link": "https://www.coindesk.com/news-analysis/2026/06/02/clarity-act-survival-depends-on-the-u-s-senate-getting-a-lot-of-non-crypto-work-done",
                            "linkLabel": "Where It Stands"
                        },
                        {
                            "heading": "The Clock + Discussion",
                            "bullets": [
                                "Still needs 60 floor votes, reconciliation with the Senate Ag Committee, then the House",
                                "Roughly eight weeks remain before the summer break — and midterm politics loom after",
                                "Does a market-structure bill survive an election-year Congress, or slip to 2027?",
                                "Is clear CFTC jurisdiction over spot Bitcoin a win worth the wait?"
                            ]
                        }
                    ]
                },
                {
                    "id": "strategic-reserve",
                    "title": "Strategic Bitcoin Reserve: Weeks Away?",
                    "description": "White House signals an announcement soon; the bill drops its 1M-BTC target",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Strategic Bitcoin Reserve: Weeks Away?",
                            "body": "Patrick Witt of the President's Council of Advisors for Digital Assets told Consensus Miami an announcement on the reserve is coming 'in the next few weeks.' Meanwhile the latest reserve bill quietly dropped its 1-million-BTC purchase target, while keeping the 20-year lockup and quarterly proof-of-reserve mandates.",
                            "link": "https://www.theblock.co/post/402264/new-strategic-bitcoin-reserve-bill-drops-btc-purchase-target-adds-lockup",
                            "linkLabel": "Read the Bill Changes"
                        },
                        {
                            "heading": "The Stakes + Discussion",
                            "bullets": [
                                "If the BITCOIN Act passes, Treasury's first official purchase is estimated for Q4 2026 — the first sovereign to actively accumulate",
                                "The US already holds an estimated ~328,000 BTC, mostly from forfeitures",
                                "Does dropping the 1M-BTC target gut the ambition, or make it actually passable?",
                                "Quarterly proof-of-reserve from a government — a precedent we'd want every nation to copy?"
                            ]
                        }
                    ]
                },
                {
                    "id": "nostr-signing",
                    "title": "Nostr: Zaps + the Remote-Signing Era",
                    "description": "NIP-57 updated this week; the ecosystem moves off pasting your nsec",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "Nostr: Zaps Spec Updated + Remote Signing",
                            "body": "NIP-57 — the spec that defines Lightning zaps — was updated this week (June 13). The bigger 2026 shift: Nostr has moved away from pasting your private key (nsec) into every app, toward remote signing where your key stays locked in one place.",
                            "link": "https://nips.nostr.com/57",
                            "linkLabel": "NIP-57 (Zaps)"
                        },
                        {
                            "heading": "How It Works + Discussion",
                            "bullets": [
                                "NIP-46 'bunkers' keep your nsec in a dedicated app (like Amber on Android); other clients get a temporary, revocable session key",
                                "NIP-47 (Nostr Wallet Connect) lets apps request Lightning payments directly — seamless zapping, no invoice copy-paste",
                                "Clients like Damus, Primal, and Amethyst now build around delegated signing",
                                "Is key management the real adoption hurdle for Nostr — and is remote signing the fix?"
                            ],
                            "link": "https://nips.nostr.com/46",
                            "linkLabel": "NIP-46 (Remote Signing)"
                        }
                    ]
                },
                {
                    "id": "ecash",
                    "title": "Ecash Grows Up: Cashu & Fedimint",
                    "description": "Chaumian ecash over Lightning keeps maturing — private, instant, bearer Bitcoin",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Ecash Grows Up: Cashu & Fedimint",
                            "body": "Chaumian ecash — private, instant, bearer tokens backed by Bitcoin over Lightning — keeps maturing. Cashu's Nutshell 0.20.0 (Q1 2026) added improved P2PK/HTLC validation; Keyset V2 derivation is rolling out, Bolt12 support for cashu.me is close, and security audits are a stated priority.",
                            "link": "https://opensats.org/projects/cashu",
                            "linkLabel": "Cashu (OpenSats)"
                        },
                        {
                            "heading": "The Tradeoff + Discussion",
                            "bullets": [
                                "Cashu uses a single mint; Fedimint spreads custody across a federation of guardians",
                                "The deal: you trust a mint/federation in exchange for instant, private, no-account payments",
                                "It's the privacy renaissance pairing with Lightning — exactly the 'invisible' UX newcomers need",
                                "Is custodial-but-private ecash the right on-ramp for everyday Bitcoin, or a step backward on self-custody?"
                            ],
                            "link": "https://blog.bitfinex.com/education/cashu-chaumian-e-cash-mints-over-lightning/",
                            "linkLabel": "How Cashu Works"
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "Stop pasting your nsec — use a remote signer",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "Quick Tip: Stop Pasting Your nsec",
                            "body": "If you're on Nostr, stop pasting your private key (nsec) into every web app — each one is a place it can leak. Instead, use a remote signer: keep your nsec in one dedicated app (Amber on Android) or an NIP-46 bunker, and let other clients sign through it with a temporary, revocable key. Same login everywhere, far smaller attack surface.",
                            "link": "https://soapbox.pub/blog/managing-nostr-keys/",
                            "linkLabel": "Managing Your Nostr Keys"
                        }
                    ]
                },
                {
                    "id": "community-news",
                    "title": "Community News & Topics",
                    "description": "Share what you're interested in talking about!",
                    "type": "text",
                    "slides": [
                        {
                            "heading": "Next Week's Meetup",
                            "body": "Find something you're interested in talking about? Share it here and we'll cover it in next week's meetup!",
                            "link": "https://github.com/MaxSikorski/bitcoin-nostr-weekly-news/issues",
                            "linkLabel": "Submit a Topic"
                        }
                    ]
                }
            ]
        },
        "2026-W24": {
            "week": "2026-W24",
            "date": "2026-06-10",
            "title": "ETF Exodus, Strategy's Dip Buy & the Reserve Bill",
            "subtitle": "This week in Bitcoin & Nostr news",
            "timerMinutes": 20,
            "topics": [
                {
                    "id": "market-pulse",
                    "title": "Bitcoin's Ugliest Week in Months",
                    "description": "Worst week since February — $61.5K, $1.1B in liquidations, and longtime holders selling",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Bitcoin's Ugliest Week in Months",
                            "body": "Bitcoin is trading near $61,500 after its worst week in months — down roughly 17% over the past seven days. The drop through $64,000 triggered about $1.1 billion in liquidations, and longtime high-conviction holders have started selling into weakness.",
                            "link": "https://www.cnbc.com/2026/06/04/bitcoin-is-weathering-its-ugliest-week-in-months-as-narrative-fades-and-liquidity-rotates.html",
                            "linkLabel": "Read CNBC's Breakdown"
                        },
                        {
                            "heading": "What's Driving It",
                            "bullets": [
                                "Liquidity rotation: capital is chasing momentum in AI and semiconductor trades, leaving Bitcoin without a fresh narrative",
                                "Long-term holders are distributing — CNBC reports 'high-conviction holders are turning into sellers' as price hit new lows",
                                "Macro jitters: this week's CPI report could decide whether the $60K–$63K range holds",
                                "Perspective check: Bitcoin sits about $48,800 below where it traded at this time last year"
                            ],
                            "link": "https://www.cnbc.com/2026/06/03/bitcoins-high-conviction-holders-are-selling-as-price-hits-new-lows.html",
                            "linkLabel": "Who's Selling"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Is this a cyclical flush or the start of a deeper bear?",
                                "Does Bitcoin need a 'narrative' at all — or is that a trader's framing for what holders just call an opportunity?",
                                "Side note: Sam Bankman-Fried is reportedly seeking a pardon from President Trump — what would that say about crypto's standing in Washington?"
                            ]
                        }
                    ]
                },
                {
                    "id": "etf-outflows",
                    "title": "The ETF Exodus",
                    "description": "$1.72B left U.S. spot Bitcoin ETFs in a week — the biggest exit since February 2025",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "ETF Exodus: $1.72B Out in One Week",
                            "body": "U.S. spot Bitcoin ETFs posted $1.72 billion in net outflows for the week ending June 6 — the largest weekly exit since February 2025, and the fourth straight week of withdrawals. The four-week bleed totals roughly $5.4 billion.",
                            "link": "https://www.coindesk.com/markets/2026/06/05/bitcoin-and-ether-etfs-end-record-multi-billion-outflow-streak",
                            "linkLabel": "How the Streak Ended"
                        },
                        {
                            "heading": "Inside the Numbers",
                            "bullets": [
                                "BlackRock's IBIT led the outflows, shedding about $1.34B on the week — its worst week since launching in January 2024",
                                "A record multi-day outflow streak finally snapped on June 5 with the first net inflows in weeks",
                                "Analysts point to rising Treasury yields, shifting Fed rate expectations, and profit-taking after the long rally",
                                "One analyst take: the multi-billion-dollar bleed 'looks more cyclical than structural'"
                            ],
                            "link": "https://www.investing.com/analysis/bitcoins-34-billion-etf-bleed-looks-more-cyclical-than-structural-200681474",
                            "linkLabel": "The Cyclical Case"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "ETFs were the 2024–25 demand engine — what happens to price when that engine runs in reverse?",
                                "Did Wall Street adoption make Bitcoin stronger, or just turn it into another momentum trade?",
                                "Would a streak of inflows flip sentiment as fast as the outflows broke it?"
                            ]
                        }
                    ]
                },
                {
                    "id": "strategy",
                    "title": "Strategy Sells… Then Buys the Dip",
                    "description": "First sale since 2022, then a $101M buy — and a cost basis now underwater",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Strategy Sells… Then Buys the Dip",
                            "body": "Michael Saylor's Strategy disclosed its first Bitcoin sale since 2022 — just 32 BTC for about $2.5 million in late May — then turned around and bought 1,550 BTC for roughly $101 million between June 1 and 7. The treasury now stands at 845,256 BTC.",
                            "link": "https://www.coindesk.com/markets/2026/06/01/strategy-sold-32-btc-for-usd2-5-million-in-late-may-filing-shows",
                            "linkLabel": "Read the Filing Coverage"
                        },
                        {
                            "heading": "The Numbers",
                            "bullets": [
                                "845,256 BTC held — about 4% of the entire 21 million supply, acquired for $33.1 billion total",
                                "Average purchase price: $66,385 — with Bitcoin at $61.5K, Strategy is underwater on its cost basis",
                                "The buy was funded with at-the-market equity sales: about 1.41 million shares for roughly $181M net",
                                "Cash reserve raised by $100M to $1B; co-CEO Phong Le: 'Rumors otherwise are just rumors'"
                            ],
                            "link": "https://bitbo.io/treasuries/microstrategy",
                            "linkLabel": "Track Strategy's Holdings"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Why sell 32 BTC at all? Housekeeping, a signal, or a trial balloon to test the market's reaction?",
                                "Strategy is now below its average cost — does the 'sell shares, buy Bitcoin' flywheel work in reverse?",
                                "One company holding 4% of all Bitcoin: systemic risk, or proof of conviction?"
                            ]
                        }
                    ]
                },
                {
                    "id": "clarity-act",
                    "title": "CLARITY Act: On the Senate Calendar",
                    "description": "The market-structure bill cleared committee — now it faces a 60-vote wall and a shrinking calendar",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "CLARITY Act: On the Senate Calendar",
                            "body": "The Digital Asset Market CLARITY Act — the big crypto market-structure bill — cleared the Senate Banking Committee 15–9 on May 14 and was placed on the Senate legislative calendar June 1. It would give the CFTC exclusive jurisdiction over 'digital commodity' spot markets like Bitcoin's, with the SEC keeping investment contracts.",
                            "link": "https://www.coindesk.com/news-analysis/2026/06/02/clarity-act-survival-depends-on-the-u-s-senate-getting-a-lot-of-non-crypto-work-done",
                            "linkLabel": "Where Things Stand"
                        },
                        {
                            "heading": "The Roadblocks",
                            "bullets": [
                                "Two Democrats (Gallego, Alsobrooks) joined all Republicans in committee — but the floor takes 60 votes to clear the filibuster",
                                "The Banking Committee version still has to merge with the Senate Agriculture Committee's framework",
                                "Roughly eight weeks remain on the Senate calendar before the summer break",
                                "61 crypto industry leaders sent a letter urging the Senate to keep developer protections intact"
                            ],
                            "link": "https://bitcoinmagazine.com/news/crypto-leaders-urge-to-pass-clarity-act",
                            "linkLabel": "Read About the Industry Letter"
                        },
                        {
                            "heading": "Why We Care + Discussion",
                            "bullets": [
                                "Clear CFTC jurisdiction over spot Bitcoin could end a decade of regulator turf wars",
                                "Developer protections decide whether writing open-source Bitcoin software carries legal risk",
                                "If it slips past the summer break, does a market-structure bill survive an election-year Congress at all?"
                            ]
                        }
                    ]
                },
                {
                    "id": "stablecoin-rules",
                    "title": "Stablecoin Rules Get Real",
                    "description": "GENIUS Act deadlines hit — the comment window closed June 9, full rules land July 18",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Stablecoin Rules Get Real",
                            "body": "The GENIUS Act — the federal stablecoin law signed last July — hit a key milestone this week: June 9 was the deadline for public comments on the FinCEN–OFAC anti-money-laundering rules. The full regulatory framework takes effect July 18.",
                            "link": "https://crypto.news/genius-act-deadline-puts-stablecoin-issuers-on-notice/",
                            "linkLabel": "Read the Deadline Rundown"
                        },
                        {
                            "heading": "The State of Stablecoins",
                            "bullets": [
                                "Total stablecoin supply now exceeds $240 billion — Tether's USDT holds about 67% market share, Circle's USDC about 27%",
                                "New York's DFS proposed aligning its state framework with Treasury's GENIUS Act certification rules",
                                "From July 18, issuers face full federal AML obligations, reserve requirements, and audits"
                            ],
                            "link": "https://home.treasury.gov/news/press-releases/sb0435",
                            "linkLabel": "Treasury's Proposed Rule"
                        },
                        {
                            "heading": "Why It Matters for Bitcoin + Discussion",
                            "bullets": [
                                "Stablecoins are the on-ramp and trading pair for most Bitcoin volume — regulated rails change how money reaches BTC",
                                "Regulated digital dollars: a gateway to Bitcoin, or a state-approved competitor to it?",
                                "Does Tether's offshore dominance survive a fully certified U.S. regime?"
                            ]
                        }
                    ]
                },
                {
                    "id": "reserve-bill",
                    "title": "Strategic Bitcoin Reserve: The Fine Print",
                    "description": "H.R. 8957's full text: a 20-year lockup and proof-of-reserve for the U.S. stash",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Strategic Bitcoin Reserve: The Fine Print Arrives",
                            "body": "Congress finally got a detailed look at the Strategic Bitcoin Reserve. The full text of the bipartisan American Reserve Modernization Act (H.R. 8957) — introduced by Rep. Nick Begich (R-AK) and Rep. Jared Golden (D-ME) with more than 20 co-sponsors — was published this week.",
                            "link": "https://bitcoinmagazine.com/news/full-of-strategic-bitcoin-reserve-bill",
                            "linkLabel": "Read the Full-Text Breakdown"
                        },
                        {
                            "heading": "What's in the Bill",
                            "bullets": [
                                "A mandatory 20-year hold: reserve BTC can't be sold, swapped, auctioned, or encumbered — for any purpose",
                                "After 20 years, at most 10% can be offloaded in any two-year window, subject to Congressional review",
                                "Quarterly public proof-of-reserve attestations, independent third-party audits, and Comptroller General oversight",
                                "The U.S. government already holds an estimated ~328,000 BTC — the largest known state holder"
                            ]
                        },
                        {
                            "heading": "Signals from the Administration + Discussion",
                            "bullets": [
                                "Treasury Secretary Bessent told a Senate committee June 3 the reserve is proceeding with 'deliberate speed'",
                                "A White House adviser has teased a reserve update 'in the next few weeks'",
                                "Does a 20-year lockup make the reserve credible — or just easy for a future Congress to repeal?",
                                "Quarterly proof-of-reserve from a government: a precedent we want every nation to copy?"
                            ],
                            "link": "https://www.thestreet.com/crypto/markets/treasury-secretary-bessent-reveals-new-information-on-bitcoin-reserve",
                            "linkLabel": "Bessent's Testimony"
                        }
                    ]
                },
                {
                    "id": "mining-difficulty",
                    "title": "Difficulty Drop Incoming as Miners Chase AI",
                    "description": "A ~9% difficulty drop is coming as public miners pivot rigs toward AI",
                    "type": "discussion",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Difficulty Drop Incoming",
                            "body": "Mining difficulty is set to fall roughly 9% around June 13–14 — from 138.96T to about 123.9T — as squeezed miners power down or redirect capacity. Network hashrate sits near 962 EH/s after recently touching the 1 zettahash milestone.",
                            "link": "https://www.coinwarz.com/mining/bitcoin/difficulty-chart",
                            "linkLabel": "Live Difficulty Chart"
                        },
                        {
                            "heading": "The AI Pivot",
                            "bullets": [
                                "Bitcoin recorded its first Q1 hashrate decline in six years — partly from miners diverting power to AI workloads",
                                "Industry projections: listed miners could earn ~70% of revenue from AI and HPC by the end of 2026, up from ~30% today",
                                "With BTC near $61K, margins favor large operators with cheap power; transaction fees are only 10–15% of miner income"
                            ],
                            "link": "https://cryptonews.net/news/mining/32977167/",
                            "linkLabel": "Why Miners Are Becoming AI Data Centers"
                        },
                        {
                            "heading": "Discussion Points",
                            "bullets": [
                                "Is the AI pivot bullish (miners stay solvent) or bearish (security budget drifts away from the network)?",
                                "A 9% difficulty drop is relief for whoever keeps hashing — who's left mining at these prices?",
                                "Does miner consolidation around cheap power worry anyone here?"
                            ]
                        }
                    ]
                },
                {
                    "id": "nostr-vpn",
                    "title": "Satoshi's First Collaborator Ships a Nostr VPN",
                    "description": "Martti Malmi releases a Tailscale-style VPN where your npub is the login",
                    "type": "tool",
                    "accent": "nostr",
                    "slides": [
                        {
                            "heading": "A Nostr VPN from a Bitcoin OG",
                            "body": "Martti Malmi — 'Sirius,' who worked directly with Satoshi from 2009–2011 and co-ran Bitcoin.org — released a privacy-focused, Tailscale-style VPN built on Nostr. Your Nostr public key replaces email logins entirely: no accounts, no third parties.",
                            "link": "https://cointelegraph.com/news/bitcoin-developer-privacy-focused-nostr-vpn-public-keys",
                            "linkLabel": "Read the Coverage"
                        },
                        {
                            "heading": "How It Works",
                            "bullets": [
                                "Nostr public keys handle identity and signaling between your devices — the same cryptography that secures Bitcoin",
                                "Direct peer-to-peer connections, with Nostr-relay multihop routing as the fallback when P2P fails",
                                "A multiplatform interface for managing VPN settings across devices, inspired by Tailscale",
                                "The same trust-minimization logic as Bitcoin — applied to internet privacy instead of money"
                            ]
                        },
                        {
                            "heading": "Elsewhere on Nostr + Discussion",
                            "bullets": [
                                "Damus shipped 'Damus Labs' features — live-streaming and offline note-loading",
                                "Primal added Remote Login: sign into other Nostr clients without ever exposing your private key",
                                "OpenSats' Nostr Fund continues funding work on accessibility, security, and decentralization",
                                "Is identity — keys instead of accounts — Nostr's real killer app, beyond social media?"
                            ]
                        }
                    ]
                },
                {
                    "id": "quick-tip",
                    "title": "Quick Tip of the Week",
                    "description": "The mempool is nearly empty — do your on-chain housekeeping while fees are cheap",
                    "type": "tool",
                    "accent": "bitcoin",
                    "slides": [
                        {
                            "heading": "Quick Tip: Housekeeping While Fees Are Low",
                            "body": "The mempool is nearly empty right now — low-priority transactions are clearing at around 1 sat/vB or less. That makes this the cheap window for on-chain housekeeping: consolidate your small UTXOs, open or rebalance Lightning channels, and move coins to cold storage. Check live fees before you send.",
                            "link": "https://mempool.space/",
                            "linkLabel": "Check Live Fees on mempool.space"
                        }
                    ]
                },
                {
                    "id": "community-news",
                    "title": "Community News & Topics",
                    "description": "Share what you're interested in talking about!",
                    "type": "text",
                    "slides": [
                        {
                            "heading": "Next Week's Meetup",
                            "body": "Find something you're interested in talking about? Share it here and we'll cover it in next week's meetup!",
                            "link": "https://github.com/MaxSikorski/bitcoin-nostr-weekly-news/issues",
                            "linkLabel": "Submit a Topic"
                        }
                    ]
                }
            ]
        }
    };

    // === Initialize ===
    function init() {
        const params = new URLSearchParams(window.location.search);
        const weekId = params.get('week');

        if (!weekId) {
            window.location.href = 'index.html';
            return;
        }

        function loadPresentation(data) {
            weekData = data;

            // Update page title
            document.title = `${data.title} — Bitcoin Meetup`;

            // Set timer from data
            if (data.timerMinutes) {
                timerSeconds = data.timerMinutes * 60;
            }
            updateTimerDisplay();

            // Build slides and TOC
            buildSlides(data);
            buildTOC(data);
            initLiveDashboard();

            // Show first slide
            loadingState.style.display = 'none';
            presentation.style.display = 'block';
            presenterControls.style.display = 'flex';

            slides[0].el.classList.add('active');
            gsap.set(slides[0].el, { opacity: 1 });

            // Animate hero elements in
            const heroElements = slides[0].el.querySelectorAll('.slide-topic-badge, .slide-heading, .slide-body, [style*="display: flex"]');
            gsap.set(heroElements, { opacity: 0, y: 30 });
            gsap.to(heroElements, {
                opacity: 1,
                y: 0,
                duration: 1.2,
                ease: 'power4.out',
                stagger: 0.12,
                delay: 0.3
            });

            // Fix subtitle opacity
            const subtitles = slides[0].el.querySelectorAll('.slide-body');
            gsap.to(subtitles, { opacity: 0.85, duration: 1.2, ease: 'power4.out', delay: 0.5 });

            updateControls();

            // Start button
            const startBtn = document.getElementById('start-btn');
            if (startBtn) {
                startBtn.addEventListener('click', () => {
                    goToSlide(overviewSlideIndex, 1);
                });
            }

            // Show keyboard hints briefly
            setTimeout(showKeyboardHints, 2000);
        }

        // Try fetch first (GitHub Pages / HTTP), fall back to inline data (file://)
        fetch(`weeks/${weekId}.json`)
            .then(res => {
                if (!res.ok) throw new Error(`Week ${weekId} not found`);
                return res.json();
            })
            .then(data => loadPresentation(data))
            .catch(err => {
                // Fall back to inline data
                if (INLINE_WEEKS[weekId]) {
                    console.log('Using inline data (file:// mode)');
                    loadPresentation(INLINE_WEEKS[weekId]);
                } else {
                    console.error('Failed to load presentation:', err);
                    loadingState.innerHTML = `
                        <div style="text-align: center;">
                            <p style="opacity: 0.5; margin-bottom: 16px;">Could not load presentation</p>
                            <a href="index.html" class="btn secondary-btn">Back to Archive</a>
                        </div>
                    `;
                }
            });
    }

    // Expose public API
    window.Presenter = {
        goToSlide,
        goToTopic,
        nextSlide,
        prevSlide,
        goToOverview,
        toggleTOC,
        toggleQR,
        resetTimer
    };

    init();

})();
