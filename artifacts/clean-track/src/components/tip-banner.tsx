/**
 * TipBanner — Rotating educational tips for laundry operators.
 *
 * Shows one tip per day, rotating through a curated list.
 * Dismissable per tip (stored in localStorage).
 * Does not interrupt workflows.
 */

import { useState, useEffect } from "react";
import { X, Lightbulb } from "lucide-react";

const TIPS = [
  {
    id: "tip-1",
    text: "Recording pickups immediately reduces customer disputes by up to 80%. Never wait until end of day.",
  },
  {
    id: "tip-2",
    text: "Customers who receive WhatsApp reminders are 3× more likely to pick up clothes within 2 days.",
  },
  {
    id: "tip-3",
    text: "Separating white garments before washing reduces discoloration and keeps them looking new longer.",
  },
  {
    id: "tip-4",
    text: "Removing wine and juice stains is much easier when treated within the first 30 minutes.",
  },
  {
    id: "tip-5",
    text: "Tracking expenses weekly (not monthly) helps you catch cost overruns before they affect your profit.",
  },
  {
    id: "tip-6",
    text: "Customers who feel remembered by name spend 25% more. Use the customer history tab to prepare before they arrive.",
  },
  {
    id: "tip-7",
    text: "Agbada and embroidered garments should always be washed separately to prevent color transfer and fabric damage.",
  },
  {
    id: "tip-8",
    text: "A 10% discount for customers who refer a friend costs less than running any paid advertisement.",
  },
  {
    id: "tip-9",
    text: "Batch processing same-day orders together reduces mixing errors and speeds up your workflow significantly.",
  },
  {
    id: "tip-10",
    text: "Delicate fabrics like lace and chiffon should be air-dried — even low heat from a dryer can cause shrinkage.",
  },
  {
    id: "tip-11",
    text: "Following up with customers 2 weeks after pickup is the simplest way to increase repeat visits.",
  },
  {
    id: "tip-12",
    text: "Reviewing your top 20 customers monthly shows you who your most valuable relationships are — reward them.",
  },
  {
    id: "tip-13",
    text: "Using zippers-up and buttons-undone when washing prevents snagging and extends the life of garments.",
  },
  {
    id: "tip-14",
    text: "Outstanding balances older than 30 days are 60% less likely to be paid. Send reminders within the first week.",
  },
  {
    id: "tip-15",
    text: "Worker handover checklists prevent clothes from being missed when shifts change mid-day.",
  },
];

const STORAGE_KEY = "ct_dismissed_tips";

function getDismissedTips(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

function dismissTip(id: string): void {
  try {
    const dismissed = getDismissedTips();
    dismissed.add(id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch {
    // localStorage unavailable — silent fail
  }
}

function pickTip(): (typeof TIPS)[0] | null {
  const dismissed = getDismissedTips();
  const available = TIPS.filter((t) => !dismissed.has(t.id));
  if (available.length === 0) return null;

  // Rotate based on day of year so it changes daily but stays stable within a day
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000
  );
  return available[dayOfYear % available.length];
}

export function TipBanner() {
  const [tip, setTip] = useState<(typeof TIPS)[0] | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = pickTip();
    if (t) {
      setTip(t);
      setVisible(true);
    }
  }, []);

  function handleDismiss() {
    if (tip) {
      dismissTip(tip.id);
    }
    setVisible(false);
  }

  if (!visible || !tip) return null;

  return (
    <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-900/10 px-4 py-3 text-sm">
      <Lightbulb className="h-4 w-4 text-amber-500 mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-amber-700 dark:text-amber-400 mr-1.5">Did you know?</span>
        <span className="text-amber-700 dark:text-amber-300">{tip.text}</span>
      </div>
      <button
        onClick={handleDismiss}
        className="text-amber-400 hover:text-amber-600 dark:hover:text-amber-200 shrink-0 ml-1 -mt-0.5"
        aria-label="Dismiss tip"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
