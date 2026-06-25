"use client";

/**
 * plugin/ai-chat/ui/chat.tsx
 *
 * Floating AI chat popup widget.
 * Injected into the root layout via the "root.root" hook.
 *
 * Props (all come from settings passed by the layout):
 *   settings — the flat CMS settings map
 *
 * Features:
 *   • Floating button positioned left / center / right
 *   • Optional tooltip text next to the button
 *   • Animated chat popup (slide-up)
 *   • Conversation history sent to /api/ai-chat (server-side proxy)
 *   • Auto-detects language from user input and replies in kind
 *   • Product suggestion / comparison support via site info context
 *   • Max 300 words response (configurable)
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

// ── Markdown-light renderer (bold, newlines) ──────────────────────────────────
function renderContent(text: string) {
    // Split by newline, bold **text** inside each line
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

export default function AiChatWidget({ settings = {} }: Props) {
    const enabled       = settings.ai_chat_enabled !== "0";
    const position      = (settings.ai_chat_position as string) || "right";
    const bubbleIcon    = (settings.ai_chat_bubble_icon as string) || "solar:chat-round-bold";
    const bubbleColor   = (settings.ai_chat_bubble_color as string) || "#10b981";
    const bubbleText    = (settings.ai_chat_bubble_text as string) ?? "Chat with us";
    const popupTitle    = (settings.ai_chat_popup_title as string) || "AI Assistant";
    const popupSubtitle = (settings.ai_chat_popup_subtitle as string) || "Ask me anything!";
    const welcomeMsg    = (settings.ai_chat_welcome_message as string) || "Hi! How can I help you today?";

    const [open, setOpen]           = useState(false);
    const [input, setInput]         = useState("");
    const [messages, setMessages]   = useState<Message[]>([]);
    const [loading, setLoading]     = useState(false);
    const [error, setError]         = useState("");
    const bottomRef                 = useRef<HTMLDivElement>(null);
    const inputRef                  = useRef<HTMLInputElement>(null);

    // Init welcome message on first open
    useEffect(() => {
        if (open && messages.length === 0 && welcomeMsg) {
            setMessages([{ role: "assistant", content: welcomeMsg }]);
        }
    }, [open, welcomeMsg, messages.length]);

    // Auto-scroll to bottom
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [messages, loading]);

    // Focus input on open
    useEffect(() => {
        if (open) setTimeout(() => inputRef.current?.focus(), 120);
    }, [open]);

    const sendMessage = useCallback(async () => {
        const text = input.trim();
        if (!text || loading) return;

        const userMsg: Message = { role: "user", content: text };
        const next = [...messages, userMsg];
        setMessages(next);
        setInput("");
        setLoading(true);
        setError("");

        try {
            // Collect page context from visible headings + meta description
            let pageContext = "";
            if (typeof document !== "undefined") {
                const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "";
                const h1 = document.querySelector("h1")?.textContent ?? "";
                const title = document.title ?? "";
                pageContext = [title, h1, metaDesc].filter(Boolean).join(" | ");
            }

            const res = await fetch("/api/ai-chat", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    messages: next.map((m) => ({ role: m.role, content: m.content })),
                    pageContext,
                }),
            });

            const data = await res.json() as { reply?: string; error?: string };

            if (!res.ok || data.error) {
                setError(data.error ?? "Something went wrong. Please try again.");
                setLoading(false);
                return;
            }

            setMessages((prev) => [...prev, { role: "assistant", content: data.reply ?? "" }]);
        } catch {
            setError("Network error. Please check your connection.");
        } finally {
            setLoading(false);
        }
    }, [input, loading, messages]);

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    };

    if (!enabled) return null;

    // ── Position classes ──────────────────────────────────────────────────────
    const positionCls =
        position === "left"
            ? "left-4 sm:left-6"
            : position === "center"
            ? "left-1/2 -translate-x-1/2"
            : "right-4 sm:right-6";

    const popupAlign =
        position === "left"
            ? "left-0"
            : position === "center"
            ? "left-1/2 -translate-x-1/2"
            : "right-0";

    return (
        <div className={`fixed bottom-4 sm:bottom-6 z-50 flex flex-col items-end gap-2 ${positionCls}`}>
            {/* ── Chat popup ─────────────────────────────────────────────── */}
            {open && (
                <div
                    className={`absolute bottom-full mb-3 w-[340px] sm:w-[380px] bg-white rounded-2xl shadow-2xl border border-gray-200 flex flex-col overflow-hidden ${popupAlign}`}
                    style={{ maxHeight: "520px" }}
                >
                    {/* Header */}
                    <div
                        className="flex items-center justify-between px-4 py-3"
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
                        <button
                            type="button"
                            onClick={() => setOpen(false)}
                            className="w-7 h-7 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center text-white transition"
                            aria-label="Close chat"
                        >
                            <Icon icon="mdi:close" width={16} />
                        </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 bg-gray-50" style={{ minHeight: 0 }}>
                        {messages.map((msg, idx) => (
                            <div
                                key={idx}
                                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                            >
                                {msg.role === "assistant" && (
                                    <div
                                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mr-2 mt-0.5"
                                        style={{ backgroundColor: bubbleColor }}
                                    >
                                        <Icon icon={bubbleIcon} width={14} className="text-white" />
                                    </div>
                                )}
                                <div
                                    className={`max-w-[80%] px-3 py-2 rounded-2xl text-sm leading-relaxed ${
                                        msg.role === "user"
                                            ? "text-white rounded-br-sm"
                                            : "bg-white text-gray-800 border border-gray-200 rounded-bl-sm shadow-sm"
                                    }`}
                                    style={msg.role === "user" ? { backgroundColor: bubbleColor } : {}}
                                >
                                    {renderContent(msg.content)}
                                </div>
                            </div>
                        ))}

                        {/* Loading dots */}
                        {loading && (
                            <div className="flex justify-start">
                                <div
                                    className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 mr-2"
                                    style={{ backgroundColor: bubbleColor }}
                                >
                                    <Icon icon={bubbleIcon} width={14} className="text-white" />
                                </div>
                                <div className="bg-white border border-gray-200 rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                                    <div className="flex gap-1 items-center h-4">
                                        {[0, 1, 2].map((i) => (
                                            <span
                                                key={i}
                                                className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce"
                                                style={{ animationDelay: `${i * 0.15}s` }}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="text-xs text-red-500 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                                {error}
                            </div>
                        )}

                        <div ref={bottomRef} />
                    </div>

                    {/* Input */}
                    <div className="px-3 py-3 border-t border-gray-100 bg-white">
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

            {/* ── Floating button ────────────────────────────────────────── */}
            <div className={`flex items-center gap-2 ${position === "left" ? "" : "flex-row-reverse"}`}>
                {bubbleText && !open && (
                    <span
                        className="hidden sm:block text-xs font-medium text-white px-3 py-1.5 rounded-full shadow-md animate-fade-in"
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
        </div>
    );
}
