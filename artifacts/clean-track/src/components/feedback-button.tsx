import { useState } from "react";
import { MessageSquarePlus, Bug, Lightbulb, Star, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

type FeedbackType = "bug" | "feature" | "general";

const TYPES: { id: FeedbackType; icon: React.ElementType; label: string; placeholder: string }[] = [
  { id: "bug", icon: Bug, label: "Report a bug", placeholder: "Describe what happened and what you expected instead…" },
  { id: "feature", icon: Lightbulb, label: "Request a feature", placeholder: "Describe the feature and the problem it would solve…" },
  { id: "general", icon: Star, label: "General feedback", placeholder: "What's on your mind? What's working well or could be better?" },
];

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<FeedbackType>("general");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const selected = TYPES.find((t) => t.id === type)!;

  const handleSend = async () => {
    if (!text.trim()) {
      toast.error("Please enter your feedback before sending.");
      return;
    }
    setSending(true);
    try {
      const subject = encodeURIComponent(`[CleanTrack ${type === "bug" ? "Bug Report" : type === "feature" ? "Feature Request" : "Feedback"}]`);
      const body = encodeURIComponent(`Type: ${selected.label}\n\n${text.trim()}`);
      window.open(`mailto:support@cleantrack.ng?subject=${subject}&body=${body}`, "_blank");
      toast.success("Your email client has been opened. Send the email to complete your report — thanks!");
      setText("");
      setOpen(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Send feedback"
        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground transition-colors"
      >
        <MessageSquarePlus className="h-4 w-4 shrink-0" />
        <span>Feedback</span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquarePlus className="h-5 w-5 text-primary" />
              Send Feedback
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {TYPES.map(({ id, icon: Icon, label }) => (
                <button
                  key={id}
                  onClick={() => setType(id)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-3 text-center text-xs font-medium transition-colors ${
                    type === id
                      ? "border-primary bg-primary/5 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>{selected.label}</Label>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
                placeholder={selected.placeholder}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 resize-none"
              />
            </div>

            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSend} disabled={sending} className="gap-2">
                <Send className="h-4 w-4" />
                {sending ? "Opening…" : "Send Feedback"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
