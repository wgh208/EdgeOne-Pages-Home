(function () {
    "use strict";

    const CONFIG = {
        // 一言接口：可替换为你自己的接口，返回字段需包含 hitokoto / from
        hitokotoUrl: "https://v1.hitokoto.cn/?c=a&c=b&c=c&c=d&c=e&c=f&c=g&max_length=32&_=",
        typingSpeed: 80,
        deletingSpeed: 40,
        stayTime: 12000,
        requestTimeout: 8000,
        fallbackQuotes: [
            { hitokoto: "人间忽晚，山河已秋。", from: "人间忽晚" },
            { hitokoto: "风来疏竹，风过而竹不留声。", from: "菜根谭" },
            { hitokoto: "人生若只如初见，何事秋风悲画扇。", from: "纳兰性德" },
            { hitokoto: "山有木兮木有枝，心悦君兮君不知。", from: "越人歌" }
        ]
    };

    const quoteText = document.getElementById("hitokoto-text");
    const quoteFrom = document.getElementById("hitokoto-from");
    const year = document.getElementById("year");
    const avatar = document.querySelector(".avatar");

    let pendingQuote = null;
    let prefetching = false;
    let stayTimer = null;
    let typeTimer = null;
    let eraseTimer = null;

    if (year) {
        year.textContent = new Date().getFullYear();
    }

    function randomFallback() {
        return CONFIG.fallbackQuotes[Math.floor(Math.random() * CONFIG.fallbackQuotes.length)];
    }

    async function fetchQuote() {
        const controller = new AbortController();
        const timer = setTimeout(function () {
            controller.abort();
        }, CONFIG.requestTimeout);

        try {
            const response = await fetch(CONFIG.hitokotoUrl + Date.now(), {
                signal: controller.signal,
                cache: "no-store"
            });
            if (!response.ok) {
                throw new Error("HTTP " + response.status);
            }
            const data = await response.json();
            return data && data.hitokoto ? data : null;
        } catch (error) {
            if (error && error.name !== "AbortError") {
                console.error("Failed to fetch hitokoto:", error);
            }
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    function prefetch() {
        if (pendingQuote || prefetching) {
            return;
        }
        prefetching = true;
        fetchQuote().then(function (quote) {
            if (quote) {
                pendingQuote = quote;
            }
        }).finally(function () {
            prefetching = false;
        });
    }

    function typeText(text, done) {
        quoteText.textContent = "";
        let index = 0;

        function type() {
            if (index < text.length) {
                quoteText.textContent += text.charAt(index);
                index += 1;
                typeTimer = setTimeout(type, CONFIG.typingSpeed);
            } else if (done) {
                done();
            }
        }

        type();
    }

    function eraseText(done) {
        let text = quoteText.textContent;

        function erase() {
            if (text.length > 0) {
                text = text.slice(0, -1);
                quoteText.textContent = text;
                eraseTimer = setTimeout(erase, CONFIG.deletingSpeed);
            } else if (done) {
                done();
            }
        }

        erase();
    }

    function showQuote(quote) {
        quoteFrom.classList.remove("is-visible");
        typeText(quote.hitokoto, function () {
            quoteFrom.textContent = "-「" + (quote.from || "佚名") + "」";
            quoteFrom.classList.add("is-visible");
            stayTimer = setTimeout(function () {
                quoteFrom.classList.remove("is-visible");
                eraseText(function () {
                    const next = pendingQuote || randomFallback();
                    pendingQuote = null;
                    showQuote(next);
                    prefetch();
                });
            }, CONFIG.stayTime);
        });
    }

    function toggleFullscreen() {
        const doc = document;
        const root = doc.documentElement;
        const fullscreenElement = doc.fullscreenElement || doc.webkitFullscreenElement ||
            doc.mozFullScreenElement || doc.msFullscreenElement;

        if (fullscreenElement) {
            const exit = doc.exitFullscreen || doc.webkitExitFullscreen ||
                doc.mozCancelFullScreen || doc.msExitFullscreen;
            if (exit) {
                const result = exit.call(doc);
                if (result && typeof result.catch === "function") {
                    result.catch(function () {});
                }
            }
            return;
        }

        const request = root.requestFullscreen || root.webkitRequestFullscreen ||
            root.mozRequestFullScreen || root.msRequestFullscreen;
        if (request) {
            try {
                const result = request.call(root);
                if (result && typeof result.catch === "function") {
                    result.catch(function () {});
                }
            } catch (error) {
                // Fullscreen may be blocked by browser policy.
            }
        }
    }

    if (avatar) {
        avatar.addEventListener("click", function (event) {
            event.preventDefault();
            toggleFullscreen();
        });
    }

    if (quoteText && quoteFrom) {
        fetchQuote().then(function (quote) {
            showQuote(quote || randomFallback());
            prefetch();
        });
    }

    window.addEventListener("pagehide", function () {
        clearTimeout(stayTimer);
        clearTimeout(typeTimer);
        clearTimeout(eraseTimer);
    });
})();
