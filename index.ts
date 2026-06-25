/**
 * plugin/ai-chat/index.ts — AI Chat Widget plugin.
 *
 * Adds a configurable floating AI chat bubble to the public-facing site.
 * The widget sends visitor messages to /api/ai-chat (server-side proxy)
 * which forwards them to any OpenAI-compatible API without exposing the
 * API key to the browser.
 *
 * Features:
 *   • Floating button — left / center / right positioning
 *   • Configurable icon, colour, tooltip text
 *   • Popup header title + subtitle + welcome message
 *   • Site/product info context passed as AI system prompt
 *   • Auto language detection — replies in the user's language
 *   • Product suggestion & comparison support
 *   • Max-word limit (default 300, configurable)
 *   • Works with OpenAI, Together AI, Groq, Ollama, or any OpenAI-compatible API
 *
 * Admin settings page:
 *   URL: /admin/ai-chat/settings
 *   Three tabs: Appearance | Content | API & Model
 *
 * Hook: root.root
 *   Components registered with slug "root" are injected at the end of
 *   the root layout (<body>), before </body> — ideal for floating widgets.
 */

import { addHook, type PluginMeta } from "@/hook";
import AiChatWidget       from "./ui/chat";
import AiChatSettingsPage from "./ui/settings";

// ─── Plugin metadata ──────────────────────────────────────────────────────────
export const PLUGINS: PluginMeta = {
    nx:          "com.system.ai-chat",
    name:        "ai-chat",
    version:     "1.0.0",
    description: "Floating AI chat widget powered by OpenAI-compatible APIs.",
    author:      "System",
    path:        "https://github.com/HOTLancerX/ai-chat.git",
    icon:        "solar:chat-round-bold",
    color:       "from-violet-500 to-purple-600",
};

/**
 * Register all hooks for this plugin.
 * Called by PluginList.reregisterHooks() after the gate is armed.
 */
export function register() {
    // ─── Root layout widget ───────────────────────────────────────────────────
    // slug: "root" — rendered at the end of the root layout (after footer).
    // The layout picks up all root.pages entries with slug === "root" and
    // renders them as global floating widgets. The component receives
    // `settings` as a prop (injected by layout.tsx).
    addHook("root.pages", [
        {
            key:      "ai-chat-widget",
            label:    "AI Chat Widget",
            type:     "widget",
            slug:     "root",
            style:    "left",
            position: 100,
            active:   true,
            component: AiChatWidget,
        },
    ], PLUGINS.nx);

    // ─── Admin nav ────────────────────────────────────────────────────────────
    addHook("admin.nav", [
        {
            key:      "ai-chat",
            label:    "AI Chat",
            icon:     "solar:chat-round-bold",
            slug:     "ai-chat",
            parent:   "",
            position: 85,
        },
        {
            key:      "ai-chat-settings",
            label:    "Settings",
            icon:     "solar:settings-bold",
            slug:     "ai-chat/settings",
            parent:   "ai-chat",
            position: 1,
        },
    ], PLUGINS.nx);

    // ─── Admin settings page ──────────────────────────────────────────────────
    // URL: /admin/ai-chat/settings
    addHook("admin.pages", [
        {
            key:      "ai-chat/settings",
            label:    "AI Chat Settings",
            type:     "ai-chat-settings",
            style:    "left",
            position: 10,
            path:     AiChatSettingsPage,
        },
    ], PLUGINS.nx);
}
