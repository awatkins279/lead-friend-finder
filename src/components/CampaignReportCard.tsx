import { useServerFn } from "@tanstack/react-start";
import { getCampaignReport, type CampaignReport } from "@/lib/campaign-reporting.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Mail, Phone, Star, TrendingUp, MessageCircle, CheckCircle } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Progress } from "@/components/ui/progress";

export function CampaignReportCard({ listId }: { listId: string }) {
  const fetchReport = useServerFn(getCampaignReport);
  const { data: report, isLoading } = useQuery({
    queryKey: ["campaign-report", listId],
    queryFn: () => fetchReport({ data: { listId } }),
    refetchInterval: 30000,
  });

  if (isLoading || !report) {
    return (
      <Card className="p-6 space-y-4">
        <div className="animate-pulse space-y-3">
          <div className="h-4 bg-white/10 rounded w-1/3" />
          <div className="h-8 bg-white/10 rounded" />
          <div className="h-4 bg-white/10 rounded w-2/3" />
        </div>
      </Card>
    );
  }

  const r = report;
  const replyRate = r.emailsSent > 0 ? Math.round((r.repliesReceived / r.emailsSent) * 100) : 0;
  const interestRate =
    r.repliesReceived > 0 ? Math.round((r.interestedReplies / r.repliesReceived) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Key metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <MetricCard
          icon={<Users className="h-4 w-4" />}
          label="Leads"
          value={r.totalLeads}
          sub={`${r.enriched} enriched`}
        />
        <MetricCard
          icon={<Mail className="h-4 w-4" />}
          label="Emails"
          value={r.emailsSent}
          sub={`${replyRate}% reply rate`}
        />
        <MetricCard
          icon={<Phone className="h-4 w-4" />}
          label="Calls"
          value={r.callsAttempted}
          sub={r.callsCompleted > 0 ? `${r.callsCompleted} completed` : "none yet"}
        />
        <MetricCard
          icon={<Star className="h-4 w-4" />}
          label="Interested"
          value={r.interestedReplies}
          sub={
            r.meetingsBooked > 0 ? `${r.meetingsBooked} meetings` : `${interestRate}% of replies`
          }
        />
      </div>

      {/* Progress bars */}
      <Card className="p-4 space-y-3">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-green-400" /> Pipeline
        </h4>
        <PipelineBar
          label="Enriched"
          value={r.enriched}
          max={r.totalLeads}
          color="bg-blue-500/50"
        />
        <PipelineBar
          label="Scripted"
          value={r.scripted}
          max={r.totalLeads}
          color="bg-purple-500/50"
        />
        <PipelineBar label="Active" value={r.active} max={r.totalLeads} color="bg-green-500/50" />
      </Card>

      {/* Call scores */}
      {r.callsScored > 0 && r.avgCallScore != null && (
        <Card className="p-4 space-y-2">
          <h4 className="text-sm font-semibold flex items-center gap-2">
            <Phone className="h-4 w-4 text-purple-400" /> Call Performance
          </h4>
          <div className="flex items-center gap-3">
            <div className="text-2xl font-bold text-purple-400">{r.avgCallScore}/100</div>
            <div className="text-xs text-muted-foreground">
              Average across {r.callsScored} scored calls
            </div>
          </div>
        </Card>
      )}

      {/* Reply stats */}
      <Card className="p-4 space-y-2">
        <h4 className="text-sm font-semibold flex items-center gap-2">
          <MessageCircle className="h-4 w-4 text-blue-400" /> Replies
        </h4>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div>
            <span className="text-muted-foreground">Total:</span>{" "}
            <span className="font-medium">{r.repliesReceived}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Unsubscribes:</span>{" "}
            <span className="font-medium text-amber-400">{r.unsubscribes}</span>
          </div>
          <div>
            <span className="text-muted-foreground">Meetings:</span>{" "}
            <span className="font-medium text-green-400">{r.meetingsBooked}</span>
          </div>
        </div>
      </Card>

      {/* Top performers */}
      {r.topPerformers.length > 0 && (
        <Card className="p-4 space-y-2">
          <h4 className="text-sm font-semibold">Top Sending Accounts</h4>
          <div className="space-y-1">
            {r.topPerformers.map((p, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground truncate mr-2">{p.email}</span>
                <span className="font-medium">{p.replies} replies</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <Card className="p-3 space-y-1">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="text-xl font-bold">{value.toLocaleString()}</div>
      <div className="text-[10px] text-muted-foreground">{sub}</div>
    </Card>
  );
}

function PipelineBar({
  label,
  value,
  max,
  color,
}: {
  label: string;
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-muted-foreground w-16">{label}</span>
      <Progress value={pct} className="flex-1 h-2" />
      <span className="text-xs font-medium w-8 text-right">{value}</span>
    </div>
  );
}
