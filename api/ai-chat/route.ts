/**
 * plugin/ai-chat/api/ai-chat/route.ts
 *
 * Served via the catch-all app/api/[...slug]/route.ts → /api/ai-chat
 *
 * POST /api/ai-chat
 * Body: { messages: ChatMessage[], pageContext?: string }
 *
 * Flow:
 *  1. Always search the database for matching products/content
 *  2. Inject found items as structured context into the AI prompt
 *  3. AI is restricted to ONLY answer about this website's products/content
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
    variants?: { price?: string; sellingprice?: string; title?: string; stock?: string; options?: Record<string, string> }[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function extractStock(variateRaw: string | undefined): string {
    if (!variateRaw) return "";
    try {
        const v: VariateBlob = JSON.parse(variateRaw);
        if (v.priceType === "variant" && Array.isArray(v.variants)) {
            const total = v.variants.reduce((sum, vr) => sum + (parseInt(vr.stock ?? "0", 10) || 0), 0);
            return String(total);
        }
        return v.stock ?? "";
    } catch {
        return "";
    }
}

function buildUrl(prefix: string, slug: string, baseUrl: string): string {
    const trimmed = prefix.trim().replace(/^\/+|\/+$/g, "");
    const path = trimmed ? `/${trimmed}/${slug}` : `/${slug}`;
    return `${baseUrl}${path}`;
}

/**
 * Extract meaningful search terms from user message.
 * Uses OR logic — any matching term is sufficient.
 */
function extractSearchTerms(text: string): string[] {
    const stopwords = new Set([
        "what", "is", "are", "the", "a", "an", "of", "for", "in", "on", "at",
        "do", "you", "have", "can", "i", "me", "my", "your", "our", "that",
        "this", "it", "its", "and", "or", "but", "not", "yes", "no",
        "show", "list", "tell", "give", "find", "search", "please",
        "want", "need", "like", "looking", "some", "any", "all",
        "how", "much", "many", "which", "where", "when", "who",
        "product", "products", "item", "items", "price", "prices",
        "about", "info", "information", "details", "detail",
        // Bangla
        "এবং", "অথবা", "কি", "না", "হ্যাঁ", "দেখাও", "বলুন", "দিন",
    ]);
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\u0980-\u09FF\s]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 2 && !stopwords.has(t));
}

// ─── DB search ────────────────────────────────────────────────────────────────

interface ContentSummary {
    title: string;
    slug: string;
    type: string;
    price: string;
    stock: string;
    shortDescription: string;
    url: string;
}

interface SiteContext {
    products: ContentSummary[];
    posts: ContentSummary[];
    totalProductCount: number;
    totalPostCount: number;
}

async function searchContent(
    userMessage: string,
    baseUrl: string
): Promise<SiteContext> {
    await connectDB();

    const terms = extractSearchTerms(userMessage);

    // Fetch all permalink prefixes in one query
    const permalinkDocs = await Permalink.find({}).lean() as any[];
    const permalinkMap: Record<string, string> = {};
    for (const doc of permalinkDocs) {
        permalinkMap[doc.contentType] = doc.prefix ?? "";
    }

    // ── Search products ─────────────────────────────────────────────────────
    const productQuery: Record<string, any> = {
        type: "product",
        status: "published",
    };

    if (terms.length > 0) {
        // OR-based: match ANY term in title
        productQuery.$or = terms.map((t) => ({
            title: { $regex: t, $options: "i" },
        }));
    }

    const productPosts = await Post.find(productQuery)
        .sort({ createdAt: -1 })
        .limit(15)
        .lean() as any[];

    // Also search by info field values (shortDescription, etc.)
    let extraProductIds: string[] = [];
    if (terms.length > 0) {
        const infoMatches = await PostInfo.find({
            name: "shortDescription",
            value: { $regex: terms.join("|"), $options: "i" },
        }).lean() as any[];

        const matchingPostIds = infoMatches
            .filter((info: any) => {
                // Verify the post is a published product
                return productPosts.every((p: any) => String(p._id) !== String(info.postId));
            })
            .map((info: any) => info.postId);

        if (matchingPostIds.length > 0) {
            const extraPosts = await Post.find({
                _id: { $in: matchingPostIds },
                type: "product",
                status: "published",
            }).lean() as any[];
            extraProductIds = extraPosts.map((p: any) => String(p._id));
            productPosts.push(...extraPosts);
        }
    }

    // Deduplicate products
    const seenProductIds = new Set<string>();
    const uniqueProducts = productPosts.filter((p: any) => {
        const id = String(p._id);
        if (seenProductIds.has(id)) return false;
        seenProductIds.add(id);
        return true;
    });

    // Count total published products
    const totalProductCount = await Post.countDocuments({ type: "product", status: "published" });

    // Fetch PostInfo for all products
    const productIds = uniqueProducts.map((p) => p._id);
    const productInfoRows = await PostInfo.find({
        postId: { $in: productIds },
        name: { $in: ["_variate", "shortDescription", "sku", "product_condition"] },
    }).lean() as any[];

    const productInfoMap: Record<string, Record<string, string>> = {};
    for (const row of productInfoRows) {
        const key = String(row.postId);
        if (!productInfoMap[key]) productInfoMap[key] = {};
        productInfoMap[key][row.name] = row.value;
    }

    const productPrefix = permalinkMap["product"] ?? "";
    const products: ContentSummary[] = uniqueProducts.map((post): ContentSummary => {
        const info = productInfoMap[String(post._id)] ?? {};
        return {
            title: String(post.title ?? ""),
            slug: String(post.slug ?? ""),
            type: "product",
            price: extractPrice(info._variate),
            stock: extractStock(info._variate),
            shortDescription: String(info.shortDescription ?? ""),
            url: buildUrl(productPrefix, String(post.slug ?? ""), baseUrl),
        };
    });

    // ── Search blog posts / pages ───────────────────────────────────────────
    const blogQuery: Record<string, any> = {
        type: { $in: ["blog", "page", "epaper"] },
        status: "published",
    };

    if (terms.length > 0) {
        blogQuery.$or = terms.map((t) => ({
            title: { $regex: t, $options: "i" },
        }));
    }

    const blogPosts = await Post.find(blogQuery)
        .sort({ createdAt: -1 })
        .limit(10)
        .lean() as any[];

    const totalPostCount = await Post.countDocuments({
        type: { $in: ["blog", "page", "epaper"] },
        status: "published",
    });

    const posts: ContentSummary[] = blogPosts.map((post): ContentSummary => {
        const prefix = permalinkMap[post.type] ?? "";
        return {
            title: String(post.title ?? ""),
            slug: String(post.slug ?? ""),
            type: String(post.type ?? ""),
            price: "",
            stock: "",
            shortDescription: "",
            url: buildUrl(prefix, String(post.slug ?? ""), baseUrl),
        };
    });

    return { products, posts, totalProductCount, totalPostCount };
}

function formatSiteContext(ctx: SiteContext, currencySymbol: string): string {
    const parts: string[] = [];

    // Products
    if (ctx.products.length > 0) {
        const productLines = ctx.products.map((p, i) => {
            const priceStr = p.price ? `${currencySymbol}${p.price}` : "Price not set";
            const stockStr = p.stock ? ` | Stock: ${p.stock}` : "";
            const desc = p.shortDescription ? `\n   ${p.shortDescription}` : "";
            return `${i + 1}. ${p.title} — ${priceStr}${stockStr}${desc}\n   URL: ${p.url}`;
        });
        parts.push(`Found ${ctx.products.length} of ${ctx.totalProductCount} total product(s):\n\n${productLines.join("\n\n")}`);
    } else if (ctx.totalProductCount > 0) {
        parts.push(`No products matched the search terms. Total products in store: ${ctx.totalProductCount}.`);
    } else {
        parts.push("No products found in the store.");
    }

    // Blog / pages
    if (ctx.posts.length > 0) {
        const postLines = ctx.posts.map((p, i) => {
            return `${i + 1}. [${p.type}] ${p.title}\n   URL: ${p.url}`;
        });
        parts.push(`Found ${ctx.posts.length} of ${ctx.totalPostCount} total page(s)/post(s):\n\n${postLines.join("\n\n")}`);
    }

    return parts.join("\n\n");
}

// ─── Route handler ────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
    try {
        const body = await req.json() as {
            messages: ChatMessage[];
            pageContext?: string;
        };

        const settings = await Settings();

        const apiUrl         = (settings.ai_chat_api_url  as string | undefined)?.trim() || "https://api.openai.com/v1/chat/completions";
        const apiKey         = (settings.ai_chat_api_key  as string | undefined)?.trim() || "";
        const model          = (settings.ai_chat_model    as string | undefined)?.trim() || "gpt-4o-mini";
        const siteInfo       = (settings.ai_chat_site_info as string | undefined) ?? "";
        const maxWords       = parseInt((settings.ai_chat_max_words as string | undefined) ?? "300", 10);
        const currencySymbol = (settings.product_currency_symbol as string | undefined) ?? "";
        const siteName       = (settings.siteName as string | undefined) ?? "this website";

        if (!apiKey) {
            return NextResponse.json(
                { error: "AI chat is not configured yet. Please add your API key in Admin → AI Chat → Settings." },
                { status: 503 }
            );
        }

        // ── Always search DB for matching content ───────────────────────────
        const lastUserMsg = [...body.messages].reverse().find((m) => m.role === "user")?.content ?? "";

        let siteContextStr = "";
        try {
            const reqUrl  = new URL(req.url);
            const baseUrl = `${reqUrl.protocol}//${reqUrl.host}`;
            const ctx     = await searchContent(lastUserMsg, baseUrl);
            siteContextStr = formatSiteContext(ctx, currencySymbol);
        } catch (dbErr) {
            console.error("[ai-chat] DB search failed:", dbErr);
        }

        // ── Build system prompt — STRICT: only answer about this website ────
        const systemParts: string[] = [
            `You are a customer support assistant for ${siteName}.`,
            `You ONLY answer questions about products, services, and content available on ${siteName}.`,
            `You MUST NOT answer questions unrelated to ${siteName}. If the user asks something off-topic, politely redirect them to ask about our products or services instead.`,
            `You MUST NOT make up product names, prices, or information. Only use data provided in the context below.`,
            `Always respond in the same language the user writes in.`,
            `Answer concisely — maximum ${maxWords} words per reply.`,
            `When listing or suggesting products, always include the product URL so the user can click through.`,
            `When comparing products, format them clearly.`,
            `If no matching products are found in the context, say so honestly — do not invent products.`,
        ];

        if (siteInfo.trim()) {
            systemParts.push(`\n--- About ${siteName} ---\n${siteInfo.trim()}`);
        }
        if (body.pageContext?.trim()) {
            systemParts.push(`\n--- Current Page ---\n${body.pageContext.trim()}`);
        }
        if (siteContextStr) {
            systemParts.push(`\n--- Live Data from ${siteName} Database ---\n${siteContextStr}`);
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
