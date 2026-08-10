"use client";

import { MetricCard } from "./MetricCard";
import { DataTable } from "./DataTable";
import { IconBarChart, IconTarget, IconTrendingUp, IconUsers, IconAward, IconBookOpen } from "../icons";

type LearningAnalytics = {
  quizAttempts: {
    total: number;
    averagePercentage: number;
    completionRate: number;
  };
  topicPerformance: {
    topicId: string;
    label: string;
    correct: number;
    total: number;
    percentage: number;
  }[];
  languageUsage: { language: string; count: number }[];
  revisionPlans: { total: number; active: number };
  repeatQuizUsage: number;
};

export function LearningMetrics({ analytics }: { analytics: LearningAnalytics }) {
  const { quizAttempts, topicPerformance, languageUsage, revisionPlans, repeatQuizUsage } = analytics;

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Quiz Attempts"
          value={quizAttempts.total}
          icon={<IconTarget size={20} />}
          hint={`Avg score: ${quizAttempts.averagePercentage.toFixed(1)}%`}
        />
        <MetricCard
          label="Quiz Completion Rate"
          value={`${quizAttempts.completionRate.toFixed(1)}%`}
          icon={<IconTrendingUp size={20} />}
        />
        <MetricCard
          label="Revision Plans"
          value={revisionPlans.total}
          icon={<IconBookOpen size={20} />}
          hint={`${revisionPlans.active} active`}
        />
        <MetricCard
          label="Repeat Quiz Usage"
          value={repeatQuizUsage}
          icon={<IconAward size={20} />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <IconBarChart size={20} />
            Topic Performance (Platform-wide)
          </h3>
          <DataTable
            columns={[
              { key: "label", header: "Topic", className: "font-medium text-slate-100" },
              {
                key: "percentage",
                header: "Accuracy",
                render: (row) => (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-slate-100 w-16 text-right">{row.percentage.toFixed(1)}%</span>
                    <div className="flex-1 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-400"
                        style={{ width: `${Math.min(row.percentage, 100)}%` }}
                      />
                    </div>
                  </div>
                ),
              },
              {
                key: "total",
                header: "Questions",
                render: (row) => (
                  <span className="text-slate-300 font-mono">{row.correct} / {row.total}</span>
                ),
              },
            ]}
            data={topicPerformance.slice(0, 20)}
            keyAccessor={(row) => row.topicId}
            emptyMessage="No topic performance data available"
          />
        </div>

        <div>
          <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-white">
            <IconUsers size={20} />
            Language Usage
          </h3>
          <DataTable
            columns={[
              { key: "language", header: "Language", className: "font-medium text-slate-100" },
              {
                key: "count",
                header: "Sessions",
                render: (row) => <span className="font-mono text-slate-300">{row.count}</span>,
                className: "text-right",
              },
            ]}
            data={languageUsage}
            keyAccessor={(row) => row.language}
            emptyMessage="No language usage data available"
          />
        </div>
      </div>
    </div>
  );
}