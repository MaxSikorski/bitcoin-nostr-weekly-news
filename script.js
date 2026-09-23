/* ============================================================
   Sikorski Design System — Shared Script
   Theme toggle, GSAP hero animation, scroll reveals
   ============================================================ */

(function () {
    'use strict';

    // === Telemetry beacon (engine-level, 2026-09-17) — archive-page visit counter ===
    // Dormant unless config.js sets telemetry.url; anonymous tick only (see presenter.js).
    // Fires only on the archive page (week.html has its own view-deck beacon).
    (function () {
        const t = (window.SITE_CONFIG || {}).telemetry || {};
        if (!t.url || !navigator.sendBeacon) return;
        if (!document.getElementById('archive-list')) return;
        try {
            navigator.sendBeacon(t.url, JSON.stringify({
                site: t.site || '', kind: 'view-archive', week: '', topic: ''
            }));
        } catch (e) { /* never break the page */ }
    })();

    // === Deck search (engine-level) ===
    let deckSearchIndex = null;

    function escapeSearchRegex(value) {
        return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function foldSearchText(value) {
        return String(value || '')
            .replace(/<[^>]+>/g, ' ')
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
    }

    function parseSearchTerms(query) {
        const terms = [];
        const pattern = /"([^"]+)"|(\S+)/g;
        let match;

        while ((match = pattern.exec(String(query || ''))) !== null) {
            const text = foldSearchText(match[1] !== undefined ? match[1] : match[2]).trim();
            if (text) terms.push({ text, phrase: match[1] !== undefined });
        }
        return terms;
    }

    function searchTermRegex(term, global) {
        const source = term.phrase
            ? escapeSearchRegex(term.text)
            : `\\b${escapeSearchRegex(term.text)}`;
        return new RegExp(source, global ? 'gi' : 'i');
    }

    function productNamesFor(slideData) {
        const productIds = [];
        if (slideData.product) {
            productIds.push(slideData.product);
        }
        if (Array.isArray(slideData.products)) {
            productIds.push(...slideData.products);
        } else if (slideData.products) {
            productIds.push(slideData.products);
        }

        if (!productIds.length || !Array.isArray(window.PRODUCTS)) return [];
        return productIds.map(id => {
            const product = window.PRODUCTS.find(item => item && item.id === id);
            return product && product.name ? product.name : '';
        }).filter(Boolean);
    }

    function buildDeckSearchIndex(weeks) {
        const entries = [];
        const weekData = weeks && typeof weeks === 'object' ? weeks : {};

        Object.keys(weekData).forEach(weekKey => {
            const deck = weekData[weekKey] || {};
            const week = deck.week || weekKey;
            const deckTitle = deck.title || '';

            (Array.isArray(deck.topics) ? deck.topics : []).forEach((topic, topicIndex) => {
                const topicTitle = topic.title || '';
                const topicDescription = topic.description || '';

                (Array.isArray(topic.slides) ? topic.slides : []).forEach((slide, slideIndex) => {
                    const textParts = [];
                    if (slide.body) textParts.push(slide.body);
                    if (Array.isArray(slide.bullets)) textParts.push(...slide.bullets);
                    if (Array.isArray(slide.links)) {
                        slide.links.forEach(link => {
                            if (link && link.label) textParts.push(link.label);
                        });
                    }
                    if (slide.linkLabel) textParts.push(slide.linkLabel);
                    if (slide.videoTitle) textParts.push(slide.videoTitle);
                    textParts.push(...productNamesFor(slide));

                    const text = textParts.filter(Boolean).join(' ');
                    const hay = foldSearchText([
                        deckTitle,
                        topicTitle,
                        topicDescription,
                        slide.heading || '',
                        text
                    ].join(' | '));

                    entries.push({
                        week,
                        date: deck.date || '',
                        deckTitle,
                        topicId: topic.id || '',
                        topicTitle,
                        topicIndex,
                        slideIndex,
                        heading: slide.heading || '',
                        text,
                        hay
                    });
                });
            });
        });

        deckSearchIndex = entries;
        return entries;
    }

    function queryDeckSearch(query) {
        const value = String(query || '').trim();
        if (value.length < 2) return [];
        if (!deckSearchIndex) buildDeckSearchIndex(window.INLINE_WEEKS || {});

        const terms = parseSearchTerms(value);
        if (!terms.length) return [];

        return deckSearchIndex.map(entry => {
            let score = 0;
            const matches = terms.every(term => {
                const regex = searchTermRegex(term, false);
                const headingHit = regex.test(foldSearchText(entry.heading));
                const topicHit = regex.test(foldSearchText(entry.topicTitle));
                const textHit = regex.test(foldSearchText(entry.text));
                const hayHit = regex.test(entry.hay);

                if (headingHit) score += 3;
                if (topicHit) score += 2;
                if (textHit) score += 1;
                return hayHit;
            });

            return matches ? { entry, score } : null;
        }).filter(Boolean).sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const dateOrder = String(b.entry.date).localeCompare(String(a.entry.date));
            if (dateOrder !== 0) return dateOrder;
            if (a.entry.topicIndex !== b.entry.topicIndex) return a.entry.topicIndex - b.entry.topicIndex;
            return a.entry.slideIndex - b.entry.slideIndex;
        }).slice(0, 200).map(item => item.entry);
    }

    function escapeSearchHTML(value) {
        return String(value || '').replace(/[&<>"']/g, character => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[character]));
    }

    function highlightDeckSearch(text, terms) {
        const escaped = escapeSearchHTML(text);
        const normalizedTerms = (Array.isArray(terms) ? terms : parseSearchTerms(terms))
            .map(term => {
                if (typeof term === 'string') {
                    const value = term.trim();
                    const phrase = value.startsWith('"') && value.endsWith('"') && value.length > 1;
                    return { text: foldSearchText(phrase ? value.slice(1, -1) : value).trim(), phrase };
                }
                return {
                    text: foldSearchText(term.text).trim(),
                    phrase: Boolean(term.phrase)
                };
            })
            .filter(term => term.text)
            .sort((a, b) => b.text.length - a.text.length);

        if (!normalizedTerms.length) return escaped;
        const source = normalizedTerms.map(term => term.phrase
            ? escapeSearchRegex(term.text)
            : `\\b${escapeSearchRegex(term.text)}`).join('|');
        const matcher = new RegExp(source, 'gi');
        return escaped.replace(matcher, match => `<mark class="search-mark">${match}</mark>`);
    }

    // === Search palette (Spotlight-style) ===
    let searchPalette = null;
    let searchPaletteOverlay = null;
    let searchPaletteForm = null;
    let searchPaletteInput = null;
    let searchPaletteResults = null;
    let searchPaletteOpen = false;
    let searchPaletteTimer = null;
    let searchPaletteEntries = [];
    let searchPaletteVisibleCount = 40;
    let searchPaletteActiveIndex = -1;
    let searchPaletteOnSelect = null;
    let searchPalettePreviousFocus = null;
    let searchPalettePreviousOverflow = '';

    function isSearchEditableTarget(target) {
        return target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
    }

    function updatePaletteURL(value) {
        if (document.getElementById('presentation')) return;
        const params = new URLSearchParams(window.location.search);
        if (value.trim()) params.set('q', value);
        else params.delete('q');
        const query = params.toString();
        const next = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
        window.history.replaceState(null, '', next);
    }

    function formatPaletteDate(date) {
        return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }

    function paletteSnippet(text, terms) {
        const value = String(text || '').replace(/<[^>]+>/g, ' ');
        if (!value) return '';

        let firstMatch = null;
        terms.forEach(term => {
            const match = searchTermRegex(term, false).exec(foldSearchText(value));
            if (match && (!firstMatch || match.index < firstMatch.index)) firstMatch = match;
        });

        if (!firstMatch) return value.length > 160 ? `${value.slice(0, 160)}…` : value;
        const start = Math.max(0, firstMatch.index - 80);
        const end = Math.min(value.length, firstMatch.index + firstMatch[0].length + 80);
        return `${start > 0 ? '…' : ''}${value.slice(start, end)}${end < value.length ? '…' : ''}`;
    }

    function paletteHref(entry) {
        return `week.html?week=${encodeURIComponent(entry.week)}&topic=${encodeURIComponent(entry.topicId)}&slide=${entry.slideIndex}`;
    }

    function paletteFocusableElements() {
        if (!searchPaletteInput || !searchPaletteResults) return [];
        return [searchPaletteInput, ...searchPaletteResults.querySelectorAll('.palette-hit, .palette-more')]
            .filter(element => !element.hidden);
    }

    function setPaletteActive(index) {
        if (!searchPaletteResults || !searchPaletteInput) return;
        const hits = Array.from(searchPaletteResults.querySelectorAll('.palette-hit'));
        hits.forEach((hit, hitIndex) => hit.classList.toggle('is-active', hitIndex === index));
        searchPaletteActiveIndex = index >= 0 && index < hits.length ? index : -1;
        searchPaletteInput.setAttribute('aria-activedescendant', searchPaletteActiveIndex >= 0
            ? hits[searchPaletteActiveIndex].id
            : '');
        if (searchPaletteActiveIndex >= 0) {
            hits[searchPaletteActiveIndex].scrollIntoView({ block: 'nearest' });
        }
    }

    function movePaletteActive(direction) {
        const hits = searchPaletteResults ? Array.from(searchPaletteResults.querySelectorAll('.palette-hit')) : [];
        if (!hits.length) return;
        const nextIndex = searchPaletteActiveIndex < 0
            ? (direction > 0 ? 0 : hits.length - 1)
            : (searchPaletteActiveIndex + direction + hits.length) % hits.length;
        setPaletteActive(nextIndex);
    }

    function renderPaletteResults(query) {
        if (!searchPalette || !searchPaletteResults) return;

        const value = String(query || '').trim();
        searchPaletteResults.innerHTML = '';
        searchPaletteEntries = [];
        setPaletteActive(-1);

        if (value.length < 2) {
            searchPalette.classList.remove('has-results');
            searchPaletteResults.hidden = true;
            return;
        }

        searchPalette.classList.add('has-results');
        searchPaletteEntries = queryDeckSearch(value);
        searchPaletteResults.hidden = false;

        if (!searchPaletteEntries.length) {
            const empty = document.createElement('div');
            empty.className = 'palette-empty';
            empty.textContent = `No slides match "${value}"`;
            searchPaletteResults.appendChild(empty);
            return;
        }

        const terms = parseSearchTerms(value);
        const visibleEntries = searchPaletteEntries.slice(0, searchPaletteVisibleCount);
        const groups = [];
        const groupMap = new Map();
        visibleEntries.forEach(entry => {
            let group = groupMap.get(entry.week);
            if (!group) {
                group = { entry, hits: [] };
                groupMap.set(entry.week, group);
                groups.push(group);
            }
            group.hits.push(entry);
        });

        let hitNumber = 0;
        groups.forEach(group => {
            const groupLabel = document.createElement('div');
            groupLabel.className = 'palette-group';
            // Deck header outranks the hits under it (Max, 2026-09-23): date big + bold,
            // then "Week 38 · Deck title" as the quieter second line.
            const groupDate = document.createElement('span');
            groupDate.className = 'palette-group-date';
            groupDate.textContent = formatPaletteDate(group.entry.date);
            const groupDeck = document.createElement('span');
            groupDeck.className = 'palette-group-deck';
            const weekMatch = String(group.entry.week || '').match(/-W(\d{2})$/);
            groupDeck.textContent = weekMatch
                ? `Week ${parseInt(weekMatch[1], 10)} · ${group.entry.deckTitle}`
                : group.entry.deckTitle;
            groupLabel.appendChild(groupDate);
            groupLabel.appendChild(groupDeck);
            searchPaletteResults.appendChild(groupLabel);

            group.hits.forEach(entry => {
                const hit = document.createElement('a');
                hit.className = 'palette-hit';
                hit.setAttribute('role', 'option');
                hit.id = `palette-hit-${hitNumber++}`;
                hit.href = paletteHref(entry);
                hit.dataset.week = entry.week;
                hit.dataset.topicId = entry.topicId;
                hit.dataset.slideIndex = String(entry.slideIndex);
                hit._deckSearchEntry = entry;

                const heading = document.createElement('span');
                heading.className = 'palette-hit-heading';
                heading.innerHTML = highlightDeckSearch(entry.heading || 'Untitled slide', terms);

                const meta = document.createElement('span');
                meta.className = 'palette-hit-meta';
                meta.textContent = `Topic ${entry.topicIndex + 1} · ${entry.topicTitle}`;

                const snippet = document.createElement('span');
                snippet.className = 'palette-hit-snippet';
                snippet.innerHTML = highlightDeckSearch(paletteSnippet(entry.text, terms), terms);

                hit.appendChild(heading);
                hit.appendChild(meta);
                hit.appendChild(snippet);
                searchPaletteResults.appendChild(hit);
            });
        });

        if (visibleEntries.length < searchPaletteEntries.length) {
            const showAll = document.createElement('button');
            showAll.type = 'button';
            showAll.className = 'palette-more';
            showAll.textContent = `Show all ${searchPaletteEntries.length - visibleEntries.length}`;
            searchPaletteResults.appendChild(showAll);
        }
    }

    function activatePaletteHit(hit) {
        if (!hit) return;
        const entry = hit._deckSearchEntry;
        let handled = false;
        if (entry && typeof searchPaletteOnSelect === 'function') {
            handled = searchPaletteOnSelect(entry) === true;
        }
        if (!handled) window.location.href = hit.href;
        closePalette();
    }

    function buildSearchPalette() {
        searchPaletteOverlay = document.createElement('div');
        searchPaletteOverlay.className = 'palette-overlay';

        searchPalette = document.createElement('div');
        searchPalette.className = 'palette';
        searchPalette.setAttribute('role', 'dialog');
        searchPalette.setAttribute('aria-modal', 'true');
        searchPalette.setAttribute('aria-label', 'Search all presentations');
        searchPalette.innerHTML = `
            <form class="palette-form" role="search" autocomplete="off">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path>
                </svg>
                <input class="palette-input" type="search" placeholder="Search every presentation…" aria-label="Search all presentations" aria-controls="palette-results" aria-activedescendant="">
                <kbd class="palette-kbd" aria-hidden="true">esc</kbd>
            </form>
            <div class="palette-results" id="palette-results" role="listbox" hidden></div>
        `;

        document.body.appendChild(searchPaletteOverlay);
        document.body.appendChild(searchPalette);
        searchPaletteForm = searchPalette.querySelector('.palette-form');
        searchPaletteInput = searchPalette.querySelector('.palette-input');
        searchPaletteResults = searchPalette.querySelector('.palette-results');

        searchPaletteOverlay.addEventListener('click', closePalette);
        searchPaletteForm.addEventListener('submit', event => event.preventDefault());
        searchPaletteInput.addEventListener('input', () => {
            const value = searchPaletteInput.value;
            searchPaletteVisibleCount = 40;
            updatePaletteURL(value);
            window.clearTimeout(searchPaletteTimer);
            searchPaletteTimer = window.setTimeout(() => renderPaletteResults(value), 120);
        });
        searchPaletteResults.addEventListener('click', event => {
            const showAll = event.target.closest('.palette-more');
            if (showAll) {
                searchPaletteVisibleCount = searchPaletteEntries.length;
                renderPaletteResults(searchPaletteInput.value);
                searchPaletteInput.focus();
                return;
            }
            const hit = event.target.closest('.palette-hit');
            if (hit) {
                event.preventDefault();
                activatePaletteHit(hit);
            }
        });
        searchPaletteResults.addEventListener('focusin', event => {
            const hit = event.target.closest('.palette-hit');
            if (hit) {
                const hits = Array.from(searchPaletteResults.querySelectorAll('.palette-hit'));
                setPaletteActive(hits.indexOf(hit));
            }
        });
        searchPalette.addEventListener('keydown', event => {
            event.stopPropagation();
            if (event.key === 'Escape') {
                event.preventDefault();
                closePalette();
                return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
                event.preventDefault();
                closePalette();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                movePaletteActive(event.key === 'ArrowDown' ? 1 : -1);
                if (document.activeElement !== searchPaletteInput) searchPaletteInput.focus();
                return;
            }
            if (event.key === 'Enter' && event.target === searchPaletteInput) {
                event.preventDefault();
                const hits = searchPaletteResults.querySelectorAll('.palette-hit');
                const hit = hits[searchPaletteActiveIndex >= 0 ? searchPaletteActiveIndex : 0];
                if (hit) activatePaletteHit(hit);
                return;
            }
            if (event.key === 'Tab') {
                const focusable = paletteFocusableElements();
                if (!focusable.length) return;
                event.preventDefault();
                const currentIndex = Math.max(0, focusable.indexOf(document.activeElement));
                const nextIndex = event.shiftKey
                    ? (currentIndex - 1 + focusable.length) % focusable.length
                    : (currentIndex + 1) % focusable.length;
                focusable[nextIndex].focus();
            }
        });
    }

    function openPalette(options = {}) {
        if (!searchPalette) buildSearchPalette();
        if (Object.prototype.hasOwnProperty.call(options, 'onSelect')) {
            searchPaletteOnSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
        }
        if (!searchPaletteOpen) {
            searchPalettePreviousFocus = document.activeElement;
            searchPalettePreviousOverflow = document.body.style.overflow;
            document.body.style.overflow = 'hidden';
        }

        searchPaletteOpen = true;
        searchPaletteOverlay.classList.add('open');
        searchPalette.classList.add('open');
        const searchToggle = document.getElementById('search-toggle');
        if (searchToggle) searchToggle.setAttribute('aria-expanded', 'true');

        if (Object.prototype.hasOwnProperty.call(options, 'initialQuery')) {
            searchPaletteInput.value = String(options.initialQuery || '');
            searchPaletteVisibleCount = 40;
        } else {
            searchPaletteVisibleCount = 40;
        }
        renderPaletteResults(searchPaletteInput.value);
        searchPaletteInput.focus();
    }

    function closePalette() {
        if (!searchPaletteOpen) return;
        window.clearTimeout(searchPaletteTimer);
        searchPaletteOpen = false;
        searchPaletteOverlay.classList.remove('open');
        searchPalette.classList.remove('open');
        document.body.style.overflow = searchPalettePreviousOverflow;
        const searchToggle = document.getElementById('search-toggle');
        if (searchToggle) searchToggle.setAttribute('aria-expanded', 'false');
        const previousFocus = searchPalettePreviousFocus;
        searchPalettePreviousFocus = null;
        searchPaletteOnSelect = null;
        if (previousFocus && previousFocus !== document.body && document.contains(previousFocus) && !searchPalette.contains(previousFocus)) {
            previousFocus.focus();
        }
    }

    function togglePalette(options = {}) {
        if (searchPaletteOpen) closePalette();
        else openPalette(options);
    }

    function togglePagePalette() {
        if (window.Presenter && typeof window.Presenter.toggleSearch === 'function') {
            window.Presenter.toggleSearch();
        } else {
            togglePalette();
        }
    }

    window.DeckSearch = {
        build: buildDeckSearchIndex,
        query: queryDeckSearch,
        highlight: highlightDeckSearch,
        openPalette,
        closePalette,
        togglePalette,
        isOpen: () => searchPaletteOpen
    };

    const searchToggle = document.getElementById('search-toggle');
    if (searchToggle) searchToggle.addEventListener('click', togglePagePalette);
    document.addEventListener('keydown', event => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            event.stopImmediatePropagation();
            togglePagePalette();
            return;
        }
        if (event.key === 'Escape' && searchPaletteOpen) {
            event.preventDefault();
            event.stopImmediatePropagation();
            closePalette();
            return;
        }
        if (event.key === '/' && !isSearchEditableTarget(event.target)) {
            event.preventDefault();
            if (searchPaletteOpen) openPalette();
            else togglePagePalette();
        }
    });

    function applyBranding() {
        const cfg = window.SITE_CONFIG;
        if (!cfg) return;

        const logo = document.querySelector('.logo');
        if (logo) logo.textContent = cfg.siteName;

        const navLinks = document.getElementById('nav-links');
        if (navLinks) {
            navLinks.innerHTML = '';
            (cfg.navLinks || []).forEach(link => {
                const anchor = document.createElement('a');
                anchor.className = 'nav-link';
                anchor.setAttribute('href', link.href);
                anchor.textContent = link.label;
                navLinks.appendChild(anchor);
            });
        }

        const heroTitle = document.querySelector('.hero-title');
        if (heroTitle) heroTitle.innerHTML = cfg.heroTitleHtml;

        const heroSubtitle = document.querySelector('.hero-subtitle');
        if (heroSubtitle) heroSubtitle.textContent = cfg.heroSubtitle;

        const slideCreditHost = document.getElementById('slide-credit-host');
        if (slideCreditHost) slideCreditHost.textContent = cfg.hostName;

        const footer = document.getElementById('site-footer');
        if (!footer) return;

        if (cfg.footer === null) {
            footer.classList.add('footer-plain');
            footer.textContent = cfg.siteName;
        } else {
            const email = cfg.contactEmail.join('@');
            const workWithMailto = `mailto:${email}?subject=${encodeURIComponent(cfg.mail.workWithSubject)}&body=${encodeURIComponent(cfg.mail.workWithBody)}`;
            const footerLinks = (cfg.footer.links || []).map(link => {
                const externalAttrs = link.href.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
                return `<a href="${link.href}"${externalAttrs}>${link.label}</a>`;
            }).join('\n                    ');
            footer.innerHTML = `
                <p class="footer-host">Hosted by <strong>${cfg.hostName}</strong></p>
                <p class="footer-tagline">${cfg.footer.tagline}</p>
                <nav class="footer-links">
                    ${footerLinks}
                    <a id="footer-workwith" href="${workWithMailto}">${cfg.footer.workWithLabel}</a>
                </nav>
            `;
        }
    }

    applyBranding();

    // === Theme Toggle ===
    const themeBtn = document.getElementById('theme-toggle');
    const themeIcon = document.getElementById('theme-icon');

    const sunPath = 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z';
    const moonPath = 'M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z';

    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)');
    const savedTheme = localStorage.getItem('theme');
    let isDark = savedTheme ? savedTheme === 'dark' : prefersDark.matches;

    const applyTheme = (dark, animate = true) => {
        document.body.setAttribute('data-theme', dark ? 'dark' : 'light');
        localStorage.setItem('theme', dark ? 'dark' : 'light');

        const metaTheme = document.querySelector('meta[name="theme-color"]');
        if (metaTheme) metaTheme.content = dark ? '#000000' : '#f5f5f7';

        if (themeIcon) {
            const pathNode = themeIcon.querySelector('path');
            if (pathNode) {
                pathNode.setAttribute('d', dark ? sunPath : moonPath);
            }

            if (animate && typeof gsap !== 'undefined') {
                gsap.fromTo(themeIcon,
                    { rotation: 0, scale: 0.8 },
                    { rotation: 360, scale: 1, duration: 0.6, ease: 'power2.out' }
                );
            }
        }
    };

    applyTheme(isDark, false);

    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            isDark = !isDark;
            applyTheme(isDark);
        });
    }

    prefersDark.addEventListener('change', (e) => {
        isDark = e.matches;
        applyTheme(isDark, true);
    });

    // === Hero Entrance Animation ===
    const heroTitle = document.querySelector('.hero-title');
    const heroSubtitle = document.querySelector('.hero-subtitle');
    const heroCta = document.querySelector('.hero-cta');
    const heroDate = document.querySelector('.hero-date');

    if (heroTitle && typeof gsap !== 'undefined') {
        const heroElements = [heroDate, heroTitle, heroSubtitle, heroCta].filter(Boolean);
        gsap.set(heroElements, { opacity: 0, y: 30 });

        const tl = gsap.timeline({ defaults: { ease: 'power4.out', duration: 1.2 } });

        if (heroDate) tl.to(heroDate, { opacity: 1, y: 0, delay: 0.2 });
        tl.to(heroTitle, { opacity: 1, y: 0 }, heroDate ? '-=0.9' : '+=0.2');
        if (heroSubtitle) tl.to(heroSubtitle, { opacity: 0.85, y: 0 }, '-=0.9');
        if (heroCta) tl.to(heroCta, { opacity: 1, y: 0 }, '-=0.9');

        // Logo click replays hero animation
        const logoRefresh = document.getElementById('logo-refresh');
        if (logoRefresh) {
            logoRefresh.addEventListener('click', (e) => {
                e.preventDefault();
                gsap.set(heroElements, { opacity: 0, y: 30 });
                tl.restart();
            });
        }
    }

    // === Scroll-Triggered Reveals ===
    function initScrollReveals() {
        if (typeof gsap === 'undefined') return;

        const cards = document.querySelectorAll('.card, .archive-card');
        const sectionLabels = document.querySelectorAll('.section-label');

        gsap.set(cards, { opacity: 0, y: 20 });
        gsap.set(sectionLabels, { opacity: 0 });

        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const el = entry.target;

                    if (el.classList.contains('section-label')) {
                        gsap.to(el, { opacity: 1, duration: 0.6, ease: 'power4.out' });
                    } else {
                        gsap.to(el, {
                            opacity: 1,
                            y: 0,
                            duration: 0.8,
                            ease: 'power4.out',
                            delay: parseFloat(el.dataset.delay) || 0
                        });
                    }

                    observer.unobserve(el);
                }
            });
        }, { threshold: 0.1 });

        cards.forEach((card, i) => {
            card.dataset.delay = i * 0.1;
            observer.observe(card);
        });

        sectionLabels.forEach(el => observer.observe(el));
    }

    // Run scroll reveals after DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initScrollReveals);
    } else {
        initScrollReveals();
    }

    // Expose for use by other scripts
    window.SikorskiTheme = {
        isDark: () => isDark,
        toggle: () => { isDark = !isDark; applyTheme(isDark); }
    };

})();
