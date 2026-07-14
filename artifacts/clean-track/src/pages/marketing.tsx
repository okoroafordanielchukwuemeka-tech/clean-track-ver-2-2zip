/**
 * AI Marketing Assistant — Phase 7.5
 *
 * Professional+ feature. Generates multi-channel marketing copy
 * from a plain-language prompt using AI or smart templates.
 */

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Sparkles, Copy, Check, ChevronDown, ChevronUp, Lock, Loader2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useQuery as useRQQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────

interface GeneratedContent {
  whatsapp: string;
  sms: string;
  email: { subject: string; body: string };
  facebook: string;
  instagram: string;
}

interface GenerateResponse {
  content: GeneratedContent;
  generatedBy: "ai" | "template";
  prompt: string;
}

// ── Copy button ───────────────────────────────────────────────────────────────

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}

// ── Channel card ──────────────────────────────────────────────────────────────

function ChannelCard({
  label,
  icon,
  color,
  content,
  extra,
}: {
  label: string;
  icon: string;
  color: string;
  content: string;
  extra?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={cn("rounded-xl border overflow-hidden", color)}>
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <div className="flex items-center gap-2">
          <span className="text-lg">{icon}</span>
          <span className="font-semibold text-sm">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          <CopyButton text={content} />
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-muted-foreground hover:text-foreground p-1"
          >
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 py-3">
          {extra}
          <pre className="text-sm whitespace-pre-wrap font-sans leading-relaxed">{content}</pre>
        </div>
      )}
    </div>
  );
}

// ── Prompt suggestions ────────────────────────────────────────────────────────

function PromptSuggestions({
  onSelect,
}: {
  onSelect: (prompt: string) => void;
}) {
  const { data } = useRQQuery({
    queryKey: ["marketing", "tips"],
    queryFn: () => api.marketing.getTips(),
    staleTime: Infinity,
  });

  if (!data?.prompts?.length) return null;

  return (
    <div>
      <p className="text-xs font-medium text-muted-foreground mb-2">Try these prompts:</p>
      <div className="flex flex-wrap gap-2">
        {data.prompts.map((prompt: string) => (
          <button
            key={prompt}
            onClick={() => onSelect(prompt)}
            className="text-xs px-3 py-1.5 rounded-full border border-border hover:border-primary hover:text-primary transition-colors bg-background"
          >
            {prompt.slice(0, 60)}{prompt.length > 60 ? "…" : ""}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function MarketingPage() {
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<GenerateResponse | null>(null);

  // Check if user has AI marketing entitlement
  const { data: status } = useRQQuery({
    queryKey: ["subscription", "status"],
    queryFn: () => api.subscription.getStatus(),
    staleTime: 60_000,
  });

  const hasAccess =
    status?.features?.HAS_AI_MARKETING ||
    status?.status === "trial";

  const generateMutation = useMutation({
    mutationFn: (p: string) => api.marketing.generate(p),
    onSuccess: (data: GenerateResponse) => {
      setResult(data);
    },
    onError: (err: any) => {
      toast.error(err?.message ?? "Failed to generate content. Please try again.");
    },
  });

  function handleGenerate() {
    if (!prompt.trim() || prompt.trim().length < 10) {
      toast.error("Please describe what you want to promote (at least 10 characters).");
      return;
    }
    generateMutation.mutate(prompt.trim());
  }

  if (!hasAccess) {
    return (
      <div className="max-w-lg mx-auto mt-16 text-center space-y-4">
        <div className="flex justify-center">
          <div className="h-14 w-14 rounded-full bg-muted flex items-center justify-center">
            <Lock className="h-7 w-7 text-muted-foreground" />
          </div>
        </div>
        <h2 className="text-xl font-bold">AI Marketing Assistant</h2>
        <p className="text-muted-foreground">
          The AI Marketing Assistant is available on the <strong>Professional</strong> and{" "}
          <strong>Enterprise</strong> plans. Upgrade to generate WhatsApp campaigns, SMS blasts,
          email copy, and social media posts instantly.
        </p>
        <Button onClick={() => window.location.href = "/settings"}>
          View plans & upgrade
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <h1 className="text-2xl font-bold">AI Marketing Assistant</h1>
          <Badge variant="secondary" className="gap-1">
            <Sparkles className="h-3 w-3" />
            Professional+
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Describe what you want to promote and get ready-to-send copy for WhatsApp, SMS, email, Facebook, and Instagram.
        </p>
      </div>

      {/* Prompt input */}
      <Card>
        <CardContent className="pt-5 space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              What do you want to promote?
            </label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Create a mid-week promotion to attract customers Tuesday to Thursday…"
              rows={3}
              className="resize-none"
              maxLength={500}
            />
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-muted-foreground">{prompt.length}/500 characters</p>
              {prompt.length >= 10 && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400">✓ Ready to generate</p>
              )}
            </div>
          </div>

          <PromptSuggestions onSelect={(p) => setPrompt(p)} />

          <Button
            onClick={handleGenerate}
            disabled={generateMutation.isPending || prompt.trim().length < 10}
            className="w-full gap-2"
          >
            {generateMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Generate Marketing Content
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Results */}
      {result && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Generated Content</h2>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">
                {result.generatedBy === "ai" ? "✨ AI-generated" : "📋 Template-based"}
              </Badge>
              <Button variant="outline" size="sm" onClick={handleGenerate} disabled={generateMutation.isPending}>
                Regenerate
              </Button>
            </div>
          </div>

          <ChannelCard
            label="WhatsApp Message"
            icon="💬"
            color="border-green-200 dark:border-green-800/40 bg-green-50/50 dark:bg-green-900/5"
            content={result.content.whatsapp}
          />

          <ChannelCard
            label="SMS"
            icon="📱"
            color="border-blue-200 dark:border-blue-800/40 bg-blue-50/50 dark:bg-blue-900/5"
            content={result.content.sms}
          />

          <ChannelCard
            label="Email"
            icon="📧"
            color="border-purple-200 dark:border-purple-800/40 bg-purple-50/50 dark:bg-purple-900/5"
            content={`Subject: ${result.content.email.subject}\n\n${result.content.email.body}`}
            extra={
              <div className="mb-3 p-2.5 rounded-lg bg-background/60 border">
                <p className="text-xs text-muted-foreground mb-0.5">Subject line</p>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{result.content.email.subject}</p>
                  <CopyButton text={result.content.email.subject} />
                </div>
              </div>
            }
          />

          <ChannelCard
            label="Facebook Post"
            icon="📘"
            color="border-indigo-200 dark:border-indigo-800/40 bg-indigo-50/50 dark:bg-indigo-900/5"
            content={result.content.facebook}
          />

          <ChannelCard
            label="Instagram Caption"
            icon="📸"
            color="border-pink-200 dark:border-pink-800/40 bg-pink-50/50 dark:bg-pink-900/5"
            content={result.content.instagram}
          />

          <div className="flex items-start gap-2 rounded-lg border bg-muted/30 px-4 py-3 text-xs text-muted-foreground">
            <MessageSquare className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <span>
              Review and personalise all generated content before sending. Add your specific prices,
              dates, and contact details where applicable.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
