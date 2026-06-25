"use client";

/**
 * plugin/ai-chat/ui/settings.tsx
 *
 * Admin settings page for the AI Chat plugin.
 * Mounted at /admin/ai-chat/settings via addHook("admin.pages", ...) in index.ts.
 *
 * Settings saved:
 *   ai_chat_enabled          — master on/off switch
 *   ai_chat_position         — "left" | "center" | "right"
 *   ai_chat_bubble_icon      — Iconify icon id (e.g. "solar:chat-round-bold")
 *   ai_chat_bubble_color     — hex color string
 *   ai_chat_bubble_text      — tooltip / label text next to button
 *   ai_chat_popup_title      — title shown in the chat header
 *   ai_chat_popup_subtitle   — subtitle shown in the chat header
 *   ai_chat_welcome_message  — first bot message on open
 *   ai_chat_site_info        — free-text: info about your site / products the AI uses
 *   ai_chat_api_url          — API endpoint URL (e.g. https://api.openai.com/v1/chat/completions)
 *   ai_chat_api_key          — API key (Bearer token)
 *   ai_chat_model            — model name (e.g. gpt-4o-mini)
 *   ai_chat_max_words        — max response word limit (default 300)
 */

import { useState, useEffect } from "react";
import { Icon } from "@iconify/react";
import useSettings from "@/lib/useSettings";
import { xFetch } from "@/lib/express";

// ── Helpers ───────────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={value}
            onClick={() => onChange(!value)}
            className={`w-11 h-6 rounded-full transition-colors relative shrink-0 ${value ? "bg-emerald-500" : "bg-gray-200"}`}
        >
            <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition-transform ${value ? "translate-x-5" : "translate-x-0"}`} />
        </button>
    );
}

function Field({
    label,
    hint,
    value,
    onChange,
    type = "text",
    placeholder = "",
}: {
    label: string;
    hint?: string;
    value: string;
    onChange: (v: string) => void;
    type?: string;
    placeholder?: string;
}) {
    return (
        <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
            {hint && <p className="text-xs text-gray-500 mb-1.5">{hint}</p>}
            <input
                type={type}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
        </div>
    );
}

function TextareaField({
    label,
    hint,
    value,
    onChange,
    rows = 4,
    placeholder = "",
}: {
    label: string;
    hint?: string;
    value: string;
    onChange: (v: string) => void;
    rows?: number;
    placeholder?: string;
}) {
    return (
        <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">{label}</label>
            {hint && <p className="text-xs text-gray-500 mb-1.5">{hint}</p>}
            <textarea
                rows={rows}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={placeholder}
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-y"
            />
        </div>
    );
}

// ── Model selector with live-fetch ───────────────────────────────────────────

function ModelSelector({
    value,
    onChange,
}: {
    value: string;
    onChange: (v: string) => void;
}) {
    const [fetchedModels, setFetchedModels] = useState<string[]>([]);
    const [fetching, setFetching]           = useState(false);
    const [fetchError, setFetchError]       = useState("");
    const [showDropdown, setShowDropdown]   = useState(false);

    const fetchModels = async () => {
        setFetching(true);
        setFetchError("");
        try {
            const res  = await fetch("/api/ai-chat/models", { cache: "no-store" });
            const data = await res.json() as { models?: string[]; error?: string };
            if (!res.ok || data.error) {
                setFetchError(data.error ?? "Failed to fetch models.");
                return;
            }
            setFetchedModels(data.models ?? []);
            setShowDropdown(true);
        } catch {
            setFetchError("Network error while fetching models.");
        } finally {
            setFetching(false);
        }
    };

    return (
        <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1">Model Name</label>
            <p className="text-xs text-gray-500 mb-1.5">
                Type the model ID manually, or click <strong>Fetch Models</strong> to load
                available models from your configured API endpoint.
            </p>

            <div className="flex gap-2">
                <input
                    type="text"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="e.g. gpt-4o-mini"
                    className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
                <button
                    type="button"
                    onClick={fetchModels}
                    disabled={fetching}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg border border-gray-200 transition disabled:opacity-50 whitespace-nowrap"
                >
                    {fetching
                        ? <Icon icon="svg-spinners:ring-resize" width={14} />
                        : <Icon icon="solar:refresh-bold" width={14} />
                    }
                    Fetch Models
                </button>
            </div>

            {fetchError && (
                <p className="mt-1.5 text-xs text-red-500 flex items-center gap-1">
                    <Icon icon="mdi:alert-circle-outline" width={14} />
                    {fetchError}
                </p>
            )}

            {showDropdown && fetchedModels.length > 0 && (
                <div className="mt-2">
                    <p className="text-xs text-gray-500 mb-1.5">
                        {fetchedModels.length} model{fetchedModels.length !== 1 ? "s" : ""} found — click to select:
                    </p>
                    <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-56 overflow-y-auto shadow-sm">
                        {fetchedModels.map((m) => (
                            <button
                                key={m}
                                type="button"
                                onClick={() => { onChange(m); setShowDropdown(false); }}
                                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                                    value === m
                                        ? "bg-emerald-50 text-emerald-700 font-medium"
                                        : "hover:bg-gray-50 text-gray-700"
                                }`}
                            >
                                <span className="font-mono text-xs">{m}</span>
                                {value === m && (
                                    <Icon icon="mdi:check" width={14} className="inline ml-2 text-emerald-600" />
                                )}
                            </button>
                        ))}
                    </div>
                    <button
                        type="button"
                        onClick={() => setShowDropdown(false)}
                        className="mt-1.5 text-xs text-gray-400 hover:text-gray-600 transition"
                    >
                        Hide list
                    </button>
                </div>
            )}

            {showDropdown && fetchedModels.length === 0 && !fetching && (
                <p className="mt-1.5 text-xs text-gray-400">No models returned by the provider.</p>
            )}
        </div>
    );
}

// ── Preset icon options ───────────────────────────────────────────────────────

const ICON_PRESETS = [
    { id: "solar:chat-round-bold",           label: "Chat Round" },
    { id: "solar:chat-square-bold",          label: "Chat Square" },
    { id: "solar:dialog-bold",               label: "Dialog" },
    { id: "solar:message-bold",              label: "Message" },
    { id: "solar:bot-bold",                  label: "Bot" },
    { id: "solar:star-bold",                 label: "Star" },
    { id: "mdi:robot-happy-outline",         label: "Robot" },
    { id: "mdi:head-lightbulb-outline",      label: "Lightbulb" },
    { id: "mdi:comment-question-outline",    label: "Question" },
    { id: "mdi:face-agent",                  label: "Agent" },
];

const POSITION_OPTIONS = [
    { value: "left",   label: "Left",   icon: "mdi:dock-left" },
    { value: "center", label: "Center", icon: "mdi:dock-bottom" },
    { value: "right",  label: "Right",  icon: "mdi:dock-right" },
];

// ── Test Connection component ─────────────────────────────────────────────────

function TestConnection() {
    const [status,  setStatus]  = useState<"idle" | "testing" | "ok" | "fail">("idle");
    const [result,  setResult]  = useState<{ reply?: string; error?: string; model?: string; apiUrl?: string } | null>(null);

    const runTest = async () => {
        setStatus("testing");
        setResult(null);
        try {
            const res  = await fetch("/api/ai-chat/test", { cache: "no-store" });
            const data = await res.json() as { ok: boolean; reply?: string; error?: string; model?: string; apiUrl?: string };
            setResult(data);
            setStatus(data.ok ? "ok" : "fail");
        } catch (e) {
            setResult({ error: "Network error — could not reach /api/ai-chat/test" });
            setStatus("fail");
        }
    };

    return (
        <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
                <div>
                    <p className="text-sm font-semibold text-gray-800">Test Connection</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                        Sends a test message using your saved API URL, key and model.
                        Save settings first before testing.
                    </p>
                </div>
                <button
                    type="button"
                    onClick={runTest}
                    disabled={status === "testing"}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-semibold rounded-lg transition disabled:opacity-50"
                >
                    {status === "testing"
                        ? <><Icon icon="svg-spinners:ring-resize" width={16} /> Testing…</>
                        : <><Icon icon="solar:play-bold" width={16} /> Test Now</>
                    }
                </button>
            </div>

            {/* Result */}
            {status === "ok" && result && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-700 font-semibold text-sm">
                        <Icon icon="solar:check-circle-bold" width={18} />
                        Connection successful
                    </div>
                    <div className="text-xs text-emerald-700 space-y-1">
                        <p><span className="font-medium">Model:</span> <code className="font-mono">{result.model}</code></p>
                        <p><span className="font-medium">URL:</span> <code className="font-mono break-all">{result.apiUrl}</code></p>
                    </div>
                    <div className="mt-2 bg-white border border-emerald-200 rounded-lg px-3 py-2 text-sm text-gray-700">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1">AI reply</span>
                        {result.reply}
                    </div>
                </div>
            )}

            {status === "fail" && result && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4 space-y-2">
                    <div className="flex items-center gap-2 text-red-700 font-semibold text-sm">
                        <Icon icon="solar:close-circle-bold" width={18} />
                        Connection failed
                    </div>
                    {result.model && (
                        <p className="text-xs text-red-600">
                            <span className="font-medium">Model used:</span> <code className="font-mono">{result.model}</code>
                        </p>
                    )}
                    {result.apiUrl && (
                        <p className="text-xs text-red-600">
                            <span className="font-medium">URL:</span> <code className="font-mono break-all">{result.apiUrl}</code>
                        </p>
                    )}
                    <div className="mt-1 bg-white border border-red-200 rounded-lg px-3 py-2 text-sm text-red-700">
                        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide block mb-1">Error</span>
                        {result.error}
                    </div>
                    <p className="text-xs text-red-600 mt-1">
                        Tip: Make sure the model name matches exactly what your provider supports. Use <strong>Fetch Models</strong> above to get the correct names.
                    </p>
                </div>
            )}
        </div>
    );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AiChatSettingsPage() {
    const { settings, loading } = useSettings();

    // ── State ─────────────────────────────────────────────────────────────────
    const [enabled,        setEnabled]        = useState(true);
    const [position,       setPosition]       = useState("right");
    const [bubbleIcon,     setBubbleIcon]      = useState("solar:chat-round-bold");
    const [bubbleColor,    setBubbleColor]     = useState("#10b981");
    const [bubbleText,     setBubbleText]      = useState("Chat with us");
    const [popupTitle,     setPopupTitle]      = useState("AI Assistant");
    const [popupSubtitle,  setPopupSubtitle]   = useState("Ask me anything!");
    const [welcomeMsg,     setWelcomeMsg]      = useState("Hi! How can I help you today?");
    const [siteInfo,       setSiteInfo]        = useState("");
    const [apiUrl,         setApiUrl]          = useState("https://api.openai.com/v1/chat/completions");
    const [apiKey,         setApiKey]          = useState("");
    const [modelName,      setModelName]       = useState("gpt-4o-mini");
    const [maxWords,       setMaxWords]        = useState("300");
    const [bottomOffset,   setBottomOffset]    = useState("16");
    const [sideOffset,     setSideOffset]      = useState("16");

    const [saving,  setSaving]  = useState(false);
    const [message, setMessage] = useState("");
    const [activeTab, setActiveTab] = useState<"appearance" | "content" | "api">("appearance");

    // ── Sync from DB settings ─────────────────────────────────────────────────
    useEffect(() => {
        if (loading) return;
        setEnabled(settings.ai_chat_enabled !== "0");
        if (settings.ai_chat_position)       setPosition(settings.ai_chat_position);
        if (settings.ai_chat_bubble_icon)    setBubbleIcon(settings.ai_chat_bubble_icon);
        if (settings.ai_chat_bubble_color)   setBubbleColor(settings.ai_chat_bubble_color);
        if (settings.ai_chat_bubble_text != null) setBubbleText(settings.ai_chat_bubble_text);
        if (settings.ai_chat_popup_title)    setPopupTitle(settings.ai_chat_popup_title);
        if (settings.ai_chat_popup_subtitle) setPopupSubtitle(settings.ai_chat_popup_subtitle);
        if (settings.ai_chat_welcome_message) setWelcomeMsg(settings.ai_chat_welcome_message);
        if (settings.ai_chat_site_info)      setSiteInfo(settings.ai_chat_site_info);
        if (settings.ai_chat_api_url)        setApiUrl(settings.ai_chat_api_url);
        if (settings.ai_chat_api_key)        setApiKey(settings.ai_chat_api_key);
        if (settings.ai_chat_model)          setModelName(settings.ai_chat_model);
        if (settings.ai_chat_max_words)      setMaxWords(settings.ai_chat_max_words);
        if (settings.ai_chat_bottom_offset)   setBottomOffset(settings.ai_chat_bottom_offset);
        if (settings.ai_chat_side_offset)     setSideOffset(settings.ai_chat_side_offset);
    }, [loading, settings]);

    // ── Save ──────────────────────────────────────────────────────────────────
    const handleSave = async () => {
        setSaving(true);
        setMessage("");
        try {
            const res = await xFetch("/settings", {
                method: "PUT",
                body: JSON.stringify({
                    ai_chat_enabled:         enabled ? "1" : "0",
                    ai_chat_position:        position,
                    ai_chat_bubble_icon:     bubbleIcon,
                    ai_chat_bubble_color:    bubbleColor,
                    ai_chat_bubble_text:     bubbleText,
                    ai_chat_popup_title:     popupTitle,
                    ai_chat_popup_subtitle:  popupSubtitle,
                    ai_chat_welcome_message: welcomeMsg,
                    ai_chat_site_info:       siteInfo,
                    ai_chat_api_url:         apiUrl,
                    ai_chat_api_key:         apiKey,
                    ai_chat_model:           modelName,
                    ai_chat_max_words:       maxWords,
                    ai_chat_bottom_offset:   bottomOffset,
                    ai_chat_side_offset:     sideOffset,
                }),
            });
            const data = await res.json();
            if (!res.ok) {
                setMessage(`Error: ${data.error ?? "Failed to save"}`);
            } else {
                setMessage("Settings saved!");
                setTimeout(() => setMessage(""), 3000);
            }
        } catch {
            setMessage("Network error");
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-24 text-gray-400">
                <Icon icon="svg-spinners:ring-resize" width={32} />
            </div>
        );
    }

    const TABS = [
        { key: "appearance", label: "Appearance", icon: "solar:palette-bold" },
        { key: "content",    label: "Content",    icon: "solar:document-text-bold" },
        { key: "api",        label: "API & Model", icon: "solar:settings-bold" },
    ] as const;

    return (
        <div className="space-y-6 max-w-3xl">
            {/* Header */}
            <p className="text-sm text-gray-500">Configure the floating AI chat widget shown on your public site.</p>

            {/* Master toggle */}
            <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm flex items-center justify-between">
                <div>
                    <p className="text-sm font-semibold text-gray-800">Enable AI Chat Widget</p>
                    <p className="text-xs text-gray-500 mt-0.5">Show the floating chat button on your site.</p>
                </div>
                <Toggle value={enabled} onChange={setEnabled} />
            </div>

            {/* Toast */}
            {message && (
                <div className={`rounded-lg px-4 py-3 text-sm font-medium border ${
                    message.startsWith("Error")
                        ? "bg-red-400/10 text-red-400 border-red-400/25"
                        : "bg-emerald-400/10 text-emerald-400 border-emerald-400/25"
                }`}>
                    {message}
                </div>
            )}

            {/* Tab bar */}
            <div className="border-b border-gray-200">
                <nav className="-mb-px flex gap-1">
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.key;
                        return (
                            <button
                                key={tab.key}
                                type="button"
                                onClick={() => setActiveTab(tab.key)}
                                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                                    isActive
                                        ? "border-emerald-500 text-emerald-600"
                                        : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                                }`}
                            >
                                <Icon icon={tab.icon} width={16} />
                                {tab.label}
                            </button>
                        );
                    })}
                </nav>
            </div>

            {/* ── Appearance Tab ─────────────────────────────────────────── */}
            {activeTab === "appearance" && (
                <div className="space-y-5">
                    {/* Button position */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
                        <p className="text-sm font-semibold text-gray-800">Button Position</p>
                        <p className="text-xs text-gray-500">Where the floating chat button appears on screen.</p>
                        <div className="flex gap-3">
                            {POSITION_OPTIONS.map((opt) => (
                                <button
                                    key={opt.value}
                                    type="button"
                                    onClick={() => setPosition(opt.value)}
                                    className={`flex-1 flex flex-col items-center gap-2 py-3 px-4 rounded-xl border text-sm font-medium transition-colors ${
                                        position === opt.value
                                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                            : "border-gray-200 text-gray-600 hover:border-emerald-300"
                                    }`}
                                >
                                    <Icon icon={opt.icon} width={24} />
                                    {opt.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Button offset */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
                        <p className="text-sm font-semibold text-gray-800">Button Offset</p>
                        <p className="text-xs text-gray-500">Distance from the edge of the screen (pixels). Same for mobile and desktop.</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Field
                                label="Bottom Offset (px)"
                                hint="Distance from the bottom edge."
                                value={bottomOffset}
                                onChange={setBottomOffset}
                                type="number"
                                placeholder="16"
                            />
                            <Field
                                label="Side Offset (px)"
                                hint="Distance from the left or right edge."
                                value={sideOffset}
                                onChange={setSideOffset}
                                type="number"
                                placeholder="16"
                            />
                        </div>
                    </div>

                    {/* Bubble icon */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
                        <p className="text-sm font-semibold text-gray-800">Button Icon</p>
                        <p className="text-xs text-gray-500">Select a preset or type any Iconify icon ID.</p>
                        <div className="flex flex-wrap gap-2 mb-3">
                            {ICON_PRESETS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    title={preset.label}
                                    onClick={() => setBubbleIcon(preset.id)}
                                    className={`p-2.5 rounded-xl border transition-colors ${
                                        bubbleIcon === preset.id
                                            ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                            : "border-gray-200 text-gray-500 hover:border-emerald-300"
                                    }`}
                                >
                                    <Icon icon={preset.id} width={22} />
                                </button>
                            ))}
                        </div>
                        <Field
                            label="Custom icon ID (Iconify)"
                            value={bubbleIcon}
                            onChange={setBubbleIcon}
                            placeholder="e.g. mdi:robot-outline"
                        />
                    </div>

                    {/* Bubble color + text */}
                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
                        <p className="text-sm font-semibold text-gray-800">Button Style</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-semibold text-gray-700 mb-1">Button Color</label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="color"
                                        value={bubbleColor}
                                        onChange={(e) => setBubbleColor(e.target.value)}
                                        className="w-10 h-10 rounded-lg border border-gray-200 cursor-pointer p-0.5"
                                    />
                                    <input
                                        type="text"
                                        value={bubbleColor}
                                        onChange={(e) => setBubbleColor(e.target.value)}
                                        className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                                        placeholder="#10b981"
                                    />
                                </div>
                            </div>
                            <Field
                                label="Tooltip / Label Text"
                                hint="Short text shown next to the button. Leave empty to hide."
                                value={bubbleText}
                                onChange={setBubbleText}
                                placeholder="Chat with us"
                            />
                        </div>

                        {/* Live preview */}
                        <div className="mt-2 p-4 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                            <p className="text-xs text-gray-400 mb-3">Preview</p>
                            <div className={`flex items-center gap-2 ${position === "left" ? "flex-row-reverse justify-end" : position === "center" ? "justify-center" : "flex-row justify-end"}`}>
                                {bubbleText && (
                                    <span className="text-xs font-medium text-white px-3 py-1.5 rounded-full shadow-md"
                                        style={{ backgroundColor: bubbleColor }}>
                                        {bubbleText}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    className="w-14 h-14 rounded-full shadow-lg flex items-center justify-center text-white"
                                    style={{ backgroundColor: bubbleColor }}
                                >
                                    <Icon icon={bubbleIcon || "solar:chat-round-bold"} width={26} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Content Tab ────────────────────────────────────────────── */}
            {activeTab === "content" && (
                <div className="space-y-5">
                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
                        <p className="text-sm font-semibold text-gray-800">Chat Window Text</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <Field
                                label="Popup Title"
                                value={popupTitle}
                                onChange={setPopupTitle}
                                placeholder="AI Assistant"
                            />
                            <Field
                                label="Popup Subtitle"
                                value={popupSubtitle}
                                onChange={setPopupSubtitle}
                                placeholder="Ask me anything!"
                            />
                        </div>
                        <Field
                            label="Welcome Message"
                            hint="The first message the bot shows when the chat opens."
                            value={welcomeMsg}
                            onChange={setWelcomeMsg}
                            placeholder="Hi! How can I help you today?"
                        />
                    </div>

                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-3">
                        <p className="text-sm font-semibold text-gray-800">Site / Store Information</p>
                        <p className="text-xs text-gray-500">
                            Describe your website, products, services, policies, and FAQs here.
                            The AI will use this as context when answering visitor questions.
                            The more detail you provide, the more accurate the answers.
                        </p>
                        <TextareaField
                            label=""
                            value={siteInfo}
                            onChange={setSiteInfo}
                            rows={8}
                            placeholder={`Example:\nWe are an online electronics store. We sell smartphones, laptops, and accessories.\nShipping takes 3–5 days inside Dhaka and 5–7 days outside.\nReturn policy: 7 days from delivery.\nContact: support@example.com`}
                        />
                    </div>
                </div>
            )}

            {/* ── API Tab ─────────────────────────────────────────────────── */}
            {activeTab === "api" && (
                <div className="space-y-5">
                    <div className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm space-y-4">
                        <p className="text-sm font-semibold text-gray-800">API Configuration</p>
                        <p className="text-xs text-gray-500">
                            Works with any OpenAI-compatible API (OpenAI, OpenRouter, Together AI, Groq, Ollama, etc.).
                        </p>

                        <Field
                            label="API Endpoint URL"
                            hint="The chat completions URL for your AI provider."
                            value={apiUrl}
                            onChange={setApiUrl}
                            placeholder="https://api.openai.com/v1/chat/completions"
                        />
                        <Field
                            label="API Key"
                            hint="Your secret API key. Stored securely in the database."
                            value={apiKey}
                            onChange={setApiKey}
                            type="password"
                            placeholder="sk-..."
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <ModelSelector
                                value={modelName}
                                onChange={setModelName}
                            />
                            <Field
                                label="Max Response Words"
                                hint="Limit AI response length. Default: 300 words."
                                value={maxWords}
                                onChange={setMaxWords}
                                type="number"
                                placeholder="300"
                            />
                        </div>
                    </div>

                    {/* ── Test Connection ── */}
                    <TestConnection />

                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
                        <div className="flex gap-2">
                            <Icon icon="solar:danger-triangle-bold" width={18} className="shrink-0 mt-0.5" />
                            <div>
                                <p className="font-semibold">Security note</p>
                                <p className="mt-0.5 text-xs">
                                    The API key is sent from your server to the AI provider — never exposed to browsers.
                                    Ensure your site is served over HTTPS.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Save */}
            <div className="flex justify-end pt-2">
                <button
                    type="button"
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-semibold rounded-lg transition disabled:opacity-55 disabled:cursor-not-allowed"
                >
                    {saving
                        ? <><Icon icon="svg-spinners:ring-resize" width={16} /> Saving…</>
                        : <><Icon icon="solar:check-circle-bold" width={16} /> Save Settings</>
                    }
                </button>
            </div>
        </div>
    );
}
