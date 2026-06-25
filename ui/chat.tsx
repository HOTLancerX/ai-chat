"use client";

/**
 * plugin/ai-chat/ui/chat.tsx
 *
 * Floating AI chat popup widget.
 * Single responsive design — one set of markup, CSS handles mobile vs desktop.
 *
 * Position logic (assistant messages):
 *   • "left"  → icon LEFT,  bubble RIGHT
 *   • "right" → icon RIGHT, bubble LEFT
 *
 * Mobile (< sm): full-screen panel, floating button stays visible as close
 * Desktop (≥ sm): floating popup above the button
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Icon } from "@iconify/react";

interface Message {
    role: "user" | "assistant";
    content: string;
}

interface Props {
    settings?: Record<string, any>;
}

function renderContent(text: string) {
    return text.split("\n").map((line, i) => {
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return (
            <span key={i}>
                {i > 0 && <br />}
                {parts.map((part, j) =>
                    part.startsWith("**") && part.endsWith("**") ? (
                        <strong key={j}>{part.slice(2, -2)}</strong>
                    ) : (
                        part
                    )
                )}
            </span>
        );
    });
}

function TypingIndicator({ color, icon, isLeft }: { color: string; icon: string; isLeft: boolean }) {
    return (
        <div className={`flex items-end gap-2 ${isLeft ? "flex-row-reverse justify-end" : "flex-row"}`}>
            <div
                className="w-6 h-6 rounded-full flex items-center justify-center shrink-0"
                style={{ backgroundColor: color }}
            >
                <Icon icon={icon} width={14} className="text-white" />
            </div>
            <div
                className="bg-white border border-gray-200 rounded-2xl px-4 py-3 shadow-sm"
                style={isLeft ? { borderRadius: "16px 16px 16px 4px" } : { borderRadius: "16px 16px 4px 16px" }}
            >
                <div className="flex items-center gap-1.5">
                    <span className="text-xs text-gray-500 mr-1">typing</span>
                    {[0, 1, 2].map((i) => (
                        <span
                            key={i}
                            className="w-1.5 h-1.5 rounded-full animate-bounce"
                            style={{
                                backgroundColor: color,
                                opacity: 0.6,
                                animationDelay: `${i * 0.2}s`,
                                animationDuration: "0.8s",
                            }}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1500, 3000, 5000];
const STORAGE_KEY = "ai-chat-messages";

function loadMessages(): Message[] {
    if (typeof window === "undefined") return [];
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function saveMessages(msgs: Message[]) {
    if (typeof window === "undefined") return;
    try {
        if (msgs.length === 0) {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(msgs));
        }
    } catch { /* quota exceeded — ignore */ }
}

export default function AiChatWidget({ settings = {} }: Props) {
    const enabled       = settings.ai_chat_enabled !== "0";
    const position      = (settings.ai_chat_position as string) || "right";
    const bubbleIcon    = (settings.ai_chat_bubble_icon as string) || "solar:chat-round-bold";
    const bubbleColor   = (settings.ai_chat_bubble_color as string) || "#10b981";
    const bubbleText    = (settings.ai_chat_bubble_text as string) ?? "Chat with us";
    const popupTitle    = (settings.ai_chat_popup_title as string) || "AI Assistant";
    const popupSubtitle = (settings.ai_chat_popup_subtitle as string) || "Ask me anything!";
    const welcomeMsg    = (settings.ai_chat_welcome_message as string) || "Hi! How can I help you today?";
    const bottomOffset  = parseInt(settings.ai_chat_bottom_offset as string ?? "16", 10) || 16;
    const sideOffset    = parseInt(settings.ai_chat_side_offset as string ?? "16", 10) || 16;

    const [open, setOpen]           = useState(false);
    const [input, setInput]         = useState("");
    const [messages, setMessages]   = useState<Message[]>(loadMessages);
    const [loading, setLoading]     = useState(false);
    const [error, setError]         = useState("");
    const bottomRef                 = useRef<HTMLDivElement>(null);
    const inputRef                  = useRef<HTMLInputElement>(null);
    const abortRef                  = useRef<AbortController | null>(null);

    const isLeft = position === "left";

    // Persist messages to localStorage on every change
    useEffect(() => {
        saveMessages(messages);
    }, [messages]);

    // Add welcome message only if no saved messages exist
    useEffect(() => {
        if (open && messages.length === 0 && welcomeMsg) {
            setMessages([{ role: "assistant", content: welcomeMsg }]);
        }
    }, [open, welcomeMsg, messages.length]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    // Auto-focus input on open — reliable even on mobile
    useEffect(() => {
        if (open) {
            requestAnimationFrame(() => {
                inputRef.current?.focus();
            });
        }
    }, [open]);

    const resetChat = useCallback(() => {
        abortRef.current?.abort();
        setMessages([]);
        setError("");
        setLoading(false);
    }, []);

    const sendMessage = useCallback(async () => {
        const text = input.trim();
        if (!text || loading) return;

        const userMsg: Message = { role: "user", content: text };
        const next = [...messages, userMsg];
        setMessages(next);
        setInput("");
        setLoading(true);
        setError("");

        let pageContext = "";
        if (typeof document !== "undefined") {
            const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
            const h1 = document.querySelector("h1")?.textContent ?? "";
            const title = document.title ?? "";
            pageContext = [title, h1, metaDesc].filter(Boolean).join(" | ");
        }

        let lastError = "";

        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            abortRef.current?.abort();
            const controller = new AbortController();
            abortRef.current = controller;

            try {
                const res = await fetch("/api/ai-chat", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    signal: controller.signal,
                    body: JSON.stringify({
                        messages: next.map((m) => ({ role: m.role, content: m.content })),
                        pageContext,
                    }),
                });

                const data = await res.json() as { reply?: string; error?: string };

                if (res.ok && !data.error && data.reply) {
                    setMessages((prev) => [...prev, { role: "assistant", content: data.reply! }]);
                    setLoading(false);
                    return;
                }

                lastError = data.error ?? `Server error (HTTP ${res.status})`;
                if (res.status < 500) break;
            } catch (err: any) {
                if (err?.name === "AbortError") {
                    setLoading(false);
                    return;
                }
                lastError = "Network error. Please check your connection.";
            }

            if (attempt < MAX_RETRIES) {
                await new Promise((r) => setTimeout(r, RETRY_DELAYS[attempt]));
            }
        }

        setError(lastError || "Something went wrong. Please try again.");
        setLoading(false);
    }, [input, loading, messages]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    if (!enabled) return null;

    return (
        <>
            {/* ── Chat panel ──────────────────────────────────────────────── */}
            {open && (
                <div
                    className={`
                        fixed inset-0 z-55
                        sm:inset-auto
                        sm:w-[380px] sm:max-h-[520px]
                        sm:rounded-2xl sm:shadow-2xl sm:border sm:border-gray-200
                        bg-white
                        flex flex-col overflow-hidden
                    `}
                    style={
                        typeof window !== "undefined" && window.innerWidth >= 640
                            ? {
                                ...(isLeft ? { left: sideOffset } : { right: sideOffset }),
                                bottom: bottomOffset + 72,
                            }
                            : undefined
                    }
                >
                    {/* Header */}
                    <div
                        className="flex items-center justify-between px-4 py-3 shrink-0"
                        style={{ backgroundColor: bubbleColor }}
                    >
                        <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-full bg-white/20 flex items-center justify-center">
                                <Icon icon={bubbleIcon} width={20} className="text-white" />
                            </div>
                            <div>
                                <p className="text-sm font-bold text-white leading-tight">{popupTitle}</p>
                                <p className="text-xs text-white/80 leading-tight">{popupSubtitle}</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={resetChat}
                                className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition"
                                title="Reset chat"
                                aria-label="Reset chat"
                            >
                                <Icon icon="solar:refresh-bold" width={14} />
                            </button>
                            <button
                                type="button"
                                onClick={() => setOpen(false)}
                                className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition"
                                aria-label="Close chat"
                            >
                                <Icon icon="mdi:close" width={16} />
                            </button>
                        </div>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50" style={{ minHeight: 0 }}>
                        {messages.map((msg, idx) => {
                            if (msg.role === "user") {
                                return (
                                    <div key={idx} className="flex justify-end">
                                        <div
                                            className="max-w-[80%] px-3 py-2 text-sm leading-relaxed text-white"
                                            style={{ backgroundColor: bubbleColor, borderRadius: "16px 16px 4px 16px" }}
                                        >
                                            {renderContent(msg.content)}
                                        </div>
                                    </div>
                                );
                            }
                            return (
                                <div key={idx} className={`flex items-start gap-2 ${isLeft ? "flex-row-reverse justify-end" : "flex-row"}`}>
                                    <div
                                        className="w-6 h-6 mt-2 rounded-full flex items-center justify-center shrink-0"
                                        style={{ backgroundColor: bubbleColor }}
                                    >
                                        <Icon icon={bubbleIcon} width={14} className="text-white" />
                                    </div>
                                    <div
                                        className="max-w-[80%] px-3 py-2 bg-white text-gray-800 border border-gray-200 text-sm leading-relaxed shadow-sm"
                                        style={isLeft ? { borderRadius: "16px 16px 16px 4px" } : { borderRadius: "16px 16px 4px 16px" }}
                                    >
                                        {renderContent(msg.content)}
                                    </div>
                                </div>
                            );
                        })}

                        {loading && (
                            <TypingIndicator color={bubbleColor} icon={bubbleIcon} isLeft={isLeft} />
                        )}

                        {error && !loading && (
                            <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                {error}
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>

                    {/* Input */}
                    <div className="px-3 py-3 border-t border-gray-100 bg-white shrink-0">
                        <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-xl px-3 py-1.5">
                            <input
                                ref={inputRef}
                                type="text"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="Type a message…"
                                disabled={loading}
                                className="flex-1 bg-transparent text-sm outline-none placeholder-gray-400 disabled:opacity-60"
                            />
                            <button
                                type="button"
                                onClick={sendMessage}
                                disabled={!input.trim() || loading}
                                className="w-7 h-7 rounded-lg flex items-center justify-center text-white transition disabled:opacity-40"
                                style={{ backgroundColor: bubbleColor }}
                                aria-label="Send message"
                            >
                                <Icon icon="solar:arrow-up-bold" width={14} />
                            </button>
                        </div>
                        <p className="text-center text-xs text-gray-400 mt-1.5">Powered by AI</p>
                    </div>
                </div>
            )}

            {/* ── Floating button ──────────────────────────────────────────── */}
            {/* Mobile: hidden when chat is open — tap the header close or use back */}
            {/* Desktop: always visible                                        */}
            <div
                className={`fixed z-60 flex items-center gap-2 ${open ? "hidden md:flex" : "flex"}`}
                style={{ bottom: bottomOffset, ...(isLeft ? { left: sideOffset } : { right: sideOffset }) }}
            >
                {bubbleText && !open && (
                    <span
                        className="hidden md:block text-xs font-medium text-white px-3 py-1.5 rounded-full shadow-md"
                        style={{ backgroundColor: bubbleColor }}
                    >
                        {bubbleText}
                    </span>
                )}
                <button
                    type="button"
                    onClick={() => setOpen((v) => !v)}
                    className="w-14 h-14 rounded-full shadow-xl flex items-center justify-center text-white transition-transform hover:scale-105 active:scale-95"
                    style={{ backgroundColor: bubbleColor }}
                    aria-label={open ? "Close chat" : "Open chat"}
                    aria-expanded={open}
                >
                    <Icon
                        icon={open ? "mdi:close" : bubbleIcon}
                        width={26}
                        className="transition-transform"
                    />
                </button>
            </div>
        </>
    );
}
