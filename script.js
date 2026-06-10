/* ============================================================
   Sikorski Design System — Shared Script
   Theme toggle, GSAP hero animation, scroll reveals
   ============================================================ */

(function () {
    'use strict';

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
