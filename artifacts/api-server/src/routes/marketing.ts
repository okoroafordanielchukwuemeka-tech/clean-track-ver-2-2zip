/**
 * Marketing Routes — Phase 7.5
 *
 * AI Marketing Assistant: Professional+ feature.
 * Generates multi-channel marketing copy from a plain-language prompt.
 *
 * If OPENAI_API_KEY is set, uses GPT-4o-mini for high-quality generation.
 * Falls back to a smart template engine if no AI key is configured.
 */

import { Router } from "express";
import { z } from "zod";
import { AuthRequest, requireOwner } from "../middleware/auth.js";
import { requireEntitlement } from "../middleware/subscription.js";

export const marketingRouter = Router();

// ── Template fallback generator ───────────────────────────────────────────────

interface MarketingContent {
  whatsapp: string;
  sms: string;
  email: { subject: string; body: string };
  facebook: string;
  instagram: string;
}

const TEMPLATES: Array<{
  keywords: string[];
  generate: (prompt: string, businessName: string) => MarketingContent;
}> = [
  {
    keywords: ["duvet", "bedding", "blanket", "comforter"],
    generate: (_prompt, biz) => ({
      whatsapp: `🛏️ *Duvet & Bedding Special at ${biz}!*\n\nGive your bedding the deep clean it deserves. We handle duvets, blankets, and comforters with professional care.\n\n📞 Drop off today — same-week turnaround!\n\nReply *YES* to book a pickup or visit us now.`,
      sms: `Duvet cleaning special at ${biz}! Professional bedding care, same-week turnaround. Call us or drop off today.`,
      email: {
        subject: `Your duvets deserve professional cleaning — special offer from ${biz}`,
        body: `Hi there,\n\nIs your duvet due for a deep clean? At ${biz}, we professionally clean duvets, blankets, and comforters — leaving them fresh, fluffy, and hygienic.\n\nDrop off this week and enjoy our bedding cleaning special.\n\nCall us or visit today.\n\nWarm regards,\n${biz}`,
      },
      facebook: `🛏️ Duvet Cleaning Special!\n\nYour bedding works hard every night — give it the professional clean it deserves. ${biz} handles all types of duvets, blankets, and comforters with expert care.\n\nSame-week turnaround. Drop off or call to book! 🌟\n\n#LaundryServices #DuvetCleaning #CleanBedding`,
      instagram: `Your duvet deserves better than a washing machine 🛏️✨\n\nProfessional duvet & bedding cleaning at ${biz}. Fresh, fluffy, and hygienically clean — every time.\n\nDrop off today! 📍\n\n#DuvetCleaning #LaundryLife #FreshBedding #CleanHome`,
    }),
  },
  {
    keywords: ["midweek", "mid-week", "tuesday", "wednesday", "thursday", "slow"],
    generate: (_prompt, biz) => ({
      whatsapp: `📅 *Midweek Special at ${biz}!*\n\nBeat the weekend rush! Bring your clothes in Tuesday–Thursday and enjoy priority service.\n\n✅ Faster turnaround\n✅ Less waiting\n✅ Same great quality\n\nDrop off midweek and collect by Friday! Reply to book.`,
      sms: `Midweek special at ${biz}! Bring clothes Tue–Thu for faster service and less waiting. Collect by Friday!`,
      email: {
        subject: `Midweek special — faster laundry service at ${biz}`,
        body: `Hello,\n\nAvoid the weekend rush! Drop your laundry at ${biz} any day Tuesday to Thursday for priority processing.\n\nFaster turnaround, shorter wait times — same quality you trust.\n\nSee you midweek!\n\n${biz}`,
      },
      facebook: `📅 MIDWEEK SPECIAL at ${biz}!\n\nBeat the weekend rush — drop your clothes in Tuesday to Thursday for faster turnaround and less waiting.\n\nCollect by Friday, fresh and ready for the weekend! 🎉\n\n#MidweekSpecial #LaundryService #NoMoreWaiting`,
      instagram: `Weekend plans sorted 🎉\n\nDrop your laundry midweek at ${biz} → fast turnaround → collect by Friday ✅\n\nNo weekend rush. No long waits. Just clean clothes.\n\n📍 Visit us Tuesday–Thursday\n\n#CleanClothes #LaundryDay #MidweekVibes`,
    }),
  },
  {
    keywords: ["discount", "offer", "promo", "promotion", "sale", "cheap", "price"],
    generate: (_prompt, biz) => ({
      whatsapp: `🎉 *Special Offer at ${biz}!*\n\nWe appreciate your loyalty! This week only — enjoy a special discount when you bring in 5 or more items.\n\n👕 Drop off any day this week\n💰 Save on your laundry bill\n\nDon't miss out — offer ends Sunday! Reply to confirm.`,
      sms: `Special offer at ${biz} this week! Bring 5+ items and save. Offer ends Sunday. Don't miss it!`,
      email: {
        subject: `Limited time offer — save on your next laundry at ${biz}`,
        body: `Hello,\n\nAs a valued customer, we have a special offer just for you!\n\nBring in 5 or more items this week and enjoy a discount on your laundry bill. This offer is available until Sunday.\n\nWe look forward to serving you!\n\n${biz}`,
      },
      facebook: `🎉 SPECIAL OFFER this week at ${biz}!\n\nBring in 5 or more items and enjoy a discount on your laundry. Limited time — ends Sunday!\n\nMark yourself as interested and share with friends and family! 👇\n\n#LaundryOffer #SpecialPromo #${biz.replace(/\s/g, "")}`,
      instagram: `OFFER ALERT 🚨\n\nThis week at ${biz}: bring 5+ items and save on your laundry! 🧺✨\n\nOffer ends Sunday — don't miss it!\n\n#LaundryDeal #WeeklyOffer #CleanClothes #LaundryDay`,
    }),
  },
  {
    keywords: ["festive", "christmas", "holiday", "xmas", "season", "eid", "easter", "celebration"],
    generate: (_prompt, biz) => ({
      whatsapp: `🎊 *Festive Season Laundry at ${biz}!*\n\nLooking fresh for the celebrations? We've got you covered!\n\n✨ Festive rush service available\n👗 Party outfits, traditional wear, kids' clothes\n⚡ Express turnaround for tight schedules\n\nBook your slot now — spaces are limited! Reply or call us.`,
      sms: `Festive season service at ${biz}! Express laundry for your celebrations. Party outfits, traditional wear welcome. Book now — limited slots!`,
      email: {
        subject: `Get your celebration outfits ready with ${biz} this festive season`,
        body: `Dear valued customer,\n\nThe celebrations are coming! Make sure your outfits, traditional wear, and party clothes are fresh and ready.\n\n${biz} offers express festive season service for everything from Agbada to children's clothes.\n\nBook your slot now before we fill up!\n\nHappy celebrations,\n${biz}`,
      },
      facebook: `🎊 Festive Season is here — is your wardrobe ready?\n\nAt ${biz}, we're offering express laundry service for your celebration outfits! Traditional wear, party clothes, kids' outfits — we handle it all.\n\nBook your slot before we fill up! 🌟\n\n#FestiveSeason #PartyReady #LaundryService #CleanClothes`,
      instagram: `Celebration ready? ✨🎊\n\n${biz} has you covered this festive season! Party outfits, traditional wear, kids' clothes — all professionally cleaned.\n\nExpress service available. Book your slot now! 📞\n\n#FestiveVibes #PartyReady #TraditionalWear #CleanClothes`,
    }),
  },
  {
    keywords: ["inactive", "customer", "return", "comeback", "miss", "long time"],
    generate: (_prompt, biz) => ({
      whatsapp: `👋 *We miss you at ${biz}!*\n\nIt's been a while since your last visit — we hope you're doing well.\n\nCome back this week and enjoy a welcome-back discount on your first order.\n\n🧺 Fresh clothes, the way you like them\n💙 Your loyalty means everything to us\n\nReply *BACK* or drop by anytime!`,
      sms: `We miss you at ${biz}! Come back this week for a welcome-back discount on your first order. Reply or drop in anytime!`,
      email: {
        subject: `We miss you — come back to ${biz} this week`,
        body: `Hello,\n\nIt's been a while since we've seen you at ${biz} and we genuinely miss serving you!\n\nCome back this week and we'll give you a welcome-back discount on your order as our way of saying thank you for your loyalty.\n\nWe hope to see you soon!\n\nWarm regards,\n${biz}`,
      },
      facebook: `👋 We miss our valued customers!\n\nIf it's been a while since you visited ${biz}, this is your sign to come back. First visit back gets a special welcome-back discount! 🎁\n\nTag a friend who needs fresh laundry! 👇\n\n#WeMissYou #LoyaltyDiscount #LaundryService`,
      instagram: `Hey, we miss you! 💙\n\nBeen a while since your last visit? Come back to ${biz} this week and we'll make it worth your while. ✨\n\nDrop in or send us a message! 🧺\n\n#WeMissYou #CustomerLove #FreshClothes #LaundryDay`,
    }),
  },
];

function generateTemplateContent(prompt: string, businessName: string): MarketingContent {
  const lowerPrompt = prompt.toLowerCase();

  for (const template of TEMPLATES) {
    if (template.keywords.some((kw) => lowerPrompt.includes(kw))) {
      return template.generate(prompt, businessName);
    }
  }

  // Generic fallback
  return {
    whatsapp: `✨ *${businessName} — Quality Laundry Service*\n\n${prompt}\n\n🧺 Drop off your clothes today for professional cleaning.\n📞 Call or message us to get started!`,
    sms: `${businessName}: ${prompt.slice(0, 120)}. Call or visit us today!`,
    email: {
      subject: `Special message from ${businessName}`,
      body: `Hello,\n\n${prompt}\n\nVisit us or give us a call to learn more.\n\nThank you,\n${businessName}`,
    },
    facebook: `${prompt}\n\nAt ${businessName}, we're committed to quality laundry service you can count on. 🧺✨\n\n#LaundryService #${businessName.replace(/\s/g, "")} #CleanClothes`,
    instagram: `${prompt.slice(0, 200)} ✨🧺\n\n#LaundryDay #CleanClothes #${businessName.replace(/\s/g, "")}`,
  };
}

// ── OpenAI generator (if API key is available) ────────────────────────────────

async function generateWithAI(prompt: string, businessName: string): Promise<MarketingContent | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;

  try {
    const systemPrompt = `You are a marketing copywriter for ${businessName}, a Nigerian laundry business. Generate engaging, culturally appropriate marketing content in English. Keep WhatsApp messages under 300 characters without markdown stars. Keep SMS under 160 characters. Be warm, professional, and action-oriented.`;

    const userPrompt = `Create marketing content for this request: "${prompt}"\n\nReturn ONLY a JSON object with these exact keys:\n- whatsapp: string (WhatsApp message, use *bold* sparingly, under 300 words)\n- sms: string (SMS version, under 160 chars)\n- email_subject: string\n- email_body: string (3-4 paragraphs)\n- facebook: string (Facebook post with relevant hashtags)\n- instagram: string (Instagram caption with hashtags)`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.8,
        max_tokens: 1000,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as any;
    const parsed = JSON.parse(data.choices[0].message.content);

    return {
      whatsapp: parsed.whatsapp ?? "",
      sms: parsed.sms ?? "",
      email: {
        subject: parsed.email_subject ?? "",
        body: parsed.email_body ?? "",
      },
      facebook: parsed.facebook ?? "",
      instagram: parsed.instagram ?? "",
    };
  } catch {
    return null;
  }
}

// ── Routes ────────────────────────────────────────────────────────────────────

const generateSchema = z.object({
  prompt: z.string().min(10, "Prompt must be at least 10 characters").max(500),
  businessName: z.string().optional(),
});

/**
 * POST /marketing/generate
 * Requires: Professional+ (HAS_AI_MARKETING entitlement)
 * Body: { prompt: string, businessName?: string }
 */
marketingRouter.post(
  "/generate",
  requireOwner,
  requireEntitlement("HAS_AI_MARKETING"),
  async (req: AuthRequest, res) => {
    try {
      const { prompt, businessName } = generateSchema.parse(req.body);
      const biz = businessName || "our laundry";

      // Try AI first, fall back to template engine
      const aiContent = await generateWithAI(prompt, biz);
      const content = aiContent ?? generateTemplateContent(prompt, biz);

      res.json({
        content,
        generatedBy: aiContent ? "ai" : "template",
        prompt,
      });
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({ error: err.errors[0].message });
      }
      res.status(500).json({ error: "Failed to generate marketing content" });
    }
  }
);

/**
 * GET /marketing/tips
 * Returns rotating content tips for the marketing assistant UI.
 */
marketingRouter.get("/tips", requireOwner, (_req, res) => {
  res.json({
    prompts: [
      "Create a mid-week promotion to attract customers Tuesday to Thursday",
      "Write a festive discount message for the holiday season",
      "Generate a campaign for inactive customers who haven't visited in 3 weeks",
      "Promote our duvet and bedding cleaning service",
      "Write a referral message asking customers to bring their friends",
      "Create a back-to-school laundry special for parents",
      "Write a rainy season message about washing and drying services",
      "Generate a thank-you message for our most loyal customers",
      "Create a weekend special for bulk laundry drop-offs",
      "Write a New Year message to restart relationships with past customers",
    ],
  });
});
