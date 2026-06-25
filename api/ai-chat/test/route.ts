/**
 * app/api/ai-chat/test/route.ts
 *
 * Sends a single "Hello" message to the configured AI provider and returns
 * the result — used by the settings page "Test Connection" button.
 *
 * GET /api/ai-chat/test
 * Returns: { ok: true, reply: string, model: string, apiUrl: string }
 *        | { ok: false, error: string, apiUrl: string }
 */

import { NextResponse } from "next/server";
import { Settings } from "@/lib/settings";

async function safeJson(res: Response): Promise<any | null> {
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json") && !ct.includes("text/json")) {
        const text = await res.text();
        console.error("[ai-chat/test] Non-JSON body:", text.slice(0, 300));
        return null;
    }
    try { return await res.json(); } catch { return null; }
}

export async function GET() {
    try {
        const settings = await Settings();

        const apiUrl = (settings.ai_chat_api_url as string | undefined)?.trim() || "https://api.openai.com/v1/chat/completions";
        const apiKey = (settings.ai_chat_api_key as string | undefined)?.trim() || "";
        const model  = (settings.ai_chat_model   as string | undefined)?.trim() || "gpt-4o-mini";

        if (!apiKey) {
            return NextResponse.json({ ok: false, error: "API key is not configured.", apiUrl });
        }

        const aiRes = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [
                    { role: "system", content: "You are a helpful assistant. Keep responses very short." },
                    { role: "user",   content: "Reply with exactly: Connection successful." },
                ],
                max_tokens: 30,
            }),
            // Don't cache test calls
            cache: "no-store",
        });

        const aiData = await safeJson(aiRes);

        if (!aiRes.ok || aiData === null) {
            let error = `HTTP ${aiRes.status}`;
            if (aiData !== null) {
                const msg =
                    (typeof aiData.error === "object" ? aiData.error?.message : aiData.error) ??
                    aiData.message;
                if (msg) error = String(msg);
            } else {
                error = `HTTP ${aiRes.status} — provider returned HTML instead of JSON. Check the API URL.`;
            }
            return NextResponse.json({ ok: false, error, model, apiUrl });
        }

        const reply = aiData.choices?.[0]?.message?.content?.trim() ?? "(no reply)";
        return NextResponse.json({ ok: true, reply, model, apiUrl });

    } catch (err) {
        console.error("[ai-chat/test] error:", err);
        return NextResponse.json({ ok: false, error: "Internal server error." });
    }
}
