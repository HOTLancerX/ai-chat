/**
 * app/api/ai-chat/models/route.ts
 *
 * Server-side proxy: fetches available models from the configured AI provider.
 * Keeps the API key off the browser.
 *
 * GET /api/ai-chat/models
 * Returns: { models: string[] } | { error: string }
 */

import { NextResponse } from "next/server";
import { Settings } from "@/lib/settings";

export async function GET() {
    try {
        const settings = await Settings();

        const apiUrl = (settings.ai_chat_api_url as string | undefined) ?? "";
        const apiKey = (settings.ai_chat_api_key as string | undefined) ?? "";

        if (!apiKey) {
            return NextResponse.json({ error: "API key is not configured." }, { status: 400 });
        }

        // Derive the /models endpoint from the configured completions URL.
        // e.g. https://api.openai.com/v1/chat/completions → https://api.openai.com/v1/models
        //      https://opencode.ai/zen/v1/chat/completions → https://opencode.ai/zen/v1/models
        let modelsUrl: string;
        try {
            const url = new URL(apiUrl || "https://api.openai.com/v1/chat/completions");
            // Replace everything from /chat/completions onward with /models
            const basePath = url.pathname.replace(/\/chat\/completions\/?$/, "");
            modelsUrl = `${url.origin}${basePath}/models`;
        } catch {
            modelsUrl = "https://api.openai.com/v1/models";
        }

        const res = await fetch(modelsUrl, {
            headers: {
                Authorization: `Bearer ${apiKey}`,
                "Content-Type": "application/json",
            },
            // Don't cache — user may have changed API key
            cache: "no-store",
        });

        if (!res.ok) {
            const errText = await res.text();
            console.error("[ai-chat/models] error:", res.status, errText);
            return NextResponse.json(
                { error: `Provider returned ${res.status}. Check your API URL and key.` },
                { status: 502 }
            );
        }

        const data = await res.json() as {
            data?: { id: string; [k: string]: any }[];
            models?: { id: string; [k: string]: any }[];
            // Some providers return a flat array
            [k: string]: any;
        };

        // Normalise: OpenAI returns { data: [{id, ...}] }
        // Some providers return { models: [{id}] } or a flat array
        let models: string[] = [];
        if (Array.isArray(data.data)) {
            models = data.data.map((m) => m.id).filter(Boolean).sort();
        } else if (Array.isArray(data.models)) {
            models = data.models.map((m) => m.id).filter(Boolean).sort();
        } else if (Array.isArray(data)) {
            models = (data as any[]).map((m: any) => m.id ?? m).filter(Boolean).sort();
        }

        return NextResponse.json({ models });
    } catch (err) {
        console.error("[ai-chat/models] route error:", err);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
