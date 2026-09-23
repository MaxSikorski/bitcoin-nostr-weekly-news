// config.js — the ONLY branding file for this site. Per-site: never copied to the sister site.
// Every engine file (index.html, week.html, script.js, presenter.js, styles.css) is identical across
// sites and reads its words, links and colors from here. Edit this, never the engine.
window.SITE_CONFIG = {
    siteName: "Bitcoin Meetup",
    weeklyName: "Bitcoin & Nostr Weekly",
    pageTitles: {
        index: "Bitcoin Meetup — Weekly Presentations",
        week: "Bitcoin Meetup — Presentation"
    },
    metaDescription: {
        index: "Weekly Bitcoin and Nostr news and discussion topics for our meetup group.",
        week: "Weekly Bitcoin and Nostr presentation."
    },
    heroTitleHtml: "Bitcoin &amp; Nostr<br>Weekly",
    heroSubtitle: "News, policy, and discussion topics curated for our weekly meetup.",
    deckSubtitle: "Weekly Bitcoin & Nostr news and discussion",
    favicons: [
        { rel: "icon", href: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>₿</text></svg>" }
    ],
    navLinks: [],
    extraScripts: [],
    hostName: "Max Sikorski",
    contactEmail: ["bitcoinmax.7l388b", "bumpmail.io"],
    mail: {
        workWithSubject: "Bitcoin & Nostr Weekly — Work With You",
        workWithBody: "Hi Max,\n\nI'd like to talk about working together — wallet security / self-custody / Nostr / a project.\n\n",
        topicSubject: "Bitcoin & Nostr Weekly — interested in: {topic}",
        topicBody: "Hi Max,\n\nI was going through this week's Bitcoin & Nostr Weekly and I'm interested in \"{topic}\".\n\n",
        generalSubject: "Bitcoin & Nostr Weekly — getting in touch",
        generalBody: "Hi Max,\n\nI came across Bitcoin & Nostr Weekly and wanted to get in touch.\n\n"
    },
    connect: {
        blurbHtml: "Bitcoin &amp; Nostr Weekly — self-custody help · wallet security checkups · Nostr onboarding. Subscribe, say hi, or grab time with me below.",
        links: [
            { label: "YouTube", href: "https://www.youtube.com/@maxwellsikorski4926" },
            { label: "GitHub", href: "https://github.com/MaxSikorski" },
            { label: "Buzz", href: "https://buzz.xyz/" },
            { label: "Schedule a Chat", href: "https://cal.com/maxsikorski" }
        ],
        workWithLabel: "Work With Me",
        qrHref: "https://cal.com/maxsikorski"
    },
    footer: null,
    // Likes: LIVE on Nostr (2026-09-23, W39). A like = a kind-7 reaction to this site's
    // per-topic anchor events on Max's Buzz relay; the shared site key publishes anchors via
    // ../tools/likes_admin.py. Same relay + key as 3D Printing Weekly; the "btcnw" tag
    // prefix keeps the two sites' counts apart. Relay URL lives ONLY here.
    likes: {
        adapter: "nostr",
        relay: "wss://buzz-production-7d9e.up.railway.app",
        sitePubkey: "0daf0fbd4c54dbeccb22e21feffbb8faeb1db0c8f72077135aa33e57cacde4ac",
        tagPrefix: "btcnw"
    },
    accents: {
        bitcoin: "#f7931a",
        nostr: "#a06af9"
    },
    halo: ["#f7931a", "#a06af9"],
    liveAccent: "#f7931a",
    archive: { openMonths: 0 }   // every month collapsed by default (Max, 2026-09-23)
};
