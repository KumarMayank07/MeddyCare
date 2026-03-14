import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Bell, CheckCircle, Trash2, Loader2, Plus, Calendar } from "lucide-react";
import apiService from "@/lib/api";

interface Reminder {
  _id: string;
  title: string;
  description?: string;
  reminderType: "medication" | "checkup" | "followup" | "other";
  scheduledAt: string;
  isCompleted: boolean;
}

const typeColors: Record<string, string> = {
  medication: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300",
  checkup: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  followup: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300",
  other: "bg-muted text-muted-foreground",
};

export default function Reminders() {
  const { toast } = useToast();

  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reminderType, setReminderType] = useState("medication");
  const [scheduledAt, setScheduledAt] = useState("");

  useEffect(() => {
    fetchReminders();
  }, []);

  const fetchReminders = async () => {
    setLoading(true);
    try {
      const { reminders: data } = await apiService.getReminders();
      setReminders(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !scheduledAt) return;

    setSaving(true);
    try {
      const { reminder } = await apiService.createReminder({ title, description, reminderType, scheduledAt });
      setReminders((prev) => [reminder, ...prev]);
      setTitle("");
      setDescription("");
      setScheduledAt("");
      setReminderType("medication");
      toast({ title: "Reminder saved!" });
    } catch (err: any) {
      toast({ title: "Failed to save", description: err.message || "Try again", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleComplete = async (id: string) => {
    try {
      await apiService.completeReminder(id);
      setReminders((prev) => prev.map((r) => (r._id === id ? { ...r, isCompleted: true } : r)));
      toast({ title: "Marked as done!" });
    } catch {
      toast({ title: "Failed to update", variant: "destructive" });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiService.deleteReminder(id);
      setReminders((prev) => prev.filter((r) => r._id !== id));
      toast({ title: "Reminder deleted" });
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  };

  const upcoming = reminders.filter((r) => !r.isCompleted);
  const completed = reminders.filter((r) => r.isCompleted);

  return (
    <div className="container py-10 space-y-8">
      <div className="flex items-center gap-3">
        <Bell className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">Care Reminders</h1>
          <p className="text-sm text-muted-foreground">Schedule medications, checkups, and follow-ups</p>
        </div>
      </div>

      {/* Create Form */}
      <Card className="p-6">
        <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
          <Plus className="h-5 w-5" /> New Reminder
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title *</Label>
              <Input
                id="title"
                placeholder="e.g. Metformin 500mg"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="type">Type</Label>
              <select
                id="type"
                value={reminderType}
                onChange={(e) => setReminderType(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="medication">Medication</option>
                <option value="checkup">Checkup</option>
                <option value="followup">Follow-up</option>
                <option value="other">Other</option>
              </select>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="desc">Notes (optional)</Label>
              <Input
                id="desc"
                placeholder="Additional notes"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="datetime">Date & Time *</Label>
              <Input
                id="datetime"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
            </div>
          </div>
          <Button
            type="submit"
            disabled={saving}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Save Reminder
          </Button>
        </form>
      </Card>

      {/* Upcoming Reminders */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Upcoming ({upcoming.length})
        </h2>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        ) : upcoming.length === 0 ? (
          <Card className="p-8 text-center border-dashed">
            <Bell className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
            <p className="text-muted-foreground">No upcoming reminders. Add one above!</p>
          </Card>
        ) : (
          upcoming.map((r) => (
            <Card key={r._id} className="p-4 flex items-center justify-between gap-4 hover:shadow-md transition-shadow">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-semibold truncate">{r.title}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${typeColors[r.reminderType]}`}>
                    {r.reminderType}
                  </span>
                </div>
                {r.description && (
                  <p className="text-sm text-muted-foreground truncate">{r.description}</p>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  {new Date(r.scheduledAt).toLocaleString("en-US", {
                    weekday: "short", month: "short", day: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-green-600 hover:text-green-700 hover:border-green-300"
                  onClick={() => handleComplete(r._id)}
                >
                  <CheckCircle className="h-4 w-4" /> Done
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500 hover:text-red-600"
                  onClick={() => handleDelete(r._id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </Card>
          ))
        )}
      </div>

      {/* Completed */}
      {completed.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold text-muted-foreground">
            Completed ({completed.length})
          </h2>
          {completed.map((r) => (
            <Card key={r._id} className="p-4 flex items-center justify-between gap-4 opacity-60">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500 shrink-0" />
                  <span className="font-medium line-through truncate">{r.title}</span>
                  <Badge variant="secondary" className="text-xs">{r.reminderType}</Badge>
                </div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-red-400 hover:text-red-600 shrink-0"
                onClick={() => handleDelete(r._id)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
