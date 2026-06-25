/**
 * plugin/ai-chat/api/ai-chat/route.ts
 *
 * Served via the catch-all app/api/[...slug]/route.ts → /api/ai-chat
 *
 * POST /api/ai-chat
 * Body: { messages: ChatMessage[], pageContext?: string }
 *
 * Flow:
 *  1. Detect product-related intent in the last user message
 *  2. If detected → search Post (type:"product", status:"published") + PostInfo
 *     and inject matching products as structured context before calling the AI
 *  3. Call the configured AI API with the full system prompt + conversation
 *  4. Return { reply: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { Settings }   from "@/lib/settings";
import connectDB      from "@/lib/mongodb";
import Post           from "@/models/post";
import PostInfo       from "@/models/post_info";
import Permalink      from "@/models/permalink";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

interface VariateBlob {
    priceType?: string;
    regularprice?: string;
    sellingprice?: string;
    stock?: string;
    variants?: { price?: string; sellingprice?: string; title?: string; options?: Record<string, string> }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Safely parse a Response as JSON — returns null if body is not JSON */
async function safeJson(res: Response): Promise<any | null> {
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("application/json") && !ct.includes("text/json")) {
        console.error("[ai-chat] Non-JSON response:", (await res.text()).slice(0, 200));
        return null;
    }
    try { return await res.json(); } catch (e) {
        console.error("[ai-chat] JSON parse error:", e);
        return null;
    }
}

/** Extract the effective selling price from a _variate blob string */
function extractPrice(variateRaw: string | undefined): string {
    if (!variateRaw) return "";
    try {
        const v: VariateBlob = JSON.parse(variateRaw);
        if (v.priceType === "variant" && Array.isArray(v.variants) && v.variants.length > 0) {
            const prices = v.variants
                .map(vr => parseFloat(vr.sellingprice ?? vr.price ?? ""))
                .filter((n) => !isNaN(n));
            if (prices.length === 0) return "";
            const min = Math.min(...prices);
            const max = Math.max(...prices);
            return min === max ? String(min) : `${min}–${max}`;
        }
        return v.sellingprice || v.regularprice || "";
    } catch {
        return "";
    }
}

/** Build the product URL given the permalink prefix and slug */
function buildProductUrl(prefix: string, slug: string, baseUrl: string): string {
    const trimmed = prefix.trim().replace(/^\/+|\/+$/g, "");
    const path = trimmed ? `/${trimmed}/${slug}` : `/${slug}`;
    return `${baseUrl}${path}`;
}

/** Simple keyword check — is the user asking about products? */
function hasProductIntent(text: string): boolean {
    const lower = text.toLowerCase();
    const keywords = [
        "product", "price", "cost", "buy", "purchase", "stock", "available",
        "compare", "cheapest", "expensive", "recommend", "suggest", "show",
        "list", "catalog", "item", "items", "offer", "deal", "discount",
        // Bangla transliterations
        "pণ্য", "মূল্য", "দাম", "কিনতে", "পণ্য", "তালিকা",
    ];
    return keywords.some((kw) => lower.includes(kw));
}

/** Search products by title keywords extracted from user message */
function extractSearchTerms(text: string): string[] {
    // Strip common filler words, keep meaningful tokens (≥ 3 chars)
    const stopwords = new Set([
        "what", "is", "are", "the", "a", "an", "of", "for", "in", "on", "at",
        "do", "you", "have", "can", "i", "me", "my", "your", "our", "that",
        "this", "it", "its", "and", "or", "but", "not", "yes", "no",
        "show", "list", "tell", "give", "find", "search",
        "product", "products", "item", "items", "price", "prices",
    ]);
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\u0980-\u09FF\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3 && !stopwords.has(t));
}

// ─── Product DB search ────────────────────────────────────────────────────────

interface ProductSummary {
    title: string;
    slug: string;
    price: string;
    shortDescription: string;
    url: string;
}

async function searchProducts(
    userMessage: string,
    baseUrl: string
): Promise<ProductSummary[]> {
    await connectDB();

    // Get the permalink prefix for "product" type
    const permalinkDoc = await Permalink.findOne({ contentType: "product" }).lean() as any;
    const prefix: string = permalinkDoc?.prefix ?? "product";

    const terms = extractSearchTerms(userMessage);

    // Build a MongoDB query:
    //  - If we have meaningful terms → regex title search
    //  - Otherwise → return recent products (up to 10)
    const baseQuery: Record<string, any> = {
        type:   "product",
        status: "published",
    };

    if (terms.length > 0) {
        baseQuery.title = {
            $regex: terms.map((t) => `(?=.*${t})`).join(""),
            $options: "i",
        };
    }

    const posts = await Post.find(baseQuery)
        .sort({ createdAt: -1 })
        .limit(12)
        .lean() as any[];

    if (posts.length === 0) return [];

    // Fetch PostInfo for all found posts in one query
    const postIds = posts.map((p) => p._id);
    const infoRows = await PostInfo.find({
        postId: { $in: postIds },
        name:   { $in: ["_variate", "shortDescription"] },
    }).lean() as any[];

    // Group info by postId
    const infoMap: Record<string, Record<string, string>> = {};
    for (const row of infoRows) {
        const key = String(row.postId);
        if (!infoMap[key]) infoMap[key] = {};
        infoMap[key][row.name] = row.value;
    }

    return posts.map((post): ProductSummary => {
        const info = infoMap[String(post._id)] ?? {};
        return {
            title:            String(post.title ?? ""),
            slug:             String(post.slug  ?? ""),
            price:            extractPrice(info._variate),
            shortDescription: String(info.shortDescription ?? ""),
            url:              buildProductUrl(prefix, String(post.slug ?? ""), baseUrl),
        };
    });
}

/** Format product list as a readable context block for the AI */
function formatProductsContext(products: ProductSummary[], currencySymbol: string): string {
    if (products.length === 0) {
        return "No matching products found in the database.";
    }
    const lines = products.map((p, i) => {
        const priceStr = p.price ? `${currencySymbol}${p.price}` : "Price not set";
        const desc = p.shortDescription ? ` — ${p.shortDescription}` : "";
        return `${i + 1}. **${p.title}**${desc}\n   Price: ${priceStr}\n   URL: ${p.url}`;
    });
    return `Found ${products.length} product(s):\n\n${lines.join("\n\n")}`;
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as {
            messages:    ChatMessage[];
            pageContext?: string;
        };

        const settings = await Settings();

        const apiUrl        = (settings.ai_chat_api_url  as string | undefined)?.trim() || "https://api.openai.com/v1/chat/completions";
        const apiKey        = (settings.ai_chat_api_key  as string | undefined)?.trim() || "";
        const model         = (settings.ai_chat_model    as string | undefined)?.trim() || "gpt-4o-mini";
        const siteInfo      = (settings.ai_chat_site_info as string | undefined) ?? "";
        const maxWords      = parseInt((settings.ai_chat_max_words as string | undefined) ?? "300", 10);
        const currencySymbol = (settings.product_currency_symbol as string | undefined) ?? "";

        if (!apiKey) {
            return NextResponse.json(
                { error: "AI chat is not configured yet. Please add your API key in Admin → AI Chat → Settings." },
                { status: 503 }
            );
        }

        // ── Detect product intent in the latest user message ─────────────────
        const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";

        let productContext = "";
        if (hasProductIntent(lastUserMsg)) {
            try {
                // Derive baseUrl from the incoming request
                const reqUrl  = new URL(req.url);
                const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;

                const products = await searchProducts(lastUserMsg, baseUrl);
                productContext = formatProductsContext(products, currencySymbol);
            } catch (dbErr) {
                console.error("[ai-chat] DB product search failed:", dbErr);
                // Non-fatal — continue without product context
            }
        }

        // ── Build system prompt ───────────────────────────────────────────────
        const systemParts: string[] = [
            `You are a helpful assistant for this website/store.`,
            `Answer concisely — maximum ${maxWords} words per reply.`,
            `Always respond in the same language the user writes in.`,
            `When suggesting products, always include the product URL so the user can click through.`,
            `When comparing products, format them clearly side by side.`,
            `Do not make up product information — only use what is provided in the context.`,
        ];

        if (siteInfo.trim()) {
            systemParts.push(`\n--- Site / Store Information ---\n${siteInfo.trim()}`);
        }
        if (body.pageContext?.trim()) {
            systemParts.push(`\n--- Current Page ---\n${body.pageContext.trim()}`);
        }
        if (productContext) {
            systemParts.push(`\n--- Live Product Data (from database) ---\n${productContext}`);
        }

        const messages: ChatMessage[] = [
            { role: "system", content: systemParts.join("\n") },
            ...body.messages,
        ];

        // ── Call AI provider ──────────────────────────────────────────────────
        const aiRes = await fetch(apiUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization:  `Bearer ${apiKey}`,
            },
            body: JSON.stringify({ model, messages, max_tokens: 600 }),
        });

        const aiData = await safeJson(aiRes);

        if (!aiRes.ok || aiData === null) {
            let userMessage = `Provider error (HTTP ${aiRes.status}). Check your API URL and model name.`;
            if (aiData !== null) {
                const msg =
                    (typeof aiData.error === "object" ? aiData.error?.message : aiData.error) ??
                    aiData.message;
                if (msg) userMessage = String(msg);
            } else {
                userMessage = `Provider returned a non-JSON response (HTTP ${aiRes.status}). The API URL may be incorrect.`;
            }
            console.error("[ai-chat] provider error:", aiRes.status, userMessage);
            return NextResponse.json({ error: userMessage }, { status: 502 });
        }

        const reply =
            aiData.choices?.[0]?.message?.content?.trim() ??
            aiData.error?.message ??
            "Sorry, I couldn't generate a response.";

        return NextResponse.json({ reply });

    } catch (err) {
        console.error("[ai-chat] route error:", err);
        return NextResponse.json({ error: "Internal server error." }, { status: 500 });
    }
}
